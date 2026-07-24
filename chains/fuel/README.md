# Train Protocol — Fuel

Trustless cross-chain swaps on Fuel via Hashed Time-Locked Contracts (HTLCs),
adapted to Fuel's UTXO / native-multi-asset model, with a sponsored-transaction
gasless deposit rail.

## Contracts (Forc workspace)

This is a single Forc workspace (`Forc.toml`) with three member packages:

| Package | Kind | Role |
|---|---|---|
| `train/` | contract | The HTLC vault — locks, redeems, refunds, payout curves, pagination. No owner/admin. |
| `interfaces/` | library | Shared types the other packages depend on: the `PayoutCurve` ABI and the `UserLockParams`/`DestinationInfo` call shapes. |
| `payout_curve/` | contract | `ConstantPayoutCurve` — the identity payout curve (reference implementation). |

Hashlock = `sha256(secret)` over a `u256` secret (cross-chain-standard
preimage). Locked amounts are native Fuel asset coins (`msg_amount()`/
`msg_asset_id()`, no approve/transferFrom); every address-like field is an
`Identity` (`Address | ContractId`). Every state-changing entrypoint is
reentrancy-guarded and follows checks-effects-interactions.

See **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the full design:
the swap lifecycle, payout curves, the gasless rail, the security model, and
the completed Fuel Sepolia end-to-end report.

```
chains/fuel/
├── train/               train/src/main.sw — the Train HTLC contract
├── interfaces/           interfaces/src/lib.sw — shared types/PayoutCurve ABI
├── payout_curve/         payout_curve/src/main.sw — ConstantPayoutCurve
├── test_asset/           test_asset/src/main.sw — throwaway e2e-only asset minter
├── scripts/              deploy/e2e/test tooling (TypeScript, fuels-ts)
│   ├── deploy.ts          deterministic, idempotent deploy CLI
│   ├── testnet-e2e.ts     Fuel Sepolia end-to-end suite + report generator
│   ├── deploy/            salt/toolchain/network/artifact/persist helpers
│   └── lib/               Rail-1 sponsorship helper + the full test suite
├── reports/              generated Sepolia e2e reports (.md + .json)
└── docs/
    └── ARCHITECTURE.md   full design, gasless rail, security model
```

## Build

Toolchain: **`forc` 0.68.7**, `std` pinned to `v0.68.7` (see each package's
`Forc.toml`) — the newest forc that fuels-ts 0.103.0 officially supports.
`sway_libs` is **not** a dependency: its only used symbol, `reentrancy_guard`,
is vendored verbatim in `train/src/reentrancy.sw` (no released `sway_libs`
version is compatible with forc/std > 0.67). The local test suite runs against
`fuel-core` 0.47.1 (the version fuels-ts 0.103.0 supports; installed as the
`fuel-core-testnode` fuelup toolchain); `forc build` itself does not need
fuel-core.

```bash
cd chains/fuel
forc build          # builds every workspace member (train, interfaces,
                     # payout_curve, test_asset)
```

Compiled bytecode/ABI land under each package's `out/debug/` and
`out/release/`. Fuel's contract ID is natively deterministic from
`(bytecode root, salt, state root)` — see
[`DEPLOYMENTS.md`](DEPLOYMENTS.md) for exactly what that determinism
guarantee does and doesn't cover.

## Test

```bash
cd chains/fuel
npm install

# TypeScript integration/property/invariant suite, each against
# a real local fuel-core node (spawned per-file via fuels/test-utils):
node --require ts-node/register --test scripts/lib/trainCore.test.ts
node --require ts-node/register --test scripts/lib/harnessSmoke.test.ts
node --require ts-node/register --test scripts/lib/sponsoredTx.test.ts
node --require ts-node/register --test scripts/lib/propertyFuzz.test.ts
node --require ts-node/register --test scripts/lib/invariant/invariant.test.ts
```

(`npm run test:rail1` is a preconfigured shortcut for the `sponsoredTx.test.ts`
run above — see `package.json`.)

This covers, in order: the core HTLC state machine and guards
(`trainCore.test.ts`), harness plumbing (`harnessSmoke.test.ts`), Gasless
Rail 1 — sponsored transactions (`sponsoredTx.test.ts`), property-based
fuzzing via `fast-check` (`propertyFuzz.test.ts`), and a hand-built stateful
invariant-fuzzing harness (`invariant/invariant.test.ts`) — the closest attainable Sway analog
of the EVM reference port's Echidna/Medusa suites, since no such fuzzer
exists for Sway.

## Deploy

```bash
cd chains/fuel
cp .env.example .env   # fill in FUEL_DEPLOY_PRIVATE_KEY if deploying fresh
npx tsx scripts/deploy.ts
```

Env vars (see `.env.example` for the full list):

- `FUEL_PROVIDER_URL` — GraphQL endpoint (default: Fuel Sepolia).
- `FUEL_DEPLOY_PRIVATE_KEY` — deployer's private key. Only needs real funds
  if `train`/`payout_curve` aren't already deployed at the predicted
  deterministic address on the target network — a re-run against an
  already-deployed network is a no-op (idempotent, no funds required).
- `FUEL_DEPLOY_SALT_SEED` — overrides the deterministic-deploy salt seed
  (default documented in `scripts/deploy/salt.ts`).

Deploys `train` + `payout_curve` with a fixed, documented salt. Writes
`chains/fuel/deployments/<network>.json` (gitignored scratch artifact) — see
[`DEPLOYMENTS.md`](DEPLOYMENTS.md) for the curated, hand-maintained record.

## Run the end-to-end suite

```bash
cd chains/fuel
cp .env.example .env   # fund exactly ONE wallet, see below
npx tsx scripts/testnet-e2e.ts
```

Fuel's testnet faucet is CAPTCHA-gated and cannot be automated, so exactly
**one** wallet needs manual funding
(`FUEL_E2E_PRIMARY_PRIVATE_KEY`, funded via
https://faucet-testnet.fuel.network/) — every other role (user, sponsor,
solver, relayer, third party, beneficiary) is a freshly generated wallet,
auto-topped-up from the primary wallet at the start of the run. Optional env
vars let you pin any role to a stable, already-funded wallet instead (see
`.env.example`). The script targets Fuel Sepolia by default; point
`FUEL_PROVIDER_URL` at a local `fuel-core` node for faster iteration.

Runs every flow — the gasless rail, payout curves, solver rewards, every
refund/redeem asymmetry — happy path and adversarial/failure cases, and
writes a human-readable report plus a JSON twin to
`chains/fuel/reports/testnet-e2e-<timestamp>.md`/`.json`, with every mined
transaction linked to `https://app-testnet.fuel.network/tx/<txId>`. The most
recent completed run is linked from `docs/ARCHITECTURE.md`'s Testing
section.

## Gasless rail, in brief

Fuel has no approve/transferFrom model, so none of EVM's permit-style rails
apply here. The gasless deposit mechanism is a sponsored transaction:

- **Rail 1 — sponsored transaction.** The user signs a real transaction
  calling `Train.user_lock_for`; a sponsor only contributes the gas coin and
  co-signs. Pure SDK orchestration (`scripts/lib/sponsoredTx.ts`), zero new
  Sway code. A malicious sponsor can only refuse to submit — never redirect
  funds.

See **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the full
mechanism and threat model.
