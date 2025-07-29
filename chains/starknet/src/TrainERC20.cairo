//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

use core::hash::{HashStateExTrait, HashStateTrait};
use core::poseidon::PoseidonTrait;
use openzeppelin::utils::snip12::{OffchainMessageHash, SNIP12Metadata, StructHash};
use starknet::ContractAddress;

/// @dev the selctor of the AddLockMsg type.
const MESSAGE_TYPE_HASH: felt252 = selector!(
    "\"AddLockMsg\"(\"Id\":\"u256\",\"hashlock\":\"u256\",\"timelock\":\"u256\")\"u256\"(\"low\":\"u128\",\"high\":\"u128\")",
);
/// @dev the selector of the u256 type.
const U256_TYPE_HASH: felt252 = selector!("\"u256\"(\"low\":\"u128\",\"high\":\"u128\")");

/// @dev Represents the data required to add a lock, used in the `addLockSig` function.
#[derive(Drop, Copy, Hash)]
struct AddLockMsg {
    /// @dev The Id of the HTLC.
    Id: u256,
    /// @dev The hashlock to be added to the HTLC.
    hashlock: u256,
    /// @dev The new timelock to be set for the HTLC.
    timelock: u256,
}
#[derive(Drop, Copy, Hash)]
pub struct StarknetDomain {
    name: felt252,
    version: felt252,
    chain_id: felt252,
    revision: felt252,
}

/// @dev used to hash AddLockMsg struct.
impl StructHashImpl of StructHash<AddLockMsg> {
    fn hash_struct(self: @AddLockMsg) -> felt252 {
        let hash_state = PoseidonTrait::new();
        hash_state
            .update_with(MESSAGE_TYPE_HASH)
            .update_with(self.Id.hash_struct())
            .update_with(self.hashlock.hash_struct())
            .update_with(self.timelock.hash_struct())
            .finalize()
    }
}
/// @dev used to hash u256 type.
impl StructHashU256 of StructHash<u256> {
    fn hash_struct(self: @u256) -> felt252 {
        let mut state = PoseidonTrait::new();
        state = state.update_with(U256_TYPE_HASH);
        state = state.update_with(*self);
        state.finalize()
    }
}

/// Required for hash computation.
/// The name and version of our protocol.
impl SNIP12MetadataImpl of SNIP12Metadata {
    fn name() -> felt252 {
        'Train'
    }
    fn version() -> felt252 {
        'v1'
    }
}

#[starknet::interface]
pub trait ITrainERC20<TContractState> {
    fn commit_hop(
        ref self: TContractState,
        Id: u256,
        hopChains: Span<felt252>,
        hopAssets: Span<felt252>,
        hopAddress: Span<felt252>,
        dstChain: felt252,
        dstAsset: felt252,
        dstAddress: ByteArray,
        srcAsset: felt252,
        srcReceiver: ContractAddress,
        timelock: u256,
        amount: u256,
        tokenContract: ContractAddress,
    ) -> u256;
    fn commit(
        ref self: TContractState,
        Id: u256,
        amount: u256,
        dstChain: felt252,
        dstAsset: felt252,
        dstAddress: ByteArray,
        srcAsset: felt252,
        srcReceiver: ContractAddress,
        timelock: u256,
        tokenContract: ContractAddress,
    ) -> u256;
    fn lock(
        ref self: TContractState,
        Id: u256,
        hashlock: u256,
        reward: u256,
        rewardTimelock: u256,
        timelock: u256,
        srcReceiver: ContractAddress,
        srcAsset: felt252,
        dstChain: felt252,
        dstAddress: ByteArray,
        dstAsset: felt252,
        amount: u256,
        tokenContract: ContractAddress,
    ) -> u256;
    fn redeem(ref self: TContractState, Id: u256, secret: u256) -> bool;
    fn refund(ref self: TContractState, Id: u256) -> bool;
    fn addLock(ref self: TContractState, Id: u256, hashlock: u256, timelock: u256) -> u256;
    fn addLockSig(
        ref self: TContractState,
        Id: u256,
        hashlock: u256,
        timelock: u256,
        signature: Array<felt252>,
    ) -> u256;
    fn getHTLCDetails(self: @TContractState, Id: u256) -> TrainERC20::HTLC;
    fn getRewardDetails(self: @TContractState, Id: u256) -> TrainERC20::Reward;
}

