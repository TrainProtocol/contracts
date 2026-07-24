# Train Protocol (Fuel) — Contract Deployments

**Deployed from:** branch `main-add-fuel`, working tree atop commit `519feed`
(the port itself — `train`/`interfaces`/`payout_curve`, the deploy tooling, and
the test suite — is uncommitted at the time of this deployment; see
`git status`).
**Toolchain used to build the deployed bytecode:** `forc` 0.68.7 / `std`
v0.68.7 (the `train` fuelup toolchain), `fuels` (fuels-ts) `^0.103.0`; the deploy
transactions were sent through fuels-ts 0.103.0. `sway_libs` is **not** a
dependency — its only used symbol, `reentrancy_guard`, is vendored verbatim into
`train/src/reentrancy.sw` (no released `sway_libs` version is compatible with
forc/std > 0.67). This matches exactly what a fresh `forc build` reproduces today.
**Deployment salt seed:** `train.protocol.v2.fuel` (default; see
"Determinism & salt convention" below).
**Last updated:** 2026-07-24 (redeployed `Train` after four security-review
fixes to `train/src/main.sw` changed its bytecode; `ConstantPayoutCurve` was
unchanged and reused at its existing address — see the deploy note below).

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
| `Train` | `0x869027a726e61ee274e9612b8fbccafa7188e1d73f47dec76aeba4a778964b68` | `0xd3d33340f68b7898ccdca41c71e78662c375944abcf3a0a58d58f147799b165a` |
| `ConstantPayoutCurve` | `0xfc598e7d022590a0eecc2f58c9ba865ace7c2ca5acae881dced5f2dbb37eb33b` | `0xbdddc9be5a38c92c9062a02f67c85f3ca314adbfa9e5d7c99395be1cd83ad2e9` |

- **Network:** Fuel Sepolia Testnet
- **Provider:** `https://testnet.fuel.network/v1/graphql`
- **Explorer:** https://app-testnet.fuel.network (e.g.
  `https://app-testnet.fuel.network/tx/<txId>` for a transaction,
  or the contract address path for a contract)
- **Deployed via:** `scripts/deploy.ts`'s `deployAll` (deterministic salt,
  idempotent). In this redeploy **only `Train` was freshly deployed** — four
  security-review fixes to `train/src/main.sw` (removing the dead
  `TrainError::InvalidToken` variant, which changed the error-enum layout, plus
  an unconditional `reward_timelock_delta` overflow guard) changed its bytecode
  root, so its deterministic contract ID changed and the prior `Train` address
  (`0x72e9bc…61168c1b`) is superseded. `ConstantPayoutCurve` was **not** touched
  by those fixes: its bytecode is byte-identical, so `deployAll` predicted the
  same contract ID, found it already on-chain, and reused it (its deploy tx above
  is the original deploy of that unchanged bytecode, still live).
- **Status:** live, verified end-to-end on 2026-07-24 (103 report rows, 37 mined
  txs, 18 expected reverts, 0 failures; see the report under `reports/` and
  `docs/ARCHITECTURE.md`'s Testing section for the run breakdown).

> **`test_asset` (e2e fixture, not part of the protocol).** The Sepolia e2e run
> also deploys a throwaway `test_asset` contract — a minimal permissionless
> native-asset minter (`test_asset/src/main.sw`) — solely to give the
> different-asset solver-reward flow a genuine second `AssetId` to escrow. It is
> redeployed with a random salt on every run (no stable address, mints no real
> value) and is deliberately **not** listed in the tables above as a protocol
> contract. The most recent run's instance was
> `0xc12e96e9cf8e261fd14b3846f4b64150b4edde7413c4773d2997695e95a16641`.
- **Source verification:** Fuel has **no** contract source-verification
  feature — there is no Etherscan/Voyager-style verify-and-publish, no
  `forc verify`, and no Sourcify equivalent (tracked upstream as the still-open
  FuelLabs/forc issues #45 and #168). The available substitute is a
  **reproducible build**: this repository publishes the full contract source
  and pins the exact `forc`/`std` toolchain (see the header above; `sway_libs`
  is no longer a dependency), so anyone can recompile and independently recompute the Contract ID
  from `(bytecodeRoot, salt, stateRoot)` and confirm it matches the deployed
  address.

## Fuel Mainnet

Not deployed.

## Status table

| Network | Train | ConstantPayoutCurve | Status |
|---|---|---|---|
| Fuel Sepolia | `0x869027…78964b68` | `0xfc598e…b37eb33b` | Deployed, e2e-verified |
| Fuel Mainnet | — | — | Not deployed |

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
