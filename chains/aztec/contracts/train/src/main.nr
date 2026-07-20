//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

mod lib;
mod test;
use aztec::macros::aztec;

/// Train Protocol - Cross-chain HTLC bridge for Aztec.
/// Hashlock = sha256(secret). Token-only (no native asset on Aztec); transfers are
/// exact-amount public token transfers with authwit authorization.
#[aztec]
pub contract Train {
    use std::meta::derive;

    use aztec::macros::{events::event, functions::{external, initializer, view}, storage::storage};

    use aztec::{
        protocol::{
            address::AztecAddress,
            traits::{Deserialize, FromField, Packable, Serialize, ToField},
        },
        state_vars::{Map, PublicMutable},
    };
    use sha256;
    use token::Token;

    use payout_curve::ConstantPayoutCurve;

    use crate::lib::{
        bytes128_to_fields, fields_to_bytes128, fields_to_hashlock, hashlock_to_fields,
    };

    global STATUS_EMPTY: u8 = 0;
    global STATUS_PENDING: u8 = 1;
    global STATUS_REFUNDED: u8 = 2;
    global STATUS_REDEEMED: u8 = 3;

    // ============ Events ============

    #[event]
    struct UserLocked {
        hashlock: [u8; 32],
        sender: AztecAddress,
        recipient: AztecAddress,
        src_chain: [u8; 30],
        token: AztecAddress,
        amount: u128,
        timelock: u64,
        payout_curve: AztecAddress,
        dst_chain: [u8; 30],
        dst_address: [u8; 90],
        dst_amount: u128,
        dst_token: [u8; 90],
        reward_amount: u128,
        reward_token: [u8; 90],
        reward_recipient: [u8; 90],
        reward_timelock_delta: u64,
        quote_expiry: u64,
        user_data: [u8; 256],
        solver_data: [u8; 256],
    }

    #[event]
    struct SolverLocked {
        hashlock: [u8; 32],
        sender: AztecAddress,
        recipient: AztecAddress,
        index: Field,
        src_chain: [u8; 30],
        token: AztecAddress,
        amount: u128,
        reward: u128,
        reward_token: AztecAddress,
        reward_recipient: AztecAddress,
        timelock: u64,
        reward_timelock: u64,
        payout_curve: AztecAddress,
        dst_chain: [u8; 30],
        dst_address: [u8; 90],
        dst_amount: u128,
        dst_token: [u8; 90],
        data: [u8; 256],
    }

    #[event]
    struct UserRedeemed {
        hashlock: [u8; 32],
        redeemer: AztecAddress,
        secret: [u8; 32],
        payout: u128,
        excess: u128,
    }

    #[event]
    struct SolverRedeemed {
        hashlock: [u8; 32],
        index: Field,
        redeemer: AztecAddress,
        secret: [u8; 32],
        payout: u128,
        excess: u128,
        reward_to: AztecAddress,
        reward: u128,
    }

    #[event]
    struct UserRefunded {
        hashlock: [u8; 32],
        refund_to: AztecAddress,
        amount: u128,
    }

    #[event]
    struct SolverRefunded {
        hashlock: [u8; 32],
        index: Field,
        refund_to: AztecAddress,
        amount: u128,
        reward: u128,
    }

    // ============ Storage structs ============

    #[derive(Eq, Serialize, Deserialize)]
    pub struct UserLock {
        pub secret: [u8; 32],
        pub sender: AztecAddress,
        pub amount: u128,
        pub refund_to: AztecAddress,
        pub timelock: u64,
        pub start_time: u64,
        pub status: u8,
        pub recipient: AztecAddress,
        pub token: AztecAddress,
        pub payout_curve: AztecAddress,
        pub payout_curve_data: [u8; 128],
    }

    #[derive(Eq, Serialize, Deserialize)]
    pub struct SolverLock {
        pub secret: [u8; 32],
        pub sender: AztecAddress,
        pub amount: u128,
        pub reward: u128,
        pub refund_to: AztecAddress,
        pub timelock: u64,
        pub reward_timelock: u64,
        pub start_time: u64,
        pub recipient: AztecAddress,
        pub status: u8,
        pub reward_recipient: AztecAddress,
        pub token: AztecAddress,
        pub reward_token: AztecAddress,
        pub payout_curve: AztecAddress,
        pub payout_curve_data: [u8; 128],
    }

    /// Manual Packable impls: the derived impl packs one field PER BYTE of `secret`
    /// (32) and `payout_curve_data` (128), making a single lock write exceed the
    /// AVM's per-tx public data write limit. Packing bytes 31-per-field keeps a
    /// UserLock at 16 and a SolverLock at 20 storage slots.
    impl Packable for UserLock {
        let N: u32 = 16;

        fn pack(self) -> [Field; 16] {
            let (secret_high, secret_low) = hashlock_to_fields(self.secret);
            let data = bytes128_to_fields(self.payout_curve_data);
            [
                secret_high,
                secret_low,
                self.sender.to_field(),
                self.amount as Field,
                self.refund_to.to_field(),
                self.timelock as Field,
                self.start_time as Field,
                self.status as Field,
                self.recipient.to_field(),
                self.token.to_field(),
                self.payout_curve.to_field(),
                data[0],
                data[1],
                data[2],
                data[3],
                data[4],
            ]
        }

        fn unpack(packed: [Field; 16]) -> Self {
            Self {
                secret: fields_to_hashlock(packed[0], packed[1]),
                sender: AztecAddress::from_field(packed[2]),
                amount: packed[3] as u128,
                refund_to: AztecAddress::from_field(packed[4]),
                timelock: packed[5] as u64,
                start_time: packed[6] as u64,
                status: packed[7] as u8,
                recipient: AztecAddress::from_field(packed[8]),
                token: AztecAddress::from_field(packed[9]),
                payout_curve: AztecAddress::from_field(packed[10]),
                payout_curve_data: fields_to_bytes128([
                    packed[11], packed[12], packed[13], packed[14], packed[15],
                ]),
            }
        }
    }

    impl Packable for SolverLock {
        let N: u32 = 20;

        fn pack(self) -> [Field; 20] {
            let (secret_high, secret_low) = hashlock_to_fields(self.secret);
            let data = bytes128_to_fields(self.payout_curve_data);
            [
                secret_high,
                secret_low,
                self.sender.to_field(),
                self.amount as Field,
                self.reward as Field,
                self.refund_to.to_field(),
                self.timelock as Field,
                self.reward_timelock as Field,
                self.start_time as Field,
                self.recipient.to_field(),
                self.status as Field,
                self.reward_recipient.to_field(),
                self.token.to_field(),
                self.reward_token.to_field(),
                self.payout_curve.to_field(),
                data[0],
                data[1],
                data[2],
                data[3],
                data[4],
            ]
        }

        fn unpack(packed: [Field; 20]) -> Self {
            Self {
                secret: fields_to_hashlock(packed[0], packed[1]),
                sender: AztecAddress::from_field(packed[2]),
                amount: packed[3] as u128,
                reward: packed[4] as u128,
                refund_to: AztecAddress::from_field(packed[5]),
                timelock: packed[6] as u64,
                reward_timelock: packed[7] as u64,
                start_time: packed[8] as u64,
                recipient: AztecAddress::from_field(packed[9]),
                status: packed[10] as u8,
                reward_recipient: AztecAddress::from_field(packed[11]),
                token: AztecAddress::from_field(packed[12]),
                reward_token: AztecAddress::from_field(packed[13]),
                payout_curve: AztecAddress::from_field(packed[14]),
                payout_curve_data: fields_to_bytes128([
                    packed[15], packed[16], packed[17], packed[18], packed[19],
                ]),
            }
        }
    }

    /// A hashlock stored as two field limbs (sha256 output exceeds the field modulus).
    #[derive(Eq, Packable, Serialize, Deserialize)]
    pub struct HashlockRef {
        pub high: Field,
        pub low: Field,
    }

    #[external("public")]
    #[initializer]
    fn constructor() {}

    #[storage]
    struct Storage<Context> {
        user_locks: Map<Field, Map<Field, PublicMutable<UserLock, Context>, Context>, Context>,
        solver_locks: Map<Field, Map<Field, Map<Field, PublicMutable<SolverLock, Context>, Context>, Context>, Context>,
        solver_lock_count: Map<Field, Map<Field, PublicMutable<Field, Context>, Context>, Context>,
        user_lock_hashes: Map<AztecAddress, Map<Field, PublicMutable<HashlockRef, Context>, Context>, Context>,
        user_lock_count: Map<AztecAddress, PublicMutable<u64, Context>, Context>,
    }

    // ============ Locks ============

    #[external("public")]
    fn user_lock(
        hashlock: [u8; 32],
        amount: u128,
        transfer_nonce: Field,
        reward_amount: u128,
        timelock_delta: u64,
        reward_timelock_delta: u64,
        quote_expiry: u64,
        refund_to: AztecAddress,
        recipient: AztecAddress,
        token: AztecAddress,
        payout_curve: AztecAddress,
        payout_curve_data: [u8; 128],
        reward_token: [u8; 90],
        reward_recipient: [u8; 90],
        src_chain: [u8; 30],
        dst_chain: [u8; 30],
        dst_address: [u8; 90],
        dst_amount: u128,
        dst_token: [u8; 90],
        user_data: [u8; 256],
        solver_data: [u8; 256],
    ) {
        let sender = self.msg_sender();
        let now = self.context.timestamp();
        assert(amount > 0, "ZeroAmount");
        assert(timelock_delta > 0, "InvalidTimelock");
        assert(now < quote_expiry, "QuoteExpired");
        assert(!recipient.is_zero(), "ZeroAddress");
        assert(!refund_to.is_zero(), "ZeroAddress");

        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let existing = self.storage.user_locks.at(hashlock_high).at(hashlock_low).read();
        assert(existing.status == STATUS_EMPTY, "SwapAlreadyExists");

        let timelock = now + timelock_delta;
        assert(timelock > now, "TimelockOverflow");

        // Curve sanity probe: a bad curve address or out-of-bounds payout fails
        // here at lock time instead of preventing a later redeem.
        if !payout_curve.is_zero() {
            let probe = self.view(ConstantPayoutCurve::at(payout_curve).compute_payout(
                amount,
                now,
                now,
                payout_curve_data,
            ));
            assert((probe > 0) & (probe <= amount), "InvalidPayout");
        }

        let lock = UserLock {
            secret: [0u8; 32],
            sender,
            amount,
            refund_to,
            timelock,
            start_time: now,
            status: STATUS_PENDING,
            recipient,
            token,
            payout_curve,
            payout_curve_data,
        };
        self.storage.user_locks.at(hashlock_high).at(hashlock_low).write(lock);

        // Append the hashlock to this user's enumeration index.
        let count = self.storage.user_lock_count.at(sender).read();
        self.storage.user_lock_hashes.at(sender).at(count as Field).write(
            HashlockRef { high: hashlock_high, low: hashlock_low },
        );
        self.storage.user_lock_count.at(sender).write(count + 1);

        self.call(Token::at(token).transfer_public_to_public(
            sender,
            self.address,
            amount,
            transfer_nonce,
        ));

        self.emit(
            UserLocked {
                hashlock,
                sender,
                recipient,
                src_chain,
                token,
                amount,
                timelock,
                payout_curve,
                dst_chain,
                dst_address,
                dst_amount,
                dst_token,
                reward_amount,
                reward_token,
                reward_recipient,
                reward_timelock_delta,
                quote_expiry,
                user_data,
                solver_data,
            },
        );
    }

    #[external("public")]
    fn solver_lock(
        hashlock: [u8; 32],
        amount: u128,
        transfer_nonce: Field,
        reward: u128,
        reward_transfer_nonce: Field,
        timelock_delta: u64,
        reward_timelock_delta: u64,
        refund_to: AztecAddress,
        recipient: AztecAddress,
        reward_recipient: AztecAddress,
        token: AztecAddress,
        reward_token: AztecAddress,
        payout_curve: AztecAddress,
        payout_curve_data: [u8; 128],
        src_chain: [u8; 30],
        dst_chain: [u8; 30],
        dst_address: [u8; 90],
        dst_amount: u128,
        dst_token: [u8; 90],
        data: [u8; 256],
    ) -> pub Field {
        let sender = self.msg_sender();
        let now = self.context.timestamp();
        assert(amount > 0, "ZeroAmount");
        assert(timelock_delta > 0, "InvalidTimelock");
        assert(!recipient.is_zero(), "ZeroAddress");
        assert(!refund_to.is_zero(), "ZeroAddress");
        if reward > 0 {
            assert(reward_timelock_delta < timelock_delta, "InvalidRewardTimelock");
            assert(!reward_recipient.is_zero(), "ZeroAddress");
        }

        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let timelock = now + timelock_delta;
        assert(timelock > now, "TimelockOverflow");
        let reward_timelock = now + reward_timelock_delta;
        assert(reward_timelock >= now, "RewardTimelockOverflow");

        // Curve sanity probe (see user_lock)
        if !payout_curve.is_zero() {
            let probe = self.view(ConstantPayoutCurve::at(payout_curve).compute_payout(
                amount,
                now,
                now,
                payout_curve_data,
            ));
            assert((probe > 0) & (probe <= amount), "InvalidPayout");
        }

        // Auto-increment index (1-based, monotonic per hashlock)
        let current_count =
            self.storage.solver_lock_count.at(hashlock_high).at(hashlock_low).read();
        let index = current_count + 1;
        self.storage.solver_lock_count.at(hashlock_high).at(hashlock_low).write(index);

        let lock = SolverLock {
            secret: [0u8; 32],
            sender,
            amount,
            reward,
            refund_to,
            timelock,
            reward_timelock,
            start_time: now,
            recipient,
            status: STATUS_PENDING,
            reward_recipient,
            token,
            reward_token,
            payout_curve,
            payout_curve_data,
        };
        self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).write(lock);

        // Transfer tokens
        if reward > 0 {
            assert(amount + reward >= amount, "AmountOverflow");
            if token == reward_token {
                // Same token: single transfer for amount + reward
                self.call(Token::at(token).transfer_public_to_public(
                    sender,
                    self.address,
                    amount + reward,
                    transfer_nonce,
                ));
            } else {
                // Different tokens: two transfers
                self.call(Token::at(token).transfer_public_to_public(
                    sender,
                    self.address,
                    amount,
                    transfer_nonce,
                ));
                self.call(Token::at(reward_token).transfer_public_to_public(
                    sender,
                    self.address,
                    reward,
                    reward_transfer_nonce,
                ));
            }
        } else {
            self.call(Token::at(token).transfer_public_to_public(
                sender,
                self.address,
                amount,
                transfer_nonce,
            ));
        }

        self.emit(
            SolverLocked {
                hashlock,
                sender,
                recipient,
                index,
                src_chain,
                token,
                amount,
                reward,
                reward_token,
                reward_recipient,
                timelock,
                reward_timelock,
                payout_curve,
                dst_chain,
                dst_address,
                dst_amount,
                dst_token,
                data,
            },
        );

        index
    }

    // ============ Redeems ============

    #[external("public")]
    fn redeem_user(hashlock: [u8; 32], secret: [u8; 32]) {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let lock = self.storage.user_locks.at(hashlock_high).at(hashlock_low).read();

        assert(lock.status != STATUS_EMPTY, "LockNotFound");
        let hashed_secret = sha256::sha256_var(secret, secret.len() as u32);
        assert(hashlock == hashed_secret, "HashlockMismatch");
        assert(lock.status == STATUS_PENDING, "LockNotPending");

        let mut redeemed_lock = lock;
        redeemed_lock.secret = secret;
        redeemed_lock.status = STATUS_REDEEMED;
        self.storage.user_locks.at(hashlock_high).at(hashlock_low).write(redeemed_lock);

        // Payout curve: payout in (0, amount], excess goes back to refund_to
        let payout = if lock.payout_curve.is_zero() {
            lock.amount
        } else {
            self.view(ConstantPayoutCurve::at(lock.payout_curve).compute_payout(
                lock.amount,
                lock.start_time,
                self.context.timestamp(),
                lock.payout_curve_data,
            ))
        };
        assert((payout > 0) & (payout <= lock.amount), "InvalidPayout");
        let excess = lock.amount - payout;

        self.call(Token::at(lock.token).transfer_public_to_public(
            self.address,
            lock.recipient,
            payout,
            0,
        ));
        if excess > 0 {
            self.call(Token::at(lock.token).transfer_public_to_public(
                self.address,
                lock.refund_to,
                excess,
                0,
            ));
        }

        let redeemer = self.msg_sender();
        self.emit(UserRedeemed { hashlock, redeemer, secret, payout, excess });
    }

    #[external("public")]
    fn redeem_solver(hashlock: [u8; 32], index: Field, secret: [u8; 32]) {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let lock = self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).read();

        assert(lock.status != STATUS_EMPTY, "LockNotFound");
        let hashed_secret = sha256::sha256_var(secret, secret.len() as u32);
        assert(hashlock == hashed_secret, "HashlockMismatch");
        assert(lock.status == STATUS_PENDING, "LockNotPending");

        let mut redeemed_lock = lock;
        redeemed_lock.secret = secret;
        redeemed_lock.status = STATUS_REDEEMED;
        self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).write(redeemed_lock);

        let redeemer = self.msg_sender();
        let now = self.context.timestamp();

        // Payout curve applies to the principal only; excess goes back to refund_to
        let payout = if lock.payout_curve.is_zero() {
            lock.amount
        } else {
            self.view(ConstantPayoutCurve::at(lock.payout_curve).compute_payout(
                lock.amount,
                lock.start_time,
                now,
                lock.payout_curve_data,
            ))
        };
        assert((payout > 0) & (payout <= lock.amount), "InvalidPayout");
        let excess = lock.amount - payout;

        // Reward routing: before reward_timelock -> reward_recipient, after -> redeemer
        let reward_to = if lock.reward_timelock > now {
            lock.reward_recipient
        } else {
            redeemer
        };

        // Transfer payout to recipient, excess to refund_to, reward to reward_to
        if (lock.reward > 0)
            & (lock.token == lock.reward_token)
            & (lock.recipient == reward_to)
            & (excess == 0) {
            // Same token and same destination: combine transfers
            self.call(Token::at(lock.token).transfer_public_to_public(
                self.address,
                lock.recipient,
                payout + lock.reward,
                0,
            ));
        } else {
            self.call(Token::at(lock.token).transfer_public_to_public(
                self.address,
                lock.recipient,
                payout,
                0,
            ));
            if excess > 0 {
                self.call(Token::at(lock.token).transfer_public_to_public(
                    self.address,
                    lock.refund_to,
                    excess,
                    0,
                ));
            }
            if lock.reward > 0 {
                self.call(Token::at(lock.reward_token).transfer_public_to_public(
                    self.address,
                    reward_to,
                    lock.reward,
                    0,
                ));
            }
        }

        self.emit(
            SolverRedeemed {
                hashlock,
                index,
                redeemer,
                secret,
                payout,
                excess,
                reward_to,
                reward: lock.reward,
            },
        );
    }

    // ============ Refunds ============

    #[external("public")]
    fn refund_user(hashlock: [u8; 32]) {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let lock = self.storage.user_locks.at(hashlock_high).at(hashlock_low).read();

        assert(lock.status != STATUS_EMPTY, "LockNotFound");
        assert(lock.status == STATUS_PENDING, "LockNotPending");

        let caller = self.msg_sender();
        // Recipient can refund anytime; others only after timelock
        if caller != lock.recipient {
            assert(self.context.timestamp() >= lock.timelock, "RefundNotAllowed");
        }

        let mut refunded_lock = lock;
        refunded_lock.status = STATUS_REFUNDED;
        self.storage.user_locks.at(hashlock_high).at(hashlock_low).write(refunded_lock);

        self.call(Token::at(lock.token).transfer_public_to_public(
            self.address,
            lock.refund_to,
            lock.amount,
            0,
        ));

        self.emit(UserRefunded { hashlock, refund_to: lock.refund_to, amount: lock.amount });
    }

    #[external("public")]
    fn refund_solver(hashlock: [u8; 32], index: Field) {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let lock = self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).read();

        assert(lock.status != STATUS_EMPTY, "LockNotFound");
        assert(lock.status == STATUS_PENDING, "LockNotPending");
        assert(self.context.timestamp() >= lock.timelock, "RefundNotAllowed");

        let mut refunded_lock = lock;
        refunded_lock.status = STATUS_REFUNDED;
        self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).write(refunded_lock);

        // Return amount + reward to refund_to
        if (lock.reward > 0) & (lock.token == lock.reward_token) {
            self.call(Token::at(lock.token).transfer_public_to_public(
                self.address,
                lock.refund_to,
                lock.amount + lock.reward,
                0,
            ));
        } else {
            self.call(Token::at(lock.token).transfer_public_to_public(
                self.address,
                lock.refund_to,
                lock.amount,
                0,
            ));
            if lock.reward > 0 {
                self.call(Token::at(lock.reward_token).transfer_public_to_public(
                    self.address,
                    lock.refund_to,
                    lock.reward,
                    0,
                ));
            }
        }

        self.emit(
            SolverRefunded {
                hashlock,
                index,
                refund_to: lock.refund_to,
                amount: lock.amount,
                reward: lock.reward,
            },
        );
    }

    // ============ View Functions ============

    #[external("public")]
    #[view]
    fn get_user_lock(hashlock: [u8; 32]) -> pub UserLock {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        self.storage.user_locks.at(hashlock_high).at(hashlock_low).read()
    }

    #[external("public")]
    #[view]
    fn get_solver_lock(hashlock: [u8; 32], index: Field) -> pub SolverLock {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).read()
    }

    #[external("public")]
    #[view]
    fn get_solver_lock_count(hashlock: [u8; 32]) -> pub Field {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        self.storage.solver_lock_count.at(hashlock_high).at(hashlock_low).read()
    }

    /// Hashlock of the `index`-th user lock created by `user` (0-based), as
    /// [high, low] u128 limbs (hashlock = high << 128 | low, big-endian; zeros if out
    /// of range). Clients loop `0..get_user_lock_count(user)` to enumerate entries.
    /// (A paged variant miscompiled to zero reads in
    /// an earlier v5 release-candidate AVM; single-entry reads are reliable.)
    #[external("public")]
    #[view]
    fn get_user_lock_hash_at(user: AztecAddress, index: Field) -> pub (Field, Field) {
        let entry = self.storage.user_lock_hashes.at(user).at(index).read();
        (entry.high, entry.low)
    }

    #[external("public")]
    #[view]
    fn get_user_lock_count(user: AztecAddress) -> pub u64 {
        self.storage.user_lock_count.at(user).read()
    }

}
