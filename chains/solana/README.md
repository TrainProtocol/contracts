# Train HTLC - Solana Program

A unified Solana program for Hash Time-Locked Contracts (HTLC) enabling cross-chain atomic swaps. Supports native SOL and SPL tokens (including Token-2022), with optional different reward tokens for solver locks.

**Program ID (devnet):** `7ZT5gs8CG7BAv34bLYSke31DJeg5RRUa4G7p9GNcbPE`

## Architecture

The program implements a two-party atomic swap protocol between a **User** and a **Solver**:

1. **User** creates a lock on the source chain with a hashlock (SHA-256 hash of a secret)
2. **Solver** creates a corresponding lock on the destination chain using the same hashlock
3. **User** redeems the solver's lock by revealing the secret
4. **Solver** uses the revealed secret to redeem the user's lock

If the swap doesn't complete, both parties can refund after their respective timelocks expire.

### Lock Types

| Variant | Description |
|---------|-------------|
| **SOL** | Native SOL transfers |
| **Token** | SPL token with same token for amount and reward |
| **Token Diff Reward** | SPL token with a different token for reward (two vaults) |

### Account PDAs

| Account | Seeds | Purpose |
|---------|-------|---------|
| UserLock | `["user_lock", hashlock]` | Stores user lock state |
| UserVault | `["user_vault", hashlock]` | Token vault for user locks |
| SolverLock | `["solver_lock", hashlock, index_le]` | Stores solver lock state |
| SolverVault | `["solver_vault", hashlock, index_le]` | Token vault for solver locks |
| SolverRewardVault | `["solver_reward_vault", hashlock, index_le]` | Reward token vault (diff reward only) |
| SolverLockCounter | `["solver_count", hashlock]` | Tracks solver lock index per hashlock |

### Status Flow

```
PENDING (0) --> REDEEMED (2)   (secret revealed)
PENDING (0) --> REFUNDED (1)   (timelock expired)
```

## Instructions

### Lock (5)

| Instruction | Description |
|-------------|-------------|
| `user_lock_sol` | Lock native SOL as user |
| `user_lock_token` | Lock SPL tokens as user |
| `solver_lock_sol` | Lock native SOL as solver |
| `solver_lock_token` | Lock SPL tokens as solver (same reward token) |
| `solver_lock_token_diff_reward` | Lock SPL tokens as solver (different reward token) |

### Redeem (5)

| Instruction | Description |
|-------------|-------------|
| `redeem_user_sol` | Redeem user's SOL lock with secret |
| `redeem_user_token` | Redeem user's token lock with secret |
| `redeem_solver_sol` | Redeem solver's SOL lock with secret |
| `redeem_solver_token` | Redeem solver's token lock with secret |
| `redeem_solver_token_diff_reward` | Redeem solver's diff-reward token lock |

### Refund (5)

| Instruction | Description |
|-------------|-------------|
| `refund_user_sol` | Refund user's SOL lock after timelock |
| `refund_user_token` | Refund user's token lock after timelock |
| `refund_solver_sol` | Refund solver's SOL lock after timelock |
| `refund_solver_token` | Refund solver's token lock after timelock |
| `refund_solver_token_diff_reward` | Refund solver's diff-reward token lock |

### Close (2)

| Instruction | Description |
|-------------|-------------|
| `close_user_lock` | Reclaim rent from redeemed/refunded user lock |
| `close_solver_lock` | Reclaim rent from redeemed/refunded solver lock |

### View (3)

| Instruction | Description |
|-------------|-------------|
| `get_user_lock` | Query user lock state |
| `get_solver_lock` | Query solver lock state |
| `get_solver_lock_count` | Query solver lock count for a hashlock |

## Prerequisites

- [Solana CLI](https://docs.solanalabs.com/cli/install) configured for devnet
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) v0.32.1
- Node.js >= 18

Verify your setup:

```bash
solana config get          # should show devnet
solana balance             # should have SOL for fees
anchor --version           # should show 0.32.1
```

## Setup

```bash
cd chains/solana
npm install
```

## Build

```bash
anchor build
```

## Testing

Run the full automated test suite against a local validator:

```bash
anchor test
```

This builds the program, starts a local validator, deploys the program, and runs all tests. No manual setup required.

## Scripts

All scripts are in `scripts/` and run via `npx ts-node`. They use your Solana CLI wallet (`~/.config/solana/id.json`) and connect to devnet by default.

