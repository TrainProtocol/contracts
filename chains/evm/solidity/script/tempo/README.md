# Tempo deploy + on-chain test flow

Deploy [`src/tempo/Train.sol`](../../src/tempo/Train.sol) + `ConstantPayoutCurve` to Tempo and exercise
both integration paths with real transactions: direct Foundry-script calls, and the **native
batched-and-sponsored** flow that replaces `TrainRouter` on this chain entirely (see the main
[README](../../README.md), trust assumptions 7–9).

| Thing | Value |
|---|---|
| Testnet | Moderato, chain id `42431` (`0xA5F7`) |
| Mainnet | chain id `4217` (`0x1079`) — not deployed yet |
| RPC (testnet) | `https://rpc.moderato.tempo.xyz` |
| Explorer (testnet) | `https://explore.testnet.tempo.xyz` |
| Verifier | `https://contracts.tempo.xyz` (Sourcify-compatible; **no Etherscan, no API key**) |
| pathUSD (6 decimals, fee-fallback TIP-20) | `0x20C0000000000000000000000000000000000000` |

All commands run from `chains/evm/solidity/`.

---

## 0. Prerequisites

1. **pathUSD**, not native ETH — Tempo has no native gas token. Fund every address that will
   broadcast anything (deployer, user, fee-payer) via the public faucet:
   ```bash
   curl -X POST https://tempo.xyz/developers/api/faucet -H "Content-Type: application/json" \
     -d '{"address":"0xYourAddress"}'
   # or: cast rpc tempo_fundAddress 0xYourAddress --rpc-url https://rpc.moderato.tempo.xyz
   ```
   1,000,000 pathUSD per request. `eth_getBalance` on Tempo always returns a fixed sentinel regardless
   of actual balance — it is **not** a valid affordability check; `DeployTempo.s.sol` checks pathUSD
   directly instead.
2. **A plain EOA key**, same caveat as the Sepolia flow — a smart-account/EIP-7702-delegated address can
   break signature checks and hits Tempo's own account-creation gas surcharge differently.

## 1. Environment

```bash
export PRIVATE_KEY=0x...    # deployer (pathUSD-funded, not ETH)
export USER_PK=0x...        # signer for the Foundry test scripts (pathUSD-funded)
```

## 2. Build

```bash
$env:FOUNDRY_PROFILE="tempo"    # PowerShell; use  export FOUNDRY_PROFILE=tempo  in bash
forge build
```

`[profile.tempo]` in `foundry.toml` targets `evm_version = "osaka"` (Tempo's hard fork) — `[profile.default]`
(`cancun`) is what the other 6 EVM chains use and stays untouched.

## 3. Deploy

```bash
forge script script/tempo/DeployTempo.s.sol --sig 'predict()'      # offline address preview, no RPC
forge script script/tempo/DeployTempo.s.sol \
  --rpc-url https://rpc.moderato.tempo.xyz --broadcast \
  --verify --verifier-url https://contracts.tempo.xyz
```

Deploys `ConstantPayoutCurve` + `src/tempo/Train.sol`'s `Train` only — **no `TrainRouter`** (see README
trust assumption 9). Same CREATE2 mechanics as `script/DeployDeterministic.s.sol` (idempotent,
permissionless, same salt) — the resulting addresses legitimately differ from the shared 7-testnet set,
since `evm_version = osaka` changes the initcode regardless of the source-level differences.

**Copy the printed export** into your shell:
```bash
export TRAIN=0x...
```

Record the deployed addresses in [`DEPLOYMENTS.md`](../../DEPLOYMENTS.md) once broadcast.

## 3a. One-time setup — USER approves Train for pathUSD

`userLock`/`solverLock` pull pathUSD via `transferFrom`, so the user needs a standing approval
before any direct-call test script below can broadcast (skip this only for the native gasless flow
in step 5, which batches its own `approve` per-call and needs no standing allowance):

```bash
forge script script/tempo/Setup.s.sol --rpc-url https://rpc.moderato.tempo.xyz --broadcast
```

## 4. Direct (non-gasless) flows — broadcast as USER

