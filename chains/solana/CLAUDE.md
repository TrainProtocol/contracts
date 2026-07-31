# Solana (Anchor) — chains/solana

Anchor workspace, **anchor 0.32.1 pinned** (`avm install 0.32.1 && avm use 0.32.1`), Solana CLI v2,
Node 22. Three programs: `train_htlc` (core, 27 instructions), `constant_payout_curve`,
`mock_decay_curve` (**test-only — never deploy to mainnet**). Program IDs are pinned identically
for localnet and devnet in `Anchor.toml`.

## Build / test

```
npm install && cp .env.example .env   # DEFAULT_KEY / SOLVER_KEY / THIRDPARTY_KEY (JSON byte arrays)
anchor build
anchor test                            # localnet; ts-mocha suite (core + gasless + adversarial matrix)
```

## Gasless rails & scripts

- Rail A: fee-payer sponsorship; Rail B: durable nonce; Rail C: signed intent (`intent_lock`).
- One-time per cluster, by the upgrade authority, **before finalizing**:
  `npx ts-node scripts/gasless/init-intent-domain.ts <per-cluster-salt>`.
- Production hardening is `solana program set-upgrade-authority <ID> --final` (irreversible) —
  devnet `train_htlc` is already finalized/immutable.
- Scripts (`scripts/*.ts`, one per instruction) run via `ts-node`; select signer with
  `WALLET=default|solver|thirdparty|user`. Devnet e2e: `npx ts-node scripts/devnet-e2e.ts`
  → writes `docs/e2e-devnet-report.md/.json`.

## Notes

- Solver locks support the full principal×reward matrix: SOL/SPL principal × SOL/SPL/different-SPL
  reward (`solver_lock_token_sol_reward`, `solver_lock_token_diff_reward`, …).
- Amount fields are u128 (`dst_amount`, reward), not u64.
- Devnet program IDs are the canonical deployment record — see `README.md`. No mainnet deploy yet.
