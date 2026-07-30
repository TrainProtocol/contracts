# Train Protocol on Starknet — architecture

Train is a hashed time-locked contract (HTLC) bridge for trustless cross-chain
swaps. This document describes the Starknet (Cairo) implementation: the contracts,
the swap lifecycle, the two gasless deposit rails, and the security model.

## Contracts

| Contract | File | Responsibility |
|---|---|---|
| `Train` | `src/Train.cairo` | The HTLC vault. Holds all locked funds; creates/redeems/refunds user and solver locks; applies payout curves; enumerates a user's locks. No admin, no owner. |
| `TrainRouter` | `src/train_router.cairo` | Gasless deposit rail (Rail A): a target-agnostic forwarder that verifies a user's signed `Intent` and forwards a call to `Train` on their behalf. No admin. |
| `IPayoutCurve` / `ConstantPayoutCurve` | `src/payout_curve.cairo` | A pluggable, SRC5-introspectable curve that computes the redeemable payout for a lock. `ConstantPayoutCurve` is the identity curve (full payout). |

All contracts are permissionless and immutable at the parameter level — there is
no owner, pause, or upgrade authority.

## Swap lifecycle

A swap is identified by a **hashlock** `h = sha256(secret)`, where `secret` is a
`u256` and the hash is computed over the 32-byte big-endian encoding of that
value (`Train::_sha256_u256`). SHA-256 over the `u256` preimage is the
cross-chain-standard hashlock so the same secret works across chains.

- **User lock** (`user_lock`, or `user_lock_for(user, …)` to attribute a lock to
  another address while funding it from the caller): the initiator locks `amount`
  of `token` under `h`, with a `recipient`, a `refund_to`, a `timelock`, a
  `quote_expiry`, and an optional `payout_curve`. One user lock per hashlock
  (`SwapAlreadyExists`).
- **Solver lock** (`solver_lock`): a solver locks `amount` (+ optional `reward` in
  `reward_token`) under the same `h`, keyed by `(h, solver)` — different solvers can
  still compete for the same hashlock, but at most one lock per `(h, solver)` ever
  (see the per-solver uniqueness guard below). Carries its own `timelock`,
  `reward_timelock`, `reward_recipient`, `refund_to`, and optional `payout_curve`.
- **Redeem** (`redeem_user` / `redeem_solver`): anyone presenting the correct
  `secret` (`sha256(secret) == h`) redeems. The `payout` (curve-adjusted `amount`,
  or full `amount` when no curve) goes to `recipient`; any `excess = amount − payout`
  goes to `refund_to`. For solver locks the payout curve applies only to `amount`;
  the `reward` is paid in full — to `reward_recipient` while `now < reward_timelock`,
  otherwise to the redeeming caller (a keeper bounty).
- **Refund** (`refund_user` / `refund_solver`): returns funds to `refund_to`.
  `refund_user` is callable by the `recipient` at any time, or by anyone once the
  `timelock` has passed. `refund_solver` is callable by anyone once the `timelock`
  has passed and returns `amount + reward`.

Lifecycle states: `Empty → Pending → {Redeemed | Refunded}` (terminal). Every
state-mutating entrypoint is guarded by a reentrancy guard and follows
checks-effects-interactions.

## Payout curves

A lock may set `payout_curve` (a contract address) + `payout_curve_data` (a
`ByteArray` config). At redeem, `Train` calls
`IPayoutCurve::compute_payout(amount, start_time, now, config)` and enforces
`0 < payout <= amount`. At lock creation the curve is validated to advertise
`IPayoutCurve` via SRC5 introspection (`InvalidPayoutCurve` otherwise). The curve
is invoked with an ordinary contract call — Starknet offers no read-only-call
guarantee — so the reentrancy guard active across redeem is what prevents a
malicious curve from re-entering; refund never calls the curve, so a reverting
curve can never strand funds (they remain refundable after the timelock).
`ConstantPayoutCurve` returns the full amount unchanged.

## Gasless deposits

A user can create a lock **without paying gas** in one of two ways. Starknet's
account abstraction provides three primitives these build on:

| Primitive | What it is |
|---|---|
| **SRC-6 `is_valid_signature(hash, sig)`** | Every account exposes it; a contract can ask "did this account's owner sign this hash?" (works for single-key, multisig, and smart-contract accounts). |
| **SNIP-9 `execute_from_outside_v2`** | A method on the user's account that runs a user-signed batch of `Call`s, submitted (and paid for) by anyone. |
| **SNIP-12** | Typed-data hashing (Poseidon, revision 1). Its `StarknetDomain` binds `name`, `version`, `chain_id`, `revision` — but **not** a contract address. |

### Rail A — `TrainRouter` signed intent

