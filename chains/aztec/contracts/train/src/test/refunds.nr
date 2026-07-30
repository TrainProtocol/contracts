use crate::test::utils::{
    self, check_balance, do_solver_lock, do_user_lock, hashlock_of, MINT_AMOUNT, REWARD_AMOUNT,
    test_secret, TIMELOCK_DELTA,
};
use crate::Train;
use aztec::protocol::address::AztecAddress;
use token::Token;

#[test]
unconstrained fn refund_user_after_timelock() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    s.env.advance_next_block_timestamp_by(TIMELOCK_DELTA + 60);

    // Anyone can refund after the timelock; funds go to refund_to (the user)
    s.env.call_public(s.solver, Train::at(s.train).refund_user(hashlock));

    check_balance(s.env, s.token, s.user, MINT_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);

    let lock = s.env.view_public(Train::at(s.train).get_user_lock(hashlock));
    assert(lock.status == 2, "expected Refunded status");
}

#[test]
unconstrained fn refund_user_by_recipient_before_timelock() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    // The recipient may refund at any time (early cancel path)
    s.env.call_public(s.recipient, Train::at(s.train).refund_user(hashlock));

    check_balance(s.env, s.token, s.user, MINT_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);
}

#[test(should_fail_with = "RefundNotAllowed")]
unconstrained fn refund_user_early_by_non_recipient_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    s.env.call_public(s.user, Train::at(s.train).refund_user(hashlock));
}

#[test(should_fail_with = "LockNotPending")]
unconstrained fn refund_user_twice_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    s.env.advance_next_block_timestamp_by(TIMELOCK_DELTA + 60);
    s.env.call_public(s.user, Train::at(s.train).refund_user(hashlock));
    s.env.call_public(s.user, Train::at(s.train).refund_user(hashlock));
}

#[test(should_fail_with = "LockNotFound")]
unconstrained fn refund_user_nonexistent_fails() {
    let mut s = utils::setup();
    s.env.call_public(s.user, Train::at(s.train).refund_user(hashlock_of(test_secret(1))));
}

#[test(should_fail_with = "LockNotPending")]
unconstrained fn refund_user_after_redeem_fails() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);
    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    s.env.call_public(s.user, Train::at(s.train).redeem_user(hashlock, secret));
    s.env.advance_next_block_timestamp_by(TIMELOCK_DELTA + 60);
    s.env.call_public(s.user, Train::at(s.train).refund_user(hashlock));
}

// ============ Solver refunds ============

#[test]
unconstrained fn refund_solver_after_timelock_same_token_reward() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    let reward_recipient = s.env.create_light_account();
    do_solver_lock(s, hashlock, 1, REWARD_AMOUNT, 0, s.token, reward_recipient);

    s.env.advance_next_block_timestamp_by(TIMELOCK_DELTA + 60);

    s.env.call_public(s.user, Train::at(s.train).refund_solver(hashlock, s.solver));

    // amount + reward return to refund_to (the solver)
    check_balance(s.env, s.token, s.solver, MINT_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);

    let lock = s.env.view_public(Train::at(s.train).get_solver_lock(hashlock, s.solver));
    assert(lock.status == 2, "expected Refunded status");
}

#[test]
unconstrained fn refund_solver_after_timelock_different_reward_token() {
    let mut s = utils::setup();
    let reward_token = utils::deploy_token(&mut s.env, s.minter);
    s.env.call_public(s.minter, Token::at(reward_token).mint_to_public(s.solver, MINT_AMOUNT));
    let reward_recipient = s.env.create_light_account();

    let hashlock = hashlock_of(test_secret(1));
    do_solver_lock(
        s,
        hashlock,
        1,
        REWARD_AMOUNT,
        2,
        reward_token,
        reward_recipient,
    );

    s.env.advance_next_block_timestamp_by(TIMELOCK_DELTA + 60);
    s.env.call_public(s.user, Train::at(s.train).refund_solver(hashlock, s.solver));

    check_balance(s.env, s.token, s.solver, MINT_AMOUNT);
    check_balance(s.env, reward_token, s.solver, MINT_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);
    check_balance(s.env, reward_token, s.train, 0 as u128);
}

#[test(should_fail_with = "RefundNotAllowed")]
unconstrained fn refund_solver_before_timelock_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_solver_lock(s, hashlock, 1, 0 as u128, 0, s.token, AztecAddress::zero());

    // Unlike user locks, not even the recipient can refund a solver lock early
    s.env.call_public(s.recipient, Train::at(s.train).refund_solver(hashlock, s.solver));
}

#[test(should_fail_with = "LockNotFound")]
unconstrained fn refund_solver_nonexistent_fails() {
    let mut s = utils::setup();
    s.env.call_public(
        s.user,
        Train::at(s.train).refund_solver(hashlock_of(test_secret(1)), s.solver),
    );
}

#[test(should_fail_with = "SolverLockAlreadyExists")]
unconstrained fn solver_cannot_relock_same_hashlock_after_refund() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_solver_lock(s, hashlock, 1, 0 as u128, 0, s.token, AztecAddress::zero());

    s.env.advance_next_block_timestamp_by(TIMELOCK_DELTA + 60);
    s.env.call_public(s.user, Train::at(s.train).refund_solver(hashlock, s.solver));
    do_solver_lock(s, hashlock, 2, 0 as u128, 0, s.token, AztecAddress::zero());
}
