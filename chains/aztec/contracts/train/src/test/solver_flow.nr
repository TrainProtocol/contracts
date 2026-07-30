use crate::test::utils::{
    self, check_balance, do_solver_lock, do_solver_lock_as, hashlock_of, LOCK_AMOUNT, MINT_AMOUNT,
    REWARD_AMOUNT, REWARD_TIMELOCK_DELTA, test_secret, TIMELOCK_DELTA,
};
use crate::Train;
use aztec::protocol::address::AztecAddress;
use token::Token;

#[test]
unconstrained fn solver_lock_and_redeem_no_reward() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);

    do_solver_lock(s, hashlock, 1, 0 as u128, 0, s.token, AztecAddress::zero());

    check_balance(s.env, s.token, s.solver, MINT_AMOUNT - LOCK_AMOUNT);
    check_balance(s.env, s.token, s.train, LOCK_AMOUNT);

    let lock = s.env.view_public(Train::at(s.train).get_solver_lock(hashlock, s.solver));
    assert(lock.status == 1, "expected Pending status");
    assert(lock.sender == s.solver, "wrong sender");

    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));

    check_balance(s.env, s.token, s.recipient, LOCK_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);

    let redeemed = s.env.view_public(Train::at(s.train).get_solver_lock(hashlock, s.solver));
    assert(redeemed.status == 3, "expected Redeemed status");
    assert(redeemed.secret == secret, "secret not stored");
}

#[test]
unconstrained fn solver_locks_are_keyed_by_hashlock_and_solver() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    let solver2 = s.env.create_contract_account();
    s.env.call_public(s.minter, Token::at(s.token).mint_to_public(solver2, MINT_AMOUNT));

    do_solver_lock(s, hashlock, 1, 0 as u128, 0, s.token, AztecAddress::zero());
    do_solver_lock_as(
        s,
        solver2,
        hashlock,
        2,
        0 as u128,
        0,
        s.token,
        AztecAddress::zero(),
    );

    let lock1 = s.env.view_public(Train::at(s.train).get_solver_lock(hashlock, s.solver));
    let lock2 = s.env.view_public(Train::at(s.train).get_solver_lock(hashlock, solver2));
    assert(lock1.status == 1, "solver 1 lock must be Pending");
    assert(lock2.status == 1, "solver 2 lock must be Pending");
    assert(lock1.sender == s.solver, "wrong solver 1 sender");
    assert(lock2.sender == solver2, "wrong solver 2 sender");
}

#[test(should_fail_with = "SolverLockAlreadyExists")]
unconstrained fn solver_cannot_lock_same_hashlock_twice() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));

    do_solver_lock(s, hashlock, 1, 0 as u128, 0, s.token, AztecAddress::zero());
    do_solver_lock(s, hashlock, 2, 0 as u128, 0, s.token, AztecAddress::zero());
}

#[test(should_fail_with = "SolverLockAlreadyExists")]
unconstrained fn solver_cannot_relock_same_hashlock_after_redeem() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);

    do_solver_lock(s, hashlock, 1, 0 as u128, 0, s.token, AztecAddress::zero());
    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));
    do_solver_lock(s, hashlock, 2, 0 as u128, 0, s.token, AztecAddress::zero());
}

#[test]
unconstrained fn solver_redeem_before_reward_timelock_pays_reward_recipient() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);
    let reward_recipient = s.env.create_light_account();

    // Same token for principal and reward: single combined pull
    do_solver_lock(s, hashlock, 1, REWARD_AMOUNT, 0, s.token, reward_recipient);
    check_balance(
        s.env,
        s.token,
        s.solver,
        MINT_AMOUNT - LOCK_AMOUNT - REWARD_AMOUNT,
    );
    check_balance(s.env, s.token, s.train, LOCK_AMOUNT + REWARD_AMOUNT);

    // Redeem immediately: now < reward_timelock, so the reward goes to reward_recipient
    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));

    check_balance(s.env, s.token, s.recipient, LOCK_AMOUNT);
    check_balance(s.env, s.token, reward_recipient, REWARD_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);
}

