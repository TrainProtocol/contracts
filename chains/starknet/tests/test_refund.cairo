use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, do_user_lock, do_solver_lock,
    SENDER, RECIPIENT, ANYONE,
    LOCK_AMOUNT, REWARD_AMOUNT, BASE_TIMESTAMP, TIMELOCK_DELTA,
    HASHLOCK, SECRET,
};

// ──────────────────────── Refund User ────────────────────────

#[test]
fn test_refund_user_after_timelock() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let before = erc20.balance_of(SENDER());

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA + 1);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    let is_refunded: bool = lock.status == LockStatus::Refunded;
    assert(is_refunded, 'wrong status');
    assert(erc20.balance_of(SENDER()) == before + LOCK_AMOUNT, 'wrong sender balance');
}

#[test]
#[should_panic(expected: 'RefundNotAllowed')]
fn test_refund_user_before_timelock() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
}

#[test]
fn test_refund_user_by_recipient_early() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    start_cheat_caller_address(train_addr, RECIPIENT());
    train.refund_user(HASHLOCK);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    let is_refunded: bool = lock.status == LockStatus::Refunded;
    assert(is_refunded, 'wrong status');
}

#[test]
#[should_panic(expected: 'LockNotFound')]
fn test_refund_user_not_found() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
}

#[test]
#[should_panic(expected: 'LockNotPending')]
fn test_refund_user_already_redeemed() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    stop_cheat_caller_address(train_addr);

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA + 1);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
}

#[test]
#[should_panic(expected: 'LockNotPending')]
fn test_refund_user_already_refunded() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA + 1);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
    train.refund_user(HASHLOCK);
}

// ──────────────────────── Refund Solver ────────────────────────

#[test]
fn test_refund_solver_after_timelock() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let reward_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };
    let bal_before = erc20.balance_of(SENDER());
    let rew_before = reward_erc20.balance_of(SENDER());

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA + 1);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_solver(HASHLOCK, index);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, index);
    let is_refunded: bool = lock.status == LockStatus::Refunded;
    assert(is_refunded, 'wrong status');
    assert(erc20.balance_of(SENDER()) == bal_before + LOCK_AMOUNT, 'wrong sender balance');
    assert(reward_erc20.balance_of(SENDER()) == rew_before + REWARD_AMOUNT, 'wrong reward balance');
}

#[test]
#[should_panic(expected: 'RefundNotAllowed')]
fn test_refund_solver_before_timelock() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);

    start_cheat_caller_address(train_addr, SENDER());
    train.refund_solver(HASHLOCK, index);
}

#[test]
#[should_panic(expected: 'LockNotFound')]
fn test_refund_solver_not_found() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_caller_address(train_addr, SENDER());
    train.refund_solver(HASHLOCK, 1);
}

#[test]
fn test_refund_solver_with_diff_reward_token() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let rew_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };
    let bal = erc20.balance_of(SENDER());
    let rew_bal = rew_erc20.balance_of(SENDER());

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA + 1);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_solver(HASHLOCK, index);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    assert(erc20.balance_of(SENDER()) == bal + LOCK_AMOUNT, 'wrong sender balance');
    assert(rew_erc20.balance_of(SENDER()) == rew_bal + REWARD_AMOUNT, 'wrong reward balance');
}
