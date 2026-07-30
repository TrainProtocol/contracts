// Test-only mock contracts live in this crate (not in src/) so they are never part of the
// deployable `train_protocol` package — and therefore never appear in explorer source
// verification uploads. snforge collects `#[starknet::contract]`s from the test target, so
// `declare("MockERC20")` etc. keep working.
mod mock_erc20;
mod mock_payout_curve;

mod common;
mod test_user_lock;
mod test_user_lock_for;
mod test_solver_lock;
mod test_redeem;
mod test_refund;
mod test_queries;
mod test_fuzz;
mod test_payout_curve;
