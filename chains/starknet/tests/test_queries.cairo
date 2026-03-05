#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use snforge_std::{
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, do_user_lock,
    SENDER, ANYONE,
    LOCK_AMOUNT, BASE_TIMESTAMP,
    HASHLOCK, HASHLOCK_2, HASHLOCK_3, SECRET,
};

#[test]
fn test_get_user_lock_empty() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let lock = train.get_user_lock(HASHLOCK);
    #[feature("deprecated-starknet-consts")]
    let zero = contract_address_const::<0>();
    assert(lock.sender == zero, 'wrong sender');
    assert(lock.amount == 0, 'wrong amount');
    let is_empty: bool = lock.status == LockStatus::Empty;
    assert(is_empty, 'wrong status');
}

#[test]
fn test_get_solver_lock_empty() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    let lock = train.get_solver_lock(HASHLOCK, 1);
    #[feature("deprecated-starknet-consts")]
    let zero = contract_address_const::<0>();
    assert(lock.sender == zero, 'wrong sender');
    assert(lock.amount == 0, 'wrong amount');
    let is_empty: bool = lock.status == LockStatus::Empty;
    assert(is_empty, 'wrong status');
}

#[test]
fn test_get_solver_lock_count_zero() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    assert(train.get_solver_lock_count(HASHLOCK) == 0, 'wrong count');
}

#[test]
fn test_get_user_lock_hashes_all() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    do_user_lock(train_addr, token_addr, HASHLOCK_3);
    stop_cheat_block_timestamp(train_addr);

    let (hashes, total) = train.get_user_lock_hashes(SENDER(), LockStatus::Empty, 0, 100);
    assert(total == 3, 'wrong total');
    assert(hashes.len() == 3, 'wrong hashes len');
    assert(*hashes.at(0) == HASHLOCK, 'wrong hash 0');
    assert(*hashes.at(1) == HASHLOCK_2, 'wrong hash 1');
    assert(*hashes.at(2) == HASHLOCK_3, 'wrong hash 2');
}

#[test]
fn test_get_user_lock_hashes_filtered() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);

    // Redeem the first lock
    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    // Filter Pending
    let (pending, p_total) = train.get_user_lock_hashes(SENDER(), LockStatus::Pending, 0, 100);
    assert(p_total == 1, 'wrong pending total');
    assert(*pending.at(0) == HASHLOCK_2, 'wrong pending hash');

    // Filter Redeemed
    let (redeemed, r_total) = train.get_user_lock_hashes(SENDER(), LockStatus::Redeemed, 0, 100);
    assert(r_total == 1, 'wrong redeemed total');
    assert(*redeemed.at(0) == HASHLOCK, 'wrong redeemed hash');
}

#[test]
fn test_get_user_lock_hashes_pagination() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    do_user_lock(train_addr, token_addr, HASHLOCK_3);
    stop_cheat_block_timestamp(train_addr);

    // Page 1: offset=0, limit=2
    let (page1, total1) = train.get_user_lock_hashes(SENDER(), LockStatus::Empty, 0, 2);
    assert(total1 == 3, 'wrong total page1');
    assert(page1.len() == 2, 'wrong page1 len');
    assert(*page1.at(0) == HASHLOCK, 'wrong page1 hash 0');
    assert(*page1.at(1) == HASHLOCK_2, 'wrong page1 hash 1');

    // Page 2: offset=2, limit=2
    let (page2, total2) = train.get_user_lock_hashes(SENDER(), LockStatus::Empty, 2, 2);
    assert(total2 == 3, 'wrong total page2');
    assert(page2.len() == 1, 'wrong page2 len');
    assert(*page2.at(0) == HASHLOCK_3, 'wrong page2 hash 0');
}

#[test]
fn test_get_user_locks_all() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    stop_cheat_block_timestamp(train_addr);

    let (locks, total) = train.get_user_locks(SENDER(), LockStatus::Empty, 0, 100);
    assert(total == 2, 'wrong total');
    assert(locks.len() == 2, 'wrong locks len');
    assert(*locks.at(0).amount == LOCK_AMOUNT, 'wrong lock 0 amount');
    assert(*locks.at(1).amount == LOCK_AMOUNT, 'wrong lock 1 amount');
}

#[test]
fn test_get_user_locks_limit_zero() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    let (locks, total) = train.get_user_locks(SENDER(), LockStatus::Empty, 0, 0);
    assert(total == 0, 'wrong total');
    assert(locks.len() == 0, 'wrong locks len');
}