The user grants a one-time `token.approve(router, amount)` (or max). Thereafter,
each lock is gasless for the user:

```
 user (off-chain)                    relayer (pays gas)             TrainRouter                              Train
 ────────────────                    ──────────────────             ───────────                              ─────
 1. Intent{user, router, train,
      token, amount, selector,        call_data = encode(
      call_hash, nonce, deadline}         user_lock_for,(user,params…))
    call_hash = poseidon(call_data)
    hash = snip12(domain{TrainRouter,
             version, chain_id}, Intent)
 2. sig = account.sign(hash) ──────► 3. forward_intent(intent,       a. assert intent.router == this          (RouterMismatch)
    (no tx, no gas)                       call_data, sig) ─────────► b. assert now <= deadline                (IntentExpired)
                                                                     c. assert !consumed[hash]; consumed[hash]=true (replay; before interactions)
                                                                     d. assert poseidon(call_data) == call_hash    (CallHashMismatch)
                                                                     e. ISRC6{user}.is_valid_signature(hash,sig)   (InvalidSignature)
                                                                     f. bal0 = token.balance_of(this)
                                                                     g. token.transfer_from(user, this, amount)    (standing approval)
                                                                     h. token.approve(train, amount)
                                                                     i. call(train, selector, call_data) ────────► user_lock_for(user,…)
                                                                     j. token.approve(train, 0)
                                                                     k. assert token.balance_of(this) == bal0      (conservation / ResidualBalance)
                                                                     l. emit IntentForwarded{user, train, call_hash, relayer, token, amount}
```

Security of the intent:
- **Router binding.** SNIP-12's `StarknetDomain` cannot carry a contract address,
  so the router address is bound explicitly by the `Intent.router` field (hashed
  into the signed struct) and asserted `== get_contract_address()` as the first
  check. Without it, the same signed intent could validate against any other
  contract reusing the `TrainRouter`/`version` domain + `Intent` type on the same
  chain (wherever the user has a standing approval). `chain_id` (from the domain)
  prevents cross-chain replay.
- **Single use.** `consumed_intent[hash]` is set before any external call; a second
  forward of the same signed intent, by any caller, reverts (`IntentConsumed`).
  `nonce` is a user-chosen differentiator baked into the hash — re-signing with a
  fresh nonce deliberately allows an identical call to run again.
- **Call binding.** `call_hash = poseidon(calldata)` plus the signed `train` /
  `selector` fully pin the forwarded call — a relayer cannot substitute a
  different call.
- **Conservation.** The router snapshots its balance, approves exactly `amount`,
  forwards, resets the approval, and asserts its balance is unchanged — a
  misbehaving target can consume at most, and exactly, `amount`.

### Rail B — SNIP-9 outside execution

No standing approval. The approval is one of the calls inside the signed payload:

```
 user (off-chain)                      relayer / paymaster (pays)     user's account (SNIP-9)                Train
 ────────────────                      ──────────────────────────     ───────────────────────                ─────
 1. OutsideExecution{caller, nonce,
      execute_after, execute_before,
      calls:[ approve(train, amount),
              user_lock_for(user, params…) ]}
    hash = snip12(domain{account}, OutsideExecution)
 2. sig = account.sign(hash) ────────► 3. account.execute_from_outside_v2( ─► verify nonce/time-bounds/sig, then run calls:
    (no tx, no gas)                          outside_exec, sig)               approve(train, amount); user_lock_for(user, …) ──► lock created
```

`Train` needs no awareness of this — it is called by the user's account, exactly
as if the user had sent the transaction. Replay (`used_nonce`), domain, and time
bounds are enforced by the account. To sponsor the fee (user pays nothing) or let
the user pay the fee in another token, a SNIP-29 paymaster (e.g. AVNU) submits the
`execute_from_outside_v2` call; the on-chain shape is unchanged.

## How the gasless rails map to Starknet standards

The two rails are not bespoke — each is a composition of Starknet account-abstraction
standards. This section states exactly which standard each piece uses and whether the
protocol *implements* it or *inherits* it from the user's account.