### Manual Devnet Testing

#### Preparation

You need two wallet addresses for testing. Use your own wallet as one and generate a second:

```bash
# Your wallet (sender/caller)
solana address
# Example: AR7DUwfrf17iir72oauSPJMqgYzboALej8a7f9yqnA4F

# Generate a second wallet for recipient
solana-keygen new -o /tmp/recipient.json --no-bip39-passphrase
solana address -k /tmp/recipient.json
# Example: 4EwnXAbwX1bQq7gzJa43y5p7PL7X9sqUmBnuiZAFVupC
```

For token tests, create two SPL token mints:

```bash
# Create token A (amount token)
spl-token create-token
# Output: Creating token <TOKEN_A_MINT>

# Create token B (reward token, for diff-reward tests)
spl-token create-token
# Output: Creating token <TOKEN_B_MINT>

# Create token accounts and mint some tokens to yourself
spl-token create-account <TOKEN_A_MINT>
spl-token mint <TOKEN_A_MINT> 1000000000    # 1B base units

spl-token create-account <TOKEN_B_MINT>
spl-token mint <TOKEN_B_MINT> 1000000000
```

Save these values — all examples below use them:

```
WALLET=<your wallet pubkey>
RECIPIENT=<second wallet pubkey>
TOKEN_A=<token A mint>
TOKEN_B=<token B mint>
```

---

### Test 1: User Lock SOL (lock + redeem + close)

```bash
# Step 1: Lock 0.001 SOL with 5 min timelock
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT
# Save the SECRET and HASHLOCK from output

# Step 2: Verify the lock
npx ts-node scripts/get-user-lock.ts $HASHLOCK
# Should show: status=PENDING, amount=1000000

# Step 3: Redeem with the secret
npx ts-node scripts/redeem-user-sol.ts $HASHLOCK $SECRET

# Step 4: Verify status changed
npx ts-node scripts/get-user-lock.ts $HASHLOCK
# Should show: status=REDEEMED

# Step 5: Reclaim rent
npx ts-node scripts/close-user-lock.ts $HASHLOCK
```

### Test 2: User Lock SOL (lock + refund after timelock)

```bash
# Step 1: Lock with short timelock (60 seconds)
npx ts-node scripts/user-lock-sol.ts 1000000 60 $RECIPIENT

# Step 2: Wait 60+ seconds for timelock to expire

# Step 3: Refund
npx ts-node scripts/refund-user-sol.ts $HASHLOCK

# Step 4: Verify and cleanup
npx ts-node scripts/get-user-lock.ts $HASHLOCK
# Should show: status=REFUNDED
npx ts-node scripts/close-user-lock.ts $HASHLOCK
```

### Test 3: User Lock Token (lock + redeem + close)

```bash
# Step 1: Lock 1000 tokens with 5 min timelock
npx ts-node scripts/user-lock-token.ts $TOKEN_A 1000 300 $RECIPIENT

# Step 2: Verify
npx ts-node scripts/get-user-lock.ts $HASHLOCK
# Should show: status=PENDING, token_mint=TOKEN_A

# Step 3: Redeem
npx ts-node scripts/redeem-user-token.ts $HASHLOCK $SECRET $TOKEN_A

# Step 4: Cleanup
npx ts-node scripts/close-user-lock.ts $HASHLOCK
```

### Test 4: User Lock Token (lock + refund)

```bash
# Step 1: Lock with short timelock
npx ts-node scripts/user-lock-token.ts $TOKEN_A 1000 60 $RECIPIENT

# Step 2: Wait 60+ seconds

# Step 3: Refund
npx ts-node scripts/refund-user-token.ts $HASHLOCK $TOKEN_A

# Step 4: Cleanup
npx ts-node scripts/close-user-lock.ts $HASHLOCK
```

### Test 5: Solver Lock SOL (lock + redeem + close)

```bash
# Step 1: Create a user lock first (to get a hashlock)
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT
# Save SECRET and HASHLOCK

# Step 2: Solver locks SOL against the same hashlock
# amount=500000, reward=100000, timelock=1800s, reward_timelock=900s
npx ts-node scripts/solver-lock-sol.ts $HASHLOCK 500000 100000 1800 900 $RECIPIENT $WALLET

# Step 3: Check solver lock count and state
npx ts-node scripts/get-solver-lock-count.ts $HASHLOCK
# Should show: Count=1, Next Index=2
npx ts-node scripts/get-solver-lock.ts $HASHLOCK 1

# Step 4: Redeem solver lock with the secret
npx ts-node scripts/redeem-solver-sol.ts $HASHLOCK 1 $SECRET

# Step 5: Cleanup
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 1
```

