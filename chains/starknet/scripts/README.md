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
# Query a specific hashlock (solver defaults to ACCOUNT_ADDRESS)
npm run interact -- view 0xabc123...

# Query a specific hashlock for a specific solver
npm run interact -- view 0xabc123... 0x<solverAddress>
```

Returns: user lock details, solver lock details for the given/default solver address (`get_solver_lock` is keyed by `(hashlock, solver)` — a zero `sender` means that solver never locked), and all user lock hashes for your account.

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

# Redeem a solver lock (solver lock is keyed by (hashlock, solver); solverAddress defaults to
# this CLI's own account)
npm run interact -- redeem solver 0x<hashlock> 0x<secret> [solverAddress]
```

Verifies the hashlock matches `sha256(secret)` before submitting.

#### `refund` - Refund an expired lock

```bash
# Refund a user lock (must be past timelock, or called by recipient)
npm run interact -- refund user 0x<hashlock>

# Refund a solver lock (solverAddress defaults to this CLI's own account)
npm run interact -- refund solver 0x<hashlock> [solverAddress]
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

## End-to-end test suite (`sepolia-e2e.ts`)

Config-driven, idempotent, re-runnable end-to-end suite that runs entirely on **Starknet
Sepolia** using the canonical Sepolia **STRK** (principal) and **ETH** (second / reward token)
ERC20 contracts. It never deploys or mints a token — it spends from the pre-funded balances of
whatever accounts are configured, in tiny (wei-scale) amounts since the happy paths cycle funds
back to the same accounts.

`deploy-all.ts` (used by this suite) declares/deploys only `ConstantPayoutCurve` -> `Train` ->
`TrainRouter` — no token.

Flows covered (each produces one or more rows in the report):

- **Happy**: direct `user_lock` -> `redeem_user`; `user_lock` with `ConstantPayoutCurve` (full
  payout, zero excess); `refund_user` by the recipient before the timelock; `refund_user` by a
  third party after the timelock; `user_lock_for(beneficiary)` attribution; `solver_lock` ->
  `redeem_solver` (reward before/after `reward_timelock`, same-token and different-token reward);
  `refund_solver` after the timelock; **Rail A** gasless via `TrainRouter.forward_intent`; **Rail
  B** gasless via SNIP-9 `execute_from_outside_v2`; view/enumeration probes.
- **Unhappy**: `ZeroAmount`, `InvalidToken`, `InvalidTimelock`, `QuoteExpired`,
  `SwapAlreadyExists`, `HashlockMismatch`, `LockNotFound`, `RefundNotAllowed`, `LockNotPending`,
  `InvalidRewardTimelock`, `ZeroAddress`, `InvalidUser`; Rail A's `RouterMismatch`,
  `IntentExpired`, `IntentConsumed` (replay), `CallHashMismatch`, `InvalidSignature`,
  `ResidualBalance`; Rail B's expired time-bounds and duplicate-nonce replay. State-independent
  cases are checked via a raw `starknet_call` simulation (no tx, no gas); state-dependent cases
  (double-redeem, replay) send a real transaction and assert it reverts on-chain.

```bash
npm run e2e
# or directly:
cd scripts && npx tsx src/sepolia-e2e.ts
```

### Sepolia (authoritative run)

```bash
RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/YOUR_KEY \
ACCOUNT_ADDRESS=0x<user_wallet_address> \
PRIVATE_KEY=0x<user_wallet_signing_key> \
RELAYER_ADDRESS=0x<funded_relayer_address> \
RELAYER_PRIVATE_KEY=0x<funded_relayer_private_key> \
cd scripts && npx tsx src/sepolia-e2e.ts
```

`ACCOUNT_ADDRESS`/`PRIVATE_KEY` (the **user**) **must be a real SNIP-9-capable wallet** — Argent,
Braavos, or Ready — since Rail B is validated against this exact account via
`execute_from_outside_v2`, not a throwaway test account. `PRIVATE_KEY` must be the account's raw
STARK-curve signing key (single-owner / no guardian), because the suite signs the Rail A `Intent`
and the Rail B `OutsideExecution` directly with `ec.starkCurve.sign`. `RELAYER_ADDRESS`/
`RELAYER_PRIVATE_KEY` pays gas for both gasless rails; `SOLVER_ADDRESS`/`SOLVER_PRIVATE_KEY` is
optional (defaults to the relayer, then to the user). `STRK_ADDRESS`/`ETH_ADDRESS` override the
default canonical Sepolia token addresses if needed. Optionally set `TRAIN`/`TRAIN_ROUTER`/
`CONSTANT_CURVE` to reuse already-deployed contracts instead of declaring/deploying fresh ones;
see `.env.example` for the full list of variables.

### Local devnet (non-Rail-B smoke test only)

```bash
starknet-devnet --seed 0 --port 5060 --accounts 3
# copy account 0 (user) and account 1 (relayer) address+private key from its output

RPC_URL=http://127.0.0.1:5060/rpc \
ACCOUNT_ADDRESS=0x<account0_address> \
PRIVATE_KEY=0x<account0_private_key> \
RELAYER_ADDRESS=0x<account1_address> \
RELAYER_PRIVATE_KEY=0x<account1_private_key> \
STRK_ADDRESS=0x<devnet_strk_fee_token_address> \
ETH_ADDRESS=0x<devnet_eth_fee_token_address> \
cd scripts && npx tsx src/sepolia-e2e.ts
```

`starknet-devnet`'s predeployed accounts are already funded in devnet's own STRK/ETH fee-token
contracts, so pointing `STRK_ADDRESS`/`ETH_ADDRESS` at those (printed in the devnet startup
banner) lets every flow except Rail B run for free. **Rail B cannot be validated on devnet**: the
default devnet account does not support SNIP-9, so the suite detects this via
`src5.supportsInterface` and records Rail B (and its unhappy paths) as a skipped/pending-on-Sepolia
info row rather than failing the run. All other flows (direct, curve, refunds, third-party
refund, Rail A, and the general/Rail-A unhappy paths) run and are asserted normally on devnet.

The suite writes `docs/e2e-testnet-report.md` (+ a sibling `.json`) in the same row-table format
used by the aztec chain's e2e report (`# | Stage | Name | Kind | Status | Tx | Block | Fee |
Note`), with a `## Build and local verification` section (Cairo build, `tsc --noEmit`, local
`snforge` tests) and an `## Environment` section listing the RPC, deployed contracts, token
addresses, and actor addresses. Exit code is non-zero if any row fails.

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
