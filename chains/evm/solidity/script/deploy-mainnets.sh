#!/usr/bin/env bash
# Resumable, fund-shortage-tolerant multi-mainnet deploy of Train (CREATE2, same address
# everywhere). Bash port of script/deploy-testnets.ps1's orchestration logic, mainnet scope.
#
# Per chain (never aborts the loop):
#   1. skip if Train code already exists at the predicted address        -> ALREADY_DEPLOYED
#   2. probe TSTORE (Cancun / EIP-1153, required by ReentrancyGuardTransient)
#   3. balance preflight (gasPrice * GAS_EST * BUFFER); if short          -> NEEDS_FUNDS (continues!)
#   4. forge script DeployTrainOnly --broadcast                          -> DEPLOYED / FAILED
#   5. verify (Etherscan v2 for the five; Blockscout for Robinhood)
#   6. append to deployments/mainnets.json
#
# Re-running finishes only what's missing: deployed chains no-op at step 1, verification
# retries independently of deployment (VERIFY_ONLY=1 skips deploy attempts entirely).
#
# Env: PRIVATE_KEY (required to broadcast), ETHERSCAN_API_KEY (required to verify the five),
#      optional <CHAIN>_RPC_URL overrides, optional CHAINS="ethereum polygon" subset,
#      DRY_RUN=1 (no broadcast), VERIFY_ONLY=1.
set -u -o pipefail

cd "$(dirname "$0")/.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

TRAIN_ADDR=0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8   # v3, keccak256("train.protocol.v3") via CreateX
GAS_EST=3600000   # measured: a v3 Train deploy uses 3,311,670 gas
BUFFER_NUM=15 BUFFER_DEN=10  # 1.5x
# TSTORE probe: initcode PUSH1 1 PUSH1 0 TSTORE STOP — eth_call succeeds only post-Cancun.
TSTORE_INITCODE=0x600160005d00

# name|chainId|default rpc|env override|verifier(etherscan|blockscout)|blockscout url|native symbol
CHAIN_TABLE="
ethereum|1|https://ethereum-rpc.publicnode.com|ETHEREUM_RPC_URL|etherscan||ETH
arbitrum|42161|https://arb1.arbitrum.io/rpc|ARBITRUM_RPC_URL|etherscan||ETH
optimism|10|https://mainnet.optimism.io|OPTIMISM_RPC_URL|etherscan||ETH
base|8453|https://mainnet.base.org|BASE_RPC_URL|etherscan||ETH
polygon|137|https://polygon-bor-rpc.publicnode.com|POLYGON_RPC_URL|etherscan||POL
bsc|56|https://bsc-rpc.publicnode.com|BSC_RPC_URL|etherscan||BNB
robinhood|4663|https://rpc.mainnet.chain.robinhood.com|ROBINHOOD_RPC_URL|blockscout|https://robinhoodchain.blockscout.com/api|ETH
"

SELECTED="${CHAINS:-ethereum arbitrum optimism base polygon bsc robinhood}"
MANIFEST=deployments/mainnets-v3.json
mkdir -p deployments
[ -f "$MANIFEST" ] || echo '{}' > "$MANIFEST"

rpc() { # rpc <url> <method> <params-json>
  curl -s -m 20 -X POST "$1" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$2\",\"params\":$3,\"id\":1}" | python3 -c '
import json,sys
try:
    r=json.load(sys.stdin)
    print(r["result"] if "result" in r else "ERR:"+json.dumps(r.get("error")))
except Exception: print("ERR:parse")'
}

