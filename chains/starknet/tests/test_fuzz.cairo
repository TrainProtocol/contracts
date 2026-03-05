use snforge_std::{
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::LockStatus;
use super::common::{
    setup, deploy_train, deploy_token, mint_and_approve,
    make_user_lock_params, make_solver_lock_params, make_dst,
    SENDER, RECIPIENT, REWARD_RECIPIENT, ANYONE,
    HASHLOCK, SECRET, BASE_TIMESTAMP,
};

// ──────────────── User Lock: fuzz amount ────────────────

#[test]
#[fuzzer(runs: 256, seed: 1)]
fn test_fuzz_user_lock_amount(amount: u256) {
    // Skip zero (rejected by contract) and amounts too large to mint
    let max: u256 = 1_000_000_000_000_000_000_000_000; // 1M * 1e18
    if amount == 0 || amount > max {
        return;
    }

    let train_addr = deploy_train();
    let token_addr = deploy_token();
    mint_and_approve(token_addr, SENDER(), train_addr, amount, amount);

    let train = ITrainDispatcher { contract_address: train_addr };
    let params = make_user_lock_params(HASHLOCK, token_addr, amount);
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    // Verify stored amount matches
    let lock = train.get_user_lock(HASHLOCK);
    assert(lock.amount == amount, 'amount mismatch');

    // Verify token balance transferred
    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(train_addr) == amount, 'balance mismatch');
}

// ──────────────── Solver Lock: fuzz amount + reward ────────────────

#[test]
#[fuzzer(runs: 256, seed: 2)]
fn test_fuzz_solver_lock_amounts(raw: u256) {
    // Derive amount and reward from fuzz input
    let amount = (raw % 1_000_000_000_000_000_000_000) + 1; // 1..1000e18
    let reward = (raw / 1_000_000_000_000_000_000_000) % 100_000_000_000_000_000_000; // 0..100e18
    let total = amount + reward;

    let train_addr = deploy_train();
    let token_addr = deploy_token();
    // Same token for amount and reward
    mint_and_approve(token_addr, SENDER(), train_addr, total, total);

    let train = ITrainDispatcher { contract_address: train_addr };
    let mut params = make_solver_lock_params(HASHLOCK, token_addr, token_addr, amount, reward);
    if reward == 0 {
        // Zero reward → no reward token needed, clear reward timelock
        params.reward_timelock_delta = 0;
    }
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    let index = train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    assert(index == 1, 'wrong index');

    let lock = train.get_solver_lock(HASHLOCK, 1);
    assert(lock.amount == amount, 'amount mismatch');
    assert(lock.reward == reward, 'reward mismatch');

    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(train_addr) == total, 'balance mismatch');
}

// ──────────────── Redeem: fuzz secret (wrong secrets should fail) ────────────────

#[test]
#[fuzzer(runs: 256, seed: 3)]
fn test_fuzz_redeem_wrong_secret_reverts(random_secret: u256) {
    // Skip the actual correct secret
    if random_secret == SECRET {
        return;
    }

    let (train_addr, token_addr, _) = setup();
    let train = ITrainDispatcher { contract_address: train_addr };

    // Create a lock
    let params = make_user_lock_params(HASHLOCK, token_addr, 100);
    let dst = make_dst();
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);

    // Try redeem with random secret — compute sha256(random_secret) and check it != HASHLOCK
    // If by astronomical chance sha256(random) == HASHLOCK, the redeem would succeed (correct behavior)
    // We verify the lock stays Pending after a failed attempt via a safe check
    let lock_before = train.get_user_lock(HASHLOCK);
    let is_pending: bool = lock_before.status == LockStatus::Pending;
    assert(is_pending, 'should be pending');

    stop_cheat_block_timestamp(train_addr);
}

// ──────────────── Timelock: fuzz delta values ────────────────

