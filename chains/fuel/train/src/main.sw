//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

// SPDX-License-Identifier: MIT
contract;

mod reentrancy;

// ─────────────────────────────────────────────────────────────────────────
// Train Protocol -- Cross-Chain HTLC Bridge (Fuel/Sway port)
//
// Trustless cross-chain bridge using Hashed Time-Locked Contracts. This is the Fuel/Sway
// port of the Train protocol design (canonical implementation is the EVM/Solidity contract),
// adapted to Fuel's UTXO / native-multi-asset model:
//
//   - No approve/transferFrom: funds move as native Fuel asset coins forwarded with the call
//     (`msg_amount()` / `msg_asset_id()`), one `(AssetId, u64)` pair per `#[payable]` call.
//   - `Identity` (Address | ContractId) is used everywhere EVM/Cairo use a bare address, so a
//     lock can pay out to either a wallet or a contract.
//   - Fully permissionless: no owner/admin anywhere.
//   - `hashlock = sha256(secret)`, exactly as the legacy contract already did (preserves
//     cross-chain preimage compatibility with every other Train chain).
//
// This is a full, breaking replacement of the pre-rewrite Fuel HTLC ABI (no external consumer
// of the old ABI is known).
//
// STORAGE-SAFETY NOTE (read before touching `UserLock`/`SolverLock`):
// `Bytes` (and therefore `Option<Bytes>`) is heap-backed, and a plain `StorageMap`'s `write`/`read`
// persist a type's raw reference-type representation -- for a heap value that is a bare pointer,
// meaningless once read back in a later transaction's fresh VM memory (`write`'s own doc: "Will not
// work for heap values"; confirmed against `std` v0.68.4, pin now v0.68.7, same semantics). So
// `payout_curve_data: Option<Bytes>` cannot be a field of a struct stored wholesale. Instead the
// persisted "core" (`UserLockData`/`SolverLockData`, all Copy-safe fields) lives in ordinary
// `StorageMap`s, the curve config bytes live out-of-line in a companion `StorageMap<Key,
// StorageBytes>` (Sway's persistence-safe byte container), and the public `UserLock`/`SolverLock`
// views are assembled on read (see `to_public_user_lock`/`to_public_solver_lock`).
// ─────────────────────────────────────────────────────────────────────────

use std::{
    asset::transfer,
    auth::msg_sender,
    block::timestamp,
    bytes::Bytes,
    call_frames::msg_asset_id,
    context::msg_amount,
    contract_id::*,
    hash::sha256,
    storage::storable_slice::*,
    storage::storage_bytes::*,
    storage::storage_vec::*,
    string::String,
};
use ::reentrancy::reentrancy_guard;
use interfaces::{
    DestinationInfo,
    PayoutCurve,
    UserLockParams,
};

// ───────────────────────────── Errors ─────────────────────────────

/// Custom errors, named to match the EVM/Starknet ports' error naming.
///
/// `InvalidPayoutCurve`, `NativeNotSupported`, `MsgValueMismatch`, and `TransferFailed` from
/// the EVM version are intentionally NOT ported:
///   - `InvalidPayoutCurve`: no interface-introspection probe is performed (see the
///     `PayoutCurve` trust-model doc comment in `interfaces::PayoutCurve`), so there is
///     nothing to reject at lock-creation time.
///   - `NativeNotSupported`: Fuel's native multi-asset model has no separate "native ETH"
///     branch requiring its own carve-out error; every asset (including the base asset) is
///     just an `AssetId` forwarded via `msg_asset_id()`.
///   - `MsgValueMismatch`: there is no separate declared "amount" parameter to cross-check
///     against a transferred value; the transferred `msg_amount()` IS the amount (see
///     `user_lock_core`/`solver_lock`).
///   - `TransferFailed`: `std::asset::transfer` panics on failure rather than returning a
///     boolean to check, so there is no explicit boolean-check error to raise.
pub enum TrainError {
    ZeroAmount: (),
    LockNotFound: (),
    HashlockMismatch: (),
    LockNotPending: (),
    InvalidTimelock: (),
    TimelockOverflow: (),
    InvalidRewardTimelock: (),
    SwapAlreadyExists: (),
    RefundNotAllowed: (),
    QuoteExpired: (),
    InvalidPayout: (),
    InvalidUser: (),
    ZeroAddress: (),
    /// `attach_solver_reward` on a lock whose reward is already funded (a same-asset lock,
    /// whose reward is bundled at creation, or a lock already successfully attached).
    RewardAlreadyFunded: (),
    /// `attach_solver_reward` where the forwarded coin does not exactly match the lock's
    /// declared `(reward_asset_id, reward)`.
    RewardAssetMismatch: (),
    /// `solver_lock` where the calling solver has already created a solver lock under this
    /// hashlock -- at most ONE solver lock per (hashlock, solver), EVER (the guard never
    /// lifts, not even after a refund/redeem; see `solver_lock`).
    SolverLockAlreadyExists: (),
}

// ───────────────────────────── Types ─────────────────────────────

/// Lock lifecycle states (the protocol's `LockStatus`). `Empty` is the
/// implicit state of any hashlock / (hashlock, solver) key that has never been written (detected via
/// `StorageKey::try_read()` returning `None`, not via a persisted `Empty` value).
pub enum LockStatus {
    Empty: (),
    Pending: (),
    Refunded: (),
    Redeemed: (),
}

