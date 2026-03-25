# Train Protocol - Bitcoin Implementation

Trustless cross-chain bridge using Hashed Time-Locked Contracts (HTLC) on Bitcoin.

## Overview

This is the Bitcoin implementation of the Train Protocol. It uses Bitcoin's **Taproot** script trees and **CSV (CheckSequenceVerify)** timelocks to implement the 6 protocol operations.

## Architecture

### Protocol Operations

| Method | UTXO Model |
|---|---|
| `userLock()` | 3-leaf Taproot: hashlock, cooperative refund, CSV refund |
| `solverLock()` | 2 UTXOs: amount (2-leaf) + reward (3-leaf) |
| `redeemUser()` | Spend hashlock leaf with secret + recipient sig |
| `redeemSolver()` | Spend amount and/or reward UTXOs |
| `refundUser()` | CSV refund leaf (after timelock) |
| `refundUserCooperativeInit/Finalize()` | Cooperative refund leaf (anytime) |
| `refundSolver()` | Atomic refund of both UTXOs |

### Cross-Chain Swap Flows

**Bitcoin as SOURCE chain (User locks BTC):**

```
Bitcoin (source)              Destination chain
─────────────────────────────────────────────────────
1. User  → userLock()
                              2. Solver → solverLock()
                              3. User   → redeemSolver()  (reveals secret)
4. Solver → redeemUser()      (uses revealed secret)
```

**Bitcoin as DESTINATION chain (Solver locks BTC):**

```
Source chain                  Bitcoin (destination)
─────────────────────────────────────────────────────
1. User  → userLock()
                              2. Solver → solverLock()
                              3. User   → redeemSolver()  (reveals secret)
4. Solver → redeemUser()
```

### User Lock Taproot Tree

```
userLock UTXO
├── Leaf 1 (hashlock):     OP_SHA256 <hashlock> OP_EQUALVERIFY <xRecipient> OP_CHECKSIG
├── Leaf 2 (coop_refund):  <xSender> OP_CHECKSIGVERIFY <xRecipient> OP_CHECKSIG
└── Leaf 3 (csv_refund):   <csvTimelock> OP_CSV OP_DROP <xSender> OP_CHECKSIG
```

### Solver Lock Taproot Trees

```
Amount UTXO                              Reward UTXO (if reward > 0)
├── Leaf 1: hashlock + xRecipient        ├── Leaf 1 (priority): hashlock + xRewardRecipient
└── Leaf 2: CSV + xSender                ├── Leaf 2 (delayed):  rewardCSV + hashlock + xRecipient
                                         └── Leaf 3 (refund):   timelockCSV + xSender
```

### Reward Timing

```
         rewardTimelock                    timelock
─────────────┼────────────────────────────────┼──────────►
 priority leaf (no CSV)      delayed leaf (with CSV)       refund leaf
 rewardRecipient + secret    recipient + secret             sender only
```

### Event System

Events are encoded in OP_RETURN outputs using a type-prefixed binary format (leverages Bitcoin Core v29+ extended OP_RETURN):

| Event | Type Byte | Size |
|---|---|---|
| `UserLocked` | `0x01` | 61B fixed + variable |
| `SolverLocked` | `0x02` | 61B fixed + variable |
| `UserRedeemed` | `0x03` | 65B |
| `SolverRedeemed` | `0x04` | 69B |
| `UserRefunded` | `0x05` | 33B |
| `SolverRefunded` | `0x06` | 37B |

## Testing on Testnet4

### Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in `chains/bitcoin/`:
   ```env
   TESTNET3_MNEMONIC=your twelve word mnemonic phrase goes here ...
   ```

3. Fund your addresses with testnet4 BTC from a faucet (e.g. `mempool.space/testnet4/faucet`).

### P2TR Conversion

The `userLock` and `solverLock` methods spend from **P2TR key-path** UTXOs. If your faucet sends to P2WPKH, convert first:

```bash
npx ts-node test/userLock.ts
# If it fails with "No UTXOs", your funds are P2WPKH — use convertP2WPKHtoP2TR first
```

### Test Scripts

All scripts read/write JSON metadata to `metadata/` for chaining flows.

#### 1. User Lock (initiate a swap)

```bash
npx ts-node test/userLock.ts
```

