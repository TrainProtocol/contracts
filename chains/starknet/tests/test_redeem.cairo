use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, do_user_lock, do_solver_lock,
    SENDER, RECIPIENT, REWARD_RECIPIENT, ANYONE,
    LOCK_AMOUNT, REWARD_AMOUNT, BASE_TIMESTAMP,
    TIMELOCK_DELTA, REWARD_TIMELOCK_DELTA,
    HASHLOCK, SECRET,
};

// ──────────────────────── Redeem User ────────────────────────

#[test]
fn test_redeem_user_success() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    let is_redeemed: bool = lock.status == LockStatus::Redeemed;
    assert(is_redeemed, 'wrong status');
    assert(lock.secret == SECRET, 'wrong secret');

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(RECIPIENT()) == LOCK_AMOUNT, 'wrong recipient balance');
}

#[test]
#[should_panic(expected: 'HashlockMismatch')]
fn test_redeem_user_wrong_secret() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, 999);
}

#[test]
#[should_panic(expected: 'LockNotFound')]
fn test_redeem_user_not_found() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
}

#[test]
#[should_panic(expected: 'LockNotPending')]
fn test_redeem_user_already_redeemed() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    train.redeem_user(HASHLOCK, SECRET);
}

#[test]
#[should_panic(expected: 'LockNotPending')]
fn test_redeem_user_already_refunded() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);

    // Refund first
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA + 1);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
    stop_cheat_caller_address(train_addr);

    // Try redeem
    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
}

// ──────────────────────── Redeem Solver ────────────────────────

#[test]
fn test_redeem_solver_success() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, index, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, index);
    let is_redeemed: bool = lock.status == LockStatus::Redeemed;
    assert(is_redeemed, 'wrong status');
    assert(lock.secret == SECRET, 'wrong secret');

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(RECIPIENT()) == LOCK_AMOUNT, 'wrong recipient balance');

    let reward_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };
    assert(reward_erc20.balance_of(REWARD_RECIPIENT()) == REWARD_AMOUNT, 'wrong reward balance');
}

#[test]
fn test_redeem_solver_reward_after_timelock() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);

    // Advance past reward_timelock -> reward goes to caller
    let after = BASE_TIMESTAMP + REWARD_TIMELOCK_DELTA + 1;
    start_cheat_block_timestamp(train_addr, after);
    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, index, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let reward_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };
    assert(reward_erc20.balance_of(ANYONE()) == REWARD_AMOUNT, 'wrong caller reward bal');
}

#[test]
fn test_redeem_solver_reward_before_timelock() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);

    // Before reward_timelock -> reward goes to reward_recipient
    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, index, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let reward_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };
    assert(reward_erc20.balance_of(REWARD_RECIPIENT()) == REWARD_AMOUNT, 'wrong reward recip bal');
    assert(reward_erc20.balance_of(ANYONE()) == 0, 'caller should have zero');
}

#[test]
#[should_panic(expected: 'LockNotFound')]
fn test_redeem_solver_not_found() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, 1, SECRET);
}

#[test]
#[should_panic(expected: 'HashlockMismatch')]
fn test_redeem_solver_wrong_secret() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, index, 999);
}
