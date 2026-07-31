#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, make_user_lock_params, make_dst, do_user_lock_for,
    SENDER, RECIPIENT, ANYONE,
    LOCK_AMOUNT, BASE_TIMESTAMP, TIMELOCK_DELTA,
    HASHLOCK, HASHLOCK_2, SECRET,
};

/// Address distinct from both the caller (SENDER, who holds the token approvals) and RECIPIENT,
/// used as the explicit `user` argument to `user_lock_for`.
#[feature("deprecated-starknet-consts")]
fn OTHER_USER() -> starknet::ContractAddress {
    contract_address_const::<'OTHER_USER'>()
}

#[test]
fn test_user_lock_for_attributes_to_user_not_caller() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock_for(train_addr, token_addr, OTHER_USER(), HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    // The lock owner of record is `user`, not the caller (SENDER) that funded the call.
    assert(lock.sender == OTHER_USER(), 'wrong sender');
    assert(lock.amount == LOCK_AMOUNT, 'wrong amount');
    let is_pending: bool = lock.status == LockStatus::Pending;
    assert(is_pending, 'wrong status');
}

#[test]
fn test_user_lock_for_pulls_funds_from_caller() {
    let (train_addr, token_addr, _) = setup();

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let sender_balance_before = erc20.balance_of(SENDER());

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock_for(train_addr, token_addr, OTHER_USER(), HASHLOCK);
    stop_cheat_block_timestamp(train_addr);

    // Funds are pulled from the caller (SENDER, who approved Train in `setup()`), not from
    // `OTHER_USER` (who never approved anything and holds no tokens).
    assert(
        erc20.balance_of(SENDER()) == sender_balance_before - LOCK_AMOUNT, 'sender not debited',
    );
    assert(erc20.balance_of(train_addr) == LOCK_AMOUNT, 'wrong contract balance');
    assert(erc20.balance_of(OTHER_USER()) == 0, 'other_user should be untouched');
}

#[test]
#[should_panic(expected: 'InvalidUser')]
fn test_user_lock_for_zero_user_reverts() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    #[feature("deprecated-starknet-consts")]
    let zero_user = contract_address_const::<0>();

    let params = make_user_lock_params(HASHLOCK, token_addr, LOCK_AMOUNT);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock_for(zero_user, params, dst, "", "");
}

#[test]
fn test_user_lock_for_redeem_pays_recipient() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock_for(train_addr, token_addr, OTHER_USER(), HASHLOCK);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    let is_redeemed: bool = lock.status == LockStatus::Redeemed;
    assert(is_redeemed, 'wrong status');

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(RECIPIENT()) == LOCK_AMOUNT, 'wrong recipient balance');
}

#[test]
fn test_user_lock_for_refund_pays_refund_to() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock_for(train_addr, token_addr, OTHER_USER(), HASHLOCK);

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    let refund_to_balance_before = erc20.balance_of(SENDER()); // default refund_to == SENDER()

    // `refund_to` (SENDER, the default from make_user_lock_params) — not `user` (OTHER_USER) and
    // not the caller of refund_user (also SENDER here, but attribution is via refund_to, not
    // caller identity) — is the one who is repaid.
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA + 1);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    let is_refunded: bool = lock.status == LockStatus::Refunded;
    assert(is_refunded, 'wrong status');
    assert(
        erc20.balance_of(SENDER()) == refund_to_balance_before + LOCK_AMOUNT,
        'refund_to not credited',
    );
    assert(erc20.balance_of(OTHER_USER()) == 0, 'user should not be credited');
}

#[test]
fn test_user_lock_for_enumeration_indexes_under_user() {
    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_user_lock_for(train_addr, token_addr, OTHER_USER(), HASHLOCK);
    do_user_lock_for(train_addr, token_addr, OTHER_USER(), HASHLOCK_2);
    stop_cheat_block_timestamp(train_addr);

    // Enumerated under OTHER_USER (the attributed `user`), not SENDER (the caller/funder).
    let (user_hashes, user_total) = train.get_user_lock_hashes(OTHER_USER(), 0, 100);
    assert(user_total == 2, 'wrong user total');
    assert(user_hashes.len() == 2, 'wrong user hashes len');
    assert(*user_hashes.at(0) == HASHLOCK, 'wrong hash 0');
    assert(*user_hashes.at(1) == HASHLOCK_2, 'wrong hash 1');

    let (sender_hashes, sender_total) = train.get_user_lock_hashes(SENDER(), 0, 100);
    assert(sender_total == 0, 'sender should have none');
    assert(sender_hashes.len() == 0, 'sender hashes should be empty');
}
