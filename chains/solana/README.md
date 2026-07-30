# Train HTLC — Solana Program

A unified Solana program for Hash Time-Locked Contracts (HTLC) enabling cross-chain atomic swaps, at feature parity with the EVM `Train.sol` v3 contract (`chains/evm/solidity`). Supports every SOL/SPL principal and reward combination (including Token-2022), pluggable **payout curves**, and three **gasless / sponsored-transaction rails** replacing the EVM `TrainRouter`.

**Program IDs (devnet):**

| Program | ID |
|---|---|
| `train_htlc` | `2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ` |
| `constant_payout_curve` | `Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF` |
| `mock_decay_curve` (test-only) | `wmgDCMVreZ5xKv8NTg8rmkGPpb7bs5FHiToxqjc5yMr` |

## Architecture

The program implements a two-party atomic swap protocol between a **User** and a **Solver**:

1. **User** creates a lock on the source chain with a hashlock (`sha256(secret)`, secret is an opaque 32-byte string — byte-compatible with the EVM side's `sha256(abi.encodePacked(uint256 secret))`)
2. **Solver** creates a corresponding lock on the destination chain using the same hashlock
3. **User** redeems the solver's lock by revealing the secret
4. **Solver** uses the revealed secret to redeem the user's lock

If the swap doesn't complete, both parties can refund after their respective timelocks expire. Refunds always return the **full** amount (plus reward) to the lock's `refund_to` — never decayed, never to the caller.

### Protocol invariants (mirrors the EVM invariant suite)

- **Escrow solvency** — while `Pending`, each lock's vault (or lamport balance) holds exactly the measured amount (+ reward).
- **Status machine** — `Empty → Pending → {Redeemed | Refunded}`; terminal states are final; settlement happens exactly once.
- **Redeem authorization** — knowledge of the secret only; payout always to the stored `recipient`, excess to the stored `refund_to`, never to the caller.
- **Reward routing** — before `reward_timelock` the reward goes to `reward_recipient`; at/after it, to the redeem caller (relayer bounty enabling gasless destination redemption).
- **Payout curves** — `0 < payout ≤ amount`, so refunds/excess can never be inflated; the curve never touches rewards or refunds.
- **Attribution vs custody** — `sender` is the owner-of-record only; custody keys off `recipient` / `refund_to`. A sponsor paying rent (`rent_payer`) gets rent back, never funds.
- **Measured amounts** — stored/emitted `amount`/`reward` are the vault balance deltas (fee-on-transfer safe for Token-2022 transfer-fee mints).

### Lock fields (parity with EVM `UserLock` / `SolverLock`)

Both lock accounts store: `secret`, `amount` (measured), `sender`, `timelock`, `start_time`, `status`, `recipient`, `refund_to`, `token_mint`, `rent_payer`, `payout_curve` + `payout_curve_data` (≤ 256 bytes); solver locks additionally `reward` (measured), `reward_timelock`, `reward_recipient`, `reward_token_mint`.

### Account PDAs

| Account | Seeds | Purpose |
|---------|-------|---------|
| UserLock | `["user_lock", hashlock]` | User lock state (doubles as SOL custody) |
| UserVault | `["user_vault", hashlock]` | Token vault for user locks |
| SolverLock | `["solver_lock", hashlock, solver]` | Solver lock state |
| SolverVault | `["solver_vault", hashlock, solver]` | SPL principal/same-token custody |
| SolverRewardVault | `["solver_reward_vault", hashlock, solver]` | SPL reward custody |
| SolverLockGuard | `["solver_guard", hashlock, solver]` | Permanent single-use marker; **never closed** |
| IntentDomain | `["intent_domain"]` | Per-deployment intent domain salt (EIP-712 chainId analog) |
| Delegate | `["delegate"]` | SPL delegate authority for the intent rail (Permit2-allowance analog) |
| ConsumedIntent | `["intent", user, nonce_le]` | Single-use intent replay guard |

### Status flow

```
EMPTY (0)   --> PENDING (1)    (lock created)
PENDING (1) --> REDEEMED (3)   (secret revealed)
PENDING (1) --> REFUNDED (2)   (recipient early-cancel, or timelock expired)
```

## Payout curves

A lock may declare a `payout_curve` program + config bytes. At redeem, the HTLC CPIs into the curve with **zero accounts and zero signers** (the Solana analog of the EVM `STATICCALL` — the curve can touch no state, and the runtime forbids re-entering the HTLC) and reads a `u64` payout from return data:

```
compute_payout(amount: u64, start_time: u64, current_time: u64, config: Vec<u8>) -> u64
```

`0 < payout ≤ amount` is enforced; `payout` goes to `recipient`, `excess = amount − payout` to `refund_to`. At lock creation the curve account must match the declared id, be executable, and answer a probe call (the ERC-165-check analog). `constant_payout_curve` (payout = amount) ships with the protocol; `mock_decay_curve` exists for tests only.

### Trust model

**The `train_htlc` program is deployed immutable in production** (its upgrade
authority is burned with `solana program set-upgrade-authority --final`). Once
immutable, the program's own logic — including the standing-delegate spend path being
reachable *only* through an intent-gated instruction — cannot be changed by anyone, so
users granting a rail-C delegate approval are trusting fixed, audited code rather than
a mutable deployment.

**Payout-curve safety is intentionally an off-chain verification responsibility, on
both sides.** The program does not (and deliberately does not try to) police which
curve a lock uses — it only guarantees the curve is invoked with no accounts/no
signers and its output is clamped to `0 < payout ≤ amount`. Everything else is a
matter of each party vetting the curve *before* they commit value:

- The `payout_curve` id and `payout_curve_data` are emitted in the `UserLocked` /
  `SolverLocked` events, so both parties can inspect them off-chain.
- A **solver** must verify the curve on a *user* lock before locking on the
  destination chain, and a **user** must verify the curve on a *solver* lock before
  revealing the secret. In particular each side should confirm the curve program is
  **immutable** (upgrade authority burned) and audited — an *upgradeable* curve can
  look benign at inspection time and be changed later to return `0`/`> amount`/revert,
  which would brick the counterparty's redeem (funds are never lost — the lock
  creator recovers via refund after the timelock — but the counterparty who already
  performed on the other chain loses the trade).