/// @title Pre Hashed Timelock Contracts (PHTLCs) on Starknet ERC20 tokens.
///
/// This contract provides a way to lock and keep PHTLCs for ERC20 tokens.
///
/// Protocol:
///
///  1) lock(srcReceiver, hashlock, timelock, tokenContract, amount) - a
///      sender calls this to lock a new HTLC on a given token (tokenContract)
///       for a given amount. A uint256 Id is returned
///  2) redeem(Id, secret) - once the srcReceiver knows the secret of
///      the hashlock hash they can claim the tokens with this function
///  3) refund(Id) - after timelock has expired and if the srcReceiver did not
///      redeem the tokens the sender / creator of the HTLC can get their tokens
///      back with this function.
#[starknet::contract]
mod TrainERC20 {
    use alexandria_bytes::{Bytes, BytesTrait};
    use core::num::traits::Zero;
    use core::traits::Into;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use openzeppelin::account::interface::{ISRC6Dispatcher, ISRC6DispatcherTrait};
    use starknet::storage::{Map, StoragePathEntry};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{AddLockMsg, OffchainMessageHash, SNIP12MetadataImpl, StructHashImpl};

    #[storage]
    struct Storage {
        /// @dev map from ID to HTLC
        contracts: Map<u256, HTLC>,
        /// @dev map from ID to Reward
        rewards: Map<u256, Reward>,
    }

    #[derive(Drop, Serde, starknet::Store)]
    pub struct HTLC {
        /// @dev The amount of funds locked in the HTLC.
        amount: u256,
        /// @dev The hash of the secret required for redeem.
        hashlock: u256,
        /// @dev The secret required to redeem.
        secret: u256,
        /// @dev The ERC20 token contract address.
        tokenContract: ContractAddress,
        /// @dev The timestamp after which the funds can be refunded.
        timelock: u256,
        /// @dev Indicates whether the funds were claimed (redeemed(3) or refunded(2)).
        claimed: u8,
        /// @dev The creator of the HTLC.
        sender: ContractAddress,
        /// @dev The recipient of the funds if conditions are met.
        srcReceiver: ContractAddress,
    }

    /// @dev Represents the reward details including the amount
    /// and the timelock for claiming the reward.
    #[derive(Drop, Serde, starknet::Store)]
    pub struct Reward {
        /// @dev The amount of the reward in ERC20 token to be claimed.
        amount: u256,
        /// @dev The timestamp after which the reward can be claimed
        /// (if claimed before than the reward will be sent back to the LP).
        timelock: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        TokenCommitted: TokenCommitted,
        TokenLocked: TokenLocked,
        TokenRedeemed: TokenRedeemed,
        TokenRefunded: TokenRefunded,
        TokenLockAdded: TokenLockAdded,
    }
    #[derive(Drop, starknet::Event)]
    struct TokenCommitted {
        #[key]
        Id: u256,
        hopChains: Span<felt252>,
        hopAssets: Span<felt252>,
        hopAddress: Span<felt252>,
        dstChain: felt252,
        dstAddress: ByteArray,
        dstAsset: felt252,
        #[key]
        sender: ContractAddress,
        #[key]
        srcReceiver: ContractAddress,
        srcAsset: felt252,
        amount: u256,
        timelock: u256,
        tokenContract: ContractAddress,
    }
    #[derive(Drop, starknet::Event)]
    struct TokenLocked {
        #[key]
        Id: u256,
        hashlock: u256,
        dstChain: felt252,
        dstAddress: ByteArray,
        dstAsset: felt252,
        #[key]
        sender: ContractAddress,
        #[key]
        srcReceiver: ContractAddress,
        srcAsset: felt252,
        amount: u256,
        reward: u256,
        rewardTimelock: u256,
        timelock: u256,
        tokenContract: ContractAddress,
    }
    #[derive(Drop, starknet::Event)]
    struct TokenLockAdded {
        #[key]
        Id: u256,
        hashlock: u256,
        timelock: u256,
    }
    #[derive(Drop, starknet::Event)]
    struct TokenRedeemed {
        #[key]
        Id: u256,
        redeemAddress: ContractAddress,
        secret: u256,
        hashlock: u256,
    }
    #[derive(Drop, starknet::Event)]
    struct TokenRefunded {
        #[key]
        Id: u256,
    }

