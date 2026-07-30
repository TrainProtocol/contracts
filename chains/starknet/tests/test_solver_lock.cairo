use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::{ITrainSafeDispatcher, ITrainSafeDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, make_solver_lock_params, make_dst, do_solver_lock, do_solver_lock_as, mint_and_approve,
    SENDER, RECIPIENT, REWARD_RECIPIENT, ANYONE,
    LOCK_AMOUNT, REWARD_AMOUNT, MINT_AMOUNT, BASE_TIMESTAMP,
    TIMELOCK_DELTA, REWARD_TIMELOCK_DELTA,
    HASHLOCK, SECRET,
};

#[test]
fn test_solver_lock_success() {
    let (train_addr, token_addr, reward_token_addr) = setup();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);
    stop_cheat_block_timestamp(train_addr);

    let train = ITrainDispatcher { contract_address: train_addr };
    let lock = train.get_solver_lock(HASHLOCK, SENDER());
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
    train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, SENDER());
    let is_pending: bool = lock.status == LockStatus::Pending;
    assert(is_pending, 'wrong status');
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
    train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, SENDER());
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

/// Different solvers may lock the same hashlock — the per-solver uniqueness guard only blocks a
/// *repeat* by the *same* caller, never a fresh lock from a different address.
#[test]
fn test_solver_lock_multiple_solvers_same_hashlock() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };
    mint_and_approve(token_addr, ANYONE(), train_addr, MINT_AMOUNT, MINT_AMOUNT);

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
    do_solver_lock_as(train_addr, token_addr, reward_token_addr, HASHLOCK, 0, ANYONE());
    stop_cheat_block_timestamp(train_addr);

    let lock1 = train.get_solver_lock(HASHLOCK, SENDER());
    let lock2 = train.get_solver_lock(HASHLOCK, ANYONE());
    assert(lock1.sender == SENDER(), 'wrong sender 1');
    let is_pending1: bool = lock1.status == LockStatus::Pending;
    assert(is_pending1, 'wrong status 1');
    assert(lock2.sender == ANYONE(), 'wrong sender 2');
    let is_pending2: bool = lock2.status == LockStatus::Pending;
    assert(is_pending2, 'wrong status 2');
}

#[test]
fn test_solver_lock_stores_correct_data() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, REWARD_AMOUNT);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, SENDER());
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
    train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_solver_lock(HASHLOCK, SENDER());
    assert(lock.reward == 0, 'wrong reward');
}

// ──────────────────────── Double-Lock Guard ────────────────────────
// A solver's RPC can lie about whether a submitted tx landed. If a blind `solver_lock` retry by
// the same solver were allowed, both the original and the retry lock would become redeemable
// once the secret is public, and the solver would lose the second escrow. These tests cover the
// permanent per-(hashlock, solver) uniqueness guard that prevents that.

#[test]
#[should_panic(expected: 'SolverLockAlreadyExists')]
fn test_solver_lock_reverts_on_duplicate_same_solver() {
    let (train_addr, token_addr, reward_token_addr) = setup();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
}

/// The duplicate must revert before any funds move: the solver's token balance after the failed
/// retry must equal the balance right after the first (successful) lock. Uses the auto-generated
/// safe dispatcher so the expected revert doesn't abort the test before the balance check runs.
#[test]
#[feature("safe_dispatcher")]
fn test_solver_lock_duplicate_takes_no_funds() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let erc20 = IERC20Dispatcher { contract_address: token_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
    let balance_after_first = erc20.balance_of(SENDER());

    let params = make_solver_lock_params(HASHLOCK, token_addr, reward_token_addr, LOCK_AMOUNT, 0);
    let dst = make_dst();
    let safe_train = ITrainSafeDispatcher { contract_address: train_addr };
    start_cheat_caller_address(train_addr, SENDER());
    let result = safe_train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    match result {
        Result::Ok(_) => assert(false, 'expected revert'),
        Result::Err(_) => {},
    }
    assert(erc20.balance_of(SENDER()) == balance_after_first, 'funds were taken');
}

#[test]
#[should_panic(expected: 'SolverLockAlreadyExists')]
fn test_solver_lock_duplicate_after_refund_still_reverts() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + TIMELOCK_DELTA);
    start_cheat_caller_address(train_addr, ANYONE());
    train.refund_solver(HASHLOCK, SENDER());
    stop_cheat_caller_address(train_addr);

    // The guard never lifts, not even after a refund — re-filling the same hashlock requires a
    // different solver address.
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
}

#[test]
#[should_panic(expected: 'SolverLockAlreadyExists')]
fn test_solver_lock_duplicate_after_redeem_reverts() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);

    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, SENDER(), SECRET);
    stop_cheat_caller_address(train_addr);

    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
}

#[test]
fn test_get_solver_lock_unknown_solver_returns_empty() {
    let (train_addr, token_addr, reward_token_addr) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    do_solver_lock(train_addr, token_addr, reward_token_addr, HASHLOCK, 0);
    stop_cheat_block_timestamp(train_addr);

    // ANYONE() never locked under HASHLOCK — the getter is a solver's "did my lock land?"
    // idempotency probe, so it must read as empty rather than aliasing SENDER()'s lock.
    let lock = train.get_solver_lock(HASHLOCK, ANYONE());
    #[feature("deprecated-starknet-consts")]
    let zero = contract_address_const::<0>();
    assert(lock.sender == zero, 'wrong sender');
    let is_empty: bool = lock.status == LockStatus::Empty;
    assert(is_empty, 'wrong status');
}
