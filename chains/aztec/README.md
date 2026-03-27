# TRAIN Protocol - Aztec

HTLC (Hash Time Locked Contract) implementation for cross-chain atomic swaps on Aztec Network.

Built with Aztec Noir contracts and Aztec.js SDK `v4.2.0-aztecnr-rc.2`.

## Project Structure

```
aztec/
├── contracts/train/          # Noir smart contract
│   ├── Nargo.toml            # Noir package manifest
│   └── src/
│       ├── main.nr           # Train contract (user/solver locks, redeems, refunds, events)
│       └── lib.nr            # Hashlock <-> Field conversion utilities
├── scripts/                  # TypeScript deployment and interaction scripts
│   ├── setup.ts              # Full environment setup (wallets, token, distribution)
│   ├── bridgeFeeJuice.ts     # Bridge Fee Juice from L1 (Sepolia) to L2 (testnet only)
│   ├── deployTrain.ts        # Deploy Train contract
│   ├── Train.ts              # Auto-generated contract wrapper (aztec codegen)
│   ├── userLock.ts           # User locks funds (creates HTLC)
│   ├── solverLock.ts         # Solver locks matching funds
│   ├── userRedeem.ts         # Redeem user lock (reveals secret)
│   ├── solverRedeem.ts       # Redeem solver lock
│   ├── userRefund.ts         # Refund user lock after timelock
│   ├── solverRefund.ts       # Refund solver lock after timelock
│   ├── readLocks.ts          # Query lock status
│   ├── mintAgain.ts          # Mint more tokens to user and solver
│   ├── userTransferPublic.ts # Public token transfer from user
│   ├── parseEvents.ts        # Parse Train contract events from tx
│   ├── getTxStatus.ts        # Check transaction status
│   ├── verifyTrainAztecScan.ts # Verify Train contract on AztecScan
│   ├── utils/                # Shared utilities
│   │   ├── config.ts         # Environment config manager (local/devnet/testnet)
│   │   ├── setupWallet.ts    # EmbeddedWallet initialization
│   │   ├── feePayment.ts     # Fee payment abstraction (FeeJuice / SponsoredFPC)
│   │   ├── sponsoredFpc.ts   # Sponsored fee payment setup (local/devnet)
│   │   ├── deployAccount.ts  # Schnorr account deployment
│   │   └── utils.ts          # Helpers (env parsing, auth witnesses, hashlock parsing)
│   └── config/               # Environment configs
│       ├── local-network.json
│       ├── devnet.json
│       └── testnet.json
└── README.md
```

## Prerequisites