    #[abi(embed_v0)]
    impl TrainERC20 of super::ITrainERC20<ContractState> {
        /// @dev Sender / Payer sets up a new pre-hash timelock contract depositing the
        /// funds and providing the reciever/srcReceiver and terms.
        /// @param srcReceiver reciever of the funds.
        /// @param timelock UNIX epoch seconds time that the lock expires at.
        ///                  Refunds can be made after this time.
        /// @return Id of the new HTLC. This is needed for subsequent calls.
        /// If there is no need in intermediate chains use commit function instead
        fn commit_hop(
            ref self: ContractState,
            Id: u256,
            hopChains: Span<felt252>,
            hopAssets: Span<felt252>,
            hopAddress: Span<felt252>,
            dstChain: felt252,
            dstAsset: felt252,
            dstAddress: ByteArray,
            srcAsset: felt252,
            srcReceiver: ContractAddress,
            timelock: u256,
            amount: u256,
            tokenContract: ContractAddress,
        ) -> u256 {
            //Check that the ID is unique
            assert!(!self.hasHTLC(Id), "Commitment Already Exists");
            assert!(self.validTimelock(timelock), "Invalid TimeLock");
            assert!(amount != 0, "Funds Can Not Be Zero");

            // transfer the token from the user into the contract
            let token: IERC20Dispatcher = IERC20Dispatcher { contract_address: tokenContract };
            assert!(token.balance_of(get_caller_address()) >= amount, "Insufficient Balance");
            assert!(
                token.allowance(get_caller_address(), get_contract_address()) >= amount,
                "Not Enough Allowence",
            );
            let transfered = token
                .transfer_from(get_caller_address(), get_contract_address(), amount);
            assert!(transfered, "transfer failed");

            //Write the PreHTLC data into the storage
            self
                .contracts
                .write(
                    Id,
                    HTLC {
                        amount: amount,
                        hashlock: 0,
                        secret: 0,
                        tokenContract: tokenContract,
                        timelock: timelock,
                        claimed: 1,
                        sender: get_caller_address(),
                        srcReceiver: srcReceiver,
                    },
                );
            self
                .emit(
                    TokenCommitted {
                        Id: Id,
                        hopChains: hopChains,
                        hopAssets: hopAssets,
                        hopAddress: hopAddress,
                        dstChain: dstChain,
                        dstAddress: dstAddress,
                        dstAsset: dstAsset,
                        sender: get_caller_address(),
                        srcReceiver: srcReceiver,
                        srcAsset: srcAsset,
                        amount: amount,
                        timelock: timelock,
                        tokenContract: tokenContract,
                    },
                );
            Id
        }