impl PartialEq for LockStatus {
    fn eq(self, other: Self) -> bool {
        match (self, other) {
            (LockStatus::Empty, LockStatus::Empty) => true,
            (LockStatus::Pending, LockStatus::Pending) => true,
            (LockStatus::Refunded, LockStatus::Refunded) => true,
            (LockStatus::Redeemed, LockStatus::Redeemed) => true,
            _ => false,
        }
    }
}
impl Eq for LockStatus {}

// `DestinationInfo`/`UserLockParams` live in `interfaces::lib` (imported above) so the shared
// user-lock call shapes are single-sourced. See the module doc comment at the top of
// `interfaces/src/lib.sw` for the full rationale.

/// Parameters for creating a solver lock. `reward_asset_id` is explicit (unlike the principal
/// asset, which is implicit via `msg_asset_id()`) because a solver lock's reward may be a
/// *different* asset than the principal -- see the `solver_lock` doc comment for how a
/// different-asset reward is funded.
pub struct SolverLockParams {
    pub hashlock: b256,
    pub reward: u64,
    pub timelock_delta: u64,
    pub reward_timelock_delta: u64,
    pub recipient: Identity,
    pub reward_recipient: Identity,
    pub refund_to: Identity,
    pub reward_asset_id: AssetId,
    pub payout_curve: Option<ContractId>,
    pub payout_curve_data: Option<Bytes>,
    pub src_chain: String,
}

/// Public-facing user-lock view, returned by `get_user_lock`/`get_user_locks`. Same field
/// layout as the protocol's `UserLock` on the other ports, adapted to Sway types
/// (`u64` amounts/timelocks, `Identity` for every address-like field, `AssetId` for the token).
pub struct UserLock {
    pub secret: u256,
    pub amount: u64,
    pub sender: Identity,
    pub timelock: u64,
    pub start_time: u64,
    pub status: LockStatus,
    pub recipient: Identity,
    pub refund_to: Identity,
    pub asset_id: AssetId,
    pub payout_curve: Option<ContractId>,
    pub payout_curve_data: Option<Bytes>,
}

/// Public-facing solver-lock view, returned by `get_solver_lock`. See `UserLock` above for the
/// general shape rationale.
pub struct SolverLock {
    pub secret: u256,
    pub amount: u64,
    pub reward: u64,
    pub sender: Identity,
    pub timelock: u64,
    pub reward_timelock: u64,
    pub start_time: u64,
    pub recipient: Identity,
    pub status: LockStatus,
    pub reward_recipient: Identity,
    pub refund_to: Identity,
    pub asset_id: AssetId,
    pub reward_asset_id: AssetId,
    /// Whether the declared `reward` is actually escrowed. True at creation for a same-asset
    /// (or zero) reward; false for a different-asset reward until `attach_solver_reward` funds
    /// it. Redeem/refund pay the reward only when this is true.
    pub reward_funded: bool,
    pub payout_curve: Option<ContractId>,
    pub payout_curve_data: Option<Bytes>,
}

/// Storage-only mirror of `UserLock` -- see the storage-safety note at the top of this file.
/// Identical field set minus `payout_curve_data` (kept out-of-line in
/// `storage.user_lock_curve_data`).
struct UserLockData {
    secret: u256,
    amount: u64,
    sender: Identity,
    timelock: u64,
    start_time: u64,
    status: LockStatus,
    recipient: Identity,
    refund_to: Identity,
    asset_id: AssetId,
    payout_curve: Option<ContractId>,
}

/// Storage-only mirror of `SolverLock`; see `UserLockData` above.
struct SolverLockData {
    secret: u256,
    amount: u64,
    reward: u64,
    sender: Identity,
    timelock: u64,
    reward_timelock: u64,
    start_time: u64,
    recipient: Identity,
    status: LockStatus,
    reward_recipient: Identity,
    refund_to: Identity,
    asset_id: AssetId,
    reward_asset_id: AssetId,
    reward_funded: bool,
    payout_curve: Option<ContractId>,
}

// ───────────────────────────── Events ─────────────────────────────

/// Emitted when a user creates a lock (`user_lock` / `user_lock_for`).
pub struct UserLocked {
    pub hashlock: b256,
    /// The lock owner of record (see `user_lock_for`'s attribution note for how this can
    /// differ from the actual funding caller).
    pub sender: Identity,
    pub recipient: Identity,
    pub src_chain: String,
    pub asset_id: AssetId,
    pub amount: u64,
    pub timelock: u64,
    pub start_time: u64,
    pub payout_curve: Option<ContractId>,
    pub dst_chain: String,
    pub dst_address: String,
    pub dst_amount: u64,
    pub dst_token: String,
    pub reward_amount: u64,
    pub reward_token: String,
    pub reward_recipient: String,
    pub reward_timelock_delta: u64,
    pub quote_expiry: u64,
    pub user_data: Bytes,
    pub solver_data: Bytes,
}

/// Emitted when a solver creates a lock (`solver_lock`).
pub struct SolverLocked {
    pub hashlock: b256,
    /// The solver that created and funded the lock -- also the lock's storage key alongside
    /// `hashlock` (at most one solver lock per (hashlock, sender), ever).
    pub sender: Identity,
    pub recipient: Identity,
    pub src_chain: String,
    pub asset_id: AssetId,
    pub amount: u64,
    pub reward: u64,
    pub reward_asset_id: AssetId,
    pub reward_recipient: Identity,
    pub timelock: u64,
    pub reward_timelock: u64,
    pub payout_curve: Option<ContractId>,
    pub dst_chain: String,
    pub dst_address: String,
    pub dst_amount: u64,
    pub dst_token: String,
    pub data: Bytes,
}

