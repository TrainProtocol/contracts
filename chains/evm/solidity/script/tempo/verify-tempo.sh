#!/usr/bin/env bash
# Source verification against Tempo's verifier (contracts.tempo.xyz, Sourcify-v2 API).
#
# Plain `forge verify-contract --verifier sourcify --verifier-url ...` does NOT work against
# this verifier (forge emits an Etherscan-format payload once --verifier-url is set — documented
# in DEPLOYMENTS.md from the Moderato verification). This script implements the proven direct
# method: build std-json under FOUNDRY_PROFILE=tempo (so it carries evmVersion=osaka + viaIR),
# POST it to /v2/verify/<chainid>/<address> with a browser User-Agent (Cloudflare 403s default
# curl UAs), then poll the returned verificationId.
#
# Usage: script/tempo/verify-tempo.sh <address> <path:Name> <chainid> [creationTxHash]
#   e.g. script/tempo/verify-tempo.sh 0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29 \
#          src/tempo/Train.sol:Train 4217 0x<deploy tx>
set -euo pipefail
cd "$(dirname "$0")/../.."

ADDR=${1:?address}; IDENT=${2:?path:Name}; CHAIN=${3:?chainid}; TX=${4:-}
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BASE=https://contracts.tempo.xyz

echo "[verify-tempo] building standard-json-input (FOUNDRY_PROFILE=tempo)..."
# ETHERSCAN_API_KEY is referenced by foundry.toml's [etherscan] table and must merely exist for
# config parsing — Tempo's verifier is keyless and never sees it.
STD=$(FOUNDRY_PROFILE=tempo ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:-unused}" \
  forge verify-contract "$ADDR" "$IDENT" --show-standard-json-input)

STDFILE=$(mktemp); trap 'rm -f "$STDFILE"' EXIT
printf '%s' "$STD" > "$STDFILE"
BODY=$(python3 -c "
import json,sys
std=json.load(open(sys.argv[1]))
ident,tx=sys.argv[2],sys.argv[3]
body={'stdJsonInput':std,'compilerVersion':'v0.8.34+commit.80d5c536','contractIdentifier':ident}
if tx: body['creationTransactionHash']=tx
print(json.dumps(body))
" "$STDFILE" "$IDENT" "$TX")

echo "[verify-tempo] POST $BASE/v2/verify/$CHAIN/$ADDR"
RESP=$(printf '%s' "$BODY" | curl -s -m 60 -X POST "$BASE/v2/verify/$CHAIN/$ADDR" \
  -H "Content-Type: application/json" -H "User-Agent: $UA" --data-binary @-)
echo "[verify-tempo] response: $RESP"
VID=$(printf '%s' "$RESP" | python3 -c "import json,sys
try: print(json.load(sys.stdin).get('verificationId',''))
except Exception: print('')")
[ -n "$VID" ] || { echo "[verify-tempo] no verificationId — inspect response above"; exit 1; }

for i in $(seq 1 12); do
  sleep 5
  ST=$(curl -s -m 30 "$BASE/v2/verify/$VID" -H "User-Agent: $UA")
  echo "[verify-tempo] poll $i: $ST"
  echo "$ST" | grep -qiE '"(status|state)"\s*:\s*"?(success|verified|exact_match|match)' && { echo "[verify-tempo] VERIFIED"; exit 0; }
  echo "$ST" | grep -qiE '"(status|state)"\s*:\s*"?(fail|error)' && { echo "[verify-tempo] FAILED"; exit 1; }
done
echo "[verify-tempo] still pending — check $BASE/v2/verify/$VID later"