### SRC-6 — account signature verification
SRC-6 is the standard account interface; its `is_valid_signature(hash, signature) -> felt252`
returns `starknet::VALIDATED` (or `1`) for a valid signature. Rail A relies on this as its
only signature primitive: `TrainRouter` calls the **user's account** `is_valid_signature`
(via OpenZeppelin's `assert_valid_signature`) rather than hardcoding a curve. Consequences:
- The router works with any SRC-6 account — single-key, multisig, or smart-contract signer —
  with no special casing (the equivalent of contract-signature support).
- The router never handles a raw private key or a specific signature scheme; correctness of
  "did this user authorize this?" is delegated to the audited account.

### SNIP-12 — typed-data hashing (Rail A intent)
SNIP-12 is Starknet's typed structured-data hashing standard (Poseidon, revision 1). The
`Intent` is hashed as a SNIP-12 message:
```
message_hash = poseidon( 'StarkNet Message', hash(StarknetDomain), signer, hash_struct(Intent) )
```
- **`StarknetDomain`** carries `name` (`'TrainRouter'`), `version` (`1`), `chain_id`
  (`get_tx_info().chain_id`), and `revision` (`1`). `chain_id` is what prevents cross-chain
  replay.
- **No verifying-contract field.** SNIP-12's `StarknetDomain` has no field for a verifying
  contract address, so the router's own address cannot be bound by the domain — the protocol
  binds it explicitly by making `router` a field of the `Intent` struct and asserting
  `intent.router == get_contract_address()` as the first check. That explicit binding is what
  stops a signature from being replayed against a different contract that reuses the same
  `name`/`version` + `Intent` type on the same chain.
- **`signer`** folded into the message hash is `intent.user` — so the account whose signature
  is checked is exactly the user named in the intent (no cross-user replay).
- **`hash_struct(Intent)`** = `poseidon(INTENT_TYPE_HASH, user, router, train, token, amount,
  selector, call_hash, nonce, deadline)`, where `INTENT_TYPE_HASH` is the precomputed SNIP-12
  type hash of the `Intent` type string (with `u256` encoded as its `low`/`high` referenced
  struct, `u64` as `u128`, and `felt` fields as `felt`, matching OpenZeppelin's convention).
  Every field that affects the pull or the forwarded call is therefore committed in the digest.

### SNIP-9 — outside execution (Rail B)
SNIP-9 defines `execute_from_outside_v2(OutsideExecution, signature)` on the **account**. The
`OutsideExecution` struct is `{ caller, nonce, execute_after, execute_before, calls }`. The
account enforces, itself: the `caller` restriction (or the `'ANY_CALLER'` sentinel), the
`execute_after < now < execute_before` window, a **non-sequential used-nonce set** (parallel-
safe replay protection), and signature validity against its own SNIP-12 domain
(`'Account.execute_from_outside'`, version 2). Rail B rides entirely on this: the user signs an
`OutsideExecution` whose `calls` are `[token.approve(train, amount), train.user_lock_for(...)]`,
a relayer submits it, and `Train` is simply called by the account — it needs, and contains, no
SNIP-9 code.

### SNIP-29 — paymaster (fee sponsorship / fee abstraction)
SNIP-29 is an off-chain paymaster API layered on SNIP-9. A paymaster's relayer account submits
the `execute_from_outside_v2` call and either sponsors the fee (user pays nothing) or lets the
user pay the fee in an alternate ERC-20. It plugs into **Rail B** with no contract change; it
can equally sponsor a **Rail A** `forward_intent` submission (that is just the relayer's own
transaction, whose gas a paymaster can cover). The protocol implements nothing for SNIP-29 —
it is purely a relayer/account-layer concern.

### Standards-conformance summary
| Rail | Standards used | Implemented by the protocol | Inherited from the account |
|---|---|---|---|
| **A — `TrainRouter` intent** | SNIP-12, SRC-6 (+ SNIP-29 optional) | `Intent` type/struct hash, domain (`name`/`version`), **explicit `router` binding**, single-use `consumed_intent`, deadline, `call_hash` binding, conservation invariant, `IntentForwarded` | signature validation (`is_valid_signature`) |
| **B — SNIP-9 outside exec** | SNIP-9, SNIP-12, SRC-6 (+ SNIP-29 optional) | nothing (`Train` unchanged; called as the account) | `OutsideExecution` hashing, used-nonce replay, time-bounds, `caller` restriction, signature, calls execution |
| **Direct** | SRC-6 | normal `user_lock`/`solver_lock` entrypoints | account `__validate__`/`__execute__` |

**Replay/trust model in one line:** Rail A's replay defense is *ours* (permanent
`consumed_intent` keyed on the full SNIP-12 digest, plus `chain_id` + `router` binding); Rail B's
replay defense is the *account's* (audited SNIP-9 nonce set + domain). Both bind the exact calls
the user signed and can be sponsored by a SNIP-29 paymaster.

## Security model & invariants

- **No admin / owner / upgrade.** Fully permissionless; the only "privileged"
  behaviors are the recipient-may-refund-early and post-`reward_timelock`
  redeemer-bounty rules, both intrinsic to the HTLC.
- **Attribution.** `user_lock` records the caller as owner; `user_lock_for` records
  the explicit `user` (funds still pulled from the caller); `solver_lock` records
  the caller. Owner is never zero for a real transaction, and a zero owner would
  read as `LockNotFound` — so attribution can't be spoofed into stranding funds.
- **Per-solver lock uniqueness.** `solver_locks` is keyed by `(hashlock, solver)`:
  at most ONE lock per `(hashlock, solver)`, ever. A repeat `solver_lock` by the
  same caller reverts with `SolverLockAlreadyExists` *before* any funds are
  pulled — so a solver whose RPC lied about a submitted tx (reported it as
  missing when it had actually landed) can retry safely instead of silently
  double-funding the same swap and losing the second escrow once the secret
  becomes public. The guard never lifts, not even after a refund or redeem; a
  deliberate re-fill of the same hashlock requires a different solver address.
  A solver can probe idempotently via `get_solver_lock(hashlock, solver).sender`
  (zero means "never locked") before deciding whether to retry. Different
  solvers may still lock the same hashlock.
- **Zero-address guards** on `recipient` / `refund_to` (and `reward_recipient` when
  `reward > 0`); `user_lock_for` rejects a zero `user` (`InvalidUser`).
- **Payout bound** `0 < payout <= amount` on every curve result (`InvalidPayout`),
  so `excess` never underflows.
- **Timelock overflow** guarded (`delta <= u64::MAX − now`).
- **Reentrancy guard** on every state-mutating entrypoint (`Train` and
  `TrainRouter`), effects before interactions.
- **Fee-on-transfer tokens** are rejected on the lock path (`_transfer_in` requires
  the balance to increase by the full `amount`).

## Security considerations & trust assumptions

These are the accepted residual risks and trust assumptions of the protocol (surfaced by an
independent security review). None is exploitable by an unprivileged party; they are trust,
availability, or operational assumptions.

- **Payout curve is trusted per-lock.** A lock's `payout_curve` is an arbitrary
  address; the on-chain SRC5 check only proves the contract *claims* the interface, not how it
  behaves, and the curve is invoked with a normal (non-static) call. A malicious/reverting/
  upgradeable curve can brick a redeem or return a valid-but-adversarial payout, which across a
  two-leg swap can cost a counterparty a leg. **A counterparty MUST whitelist the disclosed
  curve address off-chain before locking** (an on-chain curve allowlist is a possible future
  hardening). The curve only ever adjusts `amount`, never `reward`.
- **`user_lock_for` attribution is untrusted.** Anyone may create a lock attributed
  to any `user`, so `get_user_locks(user, …)` / `get_user_lock_hashes(user, …)` enumeration is
  attacker-plantable and must be treated as untrusted attribution by off-chain consumers.
  Because user locks are keyed by `hashlock`, a disclosed hashlock can also be squatted
  (`SwapAlreadyExists`) — mitigated in practice by Starknet's non-public mempool and by the
  source leg being created before the hashlock is public.
- **Supported tokens.** Assumes standard ERC-20s: **non-fee-on-transfer**,
  **non-rebasing**, **non-blacklisting**. Fee/rebasing tokens revert on the lock path (safe but
  unusable); a blacklisting token can brick a redeem if `recipient`/`refund_to` is blacklisted
  (funds recoverable via refund).
- **Loose-HTLC timelocks.** Nothing on-chain ties the two legs' timelocks; safe
  cross-chain atomicity depends on correct off-chain selection of the relative timelocks.
- **Reward is a keeper bounty after `reward_timelock`.** Past that time the reward
  goes to whoever lands the `redeem_solver` tx (MEV by design); `payout` always goes to
  `recipient`.
- **Read-only reentrancy window.** The payout-curve call happens while the lock is
  still `Pending`; unguarded view getters would return pre-redeem state if read from inside a
  malicious curve callback. `Train` never acts on this — only external integrators reading Train
  views mid-curve-call could be misled.
- **Timestamp influence on decaying curves.** A time-decaying curve's payout/excess
  split depends on the sequencer's `block.timestamp`; the identity `ConstantPayoutCurve` is
  unaffected.

## Testing

- **Local (`snforge`)**: the HTLC state machine and guards, reward-timelock
  boundary, refund asymmetry, hashlock mismatch, payout curves (identity +
  fractional-decay excess split + invalid-curve), `user_lock_for` attribution, and
  windowed pagination — using the token/curve mocks under `src/mocks/`.
- **Sepolia (end-to-end)**: `scripts/src/sepolia-e2e.ts` runs every flow —
  including both gasless rails with a real SNIP-9 wallet — happy and unhappy paths,
  against Starknet Sepolia, and writes a report with on-chain transaction links to
  `docs/e2e-testnet-report.md`. The gasless rails are proven only on-chain, with a
  real account, rather than with any mock account.