| Variable | Default | Description |
|---|---|---|
| `LOCK_AMOUNT_SAT` | `817` | Amount to lock (sats) |
| `LOCK_FEE_SAT` | `350` | Tx fee (sats) |
| `LOCK_DELAY_SEC` | `1800` | CSV timelock (seconds, min 900) |
| `PAYMENT_SECRET_HEX` | random | 32-byte secret (hex) |
| `PAYMENT_HASHLOCK_HEX` | sha256(secret) | Override hashlock directly |
| `DST_CHAIN` | `ETH` | Destination chain |
| `DST_ASSET` | `USDC` | Destination token |
| `DST_AMOUNT` | `0` | Destination amount |
| `SENDER_PATH` | `m/84'/1'/0'/0/1` | BIP32 sender path |
| `RECEIVER_PATH` | `m/84'/1'/0'/0/0` | BIP32 recipient path |

Outputs: `metadata/lock_meta.json`, `metadata/payment_secret.hex`

#### 2. Solver Lock (fulfill a swap)

```bash
npx ts-node test/solverLock.ts
```

| Variable | Default | Description |
|---|---|---|
| `SOLVER_AMOUNT_SAT` | `600` | Amount for recipient (sats) |
| `SOLVER_REWARD_SAT` | `200` | Reward for early completion (sats) |
| `SOLVER_FEE_SAT` | `400` | Tx fee (sats) |
| `SOLVER_TIMELOCK_SEC` | `1800` | Main timelock (seconds) |
| `SOLVER_REWARD_TIMELOCK_SEC` | `900` | Reward timelock (seconds) |
| `SOLVER_INDEX` | `1` | Solver lock index |
| `SOLVER_PATH` | `m/84'/1'/0'/0/2` | BIP32 solver path |
| `RECIPIENT_PATH` | `m/84'/1'/0'/0/0` | BIP32 recipient path |
| `REWARD_RECIPIENT_PATH` | `m/84'/1'/0'/0/2` | BIP32 reward recipient path |

Outputs: `metadata/solver_lock_meta.json`, `metadata/solver_payment_secret.hex`

#### 3. Redeem User Lock (solver redeems with secret)

```bash
npx ts-node test/redeemUser.ts
```

Reads `metadata/lock_meta.json`. Requires the secret from `PAYMENT_SECRET_HEX` or `metadata/payment_secret.hex`.

#### 4. Redeem Solver Lock

```bash
# Recipient redeems amount only (before rewardTimelock):
npx ts-node test/redeemSolver.ts --mode=amount

# Recipient redeems amount + reward (after rewardTimelock):
npx ts-node test/redeemSolver.ts --mode=both

# RewardRecipient claims reward only (priority leaf):
npx ts-node test/redeemSolver.ts --mode=reward
```

Reads `metadata/solver_lock_meta.json`. Requires the secret.

| Mode | Who | When | What |
|---|---|---|---|
| `amount` | Recipient | Anytime with secret | Amount UTXO only |
| `both` | Recipient | After rewardTimelock | Amount + reward UTXOs |
| `reward` | RewardRecipient | Anytime with secret | Reward UTXO only (priority leaf) |

#### 5. Refund User Lock (after timelock)

```bash
npx ts-node test/refundUser.ts
```

Reads `metadata/lock_meta.json`. CSV timelock must have expired.

#### 6. Cooperative Refund (recipient-initiated, no timelock)

```bash
npx ts-node test/cooperativeRefund.ts
```

Reads `metadata/lock_meta.json`. Two-phase: recipient signs first, sender adds fees and broadcasts. No timelock required.

#### 7. Refund Solver Lock (after timelock)

```bash
npx ts-node test/solverRefund.ts
```

Reads `metadata/solver_lock_meta.json`. Atomically refunds both amount and reward UTXOs. CSV timelock must have expired.

### Test Flow Examples

**Full user lock cycle (userLock → redeemUser):**
```bash
npx ts-node test/userLock.ts               # 1. User locks BTC
npx ts-node test/redeemUser.ts             # 2. Solver redeems with secret
```

**Full user lock cycle (userLock → refundUser after timelock):**
```bash
npx ts-node test/userLock.ts               # 1. User locks BTC
# ... wait for CSV timelock to expire ...
npx ts-node test/refundUser.ts             # 2. Sender refunds
```

**Full user lock cycle (userLock → cooperative refund):**
```bash
npx ts-node test/userLock.ts               # 1. User locks BTC
npx ts-node test/cooperativeRefund.ts      # 2. Recipient + sender cooperate to refund (no wait)
```