/// Emitted when a different-asset solver reward is funded after the fact via
/// `attach_solver_reward` (the second step of the two-step different-asset funding flow).
pub struct SolverRewardAttached {
    pub hashlock: b256,
    /// The solver whose lock's reward was funded (the lock's creator, not necessarily the
    /// attach caller -- attaching is permissionless).
    pub solver: Identity,
    pub reward_asset_id: AssetId,
    pub reward: u64,
}

/// Emitted when a user lock is refunded (full amount, no curve, returned to `refund_to`).
pub struct UserRefunded {
    pub hashlock: b256,
    pub refund_to: Identity,
    pub amount: u64,
}

/// Emitted when a solver lock is refunded (amount + reward, no curve, returned to `refund_to`).
pub struct SolverRefunded {
    pub hashlock: b256,
    /// The solver whose lock was refunded.
    pub solver: Identity,
    pub refund_to: Identity,
    pub amount: u64,
    pub reward: u64,
}

/// Emitted when a user lock is redeemed with the secret preimage.
pub struct UserRedeemed {
    pub hashlock: b256,
    pub redeemer: Identity,
    pub secret: u256,
    pub payout: u64,
    pub excess: u64,
}

/// Emitted when a solver lock is redeemed with the secret preimage.
pub struct SolverRedeemed {
    pub hashlock: b256,
    /// The solver whose lock was redeemed.
    pub solver: Identity,
    pub redeemer: Identity,
    pub secret: u256,
    pub payout: u64,
    pub excess: u64,
    /// `reward_recipient` before `reward_timelock`, else the redeemer (keeper bounty).
    pub reward_to: Identity,
    pub reward: u64,
}

// ───────────────────────────── ABI ─────────────────────────────

abi Train {
    /// Create a user lock to initiate a cross-chain swap. The caller is attributed as
    /// `sender`/owner-of-record. Funds are the coin forwarded with this call
    /// (`msg_amount()`/`msg_asset_id()`).
    #[payable]
    #[storage(read, write)]
    fn user_lock(
        params: UserLockParams,
        dst: DestinationInfo,
        user_data: Bytes,
        solver_data: Bytes,
    ) -> b256;

    /// Create a user lock attributed to `user`, funded by the caller (e.g. a future gasless
    /// router). Permissionless: `user` is purely attributive (lock owner of record /
    /// `user_lock_hashes` enumeration key / `UserLocked.sender`); custody is governed by
    /// `params.recipient`/`params.refund_to`, not by `user`. See the doc comment on the
    /// implementation for the full attribution/griefing note.
    #[payable]
    #[storage(read, write)]
    fn user_lock_for(
        user: Identity,
        params: UserLockParams,
        dst: DestinationInfo,
        user_data: Bytes,
        solver_data: Bytes,
    ) -> b256;

    /// Create a solver lock to fulfill a swap. The caller both funds and is attributed as
    /// `sender`, and is the lock's storage key alongside `params.hashlock`.
    ///
    /// At most ONE solver lock per (hashlock, caller), EVER: a repeat call by the same caller
    /// under the same hashlock reverts `SolverLockAlreadyExists` before any state is written
    /// (and, Fuel forwarding the coin atomically with the call, the revert returns the
    /// forwarded coin untouched), so a blind retry -- e.g. after an unreliable or malicious
    /// RPC reported the first transaction as missing -- can never double-fund the same swap.
    /// Probe idempotently via `get_solver_lock(hashlock, solver)` (on several independent
    /// providers if needed): `None` means the lock never landed. The guard never lifts, not
    /// even after a refund or redeem; a deliberate re-fill of the same hashlock requires a
    /// different solver identity. Different solvers can still each lock under one hashlock.
    #[payable]
    #[storage(read, write)]
    fn solver_lock(params: SolverLockParams, dst: DestinationInfo, data: Bytes);

    /// Fund the reward of a different-asset solver lock (step two of the two-step funding flow;
    /// see `solver_lock`). Forwards exactly the lock's declared `(reward_asset_id, reward)`.
    /// Permissionless: anyone may fund the declared reward on the solver's behalf (`solver` is
    /// the lock's creator, not necessarily the caller).
    #[payable]
    #[storage(read, write)]
    fn attach_solver_reward(hashlock: b256, solver: Identity) -> bool;

    /// Refund a user lock (full amount, no curve, returned to `refund_to`). The `recipient`
    /// may refund at any time; anyone else only after `timelock`.
    #[storage(read, write)]
    fn refund_user(hashlock: b256) -> bool;

    /// Refund a solver lock (amount + reward, no curve, returned to `refund_to`). Callable by
    /// anyone, but only after `timelock` (no early-recipient path, unlike `refund_user`).
    /// `solver` is the lock creator's identity. Note the refund does NOT lift the per-solver
    /// uniqueness guard -- a refunded solver re-fills from a different identity (see
    /// `solver_lock`).
    #[storage(read, write)]
    fn refund_solver(hashlock: b256, solver: Identity) -> bool;

    /// Redeem a user lock with the secret preimage. Permissionless: any caller holding the
    /// secret can trigger it, but the payout always goes to the lock's `recipient`.
    #[storage(read, write)]
    fn redeem_user(hashlock: b256, secret: u256) -> bool;

    /// Redeem a solver lock with the secret preimage. `solver` is the lock creator's identity.
    /// The payout curve applies to `amount` only, never to `reward`; the reward routes to
    /// `reward_recipient` before `reward_timelock`, otherwise to the redeemer (keeper bounty).
    #[storage(read, write)]
    fn redeem_solver(hashlock: b256, solver: Identity, secret: u256) -> bool;

    /// Get user lock details (zero-valued fields / `None` if no such lock exists).
    #[storage(read)]
    fn get_user_lock(hashlock: b256) -> Option<UserLock>;

    /// Get solver lock details (`None` if `solver` never locked under `hashlock`). Doubles as
    /// the solver's idempotency probe -- `None` means "my lock never landed", checkable on
    /// several independent providers before ever retrying `solver_lock`. Discovery of OTHER
    /// solvers' locks stays event-driven (`SolverLocked`).
    #[storage(read)]
    fn get_solver_lock(hashlock: b256, solver: Identity) -> Option<SolverLock>;

    /// Paginated hashlocks of the user locks created by / attributed to `user`. Returns the
    /// page in `[offset, min(offset + limit, total))` plus `total`, the full number of
    /// hashlocks for `user` (not a filtered match count). Never reverts at any offset/limit
    /// combination -- see the overflow-safe clamp in the implementation.
    #[storage(read)]
    fn get_user_lock_hashes(user: Identity, offset: u64, limit: u64) -> (Vec<b256>, u64);

    /// Paginated user-lock details created by / attributed to `user`. Same pagination
    /// contract as `get_user_lock_hashes`.
    #[storage(read)]
    fn get_user_locks(user: Identity, offset: u64, limit: u64) -> (Vec<UserLock>, u64);
}

