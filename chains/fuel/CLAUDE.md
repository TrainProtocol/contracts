# Fuel (Sway) — chains/fuel

Forc workspace with four members: `train/` (HTLC), `payout_curve/`, `interfaces/`, `test_asset/`
(e2e-only asset minter). Toolchain: **forc 0.68.7**, `std` pinned to git tag v0.68.7; local tests
need **fuel-core 0.47.1** (`forc build` does not).

## Build / test

```
forc build                      # builds all 4 members
npm install
npm run test:rail1              # sponsored-tx gasless rail
# the rest are NOT in package.json scripts — type them out:
node --require ts-node/register --test scripts/lib/trainCore.test.ts
node --require ts-node/register --test scripts/lib/harnessSmoke.test.ts
node --require ts-node/register --test scripts/lib/propertyFuzz.test.ts       # fast-check
node --require ts-node/register --test scripts/lib/invariant/invariant.test.ts
```

There are **no Sway unit tests** — the entire suite is TypeScript (fuels-ts), each file spawning a
real local fuel-core node. Tests run under `ts-node`; operational scripts run under `tsx`
(`npx tsx scripts/deploy.ts`, `npx tsx scripts/testnet-e2e.ts`).

## Gotchas

- `train/src/reentrancy.sw` is sway_libs' reentrancy guard **vendored verbatim** — no released
  sway_libs works with forc/std > 0.67. Do not add a sway_libs dependency; update the vendored
  file instead.
- Deploys are deterministic + idempotent: per-contract salt `sha256('train.protocol.v2.fuel:<component>')`
  (`scripts/deploy/salt.ts`), so testnet and mainnet share contract IDs.
- Fuel has no source verification — the record is a **reproducible build**: on-chain bytecode
  sha256 must match a local `forc build` (see `DEPLOYMENTS.md`).
- Canonical deployment record: `DEPLOYMENTS.md` (Sepolia testnet + Ignition mainnet; mainnet is
  Train-only, curve address reserved).
