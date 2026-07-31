// SPDX-License-Identifier: MIT

/// Interface id advertised by SRC5 `supports_interface` for `IPayoutCurve`.
///
/// SRC5 interface ids are opaque felt252 constants with no single canonical derivation rule
/// (OpenZeppelin's Cairo interface ids, e.g. `IERC721_ID`, are precomputed constants documented
/// per-interface rather than derived by a fixed convention). Since `IPayoutCurve` exposes a
/// single function, its own selector is used as a stable, unique id for this interface: any
/// deployed curve that implements `compute_payout` can register this exact value with
/// `SRC5Component::register_interface`.
pub const IPAYOUT_CURVE_ID: felt252 = selector!("compute_payout");

/// Interface for time-based payout decay curves used by the HTLC.
///
/// @dev Any contract implementing this interface can be used as a payout curve. Train calls
///      `compute_payout` via a normal contract call — Starknet gives no read-only-call guarantee,
///      so callers should not rely on the curve being unable to write storage; the reentrancy
///      guard around `redeem_user`/`redeem_solver` is what protects Train here, not a call-type
///      restriction. SRC5 is used only to confirm the target implements this trait.
///
///      `payout_curve_data` stored in each lock is passed as `config` directly — no selector
///      prefix is needed since the function is fixed by this interface.
///
///      A curve must answer `supports_interface` true for both the SRC5 id (`ISRC5_ID`) and the
///      `IPayoutCurve` id (`IPAYOUT_CURVE_ID`). Train probes this via `ISRC5Dispatcher` before
///      trusting a curve (see `Train::_validate_payout_curve`).
#[starknet::interface]
pub trait IPayoutCurve<TState> {
    /// Compute the payout for a given lock at the current time.
    /// `amount`: the locked token amount.
    /// `start_time`: the timestamp when the lock was created.
    /// `current_time`: the current timestamp (block timestamp at redeem time).
    /// `config`: the curve configuration blob, as a `ByteArray` with an implementation-defined
    ///           layout.
    /// Returns `payout`, which MUST satisfy: `0 < payout <= amount`.
    fn compute_payout(
        self: @TState, amount: u256, start_time: u64, current_time: u64, config: ByteArray,
    ) -> u256;
}

/// @title ConstantPayoutCurve - Constant (no-decay) payout
/// @notice P(t) = amount, for all t. The payout never decays and is independent of start_time,
///         current_time, and config. This is the reference curve retained by the protocol; it
///         makes the payout-curve mechanism an explicit no-op.
/// @dev Always returns `amount`, which satisfies the interface invariant `0 < payout <= amount`
///      (Train independently guarantees `amount > 0`). `config` is ignored entirely.
///      Implements SRC5: answers true for both `ISRC5_ID` and `IPAYOUT_CURVE_ID`.
#[starknet::contract]
mod ConstantPayoutCurve {
    use openzeppelin_introspection::src5::SRC5Component;
    use super::{IPAYOUT_CURVE_ID, IPayoutCurve};

    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;
    impl SRC5InternalImpl = SRC5Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        // `ISRC5_ID` is already answered `true` by `SRC5Component`'s default behavior; it is
        // registered explicitly too so it also shows up in `SRC5_supported_interfaces`.
        self.src5.register_interface(openzeppelin_interfaces::introspection::ISRC5_ID);
        self.src5.register_interface(IPAYOUT_CURVE_ID);
    }

    #[abi(embed_v0)]
    impl ConstantPayoutCurveImpl of IPayoutCurve<ContractState> {
        fn compute_payout(
            self: @ContractState,
            amount: u256,
            start_time: u64,
            current_time: u64,
            config: ByteArray,
        ) -> u256 {
            // Identity curve: ignore start_time / current_time / config, return the full amount.
            let _ = start_time;
            let _ = current_time;
            let _ = config;
            amount
        }
    }
}