- The shipped `constant_payout_curve` (payout = amount, no decay) is the safe default
  and is deployed `--final`. Any production curve should likewise be deployed
  immutable. `mock_decay_curve` is test-only and must never be used in a real quote.

This mirrors the EVM branch's curve trust assumption (no on-chain allowlist; recognize
the curve before filling); the on-chain program provides containment (no state access,
bounded output, no reentrancy), and off-chain quote validation provides the rest.

## Gasless rails (EVM TrainRouter equivalent)

The EVM `TrainRouter` exists because ERC-20s move only via allowance/signature standards (permit / EIP-3009 / Permit2). Solana's transaction model signs the *call itself*, so the three EVM rails collapse into three Solana-native ones — no standalone forwarder program, no arbitrary CPI, no router custody to conserve:

| Rail | How it works | User signs | Replay guard |
|---|---|---|---|
| **A. Fee-payer sponsorship** | Every lock instruction splits `payer` (rent+fees) from `sender` (funds). Relayer is fee payer; user co-signs as `sender`. Partially-signed tx relay: user signs → relayer countersigns → broadcast. | the transaction | native tx-signature dedup |
| **B. Durable nonce** | Rail A against a durable nonce account: no blockhash expiry, true offline/deferred signing. | the transaction (offline) | nonce advance |
| **C. Signed intent** | One-time SPL `approve` of the `["delegate"]` PDA (≈ Permit2 max-allowance), then the user signs only the **sha256 digest of an off-chain intent message** (EIP-712 style); a relayer submits `[ed25519_verify, user_lock_token_with_intent]`. The program verifies the signature via instructions-sysvar introspection and pulls exactly the signed amount by delegate authority. | an off-chain 32-byte digest only | `ConsumedIntent` PDA keyed by `(user, nonce)` (`init` fails on reuse) + deadline |

