# Train — Stateful Fuzzing Properties

Invariant specification for the `Train` HTLC escrow. The suite lives under `test/invariant/` and is
driven by Foundry, **Echidna**, and **Medusa** against one shared set of handlers and properties.

## Protocol classification

HTLC / cross-chain atomic-swap escrow. `Train` is the source-chain vault: users and solvers lock
ERC-20 (or native ETH) behind `hashlock = sha256(secret)`; a lock settles **exactly once**, either by
`redeem` (reveal the preimage → pay `recipient`) or `refund` (timelock-gated → pay `refundTo`). There
is no owner, no admin sweep, no mint/burn — the only outflows are the four settlement paths.

## Harness model (what is and isn't exercised)

- **One token.** A single non-fee `MockERC20` is used as `token` and (for solver locks) `rewardToken`.
  This makes the conservation identities *exact* (no fee-on-transfer dust). Fee-on-transfer and
  rebase behaviour are out of scope here and are documented as trust assumptions in `README.md`.
- **`payoutCurve = address(0)`** on every lock, so `payout == amount` and `excess == 0`. The curve
  attack surface (audit finding #2) is a documented trust assumption, not fuzzed.
- **Three dedicated payees** (`recipientAddr`, `refundAddr`, `rewardAddr` in `Base.sol`) receive all
  principal / refund / reward. They never act and never fund, so they are disjoint from the three
  acting actors. This lets every settlement property assert *exact per-address balance deltas* with
  no aliasing — the redeemer/refunder is always an actor, never a payee.
- **Secret registry.** The fuzzer cannot invert `sha256`, so create-handlers mint a fresh
  `(secret, hashlock)` pair from a monotone counter and record it; redeem/refund handlers replay it.
- **Time.** `handler_skipTime` and the refund handlers advance time so timelocks expire and the
  reward-routing rule (`rewardTimelock > now ? rewardRecipient : redeemer`) exercises both branches.

## Guarantee legend

- **SHOULD-HOLD** — backed by the contract code / HTLC spec; a violation is a real bug. All
  implemented properties are SHOULD-HOLD.
- **EXPLORATORY** — a lead worth human review, not a hard guarantee. Listed at the bottom; most map
  to documented trust assumptions and are intentionally *not* implemented as always-on invariants.

---

## Implemented — Global invariants

Checked after every call by both fuzzers. All are `public`, argument-free, and mutate no state.
`Properties.sol`.

| ID | Property | Guarantee | Discovery sources |
|----|----------|-----------|-------------------|
| **SOLV** | `property_escrowSolvency` — `balanceOf(Train) == Σ amount` over Pending user locks `+ Σ (amount+reward)` over Pending solver locks. Exact equality in this single-token, fee-free harness. | SHOULD-HOLD | CON-01/03, RT-09, SPEC-01, ADV-01/02 |
| **CONS** | `property_tokenConservation` — `Σ actor balances + Σ payee balances + balanceOf(Train) == totalSupply`. No tokens minted/burned/leaked by the protocol. | SHOULD-HOLD | CON-02/06, SPEC-08/15, ADV-03 |
| **UWF** | `property_userLocksWellFormed` — every created user lock: `status != Empty`, non-zero `sender`, immutable `recipient/refundTo/token`, `amount > 0`, `timelock > startTime`, and the secret biconditional (`Redeemed ⇒ sha256(secret)==hashlock`; else `secret == 0`). | SHOULD-HOLD | ST-05/07/09/11/13, VS-01/03/05/07, SPEC-03/11/13 |
| **SWF** | `property_solverLocksWellFormed` — solver-side mirror of UWF plus `rewardToken` immutability and, when `reward > 0`, `rewardRecipient` immutability and `rewardTimelock < timelock`. | SHOULD-HOLD | ST-06/08/10/12, VS-02/04/06/08, SPEC-09 |
| **ENUM** | `property_enumerationScaleSafe` — the paginated `getUserLockHashes` getter never reverts at any size, reports a stable `total`, returns a full page, and the per-owner totals sum to the registry count. Regression guard for audit finding #1. | SHOULD-HOLD | ADV-18, finding #1 |
| **SCNT** | `property_solverIndicesInRange` — every registered solver index is within `[1, getSolverLockCount(hashlock)]` (1-based, monotone post-increment). | SHOULD-HOLD | VT-01/02/03, VS-13 |

> **Terminal-state finality** (a settled lock never re-opens; ST-03/04, SPEC-02/10, ADV-04/05/11) is
> covered *implicitly*: a `Redeemed→Pending` regression breaks UWF/SWF's `Pending ⇒ secret == 0`
> (the secret is still set), and a `Refunded→Pending` regression restores an obligation whose funds
> already left, breaking SOLV. No ghost terminal-status map is needed.

## Implemented — Specific (per-transition) postconditions

`internal`, invoked on the success branch of the relevant handler with pre-call balances passed in.
The redeemer/refunder is always an actor, hence disjoint from the payees, so each delta is exact.

| ID | Wired in | Property | Discovery sources |
|----|----------|----------|-------------------|
| **ULC** | `handler_userLock`, `handler_userLockFor` | New user lock is `Pending`; stored `amount == requested` (measured-delta == requested for a fee-free token). | ST-05, RD-04 |
| **SLC** | `handler_solverLock` | New solver lock is `Pending`; `amount/reward == requested` and `amount+reward == total requested` (exact same-token split, no dust). | ST-06, RT-06/07 |
| **URD** | `handler_redeemUser` | `recipient` gains exactly `amount`; `refundTo` gains 0; the redeemer gains 0. | RT-01, RD-02, SPEC-06, ADV-07/14 |
| **SRD** | `handler_redeemSolver` | `recipient` gains exactly `amount`; reward routes by the timelock rule — to `rewardRecipient` before `rewardTimelock`, to the redeemer at/after it — never the wrong party. | RT-02/05, RD-03, SPEC-07, ADV-09/10 |
| **URF** | `handler_refundUser` | `refundTo` gets exactly `amount`; the caller gets 0. | RT-03, ADV-08 |
| **URF-R** | `handler_refundUserAsRecipient` | The recipient-may-refund-anytime branch: recipient triggers refund, funds still go to `refundTo`, recipient gets 0. | ADV-08 (auth branch) |
| **SRF** | `handler_refundSolver` | `refundTo` gets exactly `amount + reward` (single consolidated same-token transfer); the caller gets 0. | RT-04, ADV-13 |

---

## EXPLORATORY leads (not implemented as always-on invariants)

These are deliberately **documented rather than fuzzed**, because
they are either accepted trust assumptions (already in `README.md`) or need a richer harness (a
malicious token/curve/`train`) than this suite models. Listed for human review.

| Lead | Disposition |
|------|-------------|
| Hashlock-squat griefing (ADV-17, finding #3) | Accepted HTLC griefing; gas-only, no funds at risk. Documented in README. A focused test could assert the squatter nets zero after self-refund. |
| `userLockFor` array bloat (ADV-18, finding #1) | Gas-only griefing of off-chain enumeration. Mitigated by the scale-safe paginated getters (regression-guarded by **ENUM**). |
| Malicious `payoutCurve` (ADV-15/21, finding #2) | Trust assumption: solvers whitelist curves off-chain. Not fuzzed (harness uses `address(0)`). A curve-attack harness (dust payout, revert, self-destruct → confirm refund still works) is future work. |
| Fee-on-transfer split rounding (ADV-22) | Out of scope (mock has no fee). The same-token split is proven exact for fee-free tokens by **SLC**. |
| `redeemUser` liveness / ETH gas-stipend (ADV-20) | Known constraint: a contract recipient needing >10k gas to receive ETH can't be the ETH recipient. Documented in README. |
| TrainRouter conservation bypass (ADV-23) | The Router (`ResidualBalance` check) is out of this suite's scope (Train-only). Covered by the Router unit/fork tests. |
| Revealed-secret cross-lock replay on shared hashlock (ADV-19) | By design: main payout still goes to `recipient` (**SRD**); only the post-`rewardTimelock` reward is redeemer-claimable. |

---

## Campaign results

- **Medusa** (`medusa.json`, testLimit 500k): **16 tests passed, 0 failed** — 526,639 calls /
  5,318 sequences, 2,120 branches.
- **Echidna** (`echidna.yaml`, assertion mode): **0 failing** — all properties/handlers passing; the
  `assert(false)` failure branches were reported "never reached".

No property violations were found.
