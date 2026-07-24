// SPDX-License-Identifier: MIT
library;

use std::{
    bytes::Bytes,
    string::String,
};

// ─────────────────────────────────────────────────────────────────────────
// Shared library for the Train Protocol (Fuel/Sway port). Exists as a separate `library` package
// because the `PayoutCurve` ABI must be agreed on identically by both on-chain contracts -- `train`
// calls it, `payout_curve` implements it -- and a Sway `contract` project cannot depend on another
// `contract` project as a library (confirmed empirically: `forc build` fails with "is declared as a
// library dependency, but is actually a contract"). `UserLockParams`/`DestinationInfo` live here
// alongside the ABI so the user-lock call shape is defined in one place.
// ─────────────────────────────────────────────────────────────────────────

/// Interface for time-based payout decay curves used by the Train HTLC bridge.
///
/// Any contract implementing this ABI can be used as a payout curve. `Train` calls
/// `compute_payout` via a normal (non-static) contract call -- Fuel has no distinct
/// "static call" instruction or read-only-call guarantee, so this interface gives no
/// assurance that an implementation is actually side-effect free. The reentrancy guard
/// wrapped around `Train::redeem_user`/`Train::redeem_solver` is what actually protects
/// `Train` from a malicious curve re-entering, not any call-type restriction.
///
/// TRUST MODEL: there is no
/// ERC-165/SRC5-style interface-introspection primitive confirmed to exist in the pinned
/// `std` (checked at v0.68.4; toolchain now pinned to `std` v0.68.7 — still no `src5`/
/// introspection module), so `Train` does NOT probe whether a `payout_curve` address
/// actually implements this ABI before calling it at lock-creation time. A lock's
/// `payout_curve` is an arbitrary address supplied by whoever creates the lock; correctness
/// and compliance of that address is a trust-per-lock assumption -- a counterparty MUST
/// whitelist the disclosed curve address off-chain before locking against it. `Train`
/// independently enforces `0 < payout <= amount` at the call site regardless of what the
/// curve returns, so a non-compliant curve can only cause the redeem to revert
/// (`InvalidPayout`), never an out-of-bounds transfer.
abi PayoutCurve {
    /// Compute the redeemable payout for a lock at the current time.
    ///
    /// * `amount`: the locked amount, in the native Fuel asset's base units (`u64`, not
    ///   `u256`/EVM `uint256` -- Fuel native-asset amounts are natively `u64`).
    /// * `start_time`: the timestamp when the lock was created.
    /// * `now`: the current timestamp (block timestamp at redeem time).
    /// * `config`: implementation-defined curve configuration bytes, passed through from the
    ///   lock's stored `payout_curve_data` as-is (no selector prefix needed, since the
    ///   function is fixed by this interface).
    ///
    /// Must return `payout` such that `0 < payout <= amount`. The caller (`Train`) enforces
    /// this bound itself; it does not trust the curve's own claims about its output range.
    fn compute_payout(amount: u64, start_time: u64, now: u64, config: Bytes) -> u64;
}

// ───────────────────────── Shared user-lock call shape ─────────────────────────

/// Cross-chain destination details (logged only, never stored). Kept here (out of
/// `train/src/main.sw`) alongside `UserLockParams` so the shared user-lock call shapes are
/// single-sourced.
pub struct DestinationInfo {
    pub dst_chain: String,
    pub dst_address: String,
    pub dst_amount: u64,
    pub dst_token: String,
}

/// Parameters for creating a user lock. The principal `amount`/`asset_id` are NOT fields
/// here -- they come from the call's forwarded coin (`msg_amount()`/`msg_asset_id()`), exactly
/// once per `#[payable]` call, which is the Fuel-native equivalent of EVM's payable `amount`.
pub struct UserLockParams {
    pub hashlock: b256,
    pub timelock_delta: u64,
    pub quote_expiry: u64,
    pub recipient: Identity,
    pub refund_to: Identity,
    pub payout_curve: Option<ContractId>,
    pub payout_curve_data: Option<Bytes>,
    /// Informational only: the reward a solver
    /// will be offered on the destination chain. Never transferred or validated here, only
    /// echoed in the `UserLocked` event for off-chain solver routing.
    pub reward_amount: u64,
    pub reward_timelock_delta: u64,
    pub reward_token: String,
    pub reward_recipient: String,
    pub src_chain: String,
}
