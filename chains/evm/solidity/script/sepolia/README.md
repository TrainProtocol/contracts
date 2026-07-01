# Sepolia deploy + on-chain test flow

Deploy `Train` + `TrainRouter` + `ConstantPayoutCurve` to Sepolia and exercise **every flow** with real
transactions, against **real Sepolia USDC** and the canonical **Permit2**.

| Thing | Address (Sepolia) |
|---|---|
| USDC (6 decimals, supports permit + EIP-3009) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Permit2 (canonical) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

> **Validated first.** Every step below was run end-to-end on a Sepolia **fork** (anvil) before
> shipping: deploy, `userLock`/`solverLock`/`userLockFor`, all three gasless TrainRouter paths, and the
> timelock-gated refund cycle all succeeded.

All commands run from `chains/evm/solidity/`.

---

## 0. Prerequisites

1. **Sepolia ETH** in your signer (and relayer, if separate) — any Sepolia faucet.
2. **Sepolia USDC** in the signer — Circle faucet https://faucet.circle.com (chain: Ethereum
   Sepolia). ~1 USDC is plenty (locks are 0.01 USDC and cycle back on redeem/refund).
3. A signer **private key that is a plain EOA with NO code**. If it carries an EIP-7702 delegation,
   `SignatureChecker` uses the ERC-1271 path and the gasless intent signature is rejected
   (`InvalidIntentSignature`). A fresh wallet is fine. See **Troubleshooting**.
4. (Optional) An **Etherscan API key** for `--verify` — https://etherscan.io/myapikey (one v2 key
   works for Sepolia).

## 1. Environment

```bash
export SEPOLIA_RPC_URL=https://...      # your Sepolia RPC (Alchemy / Infura / public node)
export USER_PK=0x...                    # signer: holds USDC, signs gasless intents (plain EOA, no 7702)
export RELAYER_PK=0x...                  # OPTIONAL broadcaster (pays gas, submits TrainRouter txs);
                                        #   omit to self-relay (defaults to USER_PK)
export ETHERSCAN_API_KEY=...            # OPTIONAL, only for --verify
```

Both `USER_PK` and (if set) `RELAYER_PK` accounts need Sepolia ETH for gas. Only `USER_PK` needs USDC.

---

## 2. Build

```bash
forge build
```

## 3. Deploy (with Etherscan verification)

```bash
forge script script/Deploy.s.sol \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast \
  --verify --etherscan-api-key "$ETHERSCAN_API_KEY"
```

Drop `--verify --etherscan-api-key ...` to skip verification.

`Train`, `TrainRouter`, and `ConstantPayoutCurve` are all deployed via `new`, so `--verify` tracks and
verifies all three automatically. (The test flows do not attach a curve; `ConstantPayoutCurve` is
deployed for completeness.)

**Copy the printed exports** into your shell:

```bash
export TRAIN=0x...
export ROUTER=0x...
export CONSTANT_CURVE=0x...
```

## 4. One-time approvals

Signer approves Train (for direct locks) and Permit2 (for the TrainRouter permit2 path) to move its USDC.

```bash
forge script script/sepolia/Setup.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

## 5. Direct (non-gasless) flows — broadcast as USER

`userLock → redeemUser`, `solverLock → redeemSolver`, `userLockFor → redeemUser`. Funds cycle back
(recipient = refundTo = you), net USDC ≈ 0. `userLockFor` attributes the lock to a distinct
beneficiary (you'll see `lock.sender` ≠ your address) to prove on-behalf-of intake.

```bash
forge script script/sepolia/TestDirect.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Expected logs: three `... OK` lines and `lock.status : 3` (Redeemed).

## 5b. Native-ETH direct flows — broadcast as USER

`userLock`/`solverLock` with `token = address(0)` (native ETH), then `redeemUser`/`redeemSolver`. Funds
cycle back (recipient = refundTo = rewardRecipient = you), so net ETH ≈ gas. Native is **not** available
on the gasless Router or `userLockFor` — both are ERC20-only by design (the gasless standards are token
signatures; `userLockFor` uses a pull model).

```bash
forge script script/sepolia/TestNative.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Expected logs: `[1] native userLock -> redeemUser OK`, `[2] native solverLock -> redeemSolver OK`,
`lock.status : 3` (Redeemed).

## 6. Gasless TrainRouter flows — USER signs, RELAYER broadcasts

ERC-2612 permit (+ separate intent sig), Permit2 `permitWitnessTransferFrom` (witness = intent), and
EIP-3009 `receiveWithAuthorization` (nonce = intent). Each pulls USDC from the signer, forwards into
Train, then redeems back. Requires step 4 (Permit2 approval) for the permit2 path.

```bash
forge script script/sepolia/TestRouter.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Expected logs: `[permit] / [permit2] / [3009] TrainRouter -> Train -> redeem OK`, each with
`lock.sender` = your USER address and `lock.status : 3`.