        fn commit(
            ref self: ContractState,
            Id: u256,
            amount: u256,
            dstChain: felt252,
            dstAsset: felt252,
            dstAddress: ByteArray,
            srcAsset: felt252,
            srcReceiver: ContractAddress,
            timelock: u256,
            tokenContract: ContractAddress,
        ) -> u256 {
            //Check that the ID is unique
            assert!(!self.hasHTLC(Id), "Commitment Already Exists");
            assert!(self.validTimelock(timelock), "Invalid TimeLock");
            assert!(amount != 0, "Funds Can Not Be Zero");

            // transfer the token from the user into the contract
            let token: IERC20Dispatcher = IERC20Dispatcher { contract_address: tokenContract };
            assert!(token.balance_of(get_caller_address()) >= amount, "Insufficient Balance");
            assert!(
                token.allowance(get_caller_address(), get_contract_address()) >= amount,
                "Not Enough Allowence",
            );
            let transfered = token
                .transfer_from(get_caller_address(), get_contract_address(), amount);
            assert!(transfered, "transfer failed");

            //Write the PreHTLC data into the storage
            self
                .contracts
                .write(
                    Id,
                    HTLC {
                        amount: amount,
                        hashlock: 0,
                        secret: 0,
                        tokenContract: tokenContract,
                        timelock: timelock,
                        claimed: 1,
                        sender: get_caller_address(),
                        srcReceiver: srcReceiver,
                    },
                );

            let hop_chains = array!['null'].span();
            let hop_assets = array!['null'].span();
            let hop_addresses = array!['null'].span();

            self
                .emit(
                    TokenCommitted {
                        Id: Id,
                        hopChains: hop_chains,
                        hopAssets: hop_assets,
                        hopAddress: hop_addresses,
                        dstChain: dstChain,
                        dstAddress: dstAddress,
                        dstAsset: dstAsset,
                        sender: get_caller_address(),
                        srcReceiver: srcReceiver,
                        srcAsset: srcAsset,
                        amount: amount,
                        timelock: timelock,
                        tokenContract: tokenContract,
                    },
                );
            Id
        }

        /// @dev Sender / Payer sets up a new hash time lock contract depositing the
        /// funds and providing the reciever and terms.
        /// @param srcReceiver receiver of the funds.
        /// @param hashlock A sha-256 hash hashlock.
        /// @param timelock UNIX epoch seconds time that the lock expires at.
        ///                  Refunds can be made after this time.
        /// @return Id of the new HTLC. This is needed for subsequent calls.
        fn lock(
            ref self: ContractState,
            Id: u256,
            hashlock: u256,
            reward: u256,
            rewardTimelock: u256,
            timelock: u256,
            srcReceiver: ContractAddress,
            srcAsset: felt252,
            dstChain: felt252,
            dstAddress: ByteArray,
            dstAsset: felt252,
            amount: u256,
            tokenContract: ContractAddress,
        ) -> u256 {
            assert!(self.validTimelock(timelock), "Invalid TimeLock");
            assert!(amount != 0, "Funds Can Not Be Zero");
            assert!(!self.hasHTLC(Id), "HTLC Already Exists");
            assert!(
                rewardTimelock > get_block_timestamp().into() && rewardTimelock <= timelock,
                "Invalid Reward TimeLock",
            );

            // transfer the token from the user into the contract
            let token: IERC20Dispatcher = IERC20Dispatcher { contract_address: tokenContract };
            assert!(
                token.balance_of(get_caller_address()) >= amount + reward,
                "Insufficient
                Balance",
            );
            assert!(
                token.allowance(get_caller_address(), get_contract_address()) >= amount + reward,
                "Not Enough Allowence",
            );
            let transfered = token
                .transfer_from(get_caller_address(), get_contract_address(), amount + reward);
            assert!(transfered, "transfer failed");
            //Write the HTLC data into the storage
            self
                .contracts
                .write(
                    Id,
                    HTLC {
                        amount: amount,
                        hashlock: hashlock,
                        secret: 0,
                        tokenContract: tokenContract,
                        timelock: timelock,
                        claimed: 1,
                        sender: get_caller_address(),
                        srcReceiver: srcReceiver,
                    },
                );
            //Write the Reward data into the storage, if the reward is not zero
            if reward != 0 {
                self.rewards.write(Id, Reward { amount: reward, timelock: rewardTimelock });
            }
            self
                .emit(
                    TokenLocked {
                        Id: Id,
                        hashlock: hashlock,
                        dstChain: dstChain,
                        dstAddress: dstAddress,
                        dstAsset: dstAsset,
                        sender: get_caller_address(),
                        srcReceiver: srcReceiver,
                        srcAsset: srcAsset,
                        amount: amount,
                        reward: reward,
                        rewardTimelock: rewardTimelock,
                        timelock: timelock,
                        tokenContract: tokenContract,
                    },
                );
            Id
        }