`userLock → redeemUser` happy path, plus the solver-reward routing branches and the two refund cycles.
Funds cycle back where noted, net pathUSD ≈ 0.

```bash
forge script script/tempo/TestDirect.s.sol       --rpc-url https://rpc.moderato.tempo.xyz --broadcast
forge script script/tempo/TestSolverReward.s.sol --rpc-url https://rpc.moderato.tempo.xyz --broadcast
```

Expected: `... OK` lines, `lock.status : 3` (Redeemed).

### 4a. Unhappy paths

```bash
forge script script/tempo/TestUnhappy.s.sol --sig 'wrongSecret()'         --rpc-url https://rpc.moderato.tempo.xyz --broadcast --skip-simulation
forge script script/tempo/TestUnhappy.s.sol --sig 'doubleRedeem()'        --rpc-url https://rpc.moderato.tempo.xyz --broadcast --skip-simulation
forge script script/tempo/TestUnhappy.s.sol --sig 'earlyRefund()'         --rpc-url https://rpc.moderato.tempo.xyz --broadcast --skip-simulation
forge script script/tempo/TestUnhappy.s.sol --sig 'duplicateSolverLock()' --rpc-url https://rpc.moderato.tempo.xyz --broadcast --skip-simulation
```

Exercises wrong-secret redeem (`HashlockMismatch`), double-redeem (`LockNotPending`), an early
non-recipient refund attempt (`RefundNotAllowed`), and a same-solver duplicate `solverLock`
(`SolverLockAlreadyExists` — the v3 retry/double-funding guard) — each via a low-level `.call` so the
expected revert doesn't halt the script; look for `reverted as expected: true` and the decoded reason
on each line.

### 4b. Refund cycles (timelock-gated) — two steps, ~60s apart

```bash
export REFUND_SALT=$(date +%s)
forge script script/tempo/TestRefundLock.s.sol  --rpc-url https://rpc.moderato.tempo.xyz --broadcast
#   ... wait ~60s ...
forge script script/tempo/TestRefundClaim.s.sol --rpc-url https://rpc.moderato.tempo.xyz --broadcast

export REFUND_SALT=s-$(date +%s)
forge script script/tempo/TestSolverRefund.s.sol      --rpc-url https://rpc.moderato.tempo.xyz --broadcast
#   ... wait ~60s ...
forge script script/tempo/TestSolverRefundClaim.s.sol --rpc-url https://rpc.moderato.tempo.xyz --broadcast
```

## 5. The native gasless flow (primary integration path)

