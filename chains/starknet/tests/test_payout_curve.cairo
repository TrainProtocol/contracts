use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, deploy_constant_curve, deploy_mock_decay_curve, deploy_mock_src5_only,
    make_user_lock_params, make_solver_lock_params, make_dst,
    SENDER, RECIPIENT, REWARD_RECIPIENT, ANYONE,
    LOCK_AMOUNT, REWARD_AMOUNT, BASE_TIMESTAMP,
    HASHLOCK, SECRET,
};

// ──────────────────────── ConstantPayoutCurve: identity, no decay ────────────────────────

#[test]
fn test_redeem_user_with_constant_curve_pays_full_amount() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };
    let curve_addr = deploy_constant_curve();

    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.payout_curve = curve_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let refund_to_before = erc20.balance_of(SENDER());

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    let is_redeemed: bool = lock.status == LockStatus::Redeemed;
    assert(is_redeemed, 'wrong status');

    // Full amount to recipient, zero excess to refund_to (SENDER's balance is untouched by the
    // redeem — the only change vs. `refund_to_before` would be a nonzero excess transfer).
    assert(erc20.balance_of(RECIPIENT()) == LOCK_AMOUNT, 'wrong recipient balance');
    assert(erc20.balance_of(SENDER()) == refund_to_before, 'unexpected excess to refund_to');
}

#[test]
fn test_redeem_solver_with_constant_curve_pays_full_amount_and_reward() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };
    let curve_addr = deploy_constant_curve();

    let mut params = make_solver_lock_params(
        HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, REWARD_AMOUNT,
    );
    params.payout_curve = curve_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);

    // Redeem before reward_timelock: reward goes to reward_recipient, in full, regardless of the
    // curve — the curve only ever governs `amount`, never `reward`.
    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, SENDER(), SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let reward_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };
    assert(erc20.balance_of(RECIPIENT()) == LOCK_AMOUNT, 'wrong recipient balance');
    assert(reward_erc20.balance_of(REWARD_RECIPIENT()) == REWARD_AMOUNT, 'wrong reward balance');
}

// ──────────────────────── Lock creation with an invalid curve ────────────────────────
//
// `_validate_payout_curve` probes `payout_curve` via `ISRC5Dispatcher::supports_interface`. A
// contract that exposes no such entrypoint at all (e.g. the plain `MockERC20` used as `token`
// here) makes that call fail at the syscall level — confirmed empirically (see task notes) to
// panic with `('ENTRYPOINT_NOT_FOUND', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED')` — before
// Train's own `assert(supported, 'InvalidPayoutCurve')` ever gets to run. Either way the lock must
// never be created; `should_panic(expected: ...)` pins the actual (first) panic-data felt so a
// regression that silently swallows the syscall failure would be caught.

#[test]
#[should_panic(expected: 'ENTRYPOINT_NOT_FOUND')]
fn test_user_lock_with_non_curve_address_reverts() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    // `token_addr` is a deployed contract (MockERC20) that does not implement SRC5/IPayoutCurve.
    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.payout_curve = token_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
#[should_panic(expected: 'ENTRYPOINT_NOT_FOUND')]
fn test_solver_lock_with_non_curve_address_reverts() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, 0);
    params.payout_curve = token_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

// A curve contract that *does* implement SRC5 but never registered `IPAYOUT_CURVE_ID` exercises
// Train's own `assert(supported, 'InvalidPayoutCurve')` directly (as opposed to the syscall-level
// failure above), since the `supports_interface` call itself succeeds and returns `false`.
#[test]
#[should_panic(expected: 'InvalidPayoutCurve')]
fn test_user_lock_with_curve_missing_interface_reverts() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };
    let curve_addr = deploy_mock_src5_only();

    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.payout_curve = curve_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
#[should_panic(expected: 'InvalidPayoutCurve')]
fn test_solver_lock_with_curve_missing_interface_reverts() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };
    let curve_addr = deploy_mock_src5_only();

    let mut params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, 0);
    params.payout_curve = curve_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

// ──────────────────────── MockDecayCurve: real decay, excess split ────────────────────────

#[test]
fn test_redeem_user_decay_curve_splits_excess_to_refund_to() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };
    // Always pays out exactly half of `amount`.
    let curve_addr = deploy_mock_decay_curve(1, 2);

    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.payout_curve = curve_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let refund_to_before = erc20.balance_of(SENDER()); // refund_to == SENDER (default)

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let half = LOCK_AMOUNT / 2;
    let recipient_bal = erc20.balance_of(RECIPIENT());
    let refund_to_bal = erc20.balance_of(SENDER());

    assert(recipient_bal == half, 'wrong recipient payout');
    assert(refund_to_bal == refund_to_before + half, 'wrong refund_to excess');
    // Conservation: the full locked amount is accounted for between recipient and refund_to.
    assert(recipient_bal + (refund_to_bal - refund_to_before) == LOCK_AMOUNT, 'broken conservation');
}

#[test]
fn test_redeem_solver_decay_curve_splits_amount_but_reward_is_full() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };
    // Pays out exactly a quarter of `amount`.
    let curve_addr = deploy_mock_decay_curve(1, 4);

    let mut params = make_solver_lock_params(
        HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, REWARD_AMOUNT,
    );
    params.payout_curve = curve_addr;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let refund_to_before = erc20.balance_of(SENDER());

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, SENDER(), SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let quarter = LOCK_AMOUNT / 4;
    let recipient_bal = erc20.balance_of(RECIPIENT());
    let refund_to_bal = erc20.balance_of(SENDER());
    let reward_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };

    assert(recipient_bal == quarter, 'wrong recipient payout');
    assert(refund_to_bal == refund_to_before + (LOCK_AMOUNT - quarter), 'wrong refund_to excess');
    assert(recipient_bal + (refund_to_bal - refund_to_before) == LOCK_AMOUNT, 'broken conservation');
    // Reward is untouched by the curve — paid in full to reward_recipient (redeemed before
    // reward_timelock).
    assert(reward_erc20.balance_of(REWARD_RECIPIENT()) == REWARD_AMOUNT, 'wrong reward balance');
}
