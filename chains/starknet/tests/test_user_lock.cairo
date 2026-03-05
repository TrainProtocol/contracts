use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
    spy_events, EventSpyTrait,
};
#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, deploy_train, deploy_token,
    make_user_lock_params, make_dst, do_user_lock,
    SENDER, RECIPIENT, LOCK_AMOUNT,
    HASHLOCK, HASHLOCK_2, BASE_TIMESTAMP, TIMELOCK_DELTA,
};

#[test]
fn test_user_lock_success() {
    let (train_addr, token_addr, _) = setup();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(train_addr) == LOCK_AMOUNT, 'wrong contract balance');

    let train = ITrainDispatcher { contract_address: train_addr };
    let lock = train.get_user_lock(HASHLOCK);
    let is_pending: bool = lock.status == LockStatus::Pending;
    assert(is_pending, 'wrong status');
    assert(lock.amount == LOCK_AMOUNT, 'wrong amount');
}

#[test]
#[should_panic(expected: 'ZeroAmount')]
fn test_user_lock_zero_amount() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let params = make_user_lock_params(HASHLOCK, token_addr, 0);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
#[should_panic(expected: 'InvalidToken')]
fn test_user_lock_zero_token() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    #[feature("deprecated-starknet-consts")]
    let zero_addr = contract_address_const::<0>();
    let params = make_user_lock_params(HASHLOCK, zero_addr, LOCK_AMOUNT);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
#[should_panic(expected: 'InvalidTimelock')]
fn test_user_lock_zero_timelock() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.timelock_delta = 0;
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
#[should_panic(expected: 'QuoteExpired')]
fn test_user_lock_expired_quote() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.quote_expiry = 500;
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
#[should_panic(expected: 'SwapAlreadyExists')]
fn test_user_lock_duplicate_hashlock() {
    let (train_addr, token_addr, _) = setup();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK);
}

#[test]
#[should_panic(expected: 'TimelockOverflow')]
fn test_user_lock_timelock_overflow() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.timelock_delta = 0xFFFFFFFFFFFFFFFF_u64;
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
#[should_panic(expected: 'ERC20: insufficient allowance')]
fn test_user_lock_no_approval() {
    let train_addr = deploy_train();
    let token_addr = deploy_token();

    let train = ITrainDispatcher { contract_address: train_addr };
    let params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
}

#[test]
fn test_user_lock_stores_correct_data() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    assert(lock.amount == LOCK_AMOUNT, 'wrong amount');
    assert(lock.sender == SENDER(), 'wrong sender');
    assert(lock.recipient == RECIPIENT(), 'wrong recipient');
    assert(lock.token == token_addr, 'wrong token');
    assert(lock.timelock == BASE_TIMESTAMP + TIMELOCK_DELTA, 'wrong timelock');
    let is_pending: bool = lock.status == LockStatus::Pending;
    assert(is_pending, 'wrong status');
    assert(lock.secret == 0, 'wrong secret');
}

#[test]
fn test_user_lock_increments_hash_count() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    stop_cheat_block_timestamp(train_addr);

    let (hashes, total) = train.get_user_lock_hashes(SENDER(), LockStatus::Empty, 0, 100);
    assert(total == 2, 'wrong total');
    assert(hashes.len() == 2, 'wrong hashes len');
}

#[test]
fn test_user_lock_event_emitted() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let mut spy = spy_events();

    let params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "ud", "sd");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let events = spy.get_events();
    assert(events.events.len() >= 1, 'no events emitted');
}

#[test]
fn test_user_lock_different_sender_field() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    #[feature("deprecated-starknet-consts")]
    let other = contract_address_const::<'OTHER'>();

    let mut params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    params.sender = other;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    assert(lock.sender == other, 'wrong sender');
}