record() { # record <chain> <status> <extra-json-fields>
  python3 - "$MANIFEST" "$1" "$2" "$3" <<'PYEOF'
import json,sys,datetime
path,chain,status,extra=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
m=json.load(open(path))
e=m.get(chain,{})
e.update({"status":status,"updatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat()})
e.update(json.loads(extra) if extra else {})
m[chain]=e
json.dump(m,open(path,"w"),indent=2)
PYEOF
}

declare -A RESULT
overall=0

for name in $SELECTED; do
  line=$(echo "$CHAIN_TABLE" | grep "^${name}|") || { echo "[$name] unknown chain, skipping"; RESULT[$name]=UNKNOWN_CHAIN; overall=1; continue; }
  IFS='|' read -r _ chainid default_rpc env_var verifier bs_url symbol <<< "$line"
  url="${!env_var:-$default_rpc}"
  echo ""
  echo "=== $name (chainId $chainid) ==="

  # 0. RPC sanity: chain id matches
  got=$(rpc "$url" eth_chainId '[]')
  if [[ "$got" == ERR:* ]] || [ $(( got )) -ne "$chainid" ] 2>/dev/null; then
    echo "[$name] RPC unusable or wrong chain (got $got, want $chainid) — skipping"
    RESULT[$name]=RPC_ERROR; record "$name" RPC_ERROR "{\"rpc\":\"$url\"}"; overall=1; continue
  fi

  # 1. Already deployed?
  code=$(rpc "$url" eth_getCode "[\"$TRAIN_ADDR\",\"latest\"]")
  if [ "${#code}" -gt 4 ] && [[ "$code" != ERR:* ]]; then
    echo "[$name] Train already at $TRAIN_ADDR ($(( (${#code}-2)/2 )) bytes)"
    RESULT[$name]=ALREADY_DEPLOYED
    record "$name" ALREADY_DEPLOYED "{\"address\":\"$TRAIN_ADDR\",\"chainId\":$chainid}"
  else
    # 2. Cancun probe
    probe=$(rpc "$url" eth_call "[{\"data\":\"$TSTORE_INITCODE\"},\"latest\"]")
    if [[ "$probe" == ERR:* ]]; then
      echo "[$name] TSTORE probe FAILED ($probe) — chain may lack Cancun; skipping"
      RESULT[$name]=NO_CANCUN; record "$name" NO_CANCUN "{}"; overall=1; continue
    fi

    # 3. Funds preflight
    if [ -z "${PRIVATE_KEY:-}" ]; then echo "[$name] PRIVATE_KEY unset — DRY (predict only)"; RESULT[$name]=NO_KEY; overall=1; continue; fi
    deployer=$(cast wallet address --private-key "$PRIVATE_KEY")
    bal_hex=$(rpc "$url" eth_getBalance "[\"$deployer\",\"latest\"]")
    gp_hex=$(rpc "$url" eth_gasPrice '[]')
    read -r need bal short <<< "$(python3 -c "
bal=int('$bal_hex',16); gp=int('$gp_hex',16)
need=gp*$GAS_EST*$BUFFER_NUM//$BUFFER_DEN
print(need, bal, max(0,need-bal))")"
    if [ "$short" != "0" ]; then
      hshort=$(python3 -c "print(f'{$short/1e18:.6f}')")
      echo "[$name] NEEDS_FUNDS: deployer $deployer short by $hshort $symbol (need $(python3 -c "print(f'{$need/1e18:.6f}')"), has $(python3 -c "print(f'{$bal/1e18:.6f}')")) — continuing with other chains"
      RESULT[$name]="NEEDS_FUNDS(+$hshort $symbol)"
      record "$name" NEEDS_FUNDS "{\"deployer\":\"$deployer\",\"shortfallWei\":$short,\"symbol\":\"$symbol\"}"
      overall=1; continue
    fi

    # 4. Deploy
    if [ "${DRY_RUN:-0}" = "1" ] || [ "${VERIFY_ONLY:-0}" = "1" ]; then
      echo "[$name] DRY_RUN/VERIFY_ONLY — not broadcasting"; RESULT[$name]=SIMULATED
    else
      echo "[$name] deploying via CREATE2..."
      if FOUNDRY_PROFILE=default forge script script/DeployTrainOnly.s.sol --rpc-url "$url" --broadcast 2>&1 | tail -5; then
        code2=$(rpc "$url" eth_getCode "[\"$TRAIN_ADDR\",\"latest\"]")
        if [ "${#code2}" -gt 4 ]; then
          echo "[$name] ✓ deployed at $TRAIN_ADDR"
          RESULT[$name]=DEPLOYED
          txid=$(python3 -c "
import json,glob
try:
    j=json.load(open('broadcast/DeployTrainOnly.s.sol/$chainid/run-latest.json'))
    print(next((t.get('hash','') for t in j.get('transactions',[])),''))
except Exception: print('')")
          record "$name" DEPLOYED "{\"address\":\"$TRAIN_ADDR\",\"chainId\":$chainid,\"tx\":\"$txid\",\"deployer\":\"$deployer\"}"
        else
          echo "[$name] ✗ broadcast ran but no code at predicted address"; RESULT[$name]=FAILED; record "$name" FAILED "{}"; overall=1; continue
        fi
      else
        echo "[$name] ✗ forge script failed"; RESULT[$name]=FAILED; record "$name" FAILED "{}"; overall=1; continue
      fi
    fi
  fi

  # 5. Verify (idempotent; runs for ALREADY_DEPLOYED too so re-runs finish verification)
  if [ "${DRY_RUN:-0}" != "1" ] && { [ "${RESULT[$name]}" = "DEPLOYED" ] || [ "${RESULT[$name]}" = "ALREADY_DEPLOYED" ]; }; then
    echo "[$name] verifying..."
    if [ "$verifier" = "etherscan" ]; then
      vout=$(FOUNDRY_PROFILE=default forge verify-contract "$TRAIN_ADDR" src/Train.sol:Train \
        --chain "$chainid" --etherscan-api-key "${ETHERSCAN_API_KEY:-}" --watch 2>&1 | tail -3)
    else
      vout=$(FOUNDRY_PROFILE=default forge verify-contract "$TRAIN_ADDR" src/Train.sol:Train \
        --verifier blockscout --verifier-url "$bs_url" --watch 2>&1 | tail -3)
    fi
    echo "$vout"
    if echo "$vout" | grep -qiE "verified|already verified|pass"; then
      record "$name" "${RESULT[$name]}" '{"verified":true}'
      RESULT[$name]="${RESULT[$name]}+VERIFIED"
    else
      record "$name" "${RESULT[$name]}" '{"verified":false}'
      RESULT[$name]="${RESULT[$name]}+VERIFY_PENDING"; overall=1
    fi
  fi
done

echo ""
echo "==================== SUMMARY ===================="
for name in $SELECTED; do printf '  %-10s %s\n' "$name" "${RESULT[$name]:-SKIPPED}"; done
echo "manifest: $MANIFEST"
exit $overall