## 7. Refund cycle (timelock-gated) — two steps, ~60s apart

Use the **same** `REFUND_SALT` for both commands (change it for a fresh cycle). The user lock's
recipient is a counterparty (not you), so the refund exercises the timelock path.

```bash
export REFUND_SALT=$(date +%s)
forge script script/sepolia/TestRefundLock.s.sol  --rpc-url "$SEPOLIA_RPC_URL" --broadcast
#   ... wait ~60 seconds (a few Sepolia blocks) ...
forge script script/sepolia/TestRefundClaim.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Expected: `Refunded ...`, `USDC reclaimed (6dp): 22000`, `lock.status : 2` (Refunded).

### 7b. Native-ETH refund cycle (same two-step, timelock-gated pattern)

```bash
export REFUND_SALT=n-$(date +%s)
forge script script/sepolia/TestNativeRefundLock.s.sol  --rpc-url "$SEPOLIA_RPC_URL" --broadcast
#   ... wait ~60 seconds ...
forge script script/sepolia/TestNativeRefundClaim.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Expected: `Refunded native user + solver ...`, a positive `ETH balance delta (wei, net of gas)`, and
`lock.status : 2` (Refunded).

---

## 8. Gasless lock → refund (proves the depositor is refunded)

Confirms that when funds are pulled **gaslessly** (TrainRouter pulls the USER's USDC), the **original
depositor** is the one refunded — even when a third party triggers the refund. The lock is created
via the TrainRouter (user signs, relayer broadcasts) with `refundTo = user` and `recipient = a
counterparty`; after the 60s timelock the **relayer** (not the depositor) calls `refundUser`.

```bash
export REFUND_SALT=g-$(date +%s)
forge script script/sepolia/TestGaslessRefundLock.s.sol  --rpc-url $SEPOLIA_RPC_URL --broadcast
#   ... wait ~60s ...
forge script script/sepolia/TestGaslessRefundClaim.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
```
PowerShell: `$env:REFUND_SALT = "g-" + [DateTimeOffset]::Now.ToUnixTimeSeconds()` then the same two
`forge script ... --broadcast` lines with `$env:SEPOLIA_RPC_URL`.

Expected on claim: `USDC -> depositor (user) : 10000`, `USDC -> relayer (caller) : 0`,
`lock.status : 2` (Refunded) — i.e., the depositor whose tokens were pulled gets them back, not the
caller/relayer. (The relayer needs Sepolia ETH for gas on both txs.)

## Full flow at a glance

```
build → Deploy(+verify) → [export TRAIN/ROUTER] → Setup
      → TestDirect → TestNative → TestRouter → TestRefundLock → (wait 60s) → TestRefundClaim
      → TestNativeRefundLock → (wait 60s) → TestNativeRefundClaim
```

## Windows PowerShell — full command sequence

The commands above use bash (`export VAR=...`, `$VAR`). In **PowerShell** set env vars with
`$env:NAME = "value"` and reference them as `$env:NAME`:

```powershell
cd C:\Users\nerse\Desktop\contracts\chains\evm\solidity
$env:SEPOLIA_RPC_URL   = "https://ethereum-sepolia-rpc.publicnode.com"
$env:USER_PK           = "0xYOUR_EOA_KEY"        # plain EOA, no 7702 delegation
$env:RELAYER_PK        = "0xYOUR_RELAYER_KEY"    # optional; omit to self-relay
$env:ETHERSCAN_API_KEY = "YOUR_ETHERSCAN_KEY"    # optional, only for --verify

forge build
forge script script/Deploy.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast --verify --etherscan-api-key $env:ETHERSCAN_API_KEY
# paste the printed addresses:
$env:TRAIN  = "0x..."
$env:ROUTER = "0x..."

forge script script/sepolia/Setup.s.sol      --rpc-url $env:SEPOLIA_RPC_URL --broadcast
forge script script/sepolia/TestDirect.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast
forge script script/sepolia/TestNative.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast
forge script script/sepolia/TestRouter.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast

$env:REFUND_SALT = [DateTimeOffset]::Now.ToUnixTimeSeconds().ToString()
forge script script/sepolia/TestRefundLock.s.sol  --rpc-url $env:SEPOLIA_RPC_URL --broadcast
Start-Sleep -Seconds 70
forge script script/sepolia/TestRefundClaim.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast

# native-ETH refund cycle
$env:REFUND_SALT = "n-" + [DateTimeOffset]::Now.ToUnixTimeSeconds()
forge script script/sepolia/TestNativeRefundLock.s.sol  --rpc-url $env:SEPOLIA_RPC_URL --broadcast
Start-Sleep -Seconds 70
forge script script/sepolia/TestNativeRefundClaim.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast

# gasless lock -> refund (proves the original depositor is refunded; relayer needs Sepolia ETH)
$env:REFUND_SALT = "g-" + [DateTimeOffset]::Now.ToUnixTimeSeconds()
forge script script/sepolia/TestGaslessRefundLock.s.sol  --rpc-url $env:SEPOLIA_RPC_URL --broadcast
Start-Sleep -Seconds 70
forge script script/sepolia/TestGaslessRefundClaim.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast
```

Notes: drop `--verify --etherscan-api-key $env:ETHERSCAN_API_KEY` if you have no Etherscan key (an
empty key errors). `$env:` vars last only for the current PowerShell window. To run the bash blocks
above instead, use Git Bash / WSL.

## What each script does

| Script | Broadcaster | Flow |
|---|---|---|
| `Deploy.s.sol` | USER | deploy curve + Train + TrainRouter |
| `Setup.s.sol` | USER | approve Train + Permit2 for USDC |
| `TestDirect.s.sol` | USER | userLock→redeem, solverLock→redeem, userLockFor→redeem |
| `TestNative.s.sol` | USER | native (ETH) userLock→redeem, solverLock→redeem |
| `TestRouter.s.sol` | RELAYER (signs as USER) | permit / permit2 / 3009 → Train → redeem |
| `TestRefundLock.s.sol` | USER | user + solver locks, 60s timelock |
| `TestRefundClaim.s.sol` | USER | refundUser + refundSolver |
| `TestNativeRefundLock.s.sol` | USER | native user + solver locks, 60s timelock |
| `TestNativeRefundClaim.s.sol` | USER | native refundUser + refundSolver |
| `TestGaslessRefundLock.s.sol` | RELAYER (signs as USER) | gasless permit lock, refundTo = user, 60s timelock |
| `TestGaslessRefundClaim.s.sol` | RELAYER | relayer triggers refundUser → USDC returns to the depositor |
| `DebugIntent.s.sol` | — (read-only) | print recovered signer vs USER for the intent sig |

Tune `AMOUNT` / `REWARD` and the addresses in `SepoliaConfig.s.sol`. Broadcast receipts (tx hashes)
are written under `broadcast/<script>/11155111/`.

---

## Troubleshooting

- **`gapped-nonce tx from delegated accounts` / `in-flight transaction limit reached for delegated
  accounts` on deploy or broadcast** — the sending account (`USER_PK`/`RELAYER_PK`) has an EIP-7702
  delegation; nodes cap delegated accounts at one in-flight tx, so a batch of txs is rejected. Use a
  **fresh non-delegated EOA** (`cast wallet new`; confirm `cast code <addr>` is empty `0x`). A
  delegated account also breaks the gasless signature check below, so a clean EOA is required anyway.
  (`--slow` lets *deploy* through from a delegated account, but does not fix the signature issue.)
- **`InvalidIntentSignature` on a TrainRouter path** — your signer address has code (EIP-7702 delegation),
  so `SignatureChecker` uses ERC-1271 instead of ECDSA. Run the diagnostic:
  ```bash
  forge script script/sepolia/DebugIntent.s.sol --rpc-url "$SEPOLIA_RPC_URL"
  ```
  If `recovered` == your USER address but `sigCheck = false`, switch `USER_PK` to a plain EOA (a key
  whose `cast code <addr>` is empty).
- **`SwapAlreadyExists`** — that hashlock is taken. TestDirect/TestRouter auto-randomize per run; for
  the refund pair, use a fresh `REFUND_SALT`.
- **`RefundNotAllowed`** — the 60s timelock hasn't passed yet; wait a few more blocks before
  `TestRefundClaim`.
- **ERC20 transfer / `InsufficientPulled`** — signer is short on USDC, or used a fee-on-transfer
  token (USDC is not FoT; the TrainRouter rejects FoT by design). Top up USDC from the faucet.
- **Verification fails** — ensure `ETHERSCAN_API_KEY` is set; re-verify a single contract with
  `forge verify-contract <addr> <path:Name> --chain sepolia --etherscan-api-key "$ETHERSCAN_API_KEY" --watch`.
```
