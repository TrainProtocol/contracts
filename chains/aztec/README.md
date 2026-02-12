# TRAIN Protocol - Aztec

HTLC (Hash Time Locked Contract) implementation for cross-chain atomic swaps on Aztec Network.

Built with Aztec Noir contracts and Aztec.js SDK `v4.0.0-nightly.20260209`.

## Project Structure

```
aztec/
├── contracts/train/          # Noir smart contract
│   ├── Nargo.toml            # Noir package manifest
│   └── src/
│       ├── main.nr           # Train contract (user/solver locks, redeems, refunds)
│       ├── lib.nr            # Hashlock <-> Field conversion utilities
│       ├── types.nr          # Type module
│       └── types/events.nr   # Event structs (UserLocked, SolverLocked, etc.)
├── scripts/                  # TypeScript deployment and interaction scripts
│   ├── setup.ts              # Full local environment setup (wallets, token, distribution)
│   ├── deployTrain.ts        # Deploy Train contract
│   ├── Train.ts              # Auto-generated contract wrapper
│   ├── userLock.ts           # User locks funds (creates HTLC)
│   ├── solverLock.ts         # Solver locks matching funds
│   ├── userRedeem.ts         # Redeem user lock (reveals secret)
│   ├── solverRedeem.ts       # Redeem solver lock
│   ├── userRefund.ts         # Refund user lock after timelock
│   ├── solverRefund.ts       # Refund solver lock after timelock
│   ├── readLocks.ts          # Query lock status
│   ├── utils/                # Shared utilities
│   │   ├── config.ts         # Environment config manager (local/devnet)
│   │   ├── setupWallet.ts    # TestWallet initialization
│   │   ├── sponsoredFpc.ts   # Sponsored fee payment setup
│   │   ├── deployAccount.ts  # Schnorr account deployment
│   │   └── utils.ts          # Helpers (env parsing, auth witnesses, hashlock parsing)
│   └── config/               # Environment configs
│       ├── local-network.json
│       └── devnet.json
└── README.md
```

## Prerequisites

- [Aztec CLI](https://docs.aztec.network/) `v4.0.0-nightly.20260209`
- Node.js >= 18
- For local development: a running Aztec sandbox (`aztec start --sandbox`)

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
| `user_lock(...)` | User locks funds with hashlock + timelock. Emits `UserLocked` event. |
| `solver_lock(...)` | Solver locks funds against same hashlock. Returns index. Emits `SolverLocked`. |
| `redeem_user(hashlock, secret)` | Redeem user lock by providing preimage. Transfers amount to recipient. |
| `redeem_solver(hashlock, index, secret)` | Redeem solver lock. Reward routing depends on `reward_timelock`. |
| `refund_user(hashlock)` | Refund after timelock. Recipient can refund anytime. |
| `refund_solver(hashlock, index)` | Refund after timelock. Returns amount + reward to sender. |
| `get_user_lock(hashlock)` | View: returns UserLock state. |
| `get_solver_lock(hashlock, index)` | View: returns SolverLock state. |
| `get_solver_lock_count(hashlock)` | View: returns number of solver locks for a hashlock. |

### Reward Routing (Solver Redeem)

When redeeming a solver lock:
- **Before `reward_timelock`**: reward goes to `reward_recipient` (typically the solver)
- **After `reward_timelock`**: reward goes to the redeemer

## Compile Contract

```bash
cd contracts/train
aztec compile
```

Output artifact: `contracts/train/target/train-Train.json`

## Scripts

All scripts run from the `scripts/` directory using `npx tsx <script>.ts`.

Set environment via `AZTEC_ENV` (defaults to `local-network`):

```bash
export AZTEC_ENV=devnet  # or local-network
```

### 1. Local Setup (local-network only)

```bash
npx tsx setup.ts
```

Creates 3 wallets (user, solver, deployer), deploys a Token contract, mints and distributes tokens. Saves all keys/addresses to `.env`.

### 2. Deploy Train Contract

```bash
npx tsx deployTrain.ts
```

Deploys the Train contract using sponsored fee payment. Saves `TRAIN_ADDRESS` to `.env`.

### 3. User Lock (Initiate Swap)

```bash
npx tsx userLock.ts
```

Generates a random secret, computes SHA256 hashlock, and locks funds on-chain. Saves `USER_LOCK_SECRET`, `USER_LOCK_HASHLOCK` to `.env`.

### 4. Solver Lock (Match Swap)

```bash
npx tsx solverLock.ts
```

Solver locks matching funds against the same hashlock. In production the solver reads the hashlock from the source chain's `UserLocked` event; the script reads it from `.env` for convenience. Saves `SOLVER_LOCK_INDEX` to `.env`.

### 5. Redeem

```bash
npx tsx userRedeem.ts    # Solver redeems user lock (reveals secret on-chain)
npx tsx solverRedeem.ts  # User redeems solver lock (using revealed secret)
```

### 6. Refund

```bash
npx tsx userRefund.ts    # After user lock timelock expires
npx tsx solverRefund.ts  # After solver lock timelock expires
```

### 7. Query Locks

```bash
npx tsx readLocks.ts
```

Reads user lock and all solver locks for the hashlock in `.env`.

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
| `SOLVER_ADDRESS` | Solver's Aztec address |
| `AMOUNT` / `REWARD_AMOUNT` | Swap and reward amounts |
| `TIMELOCK_DELTA` / `REWARD_TIMELOCK_DELTA` | Timelock durations in seconds |
| `SRC_CHAIN` / `DST_CHAIN` | Source and destination chain identifiers |

Environment-specific configs live in `scripts/config/`:
- `local-network.json` - Local sandbox (localhost:8080)
- `devnet.json` - Aztec devnet (devnet-6.aztec-labs.com, extended timeouts)

## Cross-Chain Swap Flow

### Aztec -> Destination Chain

1. **User** runs `userLock.ts` - locks funds on Aztec with hashlock
2. **Solver** observes `UserLocked` event, runs `solverLock.ts` on destination chain
3. **User** redeems on destination chain (reveals secret)
4. **Solver** reads revealed secret, runs `userRedeem.ts` on Aztec

### Source Chain -> Aztec

1. **User** locks funds on source chain
2. **Solver** observes lock, runs `solverLock.ts` on Aztec
3. **Solver** redeems on source chain (reveals secret)
4. **User** reads revealed secret, runs `solverRedeem.ts` on Aztec

If either party fails to redeem before timelock, locked funds can be refunded.