        /// @dev Called by the srcReceiver once they know the secret of the hashlock.
        /// This will transfer the locked funds to their address.
        ///
        /// @param Id of the HTLC.
        /// @param secret sha256(secret) should equal the contract hashlock.
        /// @return bool true on success
        fn redeem(ref self: ContractState, Id: u256, secret: u256) -> bool {
            assert!(self.hasHTLC(Id), "HTLC Does Not Exist");
            let htlc: HTLC = self.contracts.read(Id);
            let reward: Reward = self.rewards.read(Id);

            // calculate the hash of the secret and check if it matches the hashlock
            // check the the hashlock is set and the funds are not claimed
            let mut bytes: Bytes = BytesTrait::new(0, array![]);
            bytes.append_u256(secret);
            let hash = bytes.sha256();
            assert!(htlc.hashlock != 0, "Hashlock Is Not Set");
            assert!(htlc.claimed == 1, "Already Claimed");
            assert!(htlc.hashlock == hash, "Does Not Match the Hashlock");

            // update the secret and set the claimed to 3
            self.contracts.entry(Id).secret.write(secret);
            self.contracts.entry(Id).claimed.write(3);

            if reward.amount != 0 {
                // if redeem is called before the reward_timelock sender should get the reward back
                if reward.timelock > get_block_timestamp().into() {
                    let transfered = IERC20Dispatcher { contract_address: htlc.tokenContract }
                        .transfer(htlc.srcReceiver, htlc.amount);
                    let reward_transfered = IERC20Dispatcher {
                        contract_address: htlc.tokenContract,
                    }
                        .transfer(htlc.sender, reward.amount);
                    assert!(transfered && reward_transfered, "transfer failed");
                } // if the caller is the receiver then they should get and the amount,
                // and the reward
                else if get_caller_address() == htlc.srcReceiver {
                    let transfered = IERC20Dispatcher { contract_address: htlc.tokenContract }
                        .transfer(htlc.srcReceiver, htlc.amount + reward.amount);
                    assert!(transfered, "transfer failed");
                } else {
                    let transfered = IERC20Dispatcher { contract_address: htlc.tokenContract }
                        .transfer(htlc.srcReceiver, htlc.amount);
                    let reward_transfered = IERC20Dispatcher {
                        contract_address: htlc.tokenContract,
                    }
                        .transfer(get_caller_address(), reward.amount);
                    assert!(transfered && reward_transfered, "transfer failed");
                }
            } else {
                // send the tokens to the receiver if the reward is set to zero
                let transfered = IERC20Dispatcher { contract_address: htlc.tokenContract }
                    .transfer(htlc.srcReceiver, htlc.amount);
                assert!(transfered, "transfer failed");
            }

            self
                .emit(
                    TokenRedeemed {
                        Id: Id,
                        redeemAddress: get_caller_address(),
                        secret: secret,
                        hashlock: htlc.hashlock,
                    },
                );
            true
        }

        /// @dev Called by the sender if there was no redeem AND the timelock has
        /// expired. This will refund the contract amount.
        ///
        /// @param Id of the HTLC to refund from.
        /// @return bool true on success
        fn refund(ref self: ContractState, Id: u256) -> bool {
            assert!(self.hasHTLC(Id), "HTLC Does Not Exist");
            let htlc: HTLC = self.contracts.read(Id);
            let reward: Reward = self.rewards.read(Id);
            //check that the timelock is passed and the tokens are not claimed
            assert!(htlc.claimed == 1, "Already Claimed");
            assert!(htlc.timelock <= get_block_timestamp().into(), "Not Passed Timelock");

            // set claimed to 2 and send the tokens back to the sender
            self.contracts.entry(Id).claimed.write(2);
            if reward.amount == 0 {
                let transfered = IERC20Dispatcher { contract_address: htlc.tokenContract }
                    .transfer(htlc.sender, htlc.amount);
                assert!(transfered, "transfer failed");
            } else {
                let transfered = IERC20Dispatcher { contract_address: htlc.tokenContract }
                    .transfer(htlc.sender, htlc.amount + reward.amount);
                assert!(transfered, "transfer failed");
            }

            self.emit(TokenRefunded { Id: Id });
            true
        }

