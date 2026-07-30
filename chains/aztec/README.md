# TRAIN Protocol - Aztec

HTLC (Hash Time Locked Contract) implementation for cross-chain atomic swaps on Aztec Network.

Built with Aztec Noir contracts and Aztec.js SDK `v5.0.1`.

## v5.0.1 migration and solver-key status (2026-07-31)

The contracts and scripts target **Aztec v5.0.1**. The token dependency now comes from
the official [`AztecProtocol/aztec-standards`](https://github.com/AztecProtocol/aztec-standards)
repository and its `@aztec-foundation/aztec-standards` npm package, both pinned to v5.0.1.
The old `defi-wonderland` dependency and local cache-patching workaround are no longer used.

Contract compilation, TypeScript checking, and the 37-test local TXE suite pass with v5.0.1.
The solver-address-keyed contract was freshly deployed and its full testnet E2E matrix was
rerun on 2026-07-31: all 107 recorded results completed without a failure (88 `OK`, 16
informational checks, and three expected losing transactions that reverted on-chain in race
tests). The public node currently reports v5.0.0 while the client, compiler, and artifacts
are v5.0.1, so the runner emits a version warning. See the
[solver-keyed v5.0.1 testnet E2E report](docs/e2e-testnet-solver-keyed-v5.0.1-report.md).

### Authorization contracts and fresh-chain seeding

`EmbeddedWallet` preloads the standard AuthRegistry locally by default, so no explicit PXE
registration is needed in these scripts. On a newly reset rollup, the standard instance must
still be published once for public execution. Run
`AZTEC_ENV=testnet npx tsx publishAuthRegistry.ts` (idempotent); it publishes the documented
salt-1 universal deployment.

This canonical AuthRegistry is used by account contracts for public authwits and is separate
from the token standard's optional ARC-403 authorization hook. TRAIN's setup scripts pass the
zero address as the token's `auth_contract`, intentionally disabling the ARC-403 hook.

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

- [Aztec CLI](https://docs.aztec.network/) `5.0.1`
- Install command:
  `aztec-up install 5.0.1`
- Node.js >= 18
- For local development: a running Aztec sandbox (`aztec start --sandbox`)

## Install

```bash
cd scripts
npm install
```

The official standards package includes its compiled token artifact. The `postinstall` step
only builds the pinned AztecScan SDK dependency.

## Contract Overview

The Train contract manages two types of HTLC locks keyed by a SHA256 hashlock:

**UserLock** - Created by the user initiating a cross-chain swap. Holds `amount` of `token` locked until `timelock` expires or the correct secret (preimage of hashlock) is provided.

**SolverLock** - Created by the solver matching the user's swap on the destination side. Holds `amount` + optional `reward`. It is permanently keyed by `(hashlock, solver_address)`: different solvers may fund the same hashlock, but one solver can fund that hashlock only once, even after redeem or refund.

### Lock Lifecycle

```
EMPTY (0) --> PENDING (1) --> REDEEMED (3)
                          \-> REFUNDED (2)
```

### Contract Functions

| Function | Description |
|---|---|
| `user_lock(...)` | User locks funds with hashlock + timelock. Emits `UserLocked` log. |
| `solver_lock(...)` | Solver locks funds against a hashlock. Rejects a repeated `(hashlock, msg_sender)` before pulling funds. Emits `SolverLocked`. |
| `redeem_user(hashlock, secret)` | Redeem user lock by providing preimage. Transfers amount to recipient. |
| `redeem_solver(hashlock, solver, secret)` | Redeem the named solver's lock. Reward routing depends on `reward_timelock`. |
| `refund_user(hashlock)` | Refund after timelock. Recipient can refund anytime. |
| `refund_solver(hashlock, solver)` | Refund the named solver's lock after timelock. Returns amount + reward to `refund_to`. |
| `get_user_lock(hashlock)` | View: returns UserLock state. |
| `get_solver_lock(hashlock, solver)` | View: returns the lock at the canonical `(hashlock, solver)` key. |

### Event Emission

Events use Aztec's `#[event]` macro and are public logs suitable for off-chain indexing. Solver settlement events include the solver address rather than an auto-incremented index:

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

### Solver identity and Aztec privacy

The solver key is the canonical `AztecAddress` returned by `msg_sender`; callers cannot provide or spoof a different identity during `solver_lock`. Any deployed Aztec account type can be used, including a dedicated or ephemeral solver account.

The current Train custody rail is public: `solver_lock` is an `#[external("public")]` function and pulls funds with `transfer_public_to_public`. Consequently, the solver address, lock parameters, and public token movements are visible. Supporting a hidden solver identity or private token balance would require a separate private entrypoint and note-based custody design; it is not implied by this public API.

### Retry safety

Before any token pull, `solver_lock` checks the existing `(hashlock, msg_sender)` slot and rejects non-empty history with `SolverLockAlreadyExists`. The slot is never cleared, including after redeem or refund. A client can probe idempotently with `get_solver_lock(hashlock, solver)`; a non-zero status means that solver must not submit another lock for the same hashlock.

## Deployed contracts (testnet, solver-keyed v5.0.1 artifacts — 2026-07-31)

| Contract | Address |
|---|---|
| Train | `0x1e36ef80d7d02ab8ed33aa07635f85152e015b9c4b09fbf5fe54ec11154d3133` |
| Token1 (ETH) | `0x217878d61e5d31ed78a8ad6f0a6a9b8ee8a1eec5944a7d122f6d910abee0b098` |
| Token2 (test RWD) | `0x2f63f2687b2fa5d38b51bc9970674e801e89074bd90b07994b8c288f980ba41a` |
| ConstantPayoutCurve | `0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7` |

Train class ID:
`0x21cae61cc13c0fc8f635a0b94551c703c1458cd87980a8d5313e27e17a5539b0`.
Its [deployment transaction](https://aztecscan.xyz/txs/0x2ecfb6762a0e24d4616d798dd0259f18ca9151aa87a068c0e5121a95ae1db942)
was included at block 24202, and the Train instance and artifact are verified on AztecScan.

The earlier [v5.0.1 E2E report](docs/e2e-testnet-v5.0.1-report.md) and
[v5.0.0 E2E report](docs/e2e-testnet-v5.0.0-report.md) are retained as historical evidence
from the index-keyed and pre-migration deployments.

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
npx tsx solverLock.ts        # Solver locks matching funds, keyed by its Aztec address
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
npx tsx solverLock.ts        # Solver locks matching funds, keyed by its Aztec address
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
