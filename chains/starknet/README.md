# Train Protocol — Starknet HTLC Bridge

Cross-chain bridge contract using Hashed Time-Locked Contracts (HTLCs) on Starknet.

## Contract Overview

### Train.cairo

Trustless cross-chain bridge supporting ERC20 tokens. Hashlock = `sha256(secret)`.

#### Functions

**Mutative:**

- **user_lock** — Create a user lock to initiate a cross-chain swap
- **solver_lock** — Create a solver lock to fulfill a swap (supports separate reward tokens)
- **redeem_user** — Redeem a user lock with the secret preimage
- **redeem_solver** — Redeem a solver lock (reward routed by timelock)
- **refund_user** — Refund a user lock (after timelock, or anytime by recipient)
- **refund_solver** — Refund a solver lock after timelock (amount + reward returned)

**View:**

- **get_user_lock** — Get user lock details by hashlock
- **get_solver_lock** — Get solver lock details by hashlock and index
- **get_solver_lock_count** — Get number of solver locks for a hashlock
- **get_user_lock_hashes** — Get user lock hashes with status filtering and pagination
- **get_user_locks** — Get full user lock structs with filtering and pagination

## Build

```bash
scarb build
```

## Test

Requires [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/).

```bash
snforge test
```

The test suite includes 59 tests: unit tests for all functions, error conditions, edge cases, view function pagination, and fuzz tests.

## Deploy

See [scripts/README.md](scripts/README.md) for deployment and interaction instructions.