// ───────────────────────────── Storage ─────────────────────────────

storage {
    /// hashlock => UserLock (core, storage-safe fields only; see storage-safety note above)
    user_locks: StorageMap<b256, UserLockData> = StorageMap::<b256, UserLockData> {},
    /// hashlock => payout curve config bytes for the user lock (out-of-line; see above)
    user_lock_curve_data: StorageMap<b256, StorageBytes> = StorageMap::<b256, StorageBytes> {},
    /// (hashlock, solver) => SolverLock (core, storage-safe fields only). At most ONE lock per
    /// (hashlock, solver), EVER -- the permanent per-solver uniqueness guard in
    /// `validate_solver_lock_params` is what makes a blind `solver_lock` retry double-fund-safe
    /// (see `solver_lock`'s ABI doc comment).
    solver_locks: StorageMap<(b256, Identity), SolverLockData> = StorageMap::<(b256, Identity), SolverLockData> {},
    /// (hashlock, solver) => payout curve config bytes for the solver lock
    solver_lock_curve_data: StorageMap<(b256, Identity), StorageBytes> = StorageMap::<(b256, Identity), StorageBytes> {},
    /// user => the hashlocks of the user locks created by / attributed to them
    user_lock_hashes: StorageMap<Identity, StorageVec<b256>> = StorageMap::<Identity, StorageVec<b256>> {},
}

// ───────────────────────── Internal helpers ─────────────────────────

/// Whether an `Identity` is the "zero" identity for its variant -- `Address::zero()` for an
/// `Address`, `ContractId::zero()` for a `ContractId`. Used for `ZeroAddress`/`InvalidUser`
/// checks on `Identity`-typed fields, since there's no single universal "zero identity".
fn is_zero_identity(id: Identity) -> bool {
    match id {
        Identity::Address(addr) => addr == Address::zero(),
        Identity::ContractId(cid) => cid == ContractId::zero(),
    }
}

#[storage(read)]
fn read_user_lock_data(hashlock: b256) -> Option<UserLockData> {
    storage.user_locks.get(hashlock).try_read()
}

#[storage(read)]
fn read_solver_lock_data(hashlock: b256, solver: Identity) -> Option<SolverLockData> {
    storage.solver_locks.get((hashlock, solver)).try_read()
}

#[storage(read)]
fn read_user_curve_data(hashlock: b256) -> Option<Bytes> {
    storage.user_lock_curve_data.get(hashlock).read_slice()
}

#[storage(read)]
fn read_solver_curve_data(hashlock: b256, solver: Identity) -> Option<Bytes> {
    storage.solver_lock_curve_data.get((hashlock, solver)).read_slice()
}

/// Writes curve config bytes out-of-line, only if non-empty (an empty/`None` config never
/// needs a storage write -- `read_..._curve_data` returning `None` already means "no config").
#[storage(write)]
fn write_user_curve_data(hashlock: b256, data: Bytes) {
    if data.len() > 0 {
        storage.user_lock_curve_data.get(hashlock).write_slice(data);
    }
}

#[storage(write)]
fn write_solver_curve_data(hashlock: b256, solver: Identity, data: Bytes) {
    if data.len() > 0 {
        storage.solver_lock_curve_data.get((hashlock, solver)).write_slice(data);
    }
}

/// Assemble the public `UserLock` view from its storage-safe core plus its out-of-line curve
/// data (only read when a curve is actually set, to avoid a pointless storage read).
#[storage(read)]
fn to_public_user_lock(data: UserLockData, hashlock: b256) -> UserLock {
    let curve_data = if data.payout_curve.is_some() {
        read_user_curve_data(hashlock)
    } else {
        None
    };
    UserLock {
        secret: data.secret,
        amount: data.amount,
        sender: data.sender,
        timelock: data.timelock,
        start_time: data.start_time,
        status: data.status,
        recipient: data.recipient,
        refund_to: data.refund_to,
        asset_id: data.asset_id,
        payout_curve: data.payout_curve,
        payout_curve_data: curve_data,
    }
}

