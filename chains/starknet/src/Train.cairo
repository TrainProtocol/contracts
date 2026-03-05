//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

// SPDX-License-Identifier: MIT

use starknet::ContractAddress;

/// Lock lifecycle states
#[derive(Drop, Copy, Serde, starknet::Store, PartialEq)]
pub enum LockStatus {
    #[default]
    Empty,
    Pending,
    Refunded,
    Redeemed,
}

/// User-initiated lock storage structure
#[derive(Drop, Serde, starknet::Store)]
pub struct UserLock {
    pub secret: u256,
    pub amount: u256,
    pub sender: ContractAddress,
    pub timelock: u64,
    pub status: LockStatus,
    pub recipient: ContractAddress,
    pub token: ContractAddress,
}

/// Solver-initiated lock storage structure
#[derive(Drop, Serde, starknet::Store)]
pub struct SolverLock {
    pub secret: u256,
    pub amount: u256,
    pub reward: u256,
    pub sender: ContractAddress,
    pub timelock: u64,
    pub reward_timelock: u64,
    pub recipient: ContractAddress,
    pub status: LockStatus,
    pub reward_recipient: ContractAddress,
    pub token: ContractAddress,
    pub reward_token: ContractAddress,
}

/// Cross-chain destination details (logged only, not stored)
#[derive(Drop, Serde)]
pub struct DestinationInfo {
    pub dst_chain: ByteArray,
    pub dst_address: ByteArray,
    pub dst_amount: u256,
    pub dst_token: ByteArray,
}

/// Parameters for creating a user lock
#[derive(Drop, Serde)]
pub struct UserLockParams {
    pub hashlock: u256,
    pub amount: u256,
    pub reward_amount: u256,
    pub timelock_delta: u64,
    pub reward_timelock_delta: u64,
    pub quote_expiry: u64,
    pub sender: ContractAddress,
    pub recipient: ContractAddress,
    pub token: ContractAddress,
    pub reward_token: ByteArray,
    pub reward_recipient: ByteArray,
    pub src_chain: ByteArray,
}

/// Parameters for creating a solver lock
#[derive(Drop, Serde)]
pub struct SolverLockParams {
    pub hashlock: u256,
    pub amount: u256,
    pub reward: u256,
    pub timelock_delta: u64,
    pub reward_timelock_delta: u64,
    pub sender: ContractAddress,
    pub recipient: ContractAddress,
    pub reward_recipient: ContractAddress,
    pub token: ContractAddress,
    pub reward_token: ContractAddress,
    pub src_chain: ByteArray,
}

#[starknet::interface]
pub trait ITrain<TContractState> {
    /// Create a user lock to initiate a cross-chain swap
    fn user_lock(
        ref self: TContractState,
        params: UserLockParams,
        dst: DestinationInfo,
        user_data: ByteArray,
        solver_data: ByteArray,
    );

    /// Create a solver lock to fulfill a swap
    fn solver_lock(
        ref self: TContractState,
        params: SolverLockParams,
        dst: DestinationInfo,
        data: ByteArray,
    ) -> u256;

    /// Refund a user lock
    fn refund_user(ref self: TContractState, hashlock: u256);

    /// Refund a solver lock (amount + reward returned to sender)
    fn refund_solver(ref self: TContractState, hashlock: u256, index: u256);

    /// Redeem a user lock with the secret preimage
    fn redeem_user(ref self: TContractState, hashlock: u256, secret: u256);

    /// Redeem a solver lock with the secret preimage
    fn redeem_solver(ref self: TContractState, hashlock: u256, index: u256, secret: u256);

    /// Get user lock details
    fn get_user_lock(self: @TContractState, hashlock: u256) -> Train::UserLock;

    /// Get solver lock details
    fn get_solver_lock(self: @TContractState, hashlock: u256, index: u256) -> Train::SolverLock;

    /// Get the number of solver locks for a hashlock
    fn get_solver_lock_count(self: @TContractState, hashlock: u256) -> u256;

    /// Get all hashlocks for user locks created by an address with filtering and pagination
    fn get_user_lock_hashes(
        self: @TContractState,
        user: ContractAddress,
        status: LockStatus,
        offset: u256,
        limit: u256,
    ) -> (Array<u256>, u256);