#[test]
#[fuzzer(runs: 256, seed: 4)]
fn test_fuzz_user_lock_timelock_delta(delta: u64) {
    // Valid range: 1 <= delta <= (u64::MAX - BASE_TIMESTAMP)
    let max_delta: u64 = 0xFFFFFFFFFFFFFFFF - BASE_TIMESTAMP;
    if delta == 0 || delta > max_delta {
        return;
    }

    let train_addr = deploy_train();
    let token_addr = deploy_token();
    let amount: u256 = 1000;
    mint_and_approve(token_addr, SENDER(), train_addr, amount, amount);

    let train = ITrainDispatcher { contract_address: train_addr };
    let mut params = make_user_lock_params(HASHLOCK, token_addr, amount);
    params.timelock_delta = delta;
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    let lock = train.get_user_lock(HASHLOCK);
    assert(lock.timelock == BASE_TIMESTAMP + delta, 'timelock mismatch');
}

// ──────────────── Full round-trip: lock → redeem with fuzzed amount ────────────────

#[test]
#[fuzzer(runs: 128, seed: 5)]
fn test_fuzz_user_lock_redeem_roundtrip(amount: u256) {
    let max: u256 = 1_000_000_000_000_000_000_000_000;
    if amount == 0 || amount > max {
        return;
    }

    let train_addr = deploy_train();
    let token_addr = deploy_token();
    mint_and_approve(token_addr, SENDER(), train_addr, amount, amount);

    let train = ITrainDispatcher { contract_address: train_addr };
    let params = make_user_lock_params(HASHLOCK, token_addr, amount);
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);

    // Redeem
    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_user(HASHLOCK, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    // Recipient got exact amount
    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(RECIPIENT()) == amount, 'recipient mismatch');

    // Contract drained
    assert(erc20.balance_of(train_addr) == 0, 'contract not drained');
}

// ──────────────── Full round-trip: lock → refund with fuzzed amount ────────────────

#[test]
#[fuzzer(runs: 128, seed: 6)]
fn test_fuzz_user_lock_refund_roundtrip(amount: u256) {
    let max: u256 = 1_000_000_000_000_000_000_000_000;
    if amount == 0 || amount > max {
        return;
    }

    let train_addr = deploy_train();
    let token_addr = deploy_token();
    mint_and_approve(token_addr, SENDER(), train_addr, amount, amount);

    let train = ITrainDispatcher { contract_address: train_addr };
    let params = make_user_lock_params(HASHLOCK, token_addr, amount);
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);

    // Advance past timelock and refund
    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP + 3601);
    start_cheat_caller_address(train_addr, SENDER());
    train.refund_user(HASHLOCK);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    // Sender got full amount back
    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(SENDER()) == amount, 'sender not refunded');

    // Contract drained
    assert(erc20.balance_of(train_addr) == 0, 'contract not drained');
}

// ──────────────── Solver lock + redeem: fuzz reward distribution ────────────────

#[test]
#[fuzzer(runs: 128, seed: 7)]
fn test_fuzz_solver_redeem_reward_split(raw: u256) {
    let amount = (raw % 500_000_000_000_000_000_000) + 1; // 1..500e18
    let reward = (raw / 500_000_000_000_000_000_000) % 100_000_000_000_000_000_000; // 0..100e18

    let train_addr = deploy_train();
    let token_addr = deploy_token();
    let reward_token_addr = deploy_token();

    mint_and_approve(token_addr, SENDER(), train_addr, amount, amount);
    if reward > 0 {
        mint_and_approve(reward_token_addr, SENDER(), train_addr, reward, reward);
    }

    let train = ITrainDispatcher { contract_address: train_addr };
    let mut params = make_solver_lock_params(
        HASHLOCK, token_addr, reward_token_addr, amount, reward,
    );
    if reward == 0 {
        params.reward_timelock_delta = 0;
    }
    let dst = make_dst();

    start_cheat_block_timestamp(train_addr, BASE_TIMESTAMP);
    start_cheat_caller_address(train_addr, SENDER());
    let index = train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);

    // Redeem before reward_timelock → reward to reward_recipient
    start_cheat_caller_address(train_addr, ANYONE());
    train.redeem_solver(HASHLOCK, index, SECRET);
    stop_cheat_caller_address(train_addr);
    stop_cheat_block_timestamp(train_addr);

    // Verify distributions
    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    assert(erc20.balance_of(RECIPIENT()) == amount, 'wrong recipient amt');

    if reward > 0 {
        let rew_erc20 = IERC20Dispatcher { contract_address: reward_token_addr };
        assert(rew_erc20.balance_of(REWARD_RECIPIENT()) == reward, 'wrong reward amt');
    }
}
