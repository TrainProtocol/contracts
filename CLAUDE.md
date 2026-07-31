# Train Protocol — Contracts

HTLC-based cross-chain atomic swap contracts ("Train") implemented independently per chain.
Current release: **v3** — solver locks are keyed by `(hashlock, solver)` so a blind `solverLock`
retry cannot double-fund a swap. Every chain implementation mirrors the same protocol surface:
`userLock / solverLock / redeem* / refund*`, optional payout curves, and gasless rails where the
chain allows them.

## Repository layout

| Path | What it is |
| --- | --- |
| `chains/evm/solidity/` | Foundry project: shared EVM `Train.sol` + `TrainRouter` + payout curve, plus the Tempo L1 variant under `src/tempo/` |
| `chains/fuel/` | Sway (forc) workspace + TypeScript test/deploy harness |
| `chains/starknet/` | Cairo (Scarb + snforge) + nested `scripts/` npm package |
| `chains/solana/` | Anchor workspace (3 programs) + ts-mocha tests |
| `chains/aztec/` | Noir/Aztec.nr contracts (v5.0.1) + nested `scripts/` npm package |
| `discovery/` | Legacy Hardhat solver-registry contract (unrelated to the HTLC core; no tests) |

Each chain folder has its own `CLAUDE.md` with build/test commands and chain-specific gotchas.
There is no working root-level build: the root `package.json` only carries lint/format tooling.

## Branch model

- `main` — latest stable state of every production-track chain (evm+tempo, fuel, starknet, solana, aztec).
- `main-add-<chain>` — long-lived per-chain development branches. They are **kept after merging**;
  chain work continues there and gets re-merged into `main`. `main-add-evm` and `main-add-evm-tempo`
  both own `chains/evm` — merge both and union `chains/evm/solidity/DEPLOYMENTS.md` when they diverge.
- Early-stage chains exist only on their branches (bitcoin, ton, zcash, xrp, sui, stacks, aptos).

## Deployment records (canonical sources)

- EVM / Tempo / Tron: `chains/evm/solidity/DEPLOYMENTS.md`
- Fuel: `chains/fuel/DEPLOYMENTS.md`
- Starknet: `chains/starknet/README.md` (Sepolia) + `chains/starknet/docs/mainnet-deployment.md`
- Solana: `chains/solana/README.md` (devnet program IDs)
- Aztec: `chains/aztec/README.md` (testnet)

The root `README.md` aggregates the **latest** addresses only; per-chain files keep history.
When you deploy or supersede a contract, update the chain's canonical record *and* the root README.

## Conventions

- Commits: `feat(<chain>): ...` / `fix(<chain>): ...` (`tempo`, `deploy`, `ci` also used as scopes).
- Mainnet deploys so far ship **Train only** — payout curves and routers stay undeployed with their
  deterministic addresses reserved; locks pass `payoutCurve = 0` (full payout).
- Deterministic deploys: CreateX on EVM (`keccak256('train.protocol.v3')` salt), sha256-salted
  contract IDs on Fuel, fixed UDC salt on Starknet. Same source + same salt ⇒ same address.
