//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

use aztec::macros::aztec;

/// ConstantPayoutCurve - Constant (no-decay) payout.
/// P(t) = amount, for all t. The payout never decays and is independent of
/// start_time, current_time, and config. This makes the payout-curve mechanism
/// an explicit no-op because the payout is constant.
///
/// Any contract exposing a public view function with the same name and signature
/// is a valid payout curve for the Train contract (function selectors are derived
/// from the name and parameter types). A curve must return payout satisfying
/// 0 < payout <= amount; Train enforces these bounds at lock and redeem time.
#[aztec]
pub contract ConstantPayoutCurve {
    use aztec::macros::functions::{external, initializer, view};

    #[external("public")]
    #[initializer]
    fn constructor() {}

    #[external("public")]
    #[view]
    fn compute_payout(
        amount: u128,
        _start_time: u64,
        _current_time: u64,
        _config: [u8; 128],
    ) -> pub u128 {
        amount
    }
}