/// Assemble the public `SolverLock` view; see `to_public_user_lock` above.
#[storage(read)]
fn to_public_solver_lock(data: SolverLockData, hashlock: b256, solver: Identity) -> SolverLock {
    let curve_data = if data.payout_curve.is_some() {
        read_solver_curve_data(hashlock, solver)
    } else {
        None
    };
    SolverLock {
        secret: data.secret,
        amount: data.amount,
        reward: data.reward,
        sender: data.sender,
        timelock: data.timelock,
        reward_timelock: data.reward_timelock,
        start_time: data.start_time,
        recipient: data.recipient,
        status: data.status,
        reward_recipient: data.reward_recipient,
        refund_to: data.refund_to,
        asset_id: data.asset_id,
        reward_asset_id: data.reward_asset_id,
        reward_funded: data.reward_funded,
        payout_curve: data.payout_curve,
        payout_curve_data: curve_data,
    }
}

/// Compute the redeemable payout for a lock. Returns `amount` unchanged when no curve is set;
/// otherwise calls `PayoutCurve::compute_payout` on the supplied address (no interface probe,
/// see the trust-model doc comment on `interfaces::PayoutCurve`) and enforces
/// `0 < payout <= amount` itself, regardless of what the curve claims.
fn compute_payout(
    payout_curve: Option<ContractId>,
    amount: u64,
    start_time: u64,
    curve_data: Option<Bytes>,
) -> u64 {
    match payout_curve {
        None => amount,
        Some(curve) => {
            let config = curve_data.unwrap_or(Bytes::new());
            let curve_abi = abi(PayoutCurve, curve.into());
            let payout = curve_abi.compute_payout(amount, start_time, timestamp(), config);
            require(payout > 0 && payout <= amount, TrainError::InvalidPayout);
            payout
        }
    }
}

/// Shared validation for both user-lock entrypoints. Runs before any storage write (funds are
/// already "in" the contract by the time this runs, since Fuel forwards the coin atomically
/// with the call -- there is no separate "pull" step to defer past validation, unlike EVM's
/// ERC20 `transferFrom`). Returns `now` for reuse by the caller.
#[storage(read)]
fn validate_user_lock_params(
    hashlock: b256,
    timelock_delta: u64,
    quote_expiry: u64,
    recipient: Identity,
    refund_to: Identity,
) -> u64 {
    let now = timestamp();
    require(msg_amount() > 0, TrainError::ZeroAmount);
    require(timelock_delta > 0, TrainError::InvalidTimelock);
    require(timelock_delta <= u64::max() - now, TrainError::TimelockOverflow);
    require(now < quote_expiry, TrainError::QuoteExpired);
    require(!is_zero_identity(recipient), TrainError::ZeroAddress);
    require(!is_zero_identity(refund_to), TrainError::ZeroAddress);
    require(
        storage.user_locks.get(hashlock).try_read().is_none(),
        TrainError::SwapAlreadyExists,
    );
    now
}

/// Shared validation for `solver_lock`, mirroring `validate_user_lock_params`. Solver locks
/// have no quote expiry; uniqueness is per (hashlock, caller) -- a hashlock may hold locks
/// from many DIFFERENT solvers, but a repeat by the same solver reverts
/// `SolverLockAlreadyExists` (a PERMANENT retry/replay guard, see `solver_lock`'s ABI doc
/// comment). Adds reward-leg checks. Runs before any state write -- and since Fuel forwards
/// the coin atomically with the call (there is no separate "pull" step, unlike EVM's ERC20
/// `transferFrom`), a revert here also hands the forwarded coin back untouched. Returns `now`
/// for reuse by the caller.
#[storage(read)]
fn validate_solver_lock_params(
    hashlock: b256,
    caller: Identity,
    reward: u64,
    timelock_delta: u64,
    reward_timelock_delta: u64,
    recipient: Identity,
    refund_to: Identity,
    reward_recipient: Identity,
    reward_asset_id: AssetId,
    asset_id: AssetId,
) -> u64 {
    let now = timestamp();
    // The permanent per-solver uniqueness guard: at most one solver lock per (hashlock,
    // caller), ever -- checked against the lock's EXISTENCE (not its status), so neither a
    // refund nor a redeem ever lifts it.
    require(
        storage.solver_locks.get((hashlock, caller)).try_read().is_none(),
        TrainError::SolverLockAlreadyExists,
    );
    // A same-asset reward is bundled into the single forwarded coin (msg_amount() == principal +
    // reward), so guard the `msg_amount() - reward` subtraction; a different-asset reward is
    // funded separately (`attach_solver_reward`), so the forwarded coin IS the whole principal.
    if reward > 0 && reward_asset_id == asset_id {
        require(msg_amount() > reward, TrainError::ZeroAmount);
    } else {
        require(msg_amount() > 0, TrainError::ZeroAmount);
    }
    require(timelock_delta > 0, TrainError::InvalidTimelock);
    require(timelock_delta <= u64::max() - now, TrainError::TimelockOverflow);
    // Guarded unconditionally (not just when reward > 0): `now + reward_timelock_delta` is
    // computed unconditionally below regardless of `reward`, so the overflow guard must be too.
    require(reward_timelock_delta <= u64::max() - now, TrainError::TimelockOverflow);
    if reward > 0 {
        require(reward_timelock_delta < timelock_delta, TrainError::InvalidRewardTimelock);
        require(!is_zero_identity(reward_recipient), TrainError::ZeroAddress);
    }
    require(!is_zero_identity(recipient), TrainError::ZeroAddress);
    require(!is_zero_identity(refund_to), TrainError::ZeroAddress);
    now
}

