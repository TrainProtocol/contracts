use crate::test::utils::{
    self, check_balance, do_user_lock, hashlock_of, LOCK_AMOUNT, MINT_AMOUNT, quote_expiry,
    test_secret, TIMELOCK_DELTA,
};
use crate::Train;
use aztec::protocol::{address::AztecAddress, traits::FromField};
use payout_curve::ConstantPayoutCurve;

#[test]
unconstrained fn user_lock_and_redeem() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);

    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    // Funds escrowed in the Train contract
    check_balance(s.env, s.token, s.user, MINT_AMOUNT - LOCK_AMOUNT);
    check_balance(s.env, s.token, s.train, LOCK_AMOUNT);

    let lock = s.env.view_public(Train::at(s.train).get_user_lock(hashlock));
    assert(lock.status == 1, "expected Pending status");
    assert(lock.amount == LOCK_AMOUNT, "wrong amount");
    assert(lock.sender == s.user, "wrong sender");
    assert(lock.recipient == s.recipient, "wrong recipient");
    assert(lock.refund_to == s.user, "wrong refund_to");
    assert(lock.token == s.token, "wrong token");
    assert(lock.payout_curve == AztecAddress::zero(), "wrong payout curve");

    // Anyone holding the secret can redeem; payout goes to the lock's recipient
    s.env.call_public(s.solver, Train::at(s.train).redeem_user(hashlock, secret));

    check_balance(s.env, s.token, s.recipient, LOCK_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);

    let redeemed = s.env.view_public(Train::at(s.train).get_user_lock(hashlock));
    assert(redeemed.status == 3, "expected Redeemed status");
    assert(redeemed.secret == secret, "secret not stored");
}

#[test(should_fail_with = "HashlockMismatch")]
unconstrained fn redeem_user_wrong_secret_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    s.env.call_public(s.user, Train::at(s.train).redeem_user(hashlock, test_secret(2)));
}

#[test(should_fail_with = "LockNotPending")]
unconstrained fn redeem_user_twice_fails() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);
    do_user_lock(s, hashlock, 1, AztecAddress::zero());

    s.env.call_public(s.user, Train::at(s.train).redeem_user(hashlock, secret));
    s.env.call_public(s.user, Train::at(s.train).redeem_user(hashlock, secret));
}

#[test(should_fail_with = "LockNotFound")]
unconstrained fn redeem_user_nonexistent_fails() {
    let mut s = utils::setup();
    let secret = test_secret(1);
    s.env.call_public(s.user, Train::at(s.train).redeem_user(hashlock_of(secret), secret));
}

#[test(should_fail_with = "SwapAlreadyExists")]
unconstrained fn user_lock_duplicate_hashlock_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    do_user_lock(s, hashlock, 1, AztecAddress::zero());
    do_user_lock(s, hashlock, 2, AztecAddress::zero());
}

#[test(should_fail_with = "ZeroAmount")]
unconstrained fn user_lock_zero_amount_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    s.env.call_public(
        s.user,
        Train::at(s.train).user_lock(
            hashlock,
            0 as u128,
            1,
            0 as u128,
            TIMELOCK_DELTA,
            0,
            quote_expiry(s.env),
            s.user,
            s.recipient,
            s.token,
            AztecAddress::zero(),
            [0; 128],
            [0; 90],
            [0; 90],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
            [0; 256],
        ),
    );
}

#[test(should_fail_with = "InvalidTimelock")]
unconstrained fn user_lock_zero_timelock_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    s.env.call_public(
        s.user,
        Train::at(s.train).user_lock(
            hashlock,
            LOCK_AMOUNT,
            1,
            0 as u128,
            0,
            0,
            quote_expiry(s.env),
            s.user,
            s.recipient,
            s.token,
            AztecAddress::zero(),
            [0; 128],
            [0; 90],
            [0; 90],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
            [0; 256],
        ),
    );
}

#[test(should_fail_with = "QuoteExpired")]
unconstrained fn user_lock_expired_quote_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    s.env.call_public(
        s.user,
        Train::at(s.train).user_lock(
            hashlock,
            LOCK_AMOUNT,
            1,
            0 as u128,
            TIMELOCK_DELTA,
            0,
            0, // quote_expiry in the past
            s.user,
            s.recipient,
            s.token,
            AztecAddress::zero(),
            [0; 128],
            [0; 90],
            [0; 90],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
            [0; 256],
        ),
    );
}

#[test(should_fail_with = "ZeroAddress")]
unconstrained fn user_lock_zero_recipient_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    s.env.call_public(
        s.user,
        Train::at(s.train).user_lock(
            hashlock,
            LOCK_AMOUNT,
            1,
            0 as u128,
            TIMELOCK_DELTA,
            0,
            quote_expiry(s.env),
            s.user,
            AztecAddress::zero(), // recipient
            s.token,
            AztecAddress::zero(),
            [0; 128],
            [0; 90],
            [0; 90],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
            [0; 256],
        ),
    );
}

// ============ Payout curve ============

#[test]
unconstrained fn user_lock_with_constant_curve_redeems_full_amount() {
    let mut s = utils::setup();
    let curve = s.env.deploy("@payout_curve/ConstantPayoutCurve").with_public_initializer(
        s.minter,
        ConstantPayoutCurve::interface().constructor(),
    );

    let secret = test_secret(1);
    let hashlock = hashlock_of(secret);
    do_user_lock(s, hashlock, 1, curve);

    let lock = s.env.view_public(Train::at(s.train).get_user_lock(hashlock));
    assert(lock.payout_curve == curve, "curve not stored");

    s.env.call_public(s.solver, Train::at(s.train).redeem_user(hashlock, secret));

    // Constant curve: payout == amount, excess == 0
    check_balance(s.env, s.token, s.recipient, LOCK_AMOUNT);
    check_balance(s.env, s.token, s.train, 0 as u128);
}

#[test(should_fail)]
unconstrained fn user_lock_with_invalid_curve_fails() {
    let mut s = utils::setup();
    let hashlock = hashlock_of(test_secret(1));
    // An address with no contract behind it: the lock-time curve probe must fail
    let bogus_curve = AztecAddress::from_field(0x1234);
    do_user_lock(s, hashlock, 1, bogus_curve);
}
