# Train Protocol on Fuel — architecture

Train is a hashed time-locked contract (HTLC) bridge for trustless cross-chain
swaps. This document describes the Fuel (Sway) implementation: the contracts,
the swap lifecycle, the gasless deposit rail, and the security model.

## Contracts

| Package | File | Responsibility |
|---|---|---|
| `train` (contract) | `train/src/main.sw` | The HTLC vault. Holds all locked funds (native Fuel asset coins); creates/redeems/refunds user and solver locks; applies payout curves; enumerates a user's locks. No admin, no owner. |
| `interfaces` (library) | `interfaces/src/lib.sw` | The `PayoutCurve` ABI (called by `train`, implemented by `payout_curve`) plus the `UserLockParams`/`DestinationInfo` call shapes. Exists as a separate `library` package because a Sway `contract` project cannot depend on another `contract` project as a dependency (confirmed empirically — `forc build` rejects it as "declared as a library dependency, but is actually a contract"). |
| `payout_curve` (contract) | `payout_curve/src/main.sw` | `ConstantPayoutCurve` — the reference/identity `PayoutCurve` implementation (`compute_payout` always returns `amount` unchanged). |

All contracts are permissionless — no owner, pause, or upgrade authority anywhere.

## Swap lifecycle

A swap is identified by a **hashlock** `h = sha256(secret)`, where `secret` is a
`u256`, exactly as the pre-rewrite Fuel contract already computed it (preserved
verbatim for cross-chain preimage compatibility with every other Train chain).

Fuel has no ERC-20-style approve/transferFrom model: every lock function is
`#[payable]` and reads the coin actually forwarded with the call via
`msg_amount()`/`msg_asset_id()` — one `(AssetId, u64)` pair per call. Every
address-like field (`recipient`, `refund_to`, `reward_recipient`, the lock
owner) is an `Identity` (`Address | ContractId`), so a lock can pay out to
either a wallet or a contract.

- **User lock** (`user_lock`, or `user_lock_for(user, …)` to attribute a lock
  to another `Identity` while funding it from the caller): locks the forwarded
  `amount`/`asset_id` under `h`, with a `recipient`, a `refund_to`, a
  `timelock_delta`, a `quote_expiry`, and an optional `payout_curve` +
  `payout_curve_data`. One user lock per hashlock (`SwapAlreadyExists`).
- **Solver lock** (`solver_lock`): a solver locks the forwarded coin (minus an
  optional `reward`) under the same `h`, indexed `1, 2, …` so multiple solvers
  can compete (`get_solver_lock_count`/`get_solver_lock`). Carries its own
  `timelock_delta`, `reward_timelock_delta`, `reward_recipient`, `refund_to`,
  and optional `payout_curve`. The reward may be a **different asset** than the
  principal — see "Different-asset solver reward" below.
- **Redeem** (`redeem_user` / `redeem_solver`): anyone presenting the correct
  `secret` (`sha256(secret) == hashlock`) redeems. The `payout` (curve-adjusted
  `amount`, or the full `amount` when no curve is set) goes to `recipient`;
  any `excess = amount − payout` goes to `refund_to`. For solver locks the
  curve applies to `amount` only — the `reward` is paid in full, to
  `reward_recipient` while `now < reward_timelock`, otherwise to the redeeming
  caller (a keeper bounty).
- **Refund** (`refund_user` / `refund_solver`): returns funds to `refund_to`.
  `refund_user` is callable by the lock's `recipient` at any time, or by
  anyone once `timelock` has passed. `refund_solver` is callable by anyone,
  but only once `timelock` has passed (no early-recipient path).

Lifecycle states: `Empty → Pending → {Refunded | Redeemed}` (terminal).
`Empty` is not a persisted value — it is the absence of a storage entry,
detected via `StorageKey::try_read()` returning `None`. Every
state-mutating entrypoint calls `reentrancy_guard()` (vendored in
`train/src/reentrancy.sw`; see the security section) and follows
checks-effects-interactions (validate → write state → transfer).