### Test 6: Solver Lock SOL (lock + refund)

```bash
# Step 1: Create user lock
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT

# Step 2: Solver lock with short timelock (60s)
npx ts-node scripts/solver-lock-sol.ts $HASHLOCK 500000 0 60 0 $RECIPIENT $WALLET

# Step 3: Wait 60+ seconds

# Step 4: Refund
npx ts-node scripts/refund-solver-sol.ts $HASHLOCK 1

# Step 5: Cleanup
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 1
```

### Test 7: Solver Lock Token — same reward token (lock + redeem)

```bash
# Step 1: Create user lock to get hashlock
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT

# Step 2: Solver locks tokens (amount + reward are same token)
# amount=1000, reward=200, timelock=1800s, reward_timelock=900s
npx ts-node scripts/solver-lock-token.ts $HASHLOCK $TOKEN_A 1000 200 1800 900 $RECIPIENT $WALLET

# Step 3: Verify
npx ts-node scripts/get-solver-lock.ts $HASHLOCK 1
# Should show: token_mint=TOKEN_A, reward_token_mint=same

# Step 4: Redeem
npx ts-node scripts/redeem-solver-token.ts $HASHLOCK 1 $SECRET $TOKEN_A

# Step 5: Cleanup
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 1
```

### Test 8: Solver Lock Token — same reward token (lock + refund)

```bash
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT
npx ts-node scripts/solver-lock-token.ts $HASHLOCK $TOKEN_A 1000 200 60 30 $RECIPIENT $WALLET

# Wait 60+ seconds
npx ts-node scripts/refund-solver-token.ts $HASHLOCK 1 $TOKEN_A
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 1
```

### Test 9: Solver Lock Token — different reward token (lock + redeem)

This uses **two different tokens**: TOKEN_A for the amount and TOKEN_B for the reward. The program creates two separate vaults.

```bash
# Step 1: Create user lock to get hashlock
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT

# Step 2: Solver locks with different reward token
# amount=1000 TOKEN_A, reward=500 TOKEN_B, timelock=1800s, reward_timelock=900s
npx ts-node scripts/solver-lock-token-diff-reward.ts $HASHLOCK $TOKEN_A $TOKEN_B 1000 500 1800 900 $RECIPIENT $WALLET

# Step 3: Verify
npx ts-node scripts/get-solver-lock.ts $HASHLOCK 1
# Should show: token_mint=TOKEN_A, reward_token_mint=TOKEN_B

# Step 4: Redeem (needs both mints)
npx ts-node scripts/redeem-solver-token-diff-reward.ts $HASHLOCK 1 $SECRET $TOKEN_A $TOKEN_B

# Step 5: Cleanup
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 1
```

### Test 10: Solver Lock Token — different reward token (lock + refund)

```bash
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT
npx ts-node scripts/solver-lock-token-diff-reward.ts $HASHLOCK $TOKEN_A $TOKEN_B 1000 500 60 30 $RECIPIENT $WALLET

# Wait 60+ seconds
npx ts-node scripts/refund-solver-token-diff-reward.ts $HASHLOCK 1 $TOKEN_A $TOKEN_B
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 1
```

### Test 11: Multiple solver locks per hashlock

The program supports multiple solver locks for the same hashlock. The counter tracks the index.

```bash
npx ts-node scripts/user-lock-sol.ts 1000000 300 $RECIPIENT

# First solver lock (index=1)
npx ts-node scripts/solver-lock-sol.ts $HASHLOCK 500000 0 1800 0 $RECIPIENT $WALLET
npx ts-node scripts/get-solver-lock-count.ts $HASHLOCK
# Count: 1

# Second solver lock (index=2)
npx ts-node scripts/solver-lock-sol.ts $HASHLOCK 300000 0 1800 0 $RECIPIENT $WALLET
npx ts-node scripts/get-solver-lock-count.ts $HASHLOCK
# Count: 2

# Redeem both
npx ts-node scripts/redeem-solver-sol.ts $HASHLOCK 1 $SECRET
npx ts-node scripts/redeem-solver-sol.ts $HASHLOCK 2 $SECRET

# Cleanup both
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 1
npx ts-node scripts/close-solver-lock.ts $HASHLOCK 2
```

