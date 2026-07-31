// SPDX-License-Identifier: MIT
contract;

use interfaces::PayoutCurve;
use std::bytes::Bytes;

/// `ConstantPayoutCurve` -- Constant (no-decay) payout.
///
/// P(t) = amount, for all t. The payout never decays and is independent of `start_time`,
/// `now`, and `config`. This is the reference curve for the protocol; it makes the
/// payout-curve mechanism an explicit no-op, matching the constant payout curve on the
/// EVM/Starknet ports.
///
/// Always returns `amount` unchanged, which satisfies the `PayoutCurve` interface invariant
/// `0 < payout <= amount` as long as `amount > 0` (Train independently guarantees
/// `amount > 0` at lock-creation time). `config` is ignored entirely.
impl PayoutCurve for Contract {
    fn compute_payout(amount: u64, start_time: u64, now: u64, config: Bytes) -> u64 {
        // Identity curve: ignore start_time / now / config, return the full amount.
        let _ = start_time;
        let _ = now;
        let _ = config;
        amount
    }
}
