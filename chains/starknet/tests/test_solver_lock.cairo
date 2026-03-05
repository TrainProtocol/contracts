use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, make_solver_lock_params, make_dst, do_solver_lock,
    SENDER, RECIPIENT, REWARD_RECIPIENT,
    LOCK_AMOUNT, REWARD_AMOUNT, BASE_TIMESTAMP,
    TIMELOCK_DELTA, REWARD_TIMELOCK_DELTA,
    HASHLOCK,
};

#[test]
fn test_solver_lock_success() {
    let (train_addr, token_addr, reward_token_addr) = setup();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);
    stop_cheat_block_timestamp(train_addr);

    assert(index == 1, 'wrong index');

    let train = ITrainDispatcher { contract_address: train_addr };
    let lock = train.get_solver_lock(HASHLOCK, 1);
    let is_pending: bool = lock.status == LockStatus::Pending;
    assert(is_pending, 'wrong status');
    assert(lock.amount == LOCK_AMOUNT, 'wrong amount');
    assert(lock.reward == REWARD_AMOUNT, 'wrong reward');
}

#[test]
#[should_panic(expected: 'ZeroAmount')]
fn test_solver_lock_zero_amount() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, 0, 0);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

#[test]
#[should_panic(expected: 'InvalidToken')]
fn test_solver_lock_zero_token() {
    let (train_addr, _, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    #[feature("deprecated-starknet-consts")]
    let zero = contract_address_const::<0>();
    let params = make_solver_lock_params(HASHLOCK, zero, reward_token_addr, LOCK_AMOUNT, 0);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

#[test]
#[should_panic(expected: 'InvalidTimelock')]
fn test_solver_lock_zero_timelock() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, 0);
    params.timelock_delta = 0;
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

#[test]
#[should_panic(expected: 'TimelockOverflow')]
fn test_solver_lock_timelock_overflow() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, 0);
    params.timelock_delta = 0xFFFFFFFFFFFFFFFF_u64;
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

#[test]
fn test_solver_lock_with_reward_same_token() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let params = make_solver_lock_params(HASHLOCK, token_addr, token_addr, LOCK_AMOUNT, REWARD_AMOUNT);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    let index = train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    assert(index == 1, 'wrong index');
    let lock = train.get_solver_lock(HASHLOCK, 1);
    assert(lock.reward == REWARD_AMOUNT, 'wrong reward');
    assert(lock.token == token_addr, 'wrong token');
    assert(lock.reward_token == token_addr, 'wrong reward token');
}

#[test]
fn test_solver_lock_with_reward_diff_token() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, REWARD_AMOUNT);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    let index = train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, index);
    assert(lock.token == token_addr, 'wrong token');
    assert(lock.reward_token == reward_token_addr, 'wrong reward token');
}

#[test]
#[should_panic(expected: 'InvalidToken')]
fn test_solver_lock_reward_no_reward_token() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    #[feature("deprecated-starknet-consts")]
    let zero = contract_address_const::<0>();
    let params = make_solver_lock_params(HASHLOCK, token_addr, zero, LOCK_AMOUNT, REWARD_AMOUNT);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

#[test]
#[should_panic(expected: 'InvalidRewardTimelock')]
fn test_solver_lock_invalid_reward_timelock() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, REWARD_AMOUNT);
    params.reward_timelock_delta = TIMELOCK_DELTA; // >= timelock_delta is invalid
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.solver_lock(params, dst, "");
}

#[test]
fn test_solver_lock_multiple_indexes() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let idx1 = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
    let idx2 = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
    let idx3 = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
    stop_cheat_block_timestamp(train_addr);

    assert(idx1 == 1, 'wrong idx1');
    assert(idx2 == 2, 'wrong idx2');
    assert(idx3 == 3, 'wrong idx3');
    assert(train.get_solver_lock_count(HASHLOCK) == 3, 'wrong count');
}

#[test]
fn test_solver_lock_stores_correct_data() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    let index = do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, index);
    assert(lock.amount == LOCK_AMOUNT, 'wrong amount');
    assert(lock.reward == REWARD_AMOUNT, 'wrong reward');
    assert(lock.sender == SENDER(), 'wrong sender');
    assert(lock.recipient == RECIPIENT(), 'wrong recipient');
    assert(lock.reward_recipient == REWARD_RECIPIENT(), 'wrong reward recipient');
    assert(lock.token == token_addr, 'wrong token');
    assert(lock.reward_token == reward_token_addr, 'wrong reward token');
    assert(lock.timelock == BASE_TIMESTAMP + TIMELOCK_DELTA, 'wrong timelock');
    assert(lock.reward_timelock == BASE_TIMESTAMP + REWARD_TIMELOCK_DELTA, 'wrong reward timelock');
    let is_pending: bool = lock.status == LockStatus::Pending;
    assert(is_pending, 'wrong status');
    assert(lock.secret == 0, 'wrong secret');
}

#[test]
fn test_solver_lock_zero_reward() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    #[feature("deprecated-starknet-consts")]
    let zero = contract_address_const::<0>();
    let mut params = make_solver_lock_params(HASHLOCK, token_addr, zero, LOCK_AMOUNT, 0);
    params.reward_timelock_delta = 0;
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    let index = train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    assert(index == 1, 'wrong index');
    let lock = train.get_solver_lock(HASHLOCK, 1);
    assert(lock.reward == 0, 'wrong reward');
}