**Storage-safety note.** `UserLock`/`SolverLock`'s public
view structs (including `payout_curve_data: Option<Bytes>`) are assembled on
read, not stored wholesale: `Bytes` is heap-backed, and `std::storage_api`'s
`write`/`read` (used by a plain `StorageMap<K, V>.insert`) persist a type's
raw reference-type representation — a bare pointer for a heap value, which is
meaningless once read back in a later transaction's fresh VM memory. The
persisted "core" (`UserLockData`/`SolverLockData`, all `Copy`-safe fields) is
stored via ordinary `StorageMap`s; curve config bytes live out-of-line in a
companion `StorageMap<Key, StorageBytes>`, Sway's purpose-built
persistence-safe byte container. This was verified against the pinned `std`
source (v0.68.4 at the time; toolchain now pinned to `std` v0.68.7, same
storage semantics), not assumed — see `train/src/main.sw`'s file-level comment.

## Payout curves

A lock may set `payout_curve` (a `ContractId`) + `payout_curve_data` (config
bytes). At redeem, `Train` calls `PayoutCurve::compute_payout(amount,
start_time, now, config)` and independently enforces `0 < payout <= amount`
regardless of what the curve returns (`InvalidPayout` otherwise).

**No interface-introspection check exists at lock-creation time — this is a
verified fact, not an assumption.** `std` (v0.68.4 at the time of this check,
now v0.68.7) was checked directly for an SRC-5/ERC-165-style introspection
module and has none. So `Train` never validates that a supplied
`payout_curve` address actually implements `PayoutCurve` before calling it. A
lock's curve is a trust-per-lock assumption: a counterparty **must** whitelist
the disclosed curve address off-chain before locking against it. The curve is
invoked via an ordinary (non-static) contract call — Fuel has no distinct
read-only-call instruction — so the reentrancy guard active across
`redeem_user`/`redeem_solver` is what actually prevents a malicious curve from
re-entering; `refund_*` never calls the curve, so a reverting/malicious curve
can never strand funds (they remain refundable after the timelock).
`ConstantPayoutCurve` is the identity curve shipped as the reference
implementation.

## Gasless deposits

EVM's three gasless rails (`forwardWithPermit`/EIP-3009/Permit2) all exist
solely because ERC-20 has an approval model, and each is a different
gasless-*approval* standard. **Fuel has no approval/transferFrom model at
all** — funds are native-asset UTXO coins, and spending a regular account's
coin always requires that account's own transaction witness. There is nothing
to "pull" via an off-chain-signed approval, so none of EVM's permit-style
rails have a Fuel equivalent. This port ships a single gasless deposit
mechanism: fee abstraction via a sponsored transaction.

| Rail | Mechanism | New on-chain code? | User experience |
|---|---|---|---|
| **1 — Sponsored transaction** | fuels-ts `Provider.assembleTx({ feePayerAccount, accountCoinQuantities })`, a dual-witness `ScriptTransactionRequest` | None — pure SDK orchestration | User signs a real Fuel transaction (fee-*gasless*, not signature-gasless) |

### Rail 1 — sponsored transaction (fee abstraction)

Implemented entirely in `scripts/lib/sponsoredTx.ts`; no new Sway code. The
user builds and signs one real `ScriptTransactionRequest` calling
`Train.user_lock_for`, funded from their own coin UTXO. A sponsor account is
named as `feePayerAccount` in `Provider.assembleTx`: it contributes a
base-asset coin input for gas and co-signs as a second witness. Each unique
coin-input owner gets its own witness slot
(`ScriptTransactionRequest.getCoinInputWitnessIndexByOwner`), so the user's
witness and the sponsor's witness are independent, but the user's witness
still covers the **entire assembled transaction** — every input, output,
script, and script-data, including the sponsor's own fee input. That is what
makes the sponsor's role strictly fee-only: **a malicious sponsor can only
refuse to submit (griefing/liveness) — it cannot alter the call, the amount,
or the recipient, and cannot redirect funds**, because doing so would
invalidate the user's own signature over the transaction.