This is what replaces `TrainRouter` on Tempo: one Tempo Transaction batches `pathUSD.approve(Train,
amount)` + `Train.userLock(...)`, a separate fee-payer signs and pays, and both calls execute with
`msg.sender == the real user` — proven live against the then-deployed v2 `Train`
(`0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29`; the current v3 deployment is
`0xCb74407724c463EAA9bC661818364b532F8B5Cb5` — see [`DEPLOYMENTS.md`](../../DEPLOYMENTS.md)) on Moderato: lock
[`0x99995e1419aab812fa4fd17ac1fd8945a6bb37da40db190560f78e8af06af226`](https://explore.testnet.tempo.xyz/tx/0x99995e1419aab812fa4fd17ac1fd8945a6bb37da40db190560f78e8af06af226)
then redeem
[`0x306dd372da5878d56318ff24ee024dc84950adaabb4c0a0fcdeb1244ae421578`](https://explore.testnet.tempo.xyz/tx/0x306dd372da5878d56318ff24ee024dc84950adaabb4c0a0fcdeb1244ae421578)
— see [`DEMO.md`](DEMO.md) for the full transaction list. It can't be expressed as a Foundry script
(Tempo Transactions are a distinct signed-envelope format outside `vm.broadcast`'s model) — use
[`native_flow.py`](native_flow.py), which has separate `lock` and `redeem` subcommands:

```bash
pip install pytempo web3 eth-account

python script/tempo/native_flow.py lock \
  --train $TRAIN --sender-key $USER_PK --fee-payer-key $FEE_PAYER_PK \
  --amount 10000 --rpc https://rpc.moderato.tempo.xyz
# prints a secret + hashlock -- save both, then:
python script/tempo/native_flow.py redeem \
  --train $TRAIN --sender-key $USER_PK --fee-payer-key $FEE_PAYER_PK \
  --secret <secret from lock step> --rpc https://rpc.moderato.tempo.xyz
```

`cast`'s `-tempo` nightly build (`foundryup -n tempo`) has a reproducible bug where `batch-send`/`send`
silently drop `--tempo.sponsor-signature` — don't use `cast` for anything involving a fee-payer
signature; `pytempo` is the tool that actually works.

**Gas note:** `native_flow.py`'s defaults (`LOCK_GAS_LIMIT = 3_000_000`, `REDEEM_GAS_LIMIT = 1_000_000`)
are set from real measured costs, not estimates — a local `cast run`/revm trace only shows regular
execution gas (~80k–300k) and misses TIP-1000's state-creation surcharges entirely (250,000 gas per
zero→nonzero storage slot), so it will look fine locally right up until the real chain rejects it out
of gas. Against the real deployed `Train`, a `lock` for an already-active sender measured
`1,610,173` gas (less than a first-ever-account `lock`, which measured `2,107,473` in earlier testing —
the extra ~500k is TIP-1000's one-time first-transaction account-creation surcharge); `redeem` measured
`320,872` gas. Use `--gas-limit` to override either subcommand's default if needed.

## 6. Solver operational model

A solver calling `Train.solverLock`/`redeemSolver`/`refundSolver` acts with its **own** funds and
authority — the native-sponsorship flow above covers the *user's* side of a swap, not the solver's own
gas. Since `Train` isn't a TIP-20 contract, Tempo's fee-token precedence resolves to pathUSD by default
for these calls, so every solver needs a standing pathUSD balance held purely to cover gas, separate
from whatever principal it locks or redeems. Running dry on pathUSD, not on swap capital, is the
failure mode to alert on.

**Cost** (post-T7 dynamic base fee, floor 6×10⁸ / cap 1.2×10¹⁰ attodollars/gas):

| Action | Gas (approx.) | Cost @ floor | Cost @ cap |
|---|---|---|---|
| `redeemSolver` / `refundSolver` (warm) | 50k–100k | $0.00003–$0.00006 | $0.0006–$0.0012 |
| `solverLock` (warm) | 100k–200k | $0.00006–$0.00012 | $0.0012–$0.0024 |
| + first-time account or new counterparty slot | +250k | +$0.00015 | +$0.003 |

**TIP-403 self-monitoring:** a solver becomes `recipient`/`refundTo` on locks in tokens it doesn't
control, and pathUSD itself runs an admin-controlled blacklist (README trust assumption 8). Nothing
pushes a notification if a solver gets blacklisted — poll `TIP403Registry.isAuthorizedRecipient(policyId,
self)` / `isAuthorizedSender(policyId, self)` at `0x403c0000000000000000000000000000000000000` for the
target token's active `transferPolicyId` before accepting a new lock in that token.

**Nonce management:** for concurrent in-flight swaps, prefer TIP-1009 expiring nonces
(`nonceKey = type(uint256).max`, `validBefore` ~30s out) over Tempo's plain 2D nonce keys — expiring
nonces let every swap's calls submit in parallel without leaving permanent unused-key state on-chain, and
a 30s window is trivial against HTLC timelocks measured in minutes to hours. Avoid the sequential
(key-0) nonce for concurrent workloads — one slow transaction blocks every other one behind it.

## 7. Before finalizing a new deploy salt

Check `isVirtualAddress(predictedAddress)` on the Address Registry (`0xFDC0000000000000000000000000000000000000`,
`pure`, no RPC needed) before broadcasting a new `CREATE2_SALT` — confirmed non-issue for the current
addresses, but cheap to keep checking on every future redeploy.

---

## What each script does

| Script | Broadcaster | Flow |
|---|---|---|
| `DeployTempo.s.sol` | deployer | deploy curve + `Train` (no `TrainRouter`) |
| `Setup.s.sol` | USER | one-time pathUSD approval for `Train` |
| `TestDirect.s.sol` | USER | userLock → redeemUser |
| `TestSolverReward.s.sol` | USER | solverLock(+reward) → redeemSolver, both reward-routing branches |
| `TestSolverRefund.s.sol` / `TestSolverRefundClaim.s.sol` | USER | solver lock, 60s timelock, refund |
| `TestRefundLock.s.sol` / `TestRefundClaim.s.sol` | USER | user lock, 60s timelock, refund |
| `TestUnhappy.s.sol` (`--sig 'wrongSecret()'` / `'doubleRedeem()'` / `'earlyRefund()'` / `'duplicateSolverLock()'`) | USER | wrong-secret / double-redeem / early-refund / same-solver duplicate `solverLock` (the v3 `SolverLockAlreadyExists` guard), all real broadcasts that revert on-chain as expected — each is its own `--sig` entrypoint since `forge script --broadcast` halts the whole run on the first transaction that reverts, and here every scenario deliberately sends one; use `--skip-simulation` too, since forge's default pre-broadcast simulation also refuses to send a call it can see will revert |
| `native_flow.py lock` / `native_flow.py redeem` | sender + fee-payer (Python/pytempo) | batched `approve`+`userLock`, sponsored; separate sponsored `redeemUser` |

See [`DEMO.md`](DEMO.md) for every real transaction hash produced by a full run of this suite against
the live deployment, with the native gas-sponsorship flow front and center.

Tune `AMOUNT` / `REWARD` in `TempoConfig.s.sol`. Broadcast receipts (tx hashes) are written under
`broadcast/<script>/42431/`.

## Troubleshooting

- **`InsufficientPulled`-style or plain balance reverts** — the account is short on pathUSD; top up via
  the faucet. Remember the *fee payer* needs pathUSD too, separately from whatever the *sender* is
  locking.
- **`SwapAlreadyExists`** — that hashlock is taken; the test scripts auto-randomize per run, so re-run
  rather than reuse a salt.
- **`RefundNotAllowed`** — the 60s timelock hasn't passed yet; wait a few more seconds (Tempo blocks are
  ~0.6s, so this is fast) before the claim step.
- **`forge script --broadcast` errors `Simulated execution failed` before sending anything, or
  `Failed to estimate gas for tx ... execution reverted` after `--skip-simulation`** — this is expected
  when a script deliberately sends a call meant to revert (as in `TestUnhappy.s.sol`): forge's default
  flow both pre-simulates every recorded transaction and calls `eth_estimateGas` before sending, and
  both steps refuse a call they can see will revert. Fix: give the reverting call's low-level `.call`
  an explicit `{ gas: N }` value (this skips `eth_estimateGas` — forge uses the literal value as the
  tx's gas limit instead) and pass `--skip-simulation`. Separately, `forge script --broadcast` halts
  the *entire remaining run* the instant any transaction it sends reverts on-chain, even one you
  expected — there's no "continue anyway" flag — so a script with multiple independent
  expected-revert scenarios needs one `--sig`-targeted entrypoint per scenario, not one `run()` with
  all of them, or the first revert silently prevents every scenario after it from ever broadcasting.
  The `Error: Transaction Failure: 0x...` forge prints in this case is not a real failure — it's proof
  the revert-triggering transaction was sent and confirmed reverted for the expected reason (check the
  tx on the explorer, or `cast receipt <hash>`, to confirm status `0` with the expected custom error).
- **A batched+sponsored transaction reverts with `feePayerSignature: null` still set** — you're
  probably using `cast batch-send`, which is known-broken for this on the current `-tempo` nightly
  build; use `native_flow.py` (pytempo) instead.
- **Verification fails** — confirm `--verifier-url https://contracts.tempo.xyz` is passed exactly (not
  `--verifier etherscan`, which doesn't exist on Tempo); re-verify a single contract with
  `forge verify-contract <addr> <path:Name> --verifier-url https://contracts.tempo.xyz --watch`.