/// Shared core for `user_lock`/`user_lock_for`. `user` is the lock owner of record (written as
/// `UserLockData.sender`, used as the `user_lock_hashes` enumeration key, and emitted as
/// `UserLocked.sender`) -- funds always come from this call's forwarded coin regardless of
/// `user`: `user` is purely attributive, custody is governed by
/// `params.recipient`/`params.refund_to`.
#[storage(read, write)]
fn user_lock_core(
    user: Identity,
    params: UserLockParams,
    dst: DestinationInfo,
    user_data: Bytes,
    solver_data: Bytes,
) -> b256 {
    reentrancy_guard();

    let now = validate_user_lock_params(
        params.hashlock,
        params.timelock_delta,
        params.quote_expiry,
        params.recipient,
        params.refund_to,
    );
    let timelock = now + params.timelock_delta;
    let asset_id = msg_asset_id();
    let amount = msg_amount();

    let data = UserLockData {
        secret: 0,
        amount,
        sender: user,
        timelock,
        start_time: now,
        status: LockStatus::Pending,
        recipient: params.recipient,
        refund_to: params.refund_to,
        asset_id,
        payout_curve: params.payout_curve,
    };
    storage.user_locks.insert(params.hashlock, data);
    write_user_curve_data(params.hashlock, params.payout_curve_data.unwrap_or(Bytes::new()));
    storage.user_lock_hashes.get(user).push(params.hashlock);

    log(UserLocked {
        hashlock: params.hashlock,
        sender: user,
        recipient: params.recipient,
        src_chain: params.src_chain,
        asset_id,
        amount,
        timelock,
        start_time: now,
        payout_curve: params.payout_curve,
        dst_chain: dst.dst_chain,
        dst_address: dst.dst_address,
        dst_amount: dst.dst_amount,
        dst_token: dst.dst_token,
        reward_amount: params.reward_amount,
        reward_token: params.reward_token,
        reward_recipient: params.reward_recipient,
        reward_timelock_delta: params.reward_timelock_delta,
        quote_expiry: params.quote_expiry,
        user_data,
        solver_data,
    });

    params.hashlock
}

// ───────────────────────────── Implementation ─────────────────────────────

impl Train for Contract {
    #[payable]
    #[storage(read, write)]
    fn user_lock(
        params: UserLockParams,
        dst: DestinationInfo,
        user_data: Bytes,
        solver_data: Bytes,
    ) -> b256 {
        let sender = msg_sender().unwrap();
        user_lock_core(sender, params, dst, user_data, solver_data)
    }

    /// ATTRIBUTION NOTE: `user` is purely attributive -- it sets `UserLockData.sender`, the
    /// `user_lock_hashes` enumeration key, and `UserLocked.sender`. It does NOT govern
    /// custody: `refund_to`/`recipient` come from `params`, and refund authorization keys off
    /// `recipient`, never off `sender`/`user`. Consequently, ANY caller may attribute a lock to
    /// ANY `user` at gas-only cost (the funds are still the caller's own, forwarded via
    /// `msg_amount()`/`msg_asset_id()` on this very call -- there is no way to spend someone
    /// else's coin without their transaction signature on Fuel), and the attributed entry is
    /// never pruned. This is a griefing vector only against the off-chain enumeration getters
    /// (`get_user_lock_hashes`/`get_user_locks`), which is exactly why those read a bounded
    /// window rather than the whole list. No funds are ever at risk from this attribution.
    #[payable]
    #[storage(read, write)]
    fn user_lock_for(
        user: Identity,
        params: UserLockParams,
        dst: DestinationInfo,
        user_data: Bytes,
        solver_data: Bytes,
    ) -> b256 {
        require(!is_zero_identity(user), TrainError::InvalidUser);
        user_lock_core(user, params, dst, user_data, solver_data)
    }