    /// Get all user lock details created by an address with filtering and pagination
    fn get_user_locks(
        self: @TContractState,
        user: ContractAddress,
        status: LockStatus,
        offset: u256,
        limit: u256,
    ) -> (Array<Train::UserLock>, u256);
}

/// @title Train Protocol - Cross-Chain HTLC Bridge
/// @notice Trustless cross-chain bridge using Hashed Time-Locked Contracts
/// @dev Supports ERC20 tokens. Hashlock = sha256(secret).
#[starknet::contract]
mod Train {
    use core::num::traits::Zero;
    use core::sha256::compute_sha256_byte_array;
    use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use openzeppelin_security::ReentrancyGuardComponent;
    use starknet::storage::{Map, StoragePathEntry};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{LockStatus, UserLockParams, SolverLockParams, DestinationInfo};

    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
        /// hashlock => UserLock
        user_locks: Map<u256, UserLock>,
        /// (hashlock, index) => SolverLock
        solver_locks: Map<(u256, u256), SolverLock>,
        /// hashlock => count of solver locks
        solver_lock_count: Map<u256, u256>,
        /// user => count of their user lock hashes
        user_lock_hash_count: Map<ContractAddress, u256>,
        /// (user, index) => hashlock
        user_lock_hashes: Map<(ContractAddress, u256), u256>,
    }

    #[derive(Drop, Serde, starknet::Store)]
    pub struct UserLock {
        pub secret: u256,
        pub amount: u256,
        pub sender: ContractAddress,
        pub timelock: u64,
        pub status: LockStatus,
        pub recipient: ContractAddress,
        pub token: ContractAddress,
    }

    #[derive(Drop, Serde, starknet::Store)]
    pub struct SolverLock {
        pub secret: u256,
        pub amount: u256,
        pub reward: u256,
        pub sender: ContractAddress,
        pub timelock: u64,
        pub reward_timelock: u64,
        pub recipient: ContractAddress,
        pub status: LockStatus,
        pub reward_recipient: ContractAddress,
        pub token: ContractAddress,
        pub reward_token: ContractAddress,
    }

    // ───────────────────────────── Events ─────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        UserLocked: UserLocked,
        SolverLocked: SolverLocked,
        UserRefunded: UserRefunded,
        SolverRefunded: SolverRefunded,
        UserRedeemed: UserRedeemed,
        SolverRedeemed: SolverRedeemed,
    }

    #[derive(Drop, starknet::Event)]
    struct UserLocked {
        #[key]
        hashlock: u256,
        #[key]
        sender: ContractAddress,
        #[key]
        recipient: ContractAddress,
        src_chain: ByteArray,
        token: ContractAddress,
        amount: u256,
        timelock: u64,
        dst_chain: ByteArray,
        dst_address: ByteArray,
        dst_amount: u256,
        dst_token: ByteArray,
        reward_amount: u256,
        reward_token: ByteArray,
        reward_recipient: ByteArray,
        reward_timelock_delta: u64,
        quote_expiry: u64,
        user_data: ByteArray,
        solver_data: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    struct SolverLocked {
        #[key]
        hashlock: u256,
        #[key]
        sender: ContractAddress,
        #[key]
        recipient: ContractAddress,
        index: u256,
        src_chain: ByteArray,
        token: ContractAddress,
        amount: u256,
        reward: u256,
        reward_token: ContractAddress,
        reward_recipient: ContractAddress,
        timelock: u64,
        reward_timelock: u64,
        dst_chain: ByteArray,
        dst_address: ByteArray,
        dst_amount: u256,
        dst_token: ByteArray,
        data: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    struct UserRefunded {
        #[key]
        hashlock: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct SolverRefunded {
        #[key]
        hashlock: u256,
        #[key]
        index: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct UserRedeemed {
        #[key]
        hashlock: u256,
        redeemer: ContractAddress,
        secret: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct SolverRedeemed {
        #[key]
        hashlock: u256,
        #[key]
        index: u256,
        redeemer: ContractAddress,
        secret: u256,
    }

    // ───────────────────────── Implementation ─────────────────────────

    #[abi(embed_v0)]
    impl TrainImpl of super::ITrain<ContractState> {
        fn user_lock(
            ref self: ContractState,
            params: UserLockParams,
            dst: DestinationInfo,
            user_data: ByteArray,
            solver_data: ByteArray,
        ) {
            self.reentrancy_guard.start();

            // Checks
            assert(params.amount != 0, 'ZeroAmount');
            assert(!params.token.is_zero(), 'InvalidToken');
            assert(params.timelock_delta != 0, 'InvalidTimelock');
            let now = get_block_timestamp();
            assert(now < params.quote_expiry, 'QuoteExpired');
            assert(
                self.user_locks.entry(params.hashlock).sender.read().is_zero(),
                'SwapAlreadyExists',
            );
            assert(params.timelock_delta <= 0xFFFFFFFFFFFFFFFF_u64 - now, 'TimelockOverflow');
            let timelock = now + params.timelock_delta;

            // Effects
            self
                .user_locks
                .write(
                    params.hashlock,
                    UserLock {
                        secret: 0,
                        amount: params.amount,
                        sender: params.sender,
                        timelock: timelock,
                        status: LockStatus::Pending,
                        recipient: params.recipient,
                        token: params.token,
                    },
                );

            let count = self.user_lock_hash_count.read(params.sender);
            self.user_lock_hashes.write((params.sender, count), params.hashlock);
            self.user_lock_hash_count.write(params.sender, count + 1);

            self
                .emit(
                    UserLocked {
                        hashlock: params.hashlock,
                        sender: params.sender,
                        recipient: params.recipient,
                        src_chain: params.src_chain,
                        token: params.token,
                        amount: params.amount,
                        timelock: timelock,
                        dst_chain: dst.dst_chain,
                        dst_address: dst.dst_address,
                        dst_amount: dst.dst_amount,
                        dst_token: dst.dst_token,
                        reward_amount: params.reward_amount,
                        reward_token: params.reward_token,
                        reward_recipient: params.reward_recipient,
                        reward_timelock_delta: params.reward_timelock_delta,
                        quote_expiry: params.quote_expiry,
                        user_data: user_data,
                        solver_data: solver_data,
                    },
                );

            // Interactions
            self._transfer_in(params.token, params.amount);

            self.reentrancy_guard.end();
        }

        fn solver_lock(
            ref self: ContractState,
            params: SolverLockParams,
            dst: DestinationInfo,
            data: ByteArray,
        ) -> u256 {
            self.reentrancy_guard.start();

            // Checks
            assert(params.amount != 0, 'ZeroAmount');
            assert(!params.token.is_zero(), 'InvalidToken');
            assert(params.timelock_delta != 0, 'InvalidTimelock');
            let now = get_block_timestamp();
            assert(params.timelock_delta <= 0xFFFFFFFFFFFFFFFF_u64 - now, 'TimelockOverflow');
            if params.reward > 0 {
                assert(!params.reward_token.is_zero(), 'InvalidToken');
                assert(params.reward_timelock_delta < params.timelock_delta, 'InvalidRewardTimelock');
            }
            assert(params.reward_timelock_delta <= 0xFFFFFFFFFFFFFFFF_u64 - now, 'TimelockOverflow');
            let timelock = now + params.timelock_delta;
            let reward_timelock = now + params.reward_timelock_delta;

            let current_count = self.solver_lock_count.read(params.hashlock);
            let index = current_count + 1;

            // Effects
            self.solver_lock_count.write(params.hashlock, index);

            self
                .solver_locks
                .write(
                    (params.hashlock, index),
                    SolverLock {
                        secret: 0,
                        amount: params.amount,
                        reward: params.reward,
                        sender: params.sender,
                        timelock: timelock,
                        reward_timelock: reward_timelock,
                        recipient: params.recipient,
                        status: LockStatus::Pending,
                        reward_recipient: params.reward_recipient,
                        token: params.token,
                        reward_token: params.reward_token,
                    },
                );

            self
                .emit(
                    SolverLocked {
                        hashlock: params.hashlock,
                        sender: params.sender,
                        recipient: params.recipient,
                        index: index,
                        src_chain: params.src_chain,
                        token: params.token,
                        amount: params.amount,
                        reward: params.reward,
                        reward_token: params.reward_token,
                        reward_recipient: params.reward_recipient,
                        timelock: timelock,
                        reward_timelock: reward_timelock,
                        dst_chain: dst.dst_chain,
                        dst_address: dst.dst_address,
                        dst_amount: dst.dst_amount,
                        dst_token: dst.dst_token,
                        data: data,
                    },
                );

            // Interactions
            self._transfer_in_mixed(params.token, params.amount, params.reward_token, params.reward);

            self.reentrancy_guard.end();
            index
        }

        fn refund_user(ref self: ContractState, hashlock: u256) {
            self.reentrancy_guard.start();

            // Checks
            let lock = self.user_locks.read(hashlock);
            assert(!lock.sender.is_zero(), 'LockNotFound');
            assert(lock.status == LockStatus::Pending, 'LockNotPending');
            if get_caller_address() != lock.recipient {
                assert(lock.timelock <= get_block_timestamp(), 'RefundNotAllowed');
            }

            // Effects
            self.user_locks.entry(hashlock).status.write(LockStatus::Refunded);
            self.emit(UserRefunded { hashlock: hashlock });

            // Interactions
            self._transfer_out(lock.token, lock.sender, lock.amount);

            self.reentrancy_guard.end();
        }

        fn refund_solver(ref self: ContractState, hashlock: u256, index: u256) {
            self.reentrancy_guard.start();

            // Checks
            let lock = self.solver_locks.read((hashlock, index));
            assert(!lock.sender.is_zero(), 'LockNotFound');
            assert(lock.status == LockStatus::Pending, 'LockNotPending');
            assert(lock.timelock <= get_block_timestamp(), 'RefundNotAllowed');

            // Effects
            self.solver_locks.entry((hashlock, index)).status.write(LockStatus::Refunded);
            self.emit(SolverRefunded { hashlock: hashlock, index: index });

            // Interactions
            self
                ._transfer_out_mixed(
                    lock.token,
                    lock.amount,
                    lock.sender,
                    lock.reward_token,
                    lock.reward,
                    lock.sender,
                );

            self.reentrancy_guard.end();
        }

        fn redeem_user(ref self: ContractState, hashlock: u256, secret: u256) {
            self.reentrancy_guard.start();

            // Checks
            let lock = self.user_locks.read(hashlock);
            assert(!lock.sender.is_zero(), 'LockNotFound');
            assert(_sha256_u256(secret) == hashlock, 'HashlockMismatch');
            assert(lock.status == LockStatus::Pending, 'LockNotPending');

            // Effects
            self.user_locks.entry(hashlock).status.write(LockStatus::Redeemed);
            self.user_locks.entry(hashlock).secret.write(secret);
            self
                .emit(
                    UserRedeemed {
                        hashlock: hashlock, redeemer: get_caller_address(), secret: secret,
                    },
                );

            // Interactions
            self._transfer_out(lock.token, lock.recipient, lock.amount);

            self.reentrancy_guard.end();
        }

        fn redeem_solver(ref self: ContractState, hashlock: u256, index: u256, secret: u256) {
            self.reentrancy_guard.start();

            // Checks
            let lock = self.solver_locks.read((hashlock, index));
            assert(!lock.sender.is_zero(), 'LockNotFound');
            assert(_sha256_u256(secret) == hashlock, 'HashlockMismatch');
            assert(lock.status == LockStatus::Pending, 'LockNotPending');

            let reward_to = if lock.reward_timelock > get_block_timestamp() {
                lock.reward_recipient
            } else {
                get_caller_address()
            };

            // Effects
            self.solver_locks.entry((hashlock, index)).status.write(LockStatus::Redeemed);
            self.solver_locks.entry((hashlock, index)).secret.write(secret);
            self
                .emit(
                    SolverRedeemed {
                        hashlock: hashlock,
                        index: index,
                        redeemer: get_caller_address(),
                        secret: secret,
                    },
                );

            // Interactions
            self
                ._transfer_out_mixed(
                    lock.token,
                    lock.amount,
                    lock.recipient,
                    lock.reward_token,
                    lock.reward,
                    reward_to,
                );

            self.reentrancy_guard.end();
        }

        fn get_user_lock(self: @ContractState, hashlock: u256) -> UserLock {
            self.user_locks.read(hashlock)
        }

        fn get_solver_lock(self: @ContractState, hashlock: u256, index: u256) -> SolverLock {
            self.solver_locks.read((hashlock, index))
        }

        fn get_solver_lock_count(self: @ContractState, hashlock: u256) -> u256 {
            self.solver_lock_count.read(hashlock)
        }

        fn get_user_lock_hashes(
            self: @ContractState,
            user: ContractAddress,
            status: LockStatus,
            offset: u256,
            limit: u256,
        ) -> (Array<u256>, u256) {
            let total_hashes = self.user_lock_hash_count.read(user);

            if limit == 0 {
                return (array![], 0);
            }

            let mut result: Array<u256> = array![];
            let mut match_count: u256 = 0;
            let mut i: u256 = 0;
            while i != total_hashes {
                let h = self.user_lock_hashes.read((user, i));
                let lock_status = self.user_locks.entry(h).status.read();
                if status == LockStatus::Empty || lock_status == status {
                    if match_count >= offset && match_count < offset + limit {
                        result.append(h);
                    }
                    match_count += 1;
                }
                i += 1;
            };

            (result, match_count)
        }

        fn get_user_locks(
            self: @ContractState,
            user: ContractAddress,
            status: LockStatus,
            offset: u256,
            limit: u256,
        ) -> (Array<UserLock>, u256) {
            let total_hashes = self.user_lock_hash_count.read(user);

            if limit == 0 {
                return (array![], 0);
            }

            let mut result: Array<UserLock> = array![];
            let mut match_count: u256 = 0;
            let mut i: u256 = 0;
            while i != total_hashes {
                let h = self.user_lock_hashes.read((user, i));
                let lock = self.user_locks.read(h);
                if status == LockStatus::Empty || lock.status == status {
                    if match_count >= offset && match_count < offset + limit {
                        result.append(lock);
                    }
                    match_count += 1;
                }
                i += 1;
            };

            (result, match_count)
        }
    }

    // ──────────────────────── Internal Helpers ────────────────────────

    /// Compute SHA256 of a u256 (32 bytes big-endian), matching Solidity's
    /// `sha256(abi.encodePacked(uint256))`.
    fn _sha256_u256(value: u256) -> u256 {
        let mut ba: ByteArray = "";
        ba.append_word(value.high.into(), 16);
        ba.append_word(value.low.into(), 16);

        let [r0, r1, r2, r3, r4, r5, r6, r7] = compute_sha256_byte_array(@ba);

        let r_high: u128 = r0.into() * 0x1000000000000000000000000_u128
            + r1.into() * 0x10000000000000000_u128
            + r2.into() * 0x100000000_u128
            + r3.into();
        let r_low: u128 = r4.into() * 0x1000000000000000000000000_u128
            + r5.into() * 0x10000000000000000_u128
            + r6.into() * 0x100000000_u128
            + r7.into();

        u256 { high: r_high, low: r_low }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _transfer_in(ref self: ContractState, token: ContractAddress, amount: u256) {
            let dispatcher = IERC20Dispatcher { contract_address: token };
            let this = get_contract_address();
            let balance_before = dispatcher.balance_of(this);
            let success = dispatcher.transfer_from(get_caller_address(), this, amount);
            assert(success, 'TransferFailed');
            assert(dispatcher.balance_of(this) >= balance_before + amount, 'TransferInsufficient');
        }

        fn _transfer_out(ref self: ContractState, token: ContractAddress, to: ContractAddress, amount: u256) {
            let success = IERC20Dispatcher { contract_address: token }.transfer(to, amount);
            assert(success, 'TransferFailed');
        }

        fn _transfer_in_mixed(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            reward_token: ContractAddress,
            reward: u256,
        ) {
            if reward > 0 && token == reward_token {
                self._transfer_in(token, amount + reward);
            } else {
                self._transfer_in(token, amount);
                if reward > 0 {
                    self._transfer_in(reward_token, reward);
                }
            }
        }

        fn _transfer_out_mixed(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            amount_to: ContractAddress,
            reward_token: ContractAddress,
            reward: u256,
            reward_to: ContractAddress,
        ) {
            if reward > 0 && token == reward_token && amount_to == reward_to {
                self._transfer_out(token, amount_to, amount + reward);
            } else {
                self._transfer_out(token, amount_to, amount);
                if reward > 0 {
                    self._transfer_out(reward_token, reward_to, reward);
                }
            }
        }
    }
}
