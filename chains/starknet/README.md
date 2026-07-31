# Train Protocol — Starknet

Trustless cross-chain swaps on Starknet via Hashed Time-Locked Contracts (HTLCs),
with two gasless deposit rails built on Starknet account abstraction.

## Contracts (`src/`)

| Contract | File | Role |
|---|---|---|
| **`Train`** | `Train.cairo` | The HTLC vault. Holds all locked funds; creates/redeems/refunds user and solver locks; applies payout curves; enumerates a user's locks. No owner/admin. |
| **`TrainRouter`** | `train_router.cairo` | Gasless rail A: a target-agnostic forwarder that verifies a user-signed SNIP-12 `Intent` and forwards a call (typically `user_lock_for`) on the user's behalf. No owner/admin. |
| **`IPayoutCurve` / `ConstantPayoutCurve`** | `payout_curve.cairo` | Pluggable, SRC5-introspectable payout curve applied to a lock's `amount` at redeem. `ConstantPayoutCurve` is the identity (full-payout) curve. |

Hashlock = `sha256(secret)` over a `u256` secret (cross-chain-standard preimage). All
value is `u256`; timelocks are `u64` with checked overflow guards; every state-changing
entrypoint is reentrancy-guarded and follows checks-effects-interactions.

### `Train` entrypoints
**Locks / redeem / refund**
- `user_lock` — create a user lock (caller is the owner of record).
- `user_lock_for(user, …)` — create a user lock attributed to `user`, funded by the caller (the router's forwarding target).
- `solver_lock` — create a solver lock (optional reward, in the same or a different token). Keyed by `(hashlock, solver)`: at most ONE lock per `(hashlock, solver)`, ever — a repeat call by the same caller reverts with `SolverLockAlreadyExists` before any funds move (permanent retry/replay guard; a refunded or redeemed solver must re-fill from a different address). Different solvers may still lock the same hashlock.
- `redeem_user` / `redeem_solver(hashlock, solver, secret)` — redeem with the secret; payout curve applies to `amount`, any excess goes to `refund_to`; solver reward routes to `reward_recipient` before `reward_timelock`, else to the redeemer.
- `refund_user` — refund to `refund_to` (recipient anytime; anyone after `timelock`).
- `refund_solver(hashlock, solver)` — refund `amount + reward` to `refund_to` (anyone after `timelock`).

**Views**
- `get_user_lock` / `get_solver_lock(hashlock, solver)` — doubles as a solver's idempotency probe: a zero `sender` in the result means that `solver` never locked under `hashlock`.
- `get_user_lock_hashes(user, offset, limit)` / `get_user_locks(user, offset, limit)` — windowed pagination returning the page plus the total count (no on-chain status filter; filter off-chain).

### Gasless deposits
- **Rail A — `TrainRouter` intent (SNIP-12 + SRC-6).** One-time `approve(router)`, then a relayer submits a user-signed `Intent` via `forward_intent`; the router pulls funds, forwards to `user_lock_for`, and asserts a conservation invariant. Single-use replay guard + explicit `router`/`chain_id` binding.
- **Rail B — SNIP-9 outside execution.** The user signs an `OutsideExecution` (`[approve, user_lock_for]`); a relayer (or a SNIP-29 paymaster) submits it via the account's `execute_from_outside_v2`. Requires no contract-side code — `Train` is simply called by the user's account.

See **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the full design, sequence
diagrams, the SRC-6 / SNIP-12 / SNIP-9 / SNIP-29 standards mapping, and the security model.

## Build & test

Toolchain: **Scarb 2.14.0**, **Starknet Foundry (snforge) 0.57.0**.

```bash
scarb build       # sierra + casm
snforge test      # 83 tests: HTLC state machine, guards (incl. the per-solver double-lock
                  # guard), reward-timelock boundary, refund asymmetry, payout curves,
                  # user_lock_for, windowed pagination, fuzz
```

The gasless rails are tested end-to-end on Sepolia with a real account (see below),
not with mock accounts.

## Deploy & end-to-end

Deployment, interaction, and the Sepolia end-to-end suite (every flow, happy + unhappy,
both gasless rails, with a generated tx report) are documented in
**[`scripts/README.md`](scripts/README.md)**.

## Deployed & verified (Starknet Sepolia)

Current deployment (2026-07-31) — the `Train` below carries the solver double-lock guard
(`(hashlock, solver)`-keyed locks, `SolverLockAlreadyExists`); it supersedes the previous
`0x4ae1ae0d…bf2d20b` deployment, which used the old indexed solver API and has no guard.

| Contract | Address | Voyager (verified source) |
|---|---|---|
| Train | `0x331d2d504d582a6918a70928fa31207f73600f45e8089310283223f439d52b0` | [class](https://sepolia.voyager.online/class/0x064d8573c2f3ef167278c765031ed7c8a969ebac44dbe56ac687450e45a7bb49#code) |
| TrainRouter | `0x1049d123293e9c182397ba1b5de795ee35c9ca0a1f2fecfec2eca14e38cecc8` | [class](https://sepolia.voyager.online/class/0x04337936c40c90f76a58d1c3d8b73c2e3adcdd63b89656ea57b84d1de1a8ef66#code) |
| ConstantPayoutCurve | `0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351` | [class](https://sepolia.voyager.online/class/0x01a3aa57876586b59a68c134c8690c3596ad524b9326920c8c0b71a0334ef33e#code) |

Train declare tx `0x2e74fd899cca318c1d0cb0fbcd9a0df7fdec7bc37ce47d62ee1efbc46590d78`, deploy tx
`0x4ef9307759efce47eb41c5e11179be7ae4eb58928c04fc3f0b85b02d31068d2`. Router/curve are reused at
their deterministic addresses (bytecode unchanged from the previous release, already verified).

The latest e2e run (`docs/e2e-testnet-report.md`) against this deployment is green:
86 rows, 33 mined txs, 4 expected on-chain reverts + 19 expected pre-flight rejections,
**0 failures** — including the on-chain guard probes (duplicate `solver_lock` rejected;
per-solver getter isolation). The verified source bundle contains **only** the deployable
package (no mocks): the test mocks live in `tests/`, outside the `train_protocol` package.

## Layout

```
src/            Train.cairo, train_router.cairo, payout_curve.cairo, lib.cairo
tests/          snforge test suite + test-only mocks (mock ERC20, mock curves) — never
                part of the package, never deployed, never in verification uploads
scripts/        TypeScript (starknet.js) deploy / interact / verify / sepolia-e2e tooling
docs/           ARCHITECTURE.md, e2e-testnet-report.md
```

## Docs
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — design, gasless rails, standards mapping, security model & considerations.
- [`docs/e2e-testnet-report.md`](docs/e2e-testnet-report.md) — the on-chain Sepolia e2e report.
- [`scripts/README.md`](scripts/README.md) — deploy / interact / e2e usage.
