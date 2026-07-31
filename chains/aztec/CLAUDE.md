# Aztec (Noir / Aztec.nr) — chains/aztec

Everything is pinned to **Aztec v5.0.1**: install with `aztec-up install 5.0.1`. Two contract
packages (no workspace): `contracts/train/` and `contracts/payout_curve/`. Token integration uses
the official `aztec-standards` Token (tag v5.0.1).

## Build / codegen

```
cd contracts/train && aztec compile            # -> target/train-Train.json
aztec codegen contracts/train/target/train-Train.json -o scripts/   # regenerates scripts/Train.ts
```

## Test — the prepare-txe.sh trap

The 37-test TXE suite runs with `aztec test` from `contracts/train/`, **but you must run
`./prepare-txe.sh` first, after every compile**: `aztec compile` wipes foreign artifacts from
`target/`, and the tests need the Token + ConstantPayoutCurve artifacts copied back in. This is
documented only inside the script itself — don't debug "artifact not found" any other way.

## scripts/ is its own npm package

- Runs via `tsx`, gated by `AZTEC_ENV=local-network|devnet|testnet` (configs in `scripts/config/`).
  ~25 npm shortcuts: `npm run setup:testnet`, `deploy:testnet`, `user-lock:testnet`, `e2e:testnet`, …
- `postinstall` builds a git dependency (`aztec-scan-sdk`); `overrides` pin `@aztec/*` to 5.0.1.
- `npm test` there is a placeholder — the real tests are the Noir TXE suite above.
- Fee payment auto-switches: SponsoredFPC on local/devnet; on testnet, Fee Juice bridged from L1
  Sepolia (`L1_PRIVATE_KEY` required; the **first** `setup.ts` run is *expected* to fail with
  "no claim data found" — run it twice).

## Notes

- Compiled artifacts (`contracts/*/target/*.json`) are **committed** and huge — exclude them from
  greps (`grep --exclude='*-*.json'` or search `src/` only).
- Canonical deployment record: testnet table in `README.md` (Train, curve, two test tokens;
  no mainnet yet). Verification is on AztecScan (instance + artifact).