The rail-C intent message binds, byte-for-byte: domain tag `TRAIN_INTENT_V1\0`, program id, **per-deployment domain salt**, user, mint, amount, `call_hash = sha256(borsh(params) ‖ borsh(user_data) ‖ borsh(solver_data))`, nonce, deadline — the exact analog of the router's EIP-712 `Intent`. The user signs the message's sha256 digest (like signing an EIP-712 struct-hash digest; it also keeps the relayer transaction under Solana's 1232-byte packet limit). A malicious relayer can only execute the exact lock the user signed — the program rebuilds the message from the submitted arguments, so any tampering changes the digest and fails verification — at most once per `(user, nonce)`, before the deadline. Funds go straight user-ATA → lock vault, so there is no residual-custody surface (the EVM `ResidualBalance` check has no equivalent to need).

The **domain salt** is the cross-cluster replay barrier (Solana programs cannot read a chain id): `initialize_intent_domain` may only be called by the program upgrade authority, once, with a distinct salt per cluster — do this immediately after deploying and before finalizing the upgrade authority. Consumed intents can be closed for rent **after their deadline** (`close_consumed_intent`, rent to the relayer that paid it); replay stays impossible because consumption requires `now ≤ deadline`.

Rail C is SPL-only, mirroring the EVM router's ERC20-only rule; native SOL gasless flows use rails A/B.

## Token-2022 policy

The policy rejects only extensions that can cause **unrecoverable** loss, and accepts trusted-issuer capabilities that can merely *delay* settlement (matching the EVM branch's acceptance of USDC's freeze/blacklist).

**Rejected at lock creation** (`UnsupportedMintExtension`):
- **Permanent delegate** — the mint authority could seize tokens straight out of the escrow vault, silently breaking solvency (unrecoverable; no EVM analog).
- **Transfer hook** — runs arbitrary third-party code on every transfer; a reverting hook can permanently brick refunds (unrecoverable).

**Accepted** (documented issuer-trust risk — the caller must trust the issuer, exactly as they already do for USDC):
- **Pausable**, base-field **freeze authority**, **DefaultAccountState** — a trusted issuer can pause/freeze transfers, which *delays* redeem/refund but loses nothing: once unpaused/thawed both paths work, and the timelock/refund still returns funds. Regulated Token-2022 stablecoins (e.g. PYUSD, EURC) rely on these, so they remain usable.
- **Transfer fee** — accepted with measured-received accounting; the vault close is tolerant of the withheld-fee balance so settlement never bricks (orphaned vault rent is recoverable out-of-band via harvest-then-close).

Note: classic SPL Token mints (including mainnet USDC) carry no extensions and bypass this check entirely.

## Documented deviations from the EVM contract

| Topic | EVM | Solana | Why |
|---|---|---|---|
| Hashlock uniqueness | Reserved forever (`SwapAlreadyExists`) | User locks are unique only while open; solver locks are permanently unique per `(hashlock, solver)` via `SolverLockGuard` | User replay protection never depends on hashlock. The permanent solver guard matches EVM v3 and prevents an unreliable RPC retry from double-funding a swap, even after settlement/lock closure. |
| Swap history | On-chain `userLockHashes` + paginated getters | Anchor events + `getProgramAccounts` (memcmp on `sender`) for live locks | On-chain per-user arrays are a rent-funded anti-pattern; events are the canonical indexer surface on both chains |
| Rent / `rent_payer` | n/a | Locks store who paid rent; all closes return rent there | Sponsored flows must not leak relayer rent to users |
| Amount width | `uint256` | `u64` (SPL native); cross-chain descriptor fields are `u128` | Platform native |
| Reentrancy guard | `ReentrancyGuardTransient` | none needed | Runtime forbids CPI re-entry; state still flips before any CPI |
| Solver lock key | `(hashlock, solver)` mapping | `["solver_lock", hashlock, solver]` PDA | Same permanent one-lock-per-solver invariant on both runtimes |

## Instructions (27)

### Locks (8)

| Instruction | Description |
|-------------|-------------|
| `user_lock_sol` | Lock native SOL as user (`payer`/`sender` split) |
| `user_lock_token` | Lock SPL/Token-2022 tokens as user |
| `user_lock_token_with_intent` | Rail C: lock user tokens from a signed off-chain intent (relayer-submitted) |
| `solver_lock_sol` | Lock native SOL (+ SOL reward) as solver |
| `solver_lock_sol_token_reward` | Lock native SOL principal + SPL reward |
| `solver_lock_token` | Lock tokens, same-token reward (single vault) |
| `solver_lock_token_sol_reward` | Lock SPL principal + native SOL reward |
| `solver_lock_token_diff_reward` | Lock tokens with a different reward mint (two vaults) |

### Redeems (7)

`redeem_user_sol`, `redeem_user_token`, plus all five solver variants (`_sol`, `_sol_token_reward`, `_token`, `_token_sol_reward`, `_token_diff_reward`) — permissionless with the secret; payout/curve-excess/reward routing as per the invariants above.

### Refunds (7)

`refund_user_sol`, `refund_user_token` (recipient anytime, others after timelock), plus all five matching solver refund variants (anyone, after timelock). Full principal and reward go to `refund_to`.

### Intent & lifecycle (3)

| Instruction | Description |
|-------------|-------------|
| `initialize_intent_domain` | One-time per deployment, upgrade authority only: sets the intent domain salt |
| `close_consumed_intent` | After an intent's deadline: reclaim the replay-guard rent to its payer |
| `close_solver_lock` | Sender/rent-payer reclaims rent from a settled solver lock |

### Views (2)

`get_user_lock`, `get_solver_lock(hashlock, solver)`.

## Actor roles

The protocol has a **user** (source-side depositor), a **solver** (destination-side
depositor), and a **relayer** (pays gas/rent and submits gasless/redeem transactions).
The invariant is that **the token/SOL depositor is never the gas payer** — every lock
instruction separates `payer` (rent + fees) from `sender` (funds authority).

The test/E2E harness maps these to the three funded devnet keypairs in `.env`:

| Role | Keypair (`.env`) | Responsibilities |
|---|---|---|
| relayer / fee-payer / redeemer + mint authority | `DEFAULT_KEY` | pays all fees & rent, submits gasless + redeem txs, creates mints |
| user (source depositor) | `SOLVER_KEY` | holds tokens; creates user locks; authorizes debits but pays no fees |
| solver (destination depositor) | `THIRDPARTY_KEY` | holds tokens; creates solver locks |

`recipient` / `refund_to` / `reward_recipient` are set to the natural swap counterparty
among these three (e.g. a user lock's recipient is the solver; its refund_to is the user).

## Setup

```bash
cd chains/solana
npm install
cp .env.example .env    # then fill in the three funded devnet keypairs + RPC
```

`.env` (gitignored) holds `DEFAULT_KEY`, `SOLVER_KEY`, `THIRDPARTY_KEY` (JSON
byte-array secret keys) and `ANCHOR_PROVIDER_URL`. See `.env.example` for the exact
format and the role each key plays.

Requirements: Anchor 0.32.1, Solana CLI v2.x, Node 22.

## Building & testing

```bash
anchor build          # builds train_htlc + both curve programs
anchor test           # localnet: core suite + gasless rails + adversarial matrix
```

The local suite (`tests/`) — **64 passing** — covers every instruction happy-path plus:
payout-curve bounds and account-substitution rejections, the variant-confusion guard
(token lock via a SOL settlement path), the hashlock-reuse deviation (pinned behavior),
a cross-chain secret→hashlock byte vector, and an adversarial matrix per gasless rail —
tampered transactions, replays (tx, nonce, intent), attacker-substituted signatures,
spoofed instructions sysvar, expired intents, delegate over-pull, wrong fee payer.

## Devnet end-to-end

```bash
# one-time after deploy (upgrade authority):  initialize the intent domain
npx ts-node scripts/gasless/init-intent-domain.ts <per-cluster-salt>

# full E2E across every flow, happy + unhappy, with production actor separation:
npx ts-node scripts/devnet-e2e.ts
```

`scripts/devnet-e2e.ts` runs **every** flow against devnet using the three funded
`.env` keypairs as real, distinct swap parties (depositor ≠ gas payer on every flow):
each deposit rail, each gasless rail (A fee-payer sponsorship, B durable nonce, C signed
intent), settlement, refunds, payout curves, and views — happy paths **and** unhappy
paths. It **never funds or sweeps** the wallets (only a balance precheck); fresh mints
are created per run, so it is idempotent. Every happy path lands a success transaction;
every landable negative case lands as a real **failed** transaction (submitted with
`skipPreflight`) with an explorer link and the on-chain error; the few failures that are
rejected before landing (bad signature, replayed tx, expired durable nonce) are recorded
with the reason. It writes **`docs/e2e-devnet-report.md`** (+ a `.json`) and prints a
summary.

### Latest E2E results

Run of 2026-07-20 against devnet: **15/15 flows PASS, 0 failures** — 36 successful
transactions, 19 negative cases landed on-chain as expected `REVERTED` transactions, 3
pre-landing rejections documented. Every transaction is explorer-verifiable in
[`docs/e2e-devnet-report.md`](docs/e2e-devnet-report.md).

## Deployment

```bash
anchor build
anchor deploy --provider.cluster devnet            # deploys all three programs
npx ts-node scripts/gasless/init-intent-domain.ts <per-cluster-salt>
# production hardening (irreversible):
solana program set-upgrade-authority <PROGRAM_ID> --final
```

Initialize the intent domain **before** finalizing the upgrade authority, with a different salt per cluster. Note: `mock_decay_curve` is for testing only — do not deploy it to mainnet.

## Script reference

Operational scripts live in `scripts/` (one per instruction; run with `npx ts-node scripts/<name>.ts`, wallet selection via `WALLET=default|solver|thirdparty|user` + `.env` keys). Gasless flows live in `scripts/gasless/`:

| Script | Purpose |
|---|---|
| `gasless/approve-delegate.ts` | One-time SPL delegation to the program delegate PDA (rail C prerequisite) |
| `gasless/init-intent-domain.ts` | Initialize the per-cluster intent domain salt (upgrade authority) |
| `gasless/rail-a-sponsored-lock.ts` | Fee-payer sponsorship demo (partially-signed relay) |
| `gasless/rail-b-durable-nonce.ts` | Durable-nonce offline signing demo |
| `gasless/rail-c-intent-lock.ts` | Signed-intent lock demo (user signs a message digest, not a transaction) |
| `gasless/close-consumed-intent.ts` | Reclaim replay-guard rent after an intent's deadline (`<user> <nonce>`) |