- [Aztec CLI](https://docs.aztec.network/) `4.2.0-aztecnr-rc.2`
- Install command:
  `aztec-up install 4.2.0-aztecnr-rc.2`
- Node.js >= 18
- For local development: a running Aztec sandbox (`aztec start --sandbox`)

## Install

```bash
cd scripts
npm install
```

> **Note:** `postinstall` creates a symlink needed by `@defi-wonderland/aztec-standards` (its `dist/` is missing the compiled `target/` artifacts). This runs automatically on `npm install`.

## Contract Overview

The Train contract manages two types of HTLC locks keyed by a SHA256 hashlock:

**UserLock** - Created by the user initiating a cross-chain swap. Holds `amount` of `token` locked until `timelock` expires or the correct secret (preimage of hashlock) is provided.

**SolverLock** - Created by the solver matching the user's swap on the destination side. Holds `amount` + optional `reward`. Multiple solver locks can exist per hashlock (indexed by auto-incremented ID).

### Lock Lifecycle

```
EMPTY (0) --> PENDING (1) --> REDEEMED (3)
                          \-> REFUNDED (2)
```

### Contract Functions

| Function | Description |
|---|---|
| `user_lock(...)` | User locks funds with hashlock + timelock. Emits `UserLocked` log. |
| `solver_lock(...)` | Solver locks funds against same hashlock. Returns index. Emits `SolverLocked` log. |
| `redeem_user(hashlock, secret)` | Redeem user lock by providing preimage. Transfers amount to recipient. |
| `redeem_solver(hashlock, index, secret)` | Redeem solver lock. Reward routing depends on `reward_timelock`. |
| `refund_user(hashlock)` | Refund after timelock. Recipient can refund anytime. |
| `refund_solver(hashlock, index)` | Refund after timelock. Returns amount + reward to sender. |
| `get_user_lock(hashlock)` | View: returns UserLock state. |
| `get_solver_lock(hashlock, index)` | View: returns SolverLock state. |
| `get_solver_lock_count(hashlock)` | View: returns number of solver locks for a hashlock. |

### Event Emission

Events are emitted via `emit_public_log_unsafe` (bypassing the v4.2.0 `#[event]` macro's 10-field size limit, which is derived from private log encryption constraints and does not apply to public-only contracts). Each event has a unique tag for off-chain indexing:

| Tag | Event |
|---|---|
| 1 | `UserLocked` |
| 2 | `SolverLocked` |
| 3 | `UserRedeemed` |
| 4 | `SolverRedeemed` |
| 5 | `UserRefunded` |
| 6 | `SolverRefunded` |

### Reward Routing (Solver Redeem)

When redeeming a solver lock:
- **Before `reward_timelock`**: reward goes to `reward_recipient` (typically the solver)
- **After `reward_timelock`**: reward goes to the redeemer

## Deployed Contract

| Network | Address |
|---|---|
| Testnet | `0x2233bce6ff669363662dd88749129cae32a626203667df82a9151ad28964c3e9` |

## Compile Contract

```bash
cd contracts/train
aztec compile
```

Output artifact: `contracts/train/target/train-Train.json`

To regenerate the TypeScript wrapper after compilation:

```bash
aztec codegen contracts/train/target/train-Train.json -o scripts/
```

## Scripts

All scripts run from the `scripts/` directory.

**Set the environment** before running any script:

```bash
export AZTEC_ENV=testnet      # Aztec testnet (requires Fee Juice from L1 Sepolia)
export AZTEC_ENV=local-network # Local sandbox (default, requires `aztec start --sandbox`)
export AZTEC_ENV=devnet        # Aztec devnet
```

Or use the npm script shortcuts which set the environment automatically:

```bash
npm run setup:testnet
npm run bridge:testnet
npm run deploy:testnet
npm run user-lock:testnet
npm run solver-lock:testnet
npm run user-redeem:testnet
npm run solver-redeem:testnet
npm run user-refund:testnet
npm run solver-refund:testnet
npm run read-locks:testnet
npm run mint-again:testnet
npm run tx-status:testnet
npm run parse-events:testnet
npm run verify-train:testnet
```

### Fee Payment

Scripts automatically select the fee payment method based on the environment:

- **local-network / devnet**: `SponsoredFeePaymentMethod` (SponsoredFPC pays all fees — no setup needed)
- **testnet**: Fee Juice bridged from L1 (Sepolia). The first transaction per account uses `FeeJuicePaymentMethodWithClaim` to claim bridged Fee Juice; subsequent transactions pay from existing balance automatically (the SDK's `PREEXISTING_FEE_JUICE` mode — no payment method needed, the account contract handles `set_as_fee_payer()` + `end_setup()`).

## Testing Workflows

### Local Network (Sandbox)

The simplest way to test. No Fee Juice bridging needed.

```bash
# 1. Start the sandbox (in a separate terminal)
aztec start --sandbox

# 2. Set environment
export AZTEC_ENV=local-network

# 3. Setup: deploy accounts, token, mint and distribute tokens
npx tsx setup.ts

# 4. Deploy Train contract
npx tsx deployTrain.ts

# 5. Run the full HTLC flow
npx tsx userLock.ts          # User locks funds → saves secret + hashlock to .env
npx tsx solverLock.ts        # Solver locks matching funds → saves index to .env
npx tsx userRedeem.ts        # User redeems user lock (reveals secret on-chain)
npx tsx solverRedeem.ts      # User redeems solver lock (using revealed secret)

# 6. Query lock state
npx tsx readLocks.ts

# 7. (Optional) Test refund flow — run userLock first, then wait for timelock
npx tsx userLock.ts
npx tsx userRefund.ts        # Only works after timelock expires
```

### Testnet

Requires Fee Juice bridged from L1 (Sepolia). Follow this exact order:

```bash
# 1. Set environment for ALL commands
export AZTEC_ENV=testnet

# 2. First run of setup — generates account keys and saves to .env
#    This will exit with an error about missing claim data. That's expected.
npx tsx setup.ts

# 3. Add your Sepolia private key to .env
#    Edit .env and set: L1_PRIVATE_KEY=0x<your-sepolia-private-key>
#    The Sepolia account needs ETH for the L1 bridge transaction.

# 4. Bridge Fee Juice from L1 to L2 for all accounts
#    Use a large amount to fund many future transactions (e.g., 100000000000000000 = 0.1 ETH worth)
npx tsx bridgeFeeJuice.ts

# 5. Second run of setup — deploys accounts + token (claims bridged Fee Juice)
npx tsx setup.ts

# 6. Deploy Train contract
npx tsx deployTrain.ts

# 7. Run the full HTLC flow (each script pays from Fee Juice balance)
npx tsx userLock.ts          # User locks funds → saves secret + hashlock to .env
npx tsx solverLock.ts        # Solver locks matching funds → saves index to .env
npx tsx userRedeem.ts        # User redeems user lock (reveals secret on-chain)
npx tsx solverRedeem.ts      # User redeems solver lock (using revealed secret)

# 8. Query lock state
npx tsx readLocks.ts

# 9. (Optional) Mint more tokens if needed
npx tsx mintAgain.ts

# 10. (Optional) Verify contract on AztecScan
npx tsx verifyTrainAztecScan.ts
```

**Important testnet notes:**
- Step 2 (first `setup.ts`) will fail with "no claim data found" — this is expected. It generates the keys needed for step 4.
- Step 4 (`bridgeFeeJuice.ts`) bridges once for all accounts. You only need to run this once.
- After step 5, all subsequent scripts pay from existing Fee Juice balance — no more bridging needed.
- Testnet transactions are slower (~30-60s per tx). Scripts have extended timeouts configured.
- To run a fresh HTLC cycle, run `userLock.ts` again (generates a new secret/hashlock).

## Configuration

Copy `env.example` to `.env` and fill in values:

```bash
cp env.example .env
```

Key variables:

| Variable | Description |
|---|---|
| `TRAIN_ADDRESS` | Deployed Train contract address |
| `TOKEN_ADDRESS` | Token contract address |
| `USER_SECRET` / `USER_SALT` / `USER_SIGNING_KEY` | User Schnorr account keys |
| `SOLVER_SECRET` / `SOLVER_SALT` / `SOLVER_SIGNING_KEY` | Solver Schnorr account keys |
| `DEPLOYER_SECRET` / `DEPLOYER_SALT` / `DEPLOYER_SIGNING_KEY` | Deployer Schnorr account keys |
| `L1_PRIVATE_KEY` | L1 (Sepolia) private key for Fee Juice bridging (testnet only) |
| `AMOUNT` / `REWARD_AMOUNT` | Swap and reward amounts |
| `TIMELOCK_DELTA` / `REWARD_TIMELOCK_DELTA` | Timelock durations in seconds |
| `SRC_CHAIN` / `DST_CHAIN` | Source and destination chain identifiers |

Environment-specific configs live in `scripts/config/`:
- `local-network.json` - Local sandbox (localhost:8080)
- `devnet.json` - Aztec devnet (`https://v4-devnet-2.aztec-labs.com`, extended timeouts)
- `testnet.json` - Aztec testnet (`https://rpc.testnet.aztec-labs.com`, Sepolia L1)

## Cross-Chain Swap Flow

### Aztec -> Destination Chain

1. **User** runs `userLock.ts` — locks funds on Aztec with hashlock
2. **Solver** observes `UserLocked` event, runs `solverLock.ts` on destination chain
3. **User** redeems on destination chain (reveals secret)
4. **Solver** reads revealed secret, runs `userRedeem.ts` on Aztec

### Source Chain -> Aztec

1. **User** locks funds on source chain
2. **Solver** observes lock, runs `solverLock.ts` on Aztec
3. **User** redeems solver lock on Aztec with `solverRedeem.ts` (reveals secret)
4. **Solver** reads revealed secret, redeems user lock on source chain

If either party fails to redeem before timelock, locked funds can be refunded.