### Script Reference

| Script | Arguments |
|--------|-----------|
| `user-lock-sol.ts` | `<amount_lamports> <timelock_delta_secs> <recipient>` |
| `user-lock-token.ts` | `<token_mint> <amount> <timelock_delta> <recipient>` |
| `solver-lock-sol.ts` | `<hashlock> <amount> <reward> <tl_delta> <rtl_delta> <recipient> <reward_recipient>` |
| `solver-lock-token.ts` | `<hashlock> <token_mint> <amount> <reward> <tl_delta> <rtl_delta> <recipient> <reward_recipient>` |
| `solver-lock-token-diff-reward.ts` | `<hashlock> <token_mint> <reward_token_mint> <amount> <reward> <tl_delta> <rtl_delta> <recipient> <reward_recipient>` |
| `refund-user-sol.ts` | `<hashlock>` |
| `refund-user-token.ts` | `<hashlock> <token_mint>` |
| `refund-solver-sol.ts` | `<hashlock> <index>` |
| `refund-solver-token.ts` | `<hashlock> <index> <token_mint>` |
| `refund-solver-token-diff-reward.ts` | `<hashlock> <index> <token_mint> <reward_token_mint>` |
| `redeem-user-sol.ts` | `<hashlock> <secret>` |
| `redeem-user-token.ts` | `<hashlock> <secret> <token_mint>` |
| `redeem-solver-sol.ts` | `<hashlock> <index> <secret>` |
| `redeem-solver-token.ts` | `<hashlock> <index> <secret> <token_mint>` |
| `redeem-solver-token-diff-reward.ts` | `<hashlock> <index> <secret> <token_mint> <reward_token_mint>` |
| `close-user-lock.ts` | `<hashlock>` |
| `close-solver-lock.ts` | `<hashlock> <index>` |
| `get-user-lock.ts` | `<hashlock>` |
| `get-solver-lock.ts` | `<hashlock> <index>` |
| `get-solver-lock-count.ts` | `<hashlock>` |

All hashlock and secret arguments are hex strings (64 characters). Amounts are in base units (lamports for SOL, smallest unit for tokens).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANCHOR_WALLET` | `~/.config/solana/id.json` | Path to wallet keypair |
| `ANCHOR_PROVIDER_URL` | `https://api.devnet.solana.com` | RPC endpoint |

## Deployment

### Sync program keys

Before building, always sync the program ID so that `declare_id!` in the source code matches the keypair you'll deploy with. If these don't match, every on-chain call will fail with `DeclaredProgramIdMismatch`.

```bash
anchor keys sync
anchor build
```

If you need a fresh program address (e.g. previous deployment is bricked), generate a new keypair first:

```bash
solana-keygen new -o target/deploy/train_htlc-keypair.json --force --no-bip39-passphrase
anchor keys sync
anchor build
```

### Build verifiable binary

```bash
solana-verify build
```

### Deploy to devnet

```bash
solana program deploy target/deploy/train_htlc.so \
  --program-id target/deploy/train_htlc-keypair.json \
  --with-compute-unit-price 10000 \
  --max-sign-attempts 50
```

Add `--final` for non-upgradeable (immutable) deployment. Only do this after testing — it is irreversible.

### Verify deployed program

```bash
# Compare local and on-chain hashes
solana-verify get-executable-hash target/deploy/train_htlc.so
solana-verify get-program-hash <PROGRAM_ID>

# Submit for public verification
solana-verify verify-from-repo \
  --remote -ud \
  --program-id <PROGRAM_ID> \
  https://github.com/TrainProtocol/contracts \
  --commit-hash <COMMIT> \
  --library-name train_htlc \
  --mount-path chains/solana
```

### Make program non-upgradeable

Once you've finished testing and are confident the program works correctly, revoke the upgrade authority to make it immutable:

```bash
solana program set-upgrade-authority target/deploy/train_htlc-keypair.json --final
```

This is **irreversible**. After this, the program can never be changed, upgraded, or closed by anyone — including you. Verify the result:

```bash
solana program show <PROGRAM_ID>
# Should show: Authority: none
```

### Recover SOL from failed deployment

```bash
solana program show --buffers        # list orphaned buffers
solana program close --buffers       # reclaim SOL
```
