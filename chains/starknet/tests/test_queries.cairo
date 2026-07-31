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

    // ANYONE() never locked anything under HASHLOCK: the getter is the idempotency probe a
    // solver uses to check "did my lock land?" — a zero sender means no.
    let lock = train.get_solver_lock(HASHLOCK, ANYONE());
    #[feature("deprecated-starknet-consts")]
    let zero = contract_address_const::<0>();
    assert(lock.sender == zero, 'wrong sender');
    assert(lock.amount == 0, 'wrong amount');
    let is_empty: bool = lock.status == LockStatus::Empty;
    assert(is_empty, 'wrong status');
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

    let (hashes, total) = train.get_user_lock_hashes(SENDER(), 0, 100);
    assert(total == 3, 'wrong total');
    assert(hashes.len() == 3, 'wrong hashes len');
    assert(*hashes.at(0) == HASHLOCK, 'wrong hash 0');
    assert(*hashes.at(1) == HASHLOCK_2, 'wrong hash 1');
    assert(*hashes.at(2) == HASHLOCK_3, 'wrong hash 2');
}

/// Enumeration is an append-only index keyed by the (former) `status` filter's removal: a lock's
/// status changing (e.g. via redeem) does not remove it from — or otherwise change — its owner's
/// hash enumeration. `total` stays the full count regardless of any lock's lifecycle state.
#[test]
fn test_get_user_lock_hashes_unaffected_by_redeem() {
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

    let (hashes, total) = train.get_user_lock_hashes(SENDER(), 0, 100);
    assert(total == 2, 'wrong total');
    assert(hashes.len() == 2, 'wrong hashes len');
    assert(*hashes.at(0) == HASHLOCK, 'wrong hash 0');
    assert(*hashes.at(1) == HASHLOCK_2, 'wrong hash 1');

    let redeemed_lock = train.get_user_lock(HASHLOCK);
    let is_redeemed: bool = redeemed_lock.status == LockStatus::Redeemed;
    assert(is_redeemed, 'wrong status');
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

    // Page 1: offset=0, limit=2 (full page)
    let (page1, total1) = train.get_user_lock_hashes(SENDER(), 0, 2);
    assert(total1 == 3, 'wrong total page1');
    assert(page1.len() == 2, 'wrong page1 len');
    assert(*page1.at(0) == HASHLOCK, 'wrong page1 hash 0');
    assert(*page1.at(1) == HASHLOCK_2, 'wrong page1 hash 1');

    // Page 2: offset=2, limit=2 (partial page: only 1 item left)
    let (page2, total2) = train.get_user_lock_hashes(SENDER(), 2, 2);
    assert(total2 == 3, 'wrong total page2');
    assert(page2.len() == 1, 'wrong page2 len');
    assert(*page2.at(0) == HASHLOCK_3, 'wrong page2 hash 0');
}

#[test]
fn test_get_user_lock_hashes_offset_equals_total() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    stop_cheat_block_timestamp(train_addr);

    let (page, total) = train.get_user_lock_hashes(SENDER(), 2, 10);
    assert(total == 2, 'wrong total');
    assert(page.len() == 0, 'expected empty page');
}

#[test]
fn test_get_user_lock_hashes_offset_greater_than_total() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    let (page, total) = train.get_user_lock_hashes(SENDER(), 1000, 10);
    assert(total == 1, 'wrong total');
    assert(page.len() == 0, 'expected empty page');
}

#[test]
fn test_get_user_lock_hashes_limit_zero() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    let (page, total) = train.get_user_lock_hashes(SENDER(), 0, 0);
    assert(total == 1, 'wrong total');
    assert(page.len() == 0, 'expected empty page');
}

#[test]
fn test_get_user_lock_hashes_empty_user() {
    let (train_addr, _, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    // ANYONE() never locked anything: total == 0 and any offset/limit yields an empty page.
    let (page, total) = train.get_user_lock_hashes(ANYONE(), 0, 100);
    assert(total == 0, 'wrong total');
    assert(page.len() == 0, 'expected empty page');
}

/// `limit` far larger than the remaining window must not overflow/panic when computing
/// `offset + limit` internally — the contract clamps to `total` instead of adding unchecked.
#[test]
fn test_get_user_lock_hashes_huge_limit_no_overflow() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    stop_cheat_block_timestamp(train_addr);

    let huge_limit: u256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    let (page, total) = train.get_user_lock_hashes(SENDER(), 0, huge_limit);
    assert(total == 2, 'wrong total');
    assert(page.len() == 2, 'wrong page len');
    assert(*page.at(0) == HASHLOCK, 'wrong hash 0');
    assert(*page.at(1) == HASHLOCK_2, 'wrong hash 1');

    // Same huge limit, but offset already at total: must stay empty, not overflow.
    let (page2, total2) = train.get_user_lock_hashes(SENDER(), 2, huge_limit);
    assert(total2 == 2, 'wrong total2');
    assert(page2.len() == 0, 'expected empty page2');
}

#[test]
fn test_get_user_locks_all() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    stop_cheat_block_timestamp(train_addr);

    let (locks, total) = train.get_user_locks(SENDER(), 0, 100);
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

    let (locks, total) = train.get_user_locks(SENDER(), 0, 0);
    assert(total == 1, 'wrong total');
    assert(locks.len() == 0, 'wrong locks len');
}

#[test]
fn test_get_user_locks_pagination_partial_page() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    do_user_lock(train_addr, token_addr, HASHLOCK_2);
    do_user_lock(train_addr, token_addr, HASHLOCK_3);
    stop_cheat_block_timestamp(train_addr);

    // offset=1, limit=100: partial page containing the remaining 2 locks.
    let (locks, total) = train.get_user_locks(SENDER(), 1, 100);
    assert(total == 3, 'wrong total');
    assert(locks.len() == 2, 'wrong locks len');
}

#[test]
fn test_get_user_locks_offset_greater_than_total() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock(train_addr, token_addr, HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    let (locks, total) = train.get_user_locks(SENDER(), 5, 10);
    assert(total == 1, 'wrong total');
    assert(locks.len() == 0, 'expected empty page');
}
