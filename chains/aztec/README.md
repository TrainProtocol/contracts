# TRAIN Protocol - Aztec

HTLC (Hash Time Locked Contract) implementation for cross-chain atomic swaps on Aztec Network.

Built with Aztec Noir contracts and Aztec.js SDK `v4.1.0-rc.2` (testnet).

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

- [Aztec CLI](https://docs.aztec.network/) `4.1.0-rc.2`
- Install command:
  `aztec-up install 4.1.0-rc.2`
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

## Deployed Contract

| Network | Address |
|---|---|
| Testnet | `0x0f2c75ee97ee46f007b54f18cf6ecf4efecdc42710c67f4ff1cbbb83508153b7` |

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
export AZTEC_ENV=testnet  # or local-network, devnet
```

Or use the npm script shortcuts:

```bash
npm run setup:testnet
npm run bridge:testnet
npm run deploy:testnet
npm run user-lock:testnet
# etc.
```

### Fee Payment

Scripts automatically select the fee payment method based on the environment:

- **local-network / devnet**: `SponsoredFeePaymentMethod` (SponsoredFPC pays all fees)
- **testnet**: Fee Juice bridged from L1 (Sepolia). The first transaction per account uses `FeeJuicePaymentMethodWithClaim` to claim bridged Fee Juice; subsequent transactions pay from existing balance automatically (the SDK's `PREEXISTING_FEE_JUICE` mode — no payment method needed, the account contract handles `set_as_fee_payer()` + `end_setup()`).

### Testnet Workflow

On testnet, accounts need Fee Juice (bridged from L1 Sepolia) to pay for transactions. This requires a specific order:

```
1. setup.ts (first run)    → generates keys, saves to .env
2. bridgeFeeJuice.ts       → bridges Fee Juice from L1 to all accounts
3. setup.ts (second run)   → deploys accounts + token (claims bridged Fee Juice)
4. deployTrain.ts          → deploys Train contract
5. userLock.ts, etc.       → all subsequent scripts pay from Fee Juice balance
```

On local-network/devnet, just run each script once — SponsoredFPC handles all fees.

### 1. Setup (Wallets + Token)

```bash
npx tsx setup.ts
```

Creates 3 accounts (user, solver, deployer), deploys a Token contract, mints and distributes tokens. Saves all keys/addresses to `.env`.

On testnet, the first run only generates keys and exits. After bridging (step 2), re-run to deploy.

### 2. Bridge Fee Juice (testnet only)

```bash
npx tsx bridgeFeeJuice.ts [amount]
```

Bridges Fee Juice from L1 (Sepolia) to L2 for all accounts in `.env`. Run once with a large amount to fund all future transactions. Requires `L1_PRIVATE_KEY` in `.env` with a Sepolia-funded account. Saves claim data to `.env` — the first transaction per account automatically claims the bridged Fee Juice.

### 3. Deploy Train Contract

```bash
npx tsx deployTrain.ts
```

Deploys the Train contract. Saves `TRAIN_ADDRESS` to `.env`.

### 4. User Lock (Initiate Swap)

```bash
npx tsx userLock.ts
```

Generates a random secret, computes SHA256 hashlock, and locks funds on-chain. Saves `USER_LOCK_SECRET`, `USER_LOCK_HASHLOCK` to `.env`.

### 5. Solver Lock (Match Swap)

```bash
npx tsx solverLock.ts
```

Solver locks matching funds against the same hashlock. In production the solver reads the hashlock from the source chain's `UserLocked` event; the script reads it from `.env` for convenience. Saves `SOLVER_LOCK_INDEX` to `.env`.

### 6. Redeem

```bash
npx tsx userRedeem.ts    # Solver redeems user lock (reveals secret on-chain)
npx tsx solverRedeem.ts  # User redeems solver lock (using revealed secret)
```

### 7. Refund

```bash
npx tsx userRefund.ts    # After user lock timelock expires
npx tsx solverRefund.ts  # After solver lock timelock expires
```

### 8. Query Locks

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

1. **User** runs `userLock.ts` - locks funds on Aztec with hashlock
2. **Solver** observes `UserLocked` event, runs `solverLock.ts` on destination chain
3. **User** redeems on destination chain (reveals secret)
4. **Solver** reads revealed secret, runs `userRedeem.ts` on Aztec

### Source Chain -> Aztec

1. **User** locks funds on source chain
2. **Solver** observes lock, runs `solverLock.ts` on Aztec
3. **User** redeems solver lock on Aztec with `solverRedeem.ts` (reveals secret)
4. **Solver** reads revealed secret, redeems user lock on source chain

If either party fails to redeem before timelock, locked funds can be refunded.
