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
use aztec::macros::aztec;

#[aztec]
pub contract Train {
    use std::meta::derive;

    use aztec::macros::{functions::{external, initializer, view}, storage::storage};

    use aztec::{
        protocol::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
        state_vars::{Map, PublicMutable},
    };
    use sha256;
    use token::Token;

    use crate::lib::hashlock_to_fields;

    #[derive(Serialize)]
    struct UserLocked {
        hashlock: [u8; 32],
        sender: AztecAddress,
        recipient: AztecAddress,
        src_chain: [u8; 30],
        token: AztecAddress,
        amount: u128,
        timelock: u64,
        dst_chain: [u8; 30],
        dst_address: [u8; 90],
        dst_amount: u128,
        dst_token: [u8; 90],
        reward_amount: u128,
        reward_token: [u8; 90],
        reward_recipient: [u8; 90],
        reward_timelock_delta: u64,
        quote_expiry: u64,
        userData: [u8; 256],
        solverData: [u8; 256],
    }

    #[derive(Serialize)]
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
        dst_chain: [u8; 30],
        dst_address: [u8; 90],
        dst_amount: u128,
        dst_token: [u8; 90],
        data: [u8; 256],
    }

    #[derive(Serialize)]
    struct UserRedeemed {
        hashlock: [u8; 32],
        redeemer: AztecAddress,
        secret: [u8; 32],
    }

    #[derive(Serialize)]
    struct SolverRedeemed {
        hashlock: [u8; 32],
        index: Field,
        redeemer: AztecAddress,
        secret: [u8; 32],
    }

    #[derive(Serialize)]
    struct UserRefunded {
        hashlock: [u8; 32],
    }

    #[derive(Serialize)]
    struct SolverRefunded {
        hashlock: [u8; 32],
        index: Field,
    }

    // Event type tags for off-chain indexing
    global EVENT_USER_LOCKED: Field = 1;
    global EVENT_SOLVER_LOCKED: Field = 2;
    global EVENT_USER_REDEEMED: Field = 3;
    global EVENT_SOLVER_REDEEMED: Field = 4;
    global EVENT_USER_REFUNDED: Field = 5;
    global EVENT_SOLVER_REFUNDED: Field = 6;

    global STATUS_EMPTY: u8 = 0;
    global STATUS_PENDING: u8 = 1;
    global STATUS_REFUNDED: u8 = 2;
    global STATUS_REDEEMED: u8 = 3;
    #[derive(Eq, Packable, Serialize, Deserialize)]
    pub struct UserLock {
        secret: [u8; 32],
        amount: u128,
        refund_to: AztecAddress,
        timelock: u64,
        status: u8,
        recipient: AztecAddress,
        token: AztecAddress,
    }

    #[derive(Eq, Packable, Serialize, Deserialize)]
    pub struct SolverLock {
        secret: [u8; 32],
        amount: u128,
        reward: u128,
        refund_to: AztecAddress,
        timelock: u64,
        reward_timelock: u64,
        recipient: AztecAddress,
        status: u8,
        reward_recipient: AztecAddress,
        token: AztecAddress,
        reward_token: AztecAddress,
    }

    #[external("public")]
    #[initializer]
    fn constructor() {}

    #[storage]
    struct Storage<Context> {
        user_locks: Map<Field, Map<Field, PublicMutable<UserLock, Context>, Context>, Context>,
        solver_locks: Map<Field, Map<Field, Map<Field, PublicMutable<SolverLock, Context>, Context>, Context>, Context>,
        solver_lock_count: Map<Field, Map<Field, PublicMutable<Field, Context>, Context>, Context>,
    }

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
        assert(amount > 0, "ZeroAmount");
        assert(timelock_delta > 0, "InvalidTimelock");
        assert(self.context.timestamp() < quote_expiry, "QuoteExpired");

        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let existing = self.storage.user_locks.at(hashlock_high).at(hashlock_low).read();
        assert(existing.status == STATUS_EMPTY, "SwapAlreadyExists");

        let timelock = self.context.timestamp() + timelock_delta;
        assert(timelock > self.context.timestamp(), "TimelockOverflow");
        let lock = UserLock {
            secret: [0u8; 32],
            amount,
            refund_to,
            timelock,
            status: STATUS_PENDING,
            recipient,
            token,
        };
        self.storage.user_locks.at(hashlock_high).at(hashlock_low).write(lock);

        self.call(Token::at(token).transfer_public_to_public(
            sender,
            self.address,
            amount,
            transfer_nonce,
        ));

        self.context.emit_public_log_unsafe(
            EVENT_USER_LOCKED,
            UserLocked {
                hashlock,
                sender,
                recipient,
                src_chain,
                token,
                amount,
                timelock,
                dst_chain,
                dst_address,
                dst_amount,
                dst_token,
                reward_amount,
                reward_token,
                reward_recipient,
                reward_timelock_delta,
                quote_expiry,
                userData: user_data,
                solverData: solver_data,
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
        src_chain: [u8; 30],
        dst_chain: [u8; 30],
        dst_address: [u8; 90],
        dst_amount: u128,
        dst_token: [u8; 90],
        data: [u8; 256],
    ) -> pub Field {
        let sender = self.msg_sender();
        assert(amount > 0, "ZeroAmount");
        assert(timelock_delta > 0, "InvalidTimelock");
        if reward > 0 {
            assert(reward_timelock_delta < timelock_delta, "InvalidRewardTimelock");
        }

        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let timelock = self.context.timestamp() + timelock_delta;
        assert(timelock > self.context.timestamp(), "TimelockOverflow");
        let reward_timelock = self.context.timestamp() + reward_timelock_delta;
        assert(reward_timelock >= self.context.timestamp(), "RewardTimelockOverflow");

        // Auto-increment index
        let current_count =
            self.storage.solver_lock_count.at(hashlock_high).at(hashlock_low).read();
        let index = current_count + 1;
        self.storage.solver_lock_count.at(hashlock_high).at(hashlock_low).write(index);

        let lock = SolverLock {
            secret: [0u8; 32],
            amount,
            reward,
            refund_to,
            timelock,
            reward_timelock,
            recipient,
            status: STATUS_PENDING,
            reward_recipient,
            token,
            reward_token,
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

        self.context.emit_public_log_unsafe(
            EVENT_SOLVER_LOCKED,
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
                dst_chain,
                dst_address,
                dst_amount,
                dst_token,
                data,
            },
        );

        index
    }

    #[external("public")]
    fn redeem_user(hashlock: [u8; 32], secret: [u8; 32]) {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let lock = self.storage.user_locks.at(hashlock_high).at(hashlock_low).read();

        assert(lock.status != STATUS_EMPTY, "LockNotFound");
        let hashed_secret = sha256::sha256_var(secret, secret.len() as u32);
        assert(hashlock == hashed_secret, "HashlockMismatch");
        assert(lock.status == STATUS_PENDING, "LockNotPending");

        let redeemed_lock = UserLock {
            secret,
            amount: lock.amount,
            refund_to: lock.refund_to,
            timelock: lock.timelock,
            status: STATUS_REDEEMED,
            recipient: lock.recipient,
            token: lock.token,
        };
        self.storage.user_locks.at(hashlock_high).at(hashlock_low).write(redeemed_lock);

        self.call(Token::at(lock.token).transfer_public_to_public(
            self.address,
            lock.recipient,
            lock.amount,
            0,
        ));

        let redeemer = self.msg_sender();
        self.context.emit_public_log_unsafe(EVENT_USER_REDEEMED, UserRedeemed { hashlock, redeemer, secret });
    }

    #[external("public")]
    fn redeem_solver(
        hashlock: [u8; 32],
        index: Field,
        secret: [u8; 32],
    ) {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let lock = self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).read();

        assert(lock.status != STATUS_EMPTY, "LockNotFound");
        let hashed_secret = sha256::sha256_var(secret, secret.len() as u32);
        assert(hashlock == hashed_secret, "HashlockMismatch");
        assert(lock.status == STATUS_PENDING, "LockNotPending");

        let redeemed_lock = SolverLock {
            secret,
            amount: lock.amount,
            reward: lock.reward,
            refund_to: lock.refund_to,
            timelock: lock.timelock,
            reward_timelock: lock.reward_timelock,
            recipient: lock.recipient,
            status: STATUS_REDEEMED,
            reward_recipient: lock.reward_recipient,
            token: lock.token,
            reward_token: lock.reward_token,
        };
        self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).write(redeemed_lock);

        let redeemer = self.msg_sender();

        // Reward routing: before rewardTimelock -> rewardRecipient, after -> redeemer
        let reward_to = if lock.reward_timelock > self.context.timestamp() {
            lock.reward_recipient
        } else {
            redeemer
        };

        // Transfer amount to recipient, reward to reward_to
        if (lock.reward > 0) & (lock.token == lock.reward_token) & (lock.recipient == reward_to) {
            // Same token and same destination: combine transfers
            self.call(Token::at(lock.token).transfer_public_to_public(
                self.address,
                lock.recipient,
                lock.amount + lock.reward,
                0,
            ));
        } else {
            self.call(Token::at(lock.token).transfer_public_to_public(
                self.address,
                lock.recipient,
                lock.amount,
                0,
            ));
            if lock.reward > 0 {
                self.call(Token::at(lock.reward_token).transfer_public_to_public(
                    self.address,
                    reward_to,
                    lock.reward,
                    0,
                ));
            }
        }

        self.context.emit_public_log_unsafe(EVENT_SOLVER_REDEEMED, SolverRedeemed { hashlock, index, redeemer, secret });
    }

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

        let refunded_lock = UserLock {
            secret: lock.secret,
            amount: lock.amount,
            refund_to: lock.refund_to,
            timelock: lock.timelock,
            status: STATUS_REFUNDED,
            recipient: lock.recipient,
            token: lock.token,
        };
        self.storage.user_locks.at(hashlock_high).at(hashlock_low).write(refunded_lock);

        self.call(Token::at(lock.token).transfer_public_to_public(
            self.address,
            lock.refund_to,
            lock.amount,
            0,
        ));

        self.context.emit_public_log_unsafe(EVENT_USER_REFUNDED, UserRefunded { hashlock });
    }

    #[external("public")]
    fn refund_solver(
        hashlock: [u8; 32],
        index: Field,
    ) {
        let (hashlock_high, hashlock_low) = hashlock_to_fields(hashlock);
        let lock = self.storage.solver_locks.at(hashlock_high).at(hashlock_low).at(index).read();

        assert(lock.status != STATUS_EMPTY, "LockNotFound");
        assert(lock.status == STATUS_PENDING, "LockNotPending");
        assert(self.context.timestamp() >= lock.timelock, "RefundNotAllowed");

        let refunded_lock = SolverLock {
            secret: lock.secret,
            amount: lock.amount,
            reward: lock.reward,
            refund_to: lock.refund_to,
            timelock: lock.timelock,
            reward_timelock: lock.reward_timelock,
            recipient: lock.recipient,
            status: STATUS_REFUNDED,
            reward_recipient: lock.reward_recipient,
            token: lock.token,
            reward_token: lock.reward_token,
        };
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

        self.context.emit_public_log_unsafe(EVENT_SOLVER_REFUNDED, SolverRefunded { hashlock, index });
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

}