**Full solver lock cycle (lock → redeem):**
```bash
npx ts-node test/solverLock.ts             # 1. Solver locks BTC + reward
npx ts-node test/redeemSolver.ts --mode=amount  # 2. Recipient redeems amount
npx ts-node test/redeemSolver.ts --mode=reward  # 3. RewardRecipient claims reward
```

**Full solver lock cycle (lock → refund after timelock):**
```bash
npx ts-node test/solverLock.ts             # 1. Solver locks BTC + reward
# ... wait for CSV timelock to expire ...
npx ts-node test/solverRefund.ts           # 2. Solver refunds both UTXOs
```

### BIP32 Derivation Paths

| Role | Default Path | Override Env |
|---|---|---|
| Sender (user) | `m/84'/1'/0'/0/1` | `SENDER_PATH` |
| Recipient (user) | `m/84'/1'/0'/0/0` | `RECEIVER_PATH` |
| Solver | `m/84'/1'/0'/0/2` | `SOLVER_PATH` |
| Reward Recipient | `m/84'/1'/0'/0/2` | `REWARD_RECIPIENT_PATH` |

### Metadata Files

| File | Written By | Contains |
|---|---|---|
| `lock_meta.json` | `userLock.ts` | User lock contract address, tapleaf info, timelocks |
| `payment_secret.hex` | `userLock.ts` | Secret preimage (if randomly generated) |
| `solver_lock_meta.json` | `solverLock.ts` | Solver lock amount + reward UTXO info |
| `solver_payment_secret.hex` | `solverLock.ts` | Solver secret preimage |
| `refund_meta.json` | `refundUser.ts` | Refund tx details |
| `coop_refund_meta.json` | `cooperativeRefund.ts` | Cooperative refund tx details |
| `solver_redeem_meta.json` | `redeemUser.ts` | User lock redeem tx details |
| `redeem_solver_meta.json` | `redeemSolver.ts` | Solver lock redeem tx details |
| `solver_refund_meta.json` | `solverRefund.ts` | Solver lock refund tx details |

## API Reference

### `userLock(sender, recipientPubKey, params, dst, userData?, solverData?)`

Creates a user lock to initiate a cross-chain swap.

**params:** `{ hashlock, amount, timelockDelta, fee?, rewardAmount?, rewardTimelockDelta?, quoteExpiry?, rewardToken?, rewardRecipient? }`

**dst:** `{ dstChain, dstAddress, dstAmount, dstToken }`

### `solverLock(sender, recipientPubKey, rewardRecipientPubKey, params, dst, data?)`

Creates a solver lock with amount + reward UTXOs.

**params:** `{ hashlock, amount, reward, timelockDelta, rewardTimelockDelta, index, fee? }`

### `redeemUser(prev, params)`

Redeems a user lock with the secret. Single call.

**params:** `{ recipient, secret, hashlock, feeSat, feeUtxos }`

### `redeemSolver(amountUtxo | null, rewardUtxo | null, params)`

Redeems a solver lock. Handles amount and/or reward UTXOs.

**params:** `{ redeemer, secret, hashlock, index, feeSat, feeUtxos }`

### `refundUser(prev, params)`

Refunds a user lock after CSV timelock expires.

**params:** `{ sender, hashlock, feeSat, feeUtxos, refundAddress? }`

### `refundUserCooperativeInit(prev, params)` / `refundUserCooperativeFinalize(psbt, sender, feeSat, feeUtxos)`

Two-phase cooperative refund (recipient initiates anytime, sender finalizes).

### `refundSolver(amountUtxo, rewardUtxo | null, params)`

Refunds a solver lock atomically after timelock expires.

**params:** `{ sender, hashlock, index, feeSat, feeUtxos, refundAddress? }`

### `convertP2WPKHtoP2TR(sender, amount, opts?)` / `convertP2TRtoP2WPKH(sender, opts?)`

Utility helpers for converting between address formats.

## Bitcoin-Specific Design Decisions

| Feature | Design | Reason |
|---|---|---|
| `quoteExpiry` | OP_RETURN only (off-chain verification) | No "tx invalid after time X" in Bitcoin consensus |
| `redeemUser` | Requires recipient signature | Prevents mempool front-running |
| Cooperative refund | Two-phase (recipient signs, sender finalizes) | Bitcoin requires both signatures explicitly |
| Reward (late claim) | Recipient gets reward via delayed leaf | Bitcoin can't route funds to dynamic caller |
| Token support | BTC only | Bitcoin is single-asset |