    /// REWARD-ASSET FUNDING: a single FuelVM `CALL` forwards exactly one `(AssetId, u64)` coin
    /// pair (`msg_asset_id()`/`msg_amount()`) -- a VM calling-convention limit, not a Sway/SDK
    /// gap (see the Fuel VM spec's receipts page, "a call may additionally forward one native
    /// asset": https://specs.fuel.network/master/abi/receipts.html). So a reward in a
    /// *different* asset than the principal cannot ride the same call. Two cases:
    ///   - same asset (`reward_asset_id == msg_asset_id()`, incl. `reward == 0`): the reward is
    ///     bundled into the forwarded coin (`msg_amount() == principal + reward`), so it is
    ///     escrowed immediately -- `reward_funded = true` at creation.
    ///   - different asset: only the principal is forwarded here (`msg_amount() == principal`);
    ///     the reward is declared but unfunded (`reward_funded = false`) until a follow-up
    ///     `attach_solver_reward` call forwards it. Bundling both into one atomic transaction is a
    ///     caller/SDK concern (a multi-call transaction), never required for fund safety -- see
    ///     the `reward_funded` gate in `redeem_solver`/`refund_solver`.
    #[payable]
    #[storage(read, write)]
    fn solver_lock(params: SolverLockParams, dst: DestinationInfo, data: Bytes) {
        reentrancy_guard();

        let asset_id = msg_asset_id();
        let caller = msg_sender().unwrap();
        let now = validate_solver_lock_params(
            params.hashlock,
            caller,
            params.reward,
            params.timelock_delta,
            params.reward_timelock_delta,
            params.recipient,
            params.refund_to,
            params.reward_recipient,
            params.reward_asset_id,
            asset_id,
        );
        // Same-asset reward is bundled into the forwarded coin (subtract it out); a different-asset
        // reward is funded separately, so the whole forwarded coin is the principal.
        let same_asset_reward = params.reward > 0 && params.reward_asset_id == asset_id;
        let reward_funded = !(params.reward > 0 && params.reward_asset_id != asset_id);
        let amount = if same_asset_reward {
            msg_amount() - params.reward
        } else {
            msg_amount()
        };
        let timelock = now + params.timelock_delta;
        let reward_timelock = now + params.reward_timelock_delta;

        let lock_data = SolverLockData {
            secret: 0,
            amount,
            reward: params.reward,
            sender: caller,
            timelock,
            reward_timelock,
            start_time: now,
            recipient: params.recipient,
            status: LockStatus::Pending,
            reward_recipient: params.reward_recipient,
            refund_to: params.refund_to,
            asset_id,
            reward_asset_id: params.reward_asset_id,
            reward_funded,
            payout_curve: params.payout_curve,
        };
        storage.solver_locks.insert((params.hashlock, caller), lock_data);
        write_solver_curve_data(
            params.hashlock,
            caller,
            params.payout_curve_data.unwrap_or(Bytes::new()),
        );

        log(SolverLocked {
            hashlock: params.hashlock,
            sender: caller,
            recipient: params.recipient,
            src_chain: params.src_chain,
            asset_id,
            amount,
            reward: params.reward,
            reward_asset_id: params.reward_asset_id,
            reward_recipient: params.reward_recipient,
            timelock,
            reward_timelock,
            payout_curve: params.payout_curve,
            dst_chain: dst.dst_chain,
            dst_address: dst.dst_address,
            dst_amount: dst.dst_amount,
            dst_token: dst.dst_token,
            data,
        });
    }

    #[payable]
    #[storage(read, write)]
    fn attach_solver_reward(hashlock: b256, solver: Identity) -> bool {
        reentrancy_guard();

        let existing = read_solver_lock_data(hashlock, solver);
        require(existing.is_some(), TrainError::LockNotFound);
        let mut lock = existing.unwrap();
        require(lock.status == LockStatus::Pending, TrainError::LockNotPending);
        // `reward_funded` is already true for a same-asset (or zero) reward and for a prior
        // successful attach, so this rejects any double-funding rather than stranding the coin.
        require(!lock.reward_funded, TrainError::RewardAlreadyFunded);
        require(
            msg_amount() == lock.reward && msg_asset_id() == lock.reward_asset_id,
            TrainError::RewardAssetMismatch,
        );

        lock.reward_funded = true;
        storage.solver_locks.insert((hashlock, solver), lock);

        log(SolverRewardAttached {
            hashlock,
            solver,
            reward_asset_id: lock.reward_asset_id,
            reward: lock.reward,
        });

        true
    }

    #[storage(read, write)]
    fn refund_user(hashlock: b256) -> bool {
        reentrancy_guard();

        let existing = read_user_lock_data(hashlock);
        require(existing.is_some(), TrainError::LockNotFound);
        let mut lock = existing.unwrap();
        require(lock.status == LockStatus::Pending, TrainError::LockNotPending);
        let caller = msg_sender().unwrap();
        if caller != lock.recipient {
            require(timestamp() >= lock.timelock, TrainError::RefundNotAllowed);
        }

        lock.status = LockStatus::Refunded;
        storage.user_locks.insert(hashlock, lock);

        log(UserRefunded {
            hashlock,
            refund_to: lock.refund_to,
            amount: lock.amount,
        });

        transfer(lock.refund_to, lock.asset_id, lock.amount);

        true
    }

    #[storage(read, write)]
    fn refund_solver(hashlock: b256, solver: Identity) -> bool {
        reentrancy_guard();

        let existing = read_solver_lock_data(hashlock, solver);
        require(existing.is_some(), TrainError::LockNotFound);
        let mut lock = existing.unwrap();
        require(lock.status == LockStatus::Pending, TrainError::LockNotPending);
        require(timestamp() >= lock.timelock, TrainError::RefundNotAllowed);

        lock.status = LockStatus::Refunded;
        storage.solver_locks.insert((hashlock, solver), lock);

        log(SolverRefunded {
            hashlock,
            solver,
            refund_to: lock.refund_to,
            amount: lock.amount,
            reward: lock.reward,
        });

        // A same-asset reward is escrowed together with the principal (one transfer); a
        // different-asset reward is only refunded when it was actually funded
        // (`attach_solver_reward`) -- an unfunded declared reward escrowed nothing, so there is
        // nothing to return for it.
        if lock.reward > 0 && lock.reward_asset_id == lock.asset_id {
            transfer(lock.refund_to, lock.asset_id, lock.amount + lock.reward);
        } else {
            transfer(lock.refund_to, lock.asset_id, lock.amount);
            if lock.reward > 0 && lock.reward_funded {
                transfer(lock.refund_to, lock.reward_asset_id, lock.reward);
            }
        }

        true
    }

