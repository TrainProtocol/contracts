# Train Protocol (Fuel) — Contract Deployments

**Deployed from:** branch `main-add-fuel`, working tree atop commit `3f7e036`
(the solver double-lock guard rework — identity-keyed solver locks,
`SolverLockAlreadyExists` — was uncommitted at the moment of this deployment
and committed immediately after, in the same change set as this file).
**Toolchain used to build the deployed bytecode:** `forc` 0.68.7 / `std`
v0.68.7 (the `train` fuelup toolchain), `fuels` (fuels-ts) `^0.103.0`; the deploy
transactions were sent through fuels-ts 0.103.0. `sway_libs` is **not** a
dependency — its only used symbol, `reentrancy_guard`, is vendored verbatim into
`train/src/reentrancy.sw` (no released `sway_libs` version is compatible with
forc/std > 0.67). This matches exactly what a fresh `forc build` reproduces today.
**Deployment salt seed:** `train.protocol.v2.fuel` (default; see
"Determinism & salt convention" below).
**Last updated:** 2026-07-30 (redeployed `Train` after the solver double-lock
guard rework — solver locks re-keyed to `(hashlock, solver)` with a permanent
`SolverLockAlreadyExists` uniqueness guard, index/count API removed — changed
its bytecode; `ConstantPayoutCurve` was unchanged and reused at its existing
address — see the deploy note below).

## What Fuel's determinism guarantee actually is