#[test]
unconstrained fn solver_redeem_after_reward_timelock_pays_redeemer() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);
    let reward_recipient = s.env.create_light_account();

    do_solver_lock(s, hashlock, 1, REWARD_AMOUNT, 0, s.token, reward_recipient);

    // Jump past the reward timelock (but before the refund timelock)
    s.env.advance_next_block_timestamp_by(REWARD_TIMELOCK_DELTA + 60);

    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));

    check_balance(s.env, s.token, s.recipient, LOCK_AMOUNT);
    check_balance(s.env, s.token, reward_recipient, 0 as u128);
    // Redeemer (s.user) collected the late-redeem reward
    check_balance(s.env, s.token, s.user, MINT_AMOUNT + REWARD_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);
}

#[test]
unconstrained fn solver_redeem_combined_transfer_when_recipient_is_reward_recipient() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);

    // reward_recipient == recipient and same token: exercises the combined-transfer branch
    do_solver_lock(s, hashlock, 1, REWARD_AMOUNT, 0, s.token, s.recipient);
    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));

    check_balance(s.env, s.token, s.recipient, LOCK_AMOUNT + REWARD_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);
}

#[test]
unconstrained fn solver_lock_and_redeem_with_different_reward_token() {
    let mut s = utils::setup();
    let reward_token = utils::deploy_token(&mut s.env, s.minter);
    s.env.call_public(s.minter, Token::at(reward_token).mint_to_public(s.solver, MINT_AMOUNT));
    let reward_recipient = s.env.create_light_account();

    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);

    do_solver_lock(
        s,
        hashlock,
        1,
        REWARD_AMOUNT,
        2,
        reward_token,
        reward_recipient,
    );

    check_balance(s.env, s.token, s.train, LOCK_AMOUNT);
    check_balance(s.env, reward_token, s.train, REWARD_AMOUNT);

    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));

    check_balance(s.env, s.token, s.recipient, LOCK_AMOUNT);
    check_balance(s.env, reward_token, reward_recipient, REWARD_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);
    check_balance(s.env, reward_token, s.train, 0 as u128);
}

#[test(should_fail_with = "InvalidRewardTimelock")]
unconstrained fn solver_lock_reward_timelock_not_below_timelock_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    s.env.call_public(
        s.solver,
        Train::at(s.train).solver_lock(
            hashlock,
            LOCK_AMOUNT,
            1,
            REWARD_AMOUNT,
            0,
            TIMELOCK_DELTA,
            TIMELOCK_DELTA, // reward_timelock_delta == timelock_delta: invalid when reward > 0
            s.solver,
            s.recipient,
            s.recipient,
            s.token,
            s.token,
            AztecAddress::zero(),
            [0; 128],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
        ),
    );
}

#[test(should_fail_with = "ZeroAddress")]
unconstrained fn solver_lock_zero_reward_recipient_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    s.env.call_public(
        s.solver,
        Train::at(s.train).solver_lock(
            hashlock,
            LOCK_AMOUNT,
            1,
            REWARD_AMOUNT,
            0,
            TIMELOCK_DELTA,
            REWARD_TIMELOCK_DELTA,
            s.solver,
            s.recipient,
            AztecAddress::zero(), // reward_recipient with reward > 0
            s.token,
            s.token,
            AztecAddress::zero(),
            [0; 128],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
        ),
    );
}

#[test(should_fail_with = "LockNotPending")]
unconstrained fn redeem_solver_twice_fails() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);
    do_solver_lock(s, hashlock, 1, 0 as u128, 0, s.token, AztecAddress::zero());

    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));
    s.env.call_public(s.user, Train::at(s.train).redeem_solver(hashlock, s.solver, secret));
}

#[test(should_fail_with = "LockNotFound")]
unconstrained fn redeem_solver_nonexistent_fails() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    s.env.call_public(
        s.user,
        Train::at(s.train).redeem_solver(hashlock_of(secret), s.solver, secret),
    );
}
