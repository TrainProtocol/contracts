use crate::lib::{fields_to_hashlock, hashlock_to_fields};
use crate::test::utils::{self, do_user_lock, hashlock_of, test_secret};
use crate::Train;
use aztec::protocol::{address::AztecAddress, traits::FromField};

/// Reads the index-th enumerated hashlock for `user` as 32 bytes.
unconstrained fn hash_at(s: utils::TrainSetup, user: AztecAddress, index: Field) -> [u8; 32] {
    let (high, low) = s.env.view_public(Train::at(s.train).get_user_lock_hash_at(user, index));
    fields_to_hashlock(high, low)
}

#[test]
unconstrained fn enumeration_single_lock() {
    let mut s = utils::setup();
    let h1 = hashlock_of(test_secret(1));
    do_user_lock(s, h1, 1, AztecAddress::zero());

    let count = s.env.view_public(Train::at(s.train).get_user_lock_count(s.user));
    assert(count == 1, "count must be 1");

    let got = hash_at(s, s.user, 0);
    let (h1_high, h1_low) = hashlock_to_fields(h1);
    let (got_high, got_low) = hashlock_to_fields(got);
    assert(got == h1, f"single: limbs got {got_high} {got_low} want {h1_high} {h1_low}");
}

#[test]
unconstrained fn hashlock_field_roundtrip() {
    let h = hashlock_of(test_secret(1));
    let (high, low) = hashlock_to_fields(h);
    let back = fields_to_hashlock(high, low);
    assert(back == h, "hashlock field round-trip mismatch");
}

#[test]
unconstrained fn user_lock_hashes_enumeration_and_paging() {
    let mut s = utils::setup();

    let h1 = hashlock_of(test_secret(1));
    let h2 = hashlock_of(test_secret(2));
    let h3 = hashlock_of(test_secret(3));
    do_user_lock(s, h1, 1, AztecAddress::zero());
    do_user_lock(s, h2, 2, AztecAddress::zero());
    do_user_lock(s, h3, 3, AztecAddress::zero());

    let count = s.env.view_public(Train::at(s.train).get_user_lock_count(s.user));
    assert(count == 3, "count must be 3");

    // Enumerate 0..count and check ordering
    assert(hash_at(s, s.user, 0) == h1, "index 0 mismatch");
    assert(hash_at(s, s.user, 1) == h2, "index 1 mismatch");
    assert(hash_at(s, s.user, 2) == h3, "index 2 mismatch");

    // Out-of-range index yields zeros
    assert(hash_at(s, s.user, 3) == [0; 32], "index 3 must be empty");
    assert(hash_at(s, s.user, 99) == [0; 32], "index 99 must be empty");

    // Unknown user has no locks
    let stranger = AztecAddress::from_field(0xdead);
    let count_stranger = s.env.view_public(Train::at(s.train).get_user_lock_count(stranger));
    assert(count_stranger == 0, "stranger count must be 0");
    assert(hash_at(s, stranger, 0) == [0; 32], "stranger entry must be empty");
}