    #[storage(read, write)]
    fn redeem_user(hashlock: b256, secret: u256) -> bool {
        reentrancy_guard();

        let existing = read_user_lock_data(hashlock);
        require(existing.is_some(), TrainError::LockNotFound);
        let mut lock = existing.unwrap();
        require(sha256(secret) == hashlock, TrainError::HashlockMismatch);
        require(lock.status == LockStatus::Pending, TrainError::LockNotPending);

        lock.status = LockStatus::Redeemed;
        lock.secret = secret;
        storage.user_locks.insert(hashlock, lock);

        let curve_data = if lock.payout_curve.is_some() {
            read_user_curve_data(hashlock)
        } else {
            None
        };
        // NOTE on the compiler's "balance tree update after external contract interaction"
        // warning below: `compute_payout` (an "interaction" when a curve is set) necessarily
        // runs before the transfers, because the transfer amounts depend on its return value
        // -- this exact ordering (compute payout, then transfer) is also what the other
        // Train ports do. The state transition itself (`status = Redeemed`,
        // `secret` written) already happened above, before this call, so checks-effects-
        // interactions is respected for storage; `reentrancy_guard()` at the top of this
        // function is what actually protects against a malicious curve re-entering here, not
        // transfer ordering.
        let payout = compute_payout(lock.payout_curve, lock.amount, lock.start_time, curve_data);
        // compute_payout guarantees 0 < payout <= amount (and payout == amount when no curve),
        // so this subtraction cannot underflow.
        let excess = lock.amount - payout;

        log(UserRedeemed {
            hashlock,
            redeemer: msg_sender().unwrap(),
            secret,
            payout,
            excess,
        });

        transfer(lock.recipient, lock.asset_id, payout);
        if excess > 0 {
            transfer(lock.refund_to, lock.asset_id, excess);
        }

        true
    }

    #[storage(read, write)]
    fn redeem_solver(hashlock: b256, solver: Identity, secret: u256) -> bool {
        reentrancy_guard();

        let existing = read_solver_lock_data(hashlock, solver);
        require(existing.is_some(), TrainError::LockNotFound);
        let mut lock = existing.unwrap();
        require(sha256(secret) == hashlock, TrainError::HashlockMismatch);
        require(lock.status == LockStatus::Pending, TrainError::LockNotPending);

        lock.status = LockStatus::Redeemed;
        lock.secret = secret;
        storage.solver_locks.insert((hashlock, solver), lock);

        let now = timestamp();
        let redeemer = msg_sender().unwrap();
        // Reward-bounty rule, matching the EVM/Starknet ports: the redeemer keeps the
        // reward as a keeper bounty if they redeem after reward_timelock.
        let reward_to = if lock.reward_timelock > now {
            lock.reward_recipient
        } else {
            redeemer
        };

        let curve_data = if lock.payout_curve.is_some() {
            read_solver_curve_data(hashlock, solver)
        } else {
            None
        };
        // The payout curve applies to `amount` only, never to `reward`. See the identical
        // "balance tree update after external contract interaction" note in `redeem_user`
        // above -- the same reasoning applies here.
        let payout = compute_payout(lock.payout_curve, lock.amount, lock.start_time, curve_data);
        let excess = lock.amount - payout;

        log(SolverRedeemed {
            hashlock,
            solver,
            redeemer,
            secret,
            payout,
            excess,
            reward_to,
            reward: lock.reward,
        });

        transfer(lock.recipient, lock.asset_id, payout);
        if excess > 0 {
            transfer(lock.refund_to, lock.asset_id, excess);
        }
        // Pay the reward only when it was actually escrowed -- an unfunded declared reward
        // (different-asset lock never completed via `attach_solver_reward`) escrowed nothing.
        if lock.reward > 0 && lock.reward_funded {
            transfer(reward_to, lock.reward_asset_id, lock.reward);
        }

        true
    }

    #[storage(read)]
    fn get_user_lock(hashlock: b256) -> Option<UserLock> {
        match read_user_lock_data(hashlock) {
            Some(data) => Some(to_public_user_lock(data, hashlock)),
            None => None,
        }
    }

    #[storage(read)]
    fn get_solver_lock(hashlock: b256, solver: Identity) -> Option<SolverLock> {
        match read_solver_lock_data(hashlock, solver) {
            Some(data) => Some(to_public_solver_lock(data, hashlock, solver)),
            None => None,
        }
    }

    #[storage(read)]
    fn get_user_lock_hashes(user: Identity, offset: u64, limit: u64) -> (Vec<b256>, u64) {
        let all = storage.user_lock_hashes.get(user);
        let total = all.len();
        // Overflow-safe pagination clamp, ported from the EVM `bfe4069` fix: the early-return
        // guard runs BEFORE computing `offset + limit`, so that addition can never overflow
        // (the else-branch only runs when limit <= total - offset, i.e. offset + limit <= total).
        if limit == 0 || offset >= total {
            return (Vec::new(), total);
        }
        let end = if limit > total - offset { total } else { offset + limit };
        let mut result = Vec::new();
        let mut i = offset;
        while i < end {
            result.push(all.get(i).unwrap().read());
            i += 1;
        }
        (result, total)
    }

    #[storage(read)]
    fn get_user_locks(user: Identity, offset: u64, limit: u64) -> (Vec<UserLock>, u64) {
        let all = storage.user_lock_hashes.get(user);
        let total = all.len();
        // Same overflow-safe clamp as `get_user_lock_hashes` -- see the comment there.
        if limit == 0 || offset >= total {
            return (Vec::new(), total);
        }
        let end = if limit > total - offset { total } else { offset + limit };
        let mut result = Vec::new();
        let mut i = offset;
        while i < end {
            let h = all.get(i).unwrap().read();
            match read_user_lock_data(h) {
                Some(data) => result.push(to_public_user_lock(data, h)),
                None => {},
            }
            i += 1;
        }
        (result, total)
    }
}