**Discovered constraint: plain `user_lock` cannot be sponsored.**
`Train::user_lock` attributes `sender` via `std::auth::msg_sender()`, which
(per `sway-lib-std`'s `caller_address()`) requires every coin/message input on
the transaction to be owned by the *same* single address, and panics
(`AuthError::InputsNotAllOwnedBySameAddress`) the instant it sees a second
owner. A sponsor's fee coin is, by construction, owned by a different address
than the user's, so introducing a distinct sponsor makes plain `user_lock`
always revert (a bare panic, not a `require()`). This was confirmed
empirically while building Rail 1 (see `sponsoredTx.ts`'s file-level doc
comment and `scripts/lib/sponsoredTx.test.ts`). `user_lock_for(user, …)`
sidesteps this entirely — it takes `user` as an explicit parameter instead of
deriving it from `msg_sender()` — so `buildSponsoredUserLock` only ever
sponsors `user_lock_for` (self-attributing the lock to the funding user when
emulating a plain `user_lock`), and throws early with an explanatory error if
asked to sponsor `{ kind: 'user_lock' }` with a distinct sponsor rather than
letting the caller hit an opaque on-chain revert.

One same-asset caveat also discovered empirically: `assembleTx` allows only
one change destination per `AssetId` across a transaction. When the locked
asset is also the base (gas) asset, the sponsor's own change falls back to
the user's address rather than the sponsor's — a sponsor-side operational
concern (it can overpay into the user's pocket), never a fund-safety issue for
the user.

## Security model & invariants

- **No admin / owner / upgrade.** Fully permissionless; the only
  "privileged" behaviors are the recipient-may-refund-early rule and the
  post-`reward_timelock` redeemer-bounty rule, both intrinsic to the HTLC.
- **Attribution.** `user_lock` records the caller (`msg_sender()`) as owner;
  `user_lock_for` records the explicit `user` argument (funds still pulled
  from the caller's own coin input); `solver_lock` records the caller. See
  "Attribution" under Security considerations below.
- **Zero-identity guards** on `recipient`/`refund_to` (and
  `reward_recipient` when `reward > 0`); `user_lock_for` additionally rejects
  a zero `user` (`InvalidUser`). Checked via `is_zero_identity`, which
  compares against `Address::zero()`/`ContractId::zero()` depending on the
  `Identity` variant (there is no single universal "zero identity").
- **Payout bound** `0 < payout <= amount` on every curve result
  (`InvalidPayout`), so `excess` never underflows.
- **Timelock overflow guard**: `timelock_delta <= u64::max() - now` before
  computing `now + timelock_delta`, for both user and solver locks (and the
  reward timelock).
- **Reentrancy guard** (`reentrancy_guard()`, vendored verbatim from
  `sway_libs` v0.25.2 into `train/src/reentrancy.sw` — the `sway_libs`
  dependency was dropped because no released version is compatible with
  forc/std > 0.67, and this was its only used symbol) on every state-mutating
  entrypoint, effects (storage write) before interactions (payout-curve call,
  transfer).
- **No implicit balance assumptions.** Every lock entrypoint validates
  `msg_amount()`/`msg_asset_id()` explicitly — never trusting an implicit
  balance.
- **Overflow-safe pagination.** `get_user_lock_hashes`/`get_user_locks` guard
  `offset >= total` (or `limit == 0`) before computing
  `end = offset + limit`, so the addition can never overflow at any
  `(offset, limit)` — ported from the EVM reference port's pagination fix.

The hand-built invariant harness (`scripts/lib/invariant/`) checks five
properties continuously across randomized action sequences against a real
local node:

| ID | Property |
|---|---|
| **SOLV** | The contract's real balance of the tracked asset equals the sum of every currently-`Pending` lock's obligation (user-lock `amount`, or solver-lock `amount + reward`) in a shadow model — no more, no less. |
| **CONS** | Across any single action, every actor's and the contract's balance changes by exactly the signed amount that action's own accounting expects; an untouched wallet shows a delta of precisely zero. |
| **LWF** | A lock's `status` only ever transitions `Pending → {Redeemed, Refunded}`; a never-used hashlock stays `Empty`; once any `user_lock`/`user_lock_for` has succeeded under a hashlock, every later `user_lock` attempt under it reverts `SwapAlreadyExists` forever, even after redeem/refund. |
| **PAG** | `get_user_locks`/`get_user_lock_hashes` never revert for any `(offset, limit)` pair. |
| **SIDX** | For every hashlock with at least one solver lock, `get_solver_lock(hashlock, index)` returns `Some` for every `index` in `[1, count]` and `None` for `count + 1`. |

## Security considerations & trust assumptions

These are the accepted residual risks and trust assumptions of the protocol.
None is exploitable by an unprivileged party to steal funds; they are trust,
availability, or operational assumptions.

- **Payout curve is trusted per-lock.** As stated above, there is no
  interface-introspection check at lock-creation time (confirmed absent from
  the pinned `std`), so a lock's `payout_curve` is an arbitrary
  address whose behavior is not verified on-chain. A counterparty **must**
  whitelist the disclosed curve address off-chain before locking against it.
  The curve only ever adjusts `amount`, never `reward`.
- **`user_lock_for` attribution is untrusted.** Anyone may create a lock
  attributed to any `Identity`, so `get_user_locks`/`get_user_lock_hashes`
  enumeration is attacker-plantable and must be treated as untrusted
  attribution by off-chain consumers — no funds are ever at risk from this,
  since custody is governed by `recipient`/`refund_to`, never by the
  attributed owner. This is why the pagination getters return a bounded
  window rather than the whole list.
- **Hashlock squatting is permanent.** Because user locks are keyed by
  `hashlock` and `SwapAlreadyExists` is checked forever (see LWF above), a
  disclosed hashlock can be squatted by anyone before the legitimate user
  locks it. Mitigated in practice by the source leg typically being created
  before the hashlock is made public.
- **Different-asset solver reward — two-step funding.** A single FuelVM
  `CALL` forwards exactly one `(AssetId, u64)` coin pair — a VM
  calling-convention limit, not a Sway/SDK gap (the Fuel VM spec's receipts
  page: "a call may additionally forward one native asset",
  https://specs.fuel.network/master/abi/receipts.html) — so a reward in a
  *different* asset than the principal cannot ride the same call as the
  principal. `solver_lock` handles both cases:
  - **Same asset** (or `reward == 0`): the reward is bundled into the
    forwarded coin (`msg_amount() == principal + reward`) and escrowed
    immediately — `reward_funded = true` at creation.
  - **Different asset**: `solver_lock` forwards only the principal
    (`msg_amount() == principal`) and records the reward as declared-but-
    unfunded (`reward_funded = false`); a follow-up `attach_solver_reward(
    hashlock, index)` forwards exactly the declared `(reward_asset_id,
    reward)` and flips `reward_funded` true (`RewardAlreadyFunded` /
    `RewardAssetMismatch` guard against double-funding and wrong coins). It is
    permissionless — anyone may fund the declared reward on the solver's
    behalf.

  `redeem_solver`/`refund_solver` pay the reward only when `reward_funded` is
  true; an unfunded reward escrowed nothing, so skipping its transfer is
  correct and never blocks the principal from settling. When `reward == 0`,
  or `reward > 0` with `reward_asset_id == asset_id`, `reward_funded` is
  `true` from creation and `attach_solver_reward` is never called at all —
  the two-call path only exists for the specific case of a positive
  different-asset reward.

  **Bundling the two calls (optional, not a fund-safety requirement).**
  `Train` has no multicall-aware code whatsoever: `solver_lock` and
  `attach_solver_reward` are two completely ordinary entrypoints, each
  oblivious to whether the other is called in the same transaction or a
  separate one later. What makes bundling possible is a plain fact about
  Fuel scripts, not a Train or SDK-specific mechanism: a single Fuel script
  may issue as many contract `CALL`s as it wants in one transaction, each
  with its own forwarded-coin slot (the same general capability any script
  has, not something built for this feature). `fuels-ts`'s
  `Contract.multiCall([...])` is a client-side convenience that *generates*
  such a script from a list of call descriptions — it is not itself a chain
  or contract feature, and unlike EVM (where batching independent calls
  needs a dedicated `Multicall`-style contract using `delegatecall`, because
  one EVM transaction can only directly invoke one top-level call), Fuel
  needs no on-chain batching contract at all. Concretely (see
  `scripts/lib/testHarness.ts`'s `solverLockWithAttachedReward`):
  ```ts
  const lockScope = train.functions
    .solver_lock(params, dst, data)
    .callParams({ forward: [amount, assetId] });        // asset A
  const attachScope = train.functions
    .attach_solver_reward(hashlock, index)
    .callParams({ forward: [reward, rewardAssetId] });  // asset B
  await train.multiCall([lockScope, attachScope]).call();
  ```
  This compiles to one script issuing two sequential `CALL`s to `Train`,
  submitted as one signed transaction (one tx id, one block inclusion, one
  fee) — so if `attach_solver_reward` reverts (wrong asset/amount, already
  funded), the whole transaction reverts, including the `solver_lock` call
  that ran just before it. That atomicity is a UX nicety only, verified
  against the installed SDK on both a local node and Fuel Sepolia (see
  `DEPLOYMENTS.md`/`reports/`) — not required for fund safety, since the
  `reward_funded` gate already makes an unattached reward harmless on its
  own (see above).
- **TAI64 timestamps — an integrator gotcha.** `std::block::timestamp()`
  returns **TAI64**, not raw Unix seconds (TAI64 = Unix seconds + a fixed
  ~4.611×10¹⁸ offset) — confirmed against a live node while building Rail 1.
  Every timestamp-shaped field compared against it (e.g. `quote_expiry`) must
  be produced in TAI64 (this repo's scripts use fuels-ts's
  `DateTime.fromUnixSeconds(...).toTai64()`). An integrator who assumes plain
  Unix seconds will produce a `quote_expiry` that reads as always in the past,
  causing every call to appear immediately expired.
- **Reward is a keeper bounty after `reward_timelock`.** Past that time the
  reward goes to whoever lands the `redeem_solver` transaction (by design);
  `payout` always goes to `recipient` regardless.
- **Loose-HTLC timelocks.** Nothing on-chain ties the two legs of a
  cross-chain swap together; safe atomicity depends on correct off-chain
  selection of the relative timelocks, same as every Train HTLC port.

## Testing

There is no Echidna/Medusa/Foundry-invariant equivalent for Sway. The test
suite is TypeScript (`fuels-ts`) driving a real local `fuel-core` node for
every tier below (never a pure in-memory simulation), plus a completed live
Fuel Sepolia run:

- **Integration tests against a real local node** (`scripts/lib/*.test.ts`,
  Node's built-in test runner + `ts-node`, via `scripts/lib/testHarness.ts`):
  - `trainCore.test.ts` — the core HTLC state machine and guards (lock,
    redeem, refund, reward-timelock boundary, refund asymmetry, hashlock
    mismatch, payout-curve identity path, `user_lock_for` attribution,
    windowed pagination).
  - `harnessSmoke.test.ts` — a minimal round-trip smoke test validating the
    shared test-harness plumbing itself.
  - `sponsoredTx.test.ts` — Rail 1 (sponsored transaction), including the
    `user_lock` vs `user_lock_for` sponsorship constraint above and
    field-tamper adversarial cases.
  - `propertyFuzz.test.ts` — property-based fuzzing via `fast-check` (the
    closest attainable TS analog of Rust's `proptest`/the EVM port's
    Echidna/Medusa), generating randomized valid parameter sequences against
    the real node and asserting invariants hold for every generated case.
- **Stateful invariant-fuzzing harness**
  (`scripts/lib/invariant/invariant.test.ts`): a
  bespoke, hand-built driver (no reusable Echidna/Medusa harness exists for
  Sway) running bounded-length random action sequences against a real node
  and checking the SOLV/CONS/LWF/PAG/SIDX properties above after every step.
- **Fuel Sepolia end-to-end run** (`scripts/testnet-e2e.ts`): every flow this
  port supports — user lock, user lock with a payout curve, refund by
  recipient before timelock, refund by a third party after timelock,
  `user_lock_for` attribution, solver lock + redeem, solver reward before and
  after `reward_timelock`, solver refund, the **different-asset solver reward**
  (`solver_lock` + `attach_solver_reward` bundled as one atomic multi-call, with
  the principal paid in the base asset and the reward in a distinct
  `test_asset`), and Rail 1 sponsored `user_lock_for` — each with a happy path
  plus adversarial/validation failure cases (including the different-asset
  negatives: `RewardAssetMismatch`, `RewardAlreadyFunded`, `LockNotFound`), and
  every actor role on its own distinct address. Run against real deployed
  contracts on Fuel Sepolia (provider `https://testnet.fuel.network/v1/graphql`),
  targeting (2026-07-24 redeploy; see `DEPLOYMENTS.md` and `reports/`):
  - Train: `0x869027a726e61ee274e9612b8fbccafa7188e1d73f47dec76aeba4a778964b68`
  - ConstantPayoutCurve: `0xfc598e7d022590a0eecc2f58c9ba865ace7c2ca5acae881dced5f2dbb37eb33b`

  The different-asset reward is now proven on-chain against a real second asset,
  not only in the local suite. The gasless rail is likewise proven only
  on-chain, against real wallets, rather than with any mocked signer or node.