Fuel's contract ID is natively deterministic —
`ContractId = sha256(0x4655454C ++ salt ++ bytecodeRoot ++ stateRoot)`
(confirmed against `@fuel-ts/contract`'s `getContractId`) — so, unlike EVM,
**no CREATE2 factory is needed**: deploying identical bytecode with an
identical salt (and identical initial storage state — empty for both `train`
and `payout_curve`, confirmed via their `out/debug/*-storage_slots.json`
both being `[]`) on any two networks yields the identical contract ID.

This is a narrower guarantee than it may sound, and narrower than the EVM
port's CREATE2 claim across arbitrary deployer machines: it holds only for
**byte-identical bytecode**, which in turn requires the **same toolchain**
(`forc`/`std` versions, confirmed pinned above; `sway_libs` is no longer a
dependency — its `reentrancy_guard` is vendored in `train/src/reentrancy.sw`)
producing the build. It is not a magic property of the salt alone — it is a property of
`(bytecode, salt, state root)`, and only the salt half of that is fixed by
convention; the bytecode half is only reproducible if the exact same
compiler and dependency pins are used to produce it. `scripts/deploy/
toolchain.ts` exists specifically to capture and record `forc`/`fuel-core`/
`fuels-ts` versions alongside every deployment for exactly this reason — a
determinism claim is only meaningful alongside the toolchain that produced
the bytecode it refers to.

## Determinism & salt convention

Per-contract deterministic salt: `sha256('${seed}:${componentName}')`
(`scripts/deploy/salt.ts`'s `deterministicSalt`), `seed` defaulting to
`train.protocol.v2.fuel`. `sha256`, not `keccak256`, deliberately — every
other hash in this port (the hashlock) already standardizes on
`std::hash::sha256`, and Fuel's own `ContractId` derivation is itself
sha256-based. The literal seed carries the same `train.protocol.v2` root the
protocol uses for its deterministic-deploy salts on other chains, with a
`.fuel` suffix, documenting "same protocol generation" across chains without
implying any actual address relationship between them (the chains' address
spaces never overlap). Override via `FUEL_DEPLOY_SALT_SEED` — bump it
deliberately for a new release generation.

Per-contract (not one shared salt for `train` and `payout_curve`) purely as a
convention — not load-bearing for uniqueness, since the two contracts have
different bytecode and would get different contract IDs from the same salt
regardless.

Deployment is idempotent and permissionless: `scripts/deploy.ts` predicts the
contract ID from `(bytecode, salt, state root)` before sending anything, and
reuses an existing on-chain contract at that ID rather than redeploying
(`scripts/deploy/core.ts`'s `deployDeterministic`) — safe to re-run against
the same network any number of times.

## Fuel Sepolia Testnet — current deployment

| Component | Address | Deploy tx |
|---|---|---|
| `Train` | `0x445464bf4d8f2ad1cdffefa8345438f6769c44fc4aedf0eb9c2e34f5756f5750` | `0x89ef685f04e462507d516ff3801c486276b898fee7eff3aac548a672fce1f247` |
| `ConstantPayoutCurve` | `0xfc598e7d022590a0eecc2f58c9ba865ace7c2ca5acae881dced5f2dbb37eb33b` | `0xbdddc9be5a38c92c9062a02f67c85f3ca314adbfa9e5d7c99395be1cd83ad2e9` |

- **Network:** Fuel Sepolia Testnet
- **Provider:** `https://testnet.fuel.network/v1/graphql`
- **Explorer:** https://app-testnet.fuel.network (e.g.
  `https://app-testnet.fuel.network/tx/<txId>` for a transaction,
  or the contract address path for a contract)
- **Deployed via:** `scripts/deploy.ts`'s `deployAll` (deterministic salt,
  idempotent). In this redeploy **only `Train` was freshly deployed** — the
  solver double-lock guard rework of `train/src/main.sw` (solver locks re-keyed
  from `(hashlock, index)` to `(hashlock, solver Identity)`, a permanent
  `SolverLockAlreadyExists` per-solver uniqueness guard, deletion of the
  `solver_lock_count` map/getter, and the identity-keyed
  `redeem_solver`/`refund_solver`/`attach_solver_reward`/`get_solver_lock` API)
  changed its bytecode root, so its deterministic contract ID changed and the
  prior `Train` address (`0x869027…78964b68`, 2026-07-24) is superseded.
  `ConstantPayoutCurve` was **not** touched by the rework: its bytecode is
  byte-identical, so `deployAll` predicted the same contract ID, found it
  already on-chain, and reused it (its deploy tx above is the original deploy
  of that unchanged bytecode, still live).
- **Status:** live, verified end-to-end on 2026-07-30 (105 report rows, 37 mined
  txs, 20 expected pre-flight rejections — including the two new
  `SolverLockAlreadyExists` negatives: a duplicate `solver_lock` by the same
  solver, and a re-lock by the same solver after its lock was refunded — and
  0 failures; see the report under `reports/` and `docs/ARCHITECTURE.md`'s
  Testing section for the run breakdown).

> **`test_asset` (e2e fixture, not part of the protocol).** The Sepolia e2e run
> also deploys a throwaway `test_asset` contract — a minimal permissionless
> native-asset minter (`test_asset/src/main.sw`) — solely to give the
> different-asset solver-reward flow a genuine second `AssetId` to escrow. It is
> redeployed with a random salt on every run (no stable address, mints no real
> value) and is deliberately **not** listed in the tables above as a protocol
> contract. The most recent run's instance was
> `0x41cd620129d3bfd61c199b8007f474deddeee81261c3843968dfcf5c5c5d4bf8`.
- **Source verification:** Fuel has **no** contract source-verification
  feature — there is no Etherscan/Voyager-style verify-and-publish, no
  `forc verify`, and no Sourcify equivalent (tracked upstream as the still-open
  FuelLabs/forc issues #45 and #168). The available substitute is a
  **reproducible build**: this repository publishes the full contract source
  and pins the exact `forc`/`std` toolchain (see the header above; `sway_libs`
  is no longer a dependency), so anyone can recompile and independently recompute the Contract ID
  from `(bytecodeRoot, salt, stateRoot)` and confirm it matches the deployed
  address.

## Fuel Mainnet (Ignition) — current deployment

| Component | Address | Deploy tx |
|---|---|---|
| `Train` | `0x445464bf4d8f2ad1cdffefa8345438f6769c44fc4aedf0eb9c2e34f5756f5750` | `0x9f93a209b48a878ab66fcf14651947399e278f697dc03a981dcd0c4a73d62842` |

- **Network:** Fuel Mainnet (Ignition) · **Provider:** `https://mainnet.fuel.network/v1/graphql`
- **Explorer:** https://app.fuel.network (tx: `https://app.fuel.network/tx/<txId>`)
- **Deployed:** 2026-07-30, block 60,207,802, from commit `36e0677` (solver double-lock guard)
  via `scripts/deploy-train-mainnet.ts` (Train-only wrapper around
  `scripts/deploy/core.ts`'s `deployDeterministic`; same salt convention).
  Deploy fee: **211 base units** (~2.1e-7 ETH), gas 121,217.
- **Contract ID is identical to Fuel Sepolia's** — by construction (same `forc` 0.68.7 /
  `std` v0.68.7 debug-profile bytecode, same salt `sha256('train.protocol.v2.fuel:train')`,
  empty state root), so mainnet ships the exact bytecode that passed the 2026-07-30 Sepolia
  e2e run (105 rows, 0 failures). Confirmed post-deploy: sha256 of the on-chain bytecode on
  **mainnet, testnet, and the local build are all**
  `9811a5aa468a5fb999d898bd04487b623f074ddc4bc10de46a2ba139978c816d`.
- **`ConstantPayoutCurve` is deliberately NOT deployed on mainnet.** Curve-less locks are
  fully supported (`payout_curve: Option::None` ⇒ `compute_payout` returns the full amount).
  Its deterministic ID stays reserved at
  `0xfc598e7d022590a0eecc2f58c9ba865ace7c2ca5acae881dced5f2dbb37eb33b`.
- **Superseded:** the 2026-07-29 mainnet `Train` at `0x869027…78964b68` (pre-solver-guard
  bytecode) remains live but is superseded by the address above.
- **Source verification:** not possible on Fuel (see the Sepolia section) — the
  reproducible-build attestation above is the substitute.

## Status table

| Network | Train | ConstantPayoutCurve | Status |
|---|---|---|---|
| Fuel Sepolia | `0x445464…756f5750` | `0xfc598e…b37eb33b` | Deployed, e2e-verified |
| Fuel Mainnet | `0x445464…756f5750` | — (deliberately not deployed) | Deployed 2026-07-30, bytecode byte-identical to Sepolia |

## Operational notes

- **Reproducibility scope.** Re-running `scripts/deploy.ts` against a
  *different* network with the same salt seed and the same toolchain
  reproduces the same two addresses above; changing `forc`/`std`
  versions, or the contract source, changes the bytecode root
  and therefore the resulting contract ID — bump `FUEL_DEPLOY_SALT_SEED`
  deliberately for a new release generation rather than relying on address
  reuse across incompatible builds.
- **Idempotent re-runs.** `deployDeterministic` predicts the contract ID
  before deploying and reuses an existing on-chain match — re-running
  `scripts/deploy.ts` against Fuel Sepolia today would detect both `Train`
  and `ConstantPayoutCurve` already deployed at the addresses above and send
  no new deploy transaction.
- **Machine-readable record.** `scripts/deploy.ts` also writes
  `chains/fuel/deployments/<network>.json` (gitignored — a per-run scratch
  artifact, not source-controlled) with the same addresses plus the
  toolchain versions captured by `scripts/deploy/toolchain.ts`; this file is
  the source a future update to this table should be curated from.