        /// @dev Called by the sender to add hashlock to the HTLC
        ///
        /// @param Id of the HTLC.
        /// @param hashlock to be added.
        /// @return Id of the locked HTLC
        fn addLock(ref self: ContractState, Id: u256, hashlock: u256, timelock: u256) -> u256 {
            assert!(self.validTimelock(timelock), "Invalid TimeLock");
            assert!(self.hasHTLC(Id), "HTLC Does Not Exist");
            let htlc: HTLC = self.contracts.read(Id);

            // check that the hashlock is not set
            // funds are not claimed
            // the caller is the sender
            assert!(htlc.claimed == 1, "Already Claimed");
            assert!(htlc.hashlock == 0, "Hashlock Already Set");
            assert!(get_caller_address() == htlc.sender, "Unauthorized Access");

            // update the hashlock and the timelock
            self.contracts.entry(Id).hashlock.write(hashlock);
            self.contracts.entry(Id).timelock.write(timelock);
            self.emit(TokenLockAdded { Id: Id, hashlock: hashlock, timelock: timelock });
            Id
        }
        fn addLockSig(
            ref self: ContractState,
            Id: u256,
            hashlock: u256,
            timelock: u256,
            signature: Array<felt252>,
        ) -> u256 {
            assert!(self.validTimelock(timelock), "Invalid TimeLock");
            assert!(self.hasHTLC(Id), "HTLC Does Not Exist");
            let sender = self.contracts.read(Id).sender;
            // construct the message from Id, hashlock, and timelock
            let message = AddLockMsg { Id: Id, hashlock: hashlock, timelock: timelock };
            // hash the message
            let message_hash = message.get_message_hash(sender);
            // and check that the message's signature is correct
            let is_valid_signature_felt = ISRC6Dispatcher { contract_address: sender }
                .is_valid_signature(message_hash, signature);
            // Check either 'VALID' or true
            let is_valid_signature = is_valid_signature_felt == starknet::VALIDATED
                || is_valid_signature_felt == 1;
            assert(is_valid_signature, 'Invalid signature');

            // check that the hashlock is not set
            // and the funds are not claimed
            assert!(self.contracts.read(Id).claimed == 1, "Already Claimed");
            assert!(self.contracts.read(Id).hashlock == 0, "Hashlock Already Set");

            // update the hashlcok and the timelock
            self.contracts.entry(Id).hashlock.write(hashlock);
            self.contracts.entry(Id).timelock.write(timelock);
            self.emit(TokenLockAdded { Id: Id, hashlock: hashlock, timelock: timelock });
            Id
        }

        /// @dev Returns the data of the HTLC with the given Id.
        /// will return the default values if HTLC with the given Id does not exist.
        fn getHTLCDetails(self: @ContractState, Id: u256) -> HTLC {
            self.contracts.read(Id)
        }
        /// @dev Returns the data of the Reward with the given Id.
        /// will return the default values if Reward with the given Id does not exist.
        fn getRewardDetails(self: @ContractState, Id: u256) -> Reward {
            self.rewards.read(Id)
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        /// @dev Check if there is a HTLC with the given Id.
        /// @param Id into HTLC mapping.
        fn hasHTLC(self: @ContractState, Id: u256) -> bool {
            let exists: bool = (!self.contracts.read(Id).sender.is_zero());
            exists
        }

        fn validTimelock(self: @ContractState, timelock: u256) -> bool {
            let isValid: bool = timelock >= (get_block_timestamp().into() + 900);
            isValid
        }
    }
}

