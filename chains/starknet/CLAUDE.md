# Starknet (Cairo) — chains/starknet

Cairo package `train_protocol` built with **Scarb 2.14.0**, tested with **Starknet Foundry
(snforge) 0.57.0**. OpenZeppelin components for security/introspection.

## Build / test

```
scarb build          # sierra + casm
snforge test         # full suite (unit + fuzz), no network needed
```

- `tests/` lives deliberately **outside** the package sources so mocks never ship in
  class-verification uploads. Keep it that way.
- Gasless rails are exercised only by the Sepolia e2e (real account), not by mocks:
  `cd scripts && npm run e2e`.

## scripts/ is its own npm package

`chains/starknet/scripts/` has a separate `package.json` (starknet.js v9, tsx). From there:

```
npm ci && cp .env.example .env       # RPC URL + account keys
npm run deploy | deploy-all | interact | verify | e2e
npx tsx src/preflight-mainnet.ts     # mainnet readiness checks
```

## Layout / records

- `src/Train.cairo`, `src/train_router.cairo`, `src/payout_curve.cairo`.
- Deployments: Sepolia table in `README.md`; mainnet in `docs/mainnet-deployment.md`
  (Train only, UDC salt `train-protocol-mainnet-v1`, `unique: false`; verification is by
  class-hash reuse — mainnet class == verified Sepolia class).
- e2e reports: `docs/e2e-testnet-report.md/.json`.
