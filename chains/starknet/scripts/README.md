# Train Protocol - Starknet Scripts

TypeScript scripts for deploying, interacting with, and verifying the Train HTLC bridge contract on Starknet.

## Setup

```bash
cd scripts
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|----------|-------------|
| `RPC_URL` | Starknet JSON-RPC endpoint |
| `RPC_BLOCK_TAG` | Optional block tag (default: `latest`, useful when provider rejects `pending`) |
| `ACCOUNT_ADDRESS` | Your funded account address |
| `PRIVATE_KEY` | Account private key |
| `CONTRACT_ADDRESS` | Set after deploy |
| `CLASS_HASH` | Set after declare (optional, skips re-declare) |
| `TOKEN_ADDRESS` | ERC20 token to use (default: Sepolia ETH) |
| `REWARD_TOKEN_ADDRESS` | Optional: different ERC20 for `solver-lock-diff-reward` demo |

## Deploy

Declares the contract class (if not already declared) and deploys a new instance.

```bash
npm run deploy
```

Output includes the contract address and class hash to add to `.env`.

## Interact

```bash
npm run interact -- <command> [args...]
```

### Commands

#### `view` - Read contract state

```bash
# Basic check (solver lock count for hashlock=0)
npm run interact -- view

# Query a specific hashlock
npm run interact -- view 0xabc123...
```

Returns: solver lock count, user lock details, solver lock details (if any), and all user lock hashes for your account.

#### `user-lock` - Create a user lock

```bash
npm run interact -- user-lock
```

Generates a random secret/hashlock pair, then sends a multicall that atomically approves the token and creates the user lock. Prints the secret and hashlock — save these for redeeming later.

Default parameters: 1 wei amount, 150s timelock, 100s quote expiry.

#### `solver-lock` - Create a solver lock (same token)

```bash
npm run interact -- solver-lock 0x<hashlock>
```

Creates a solver lock against an existing hashlock. Sends a multicall (approve + solver_lock). Uses `TOKEN_ADDRESS` for both amount and reward.

#### `solver-lock-diff-reward` - Create a solver lock (different reward token)

```bash
npm run interact -- solver-lock-diff-reward 0x<hashlock>
```

Same as `solver-lock` but uses `TOKEN_ADDRESS` for the main amount and `REWARD_TOKEN_ADDRESS` for the reward. Sends a multicall (approve main + approve reward + solver_lock). Requires `REWARD_TOKEN_ADDRESS` in `.env`.

#### `redeem` - Redeem a lock with the secret

```bash
# Redeem a user lock
npm run interact -- redeem user 0x<hashlock> 0x<secret>

# Redeem a solver lock (index defaults to 1)
npm run interact -- redeem solver 0x<hashlock> 0x<secret> [index]
```

Verifies the hashlock matches `sha256(secret)` before submitting.

#### `refund` - Refund an expired lock

```bash
# Refund a user lock (must be past timelock, or called by recipient)
npm run interact -- refund user 0x<hashlock>

# Refund a solver lock (index defaults to 1)
npm run interact -- refund solver 0x<hashlock> [index]
```

## Verify

Checks the deployed contract against local build artifacts, prints Voyager explorer links, and optionally submits source code for verification.

```bash
# Report only (class hash check, ABI match, explorer links)
npm run verify

# Submit source code to Voyager for verification
npm run verify -- voyager
```

Output:
- On-chain class hash comparison
- ABI match (function and event counts)
- Voyager explorer links
- When `voyager` is specified: submits all Cairo source files + Scarb.toml, polls briefly, then prints the Voyager link to check status

## Hashlock / Secret

The contract uses `sha256(secret)` as the hashlock, where `secret` is a `u256` hashed as 32 bytes big-endian. The `interact` script computes this identically using Node.js `crypto.createHash('sha256')`.

## Example Flow

```bash
# 1. Deploy
npm run deploy
# → copy CONTRACT_ADDRESS and CLASS_HASH to .env

# 2. Create a user lock (prints secret + hashlock)
npm run interact -- user-lock
# → Secret: 0xaaa...  Hashlock: 0xbbb...

# 3. View the lock
npm run interact -- view 0xbbb...

# 4. Redeem with the secret
npm run interact -- redeem user 0xbbb... 0xaaa...

# 5. Verify deployment and submit to Voyager
npm run verify -- voyager
```
