//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@


contract;
use std::{
    asset::*,
    auth::*,
    b512::*,
    block::*,
    bytes::Bytes,
    bytes_conversions::{
        b256::*,
        u256::*,
        u64::*,
    },
    call_frames::*,
    codec::encode,
    context::*,
    contract_id::*,
    crypto::message::*,
    crypto::secp256k1::*,
    crypto::signature::*,
    crypto::signature_error::*,
    hash::*,
    storage::storage_vec::*,
    string::String,
};
use sway_libs::reentrancy::reentrancy_guard;
// Interface defining HTLC functions
abi Train {
    #[payable]
    #[storage(read, write)]
    fn commit(
        hopChains: [str[64]; 5],
        hopAssets: [str[64]; 5],
        hopAddresses: [str[64]; 5],
        dstChain: str[64],
        dstAsset: str[64],
        dstAddress: str[64],
        srcAsset: str[64],
        Id: u256,
        srcReceiver: Address,
        timelock: u64,
    ) -> u256;
    #[storage(read, write)]
    fn refund(Id: u256) -> bool;
    #[storage(read, write)]
    fn add_lock(Id: u256, hashlock: b256, timelock: u64) -> u256;
    #[storage(read, write)]
    fn add_lock_sig(signature: B512, Id: u256, hashlock: b256, timelock: u64) -> u256;
    #[payable]
    #[storage(read, write)]
    fn lock(
        Id: u256,
        hashlock: b256,
        reward: u64,
        rewardTimelock: u64,
        timelock: u64,
        srcReceiver: Address,
        srcAsset: str[64],
        dstChain: str[64],
        dstAddress: str[64],
        dstAsset: str[64],
    ) -> u256;
    #[storage(read, write)]
    fn redeem(Id: u256, secret: u256) -> bool;
    #[storage(read)]
    fn get_htlc_details(Id: u256) -> Option<HTLC>;
    #[storage(read)]
    fn get_reward_details(Id: u256) -> Option<Reward>;
}
/// Emitted when an HTLC is created and funds are committed.
pub struct TokenCommitted {
    hopChains: [str[64]; 5],
    hopAssets: [str[64]; 5],
    hopAddresses: [str[64]; 5],
    Id: u256,
    dstChain: str[64],
    dstAsset: str[64],
    dstAddress: str[64],
    sender: Address,
    srcReceiver: Address,
    srcAsset: str[64],
    amount: u64,
    timelock: u64,
    assetId: AssetId,
}
/// Emitted when an HTLC is locked with a hashlock and timelock.
pub struct TokenLocked {
    Id: u256,
    hashlock: b256,
    dstChain: str[64],
    dstAddress: str[64],
    dstAsset: str[64],
    sender: Address,
    srcReceiver: Address,
    srcAsset: str[64],
    amount: u64,
    reward: u64,
    rewardTimelock: u64,
    timelock: u64,
    assetId: AssetId,
}
/// Emitted when a hashlock and timelock are added to an existing HTLC.
pub struct TokenLockAdded {
    Id: u256,
    hashlock: b256,
    timelock: u64,
}
/// Emitted when funds are refunded from an HTLC after the timelock expires.
pub struct TokenRefuned {
    Id: u256,
}
/// Emitted when funds are redeemed from an HTLC using the correct secret.
pub struct TokenRedeemed {
    Id: u256,
    redeemAddress: Identity,
    secret: u256,
    hashlock: b256,
}
/// Represents a hashed time-locked contract (HTLC) used in the Train protocol.
pub struct HTLC {
    amount: u64,
    hashlock: b256,
    secret: u256,
    sender: Address,
    srcReceiver: Address,
    timelock: u64,
    assetId: AssetId,
    claimed: u8,
}
/// Reward struct for incentivizing early redeemers
pub struct Reward {
    amount: u64,
    timelock: u64,
}
/// Storage for HTLCs and rewards
storage {
    contracts: StorageMap<u256, HTLC> = StorageMap::<u256, HTLC> {},
    rewards: StorageMap<u256, Reward> = StorageMap::<u256, Reward> {},
}
// message prefix '\x19Fuel Signed Message:\n32'
const MESSAGE_PREFIX: [u8; 24] = [
    25, 70, 117, 101, 108, 32, 83, 105, 103, 110, 101, 100, 32, 77, 101, 115, 115,
    97, 103, 101, 58, 10, 51, 50,
];
// Check if an HTLC exists
#[storage(read)]
fn has_htlc(Id: u256) -> bool {
    match storage.contracts.get(Id).try_read() {
        Some(_) => true,
        None => false,
    }
}
// Check if a reward exists
#[storage(read)]
fn has_reward(Id: u256) -> bool {
    match storage.rewards.get(Id).try_read() {
        Some(_) => true,
        None => false,
    }
}
// Implementation of the PreHTLC functions
impl Train for Contract {
    /// Creates and commits a new hashed time-locked contract (HTLC).
    /// Locks funds in the contract and emits a `TokenCommitted` event.
    #[payable]
    #[storage(read, write)]
    fn commit(
        hopChains: [str[64]; 5],
        hopAssets: [str[64]; 5],
        hopAddresses: [str[64]; 5],
        dstChain: str[64],
        dstAsset: str[64],
        dstAddress: str[64],
        srcAsset: str[64],
        Id: u256,
        srcReceiver: Address,
        timelock: u64,
    ) -> u256 {
        reentrancy_guard();
        require(msg_amount() > 0, "Funds Not Sent");
        require(timelock > timestamp() + 900, "Not Future Timelock");
        require(!has_htlc(Id), "Contract Already Exists");
        let htlc = HTLC {
            sender: msg_sender().unwrap().as_address().unwrap(),
            srcReceiver: srcReceiver,
            hashlock: b256::from(1),
            timelock: timelock,
            amount: msg_amount(),
            secret: 1,
            assetId: msg_asset_id(),
            claimed: 1,
        };
        let result = storage.contracts.try_insert(Id, htlc);
        assert(result.is_ok());
        log(TokenCommitted {
            hopChains,
            hopAssets,
            hopAddresses,
            Id,
            dstChain,
            dstAsset,
            dstAddress,
            sender: msg_sender().unwrap().as_address().unwrap(),
            srcReceiver,
            srcAsset,
            amount: msg_amount(),
            timelock,
            assetId: msg_asset_id(),
        });
        Id
    }
    /// Refunds the locked funds from an HTLC after the timelock expires.
    /// Can only be called if the HTLC exists and the timelock has passed. Emits a `TokenRefunded` event.
    #[storage(read, write)]
    fn refund(Id: u256) -> bool {
        reentrancy_guard();
        require(has_htlc(Id), "Contract Does Not Exist");
        let mut htlc: HTLC = storage.contracts.get(Id).try_read().unwrap();
        require(htlc.claimed == 1, "Already Claimed");
        require(htlc.timelock < timestamp(), "Not Passed Timelock");
        htlc.claimed = 2;
        storage.contracts.insert(Id, htlc);
        if has_reward(Id) {
            let reward: Reward = storage.rewards.get(Id).try_read().unwrap();
            transfer(
                Identity::Address(htlc.sender),
                htlc.assetId,
                htlc.amount + reward
                    .amount,
            );
        } else {
            transfer(Identity::Address(htlc.sender), htlc.assetId, htlc.amount);
        }
        log(TokenRefuned { Id });
        true
    }
    /// Adds a hashlock and updates the timelock for an existing HTLC.
    /// Can only be called by the HTLC's creator if the HTLC exists and has not been claimed. Emits a `TokenLockAdded` event.
    #[storage(read, write)]
    fn add_lock(Id: u256, hashlock: b256, timelock: u64) -> u256 {
        reentrancy_guard();
        require(has_htlc(Id), "Contract Does Not Exist");
        require(timelock > timestamp() + 900, "Not Future Timelock");
        let mut htlc: HTLC = storage.contracts.get(Id).try_read().unwrap();
        require(
            msg_sender()
                .unwrap()
                .as_address()
                .unwrap() == htlc.sender,
            "No Allowance",
        );
        require(htlc.claimed == 1, "Already Claimed");
        require(htlc.hashlock == b256::from(1), "Hashlock Already Set");
        htlc.hashlock = hashlock;
        htlc.timelock = timelock;
        storage.contracts.insert(Id, htlc);
        log(TokenLockAdded {
            Id,
            hashlock,
            timelock,
        });
        Id
    }
    ///  Adds a hashlock and updates the timelock for an existing HTLC using a signed message.
    ///  Verifies the provided signature and updates the HTLC if valid. Emits a `TokenLockAdded` event.
    #[storage(read, write)]
    fn add_lock_sig(signature: B512, Id: u256, hashlock: b256, timelock: u64) -> u256 {
        reentrancy_guard();
        require(has_htlc(Id), "Contract Does Not Exist");
        require(timelock > timestamp() + 900, "Not Future Timelock");
        let mut htlc: HTLC = storage.contracts.get(Id).try_read().unwrap();
        let message_hash: b256 = sha256(
            {
                let mut bytes = Bytes::new();
                bytes
                    .append(Bytes::from(encode(Id)));
                bytes
                    .append(Bytes::from(encode(hashlock)));
                bytes
                    .append(Bytes::from(encode(timelock)));
                bytes
            },
        );
        let signed_messsage_hash: b256 = sha256(
            {
                let mut bytes = Bytes::new();
                let mut vec = Vec::new();
                let mut i: u64 = 0;
                while i < 24 {
                    vec.push(MESSAGE_PREFIX[i]);
                    i = i + 1;
                }
                //                 bytes
                //                     .append(Bytes::from(encode("Fuel Signed Message:
                // 32")));
                bytes
                    .append(Bytes::from(vec));
                log(bytes);
                bytes
                    .append(Bytes::from(encode(message_hash)));
                log(bytes);
                bytes
            },
        );
        log(signed_messsage_hash);
        let (r, s): (b256, b256) = <(b256, b256) as From<B512>>::from(signature);
        let sig = Signature::Secp256k1(Secp256k1::from((r, s)));
        let msg = Message::from(Bytes::from(signed_messsage_hash));
        log(msg.bytes());
        let addr = Address::from(htlc.sender);
        require(sig.verify_address(addr, msg).is_ok(), "Invalid Signature");
        require(htlc.claimed == 1, "Already Claimed");
        require(htlc.hashlock == b256::from(1), "Hashlock Already Set");
        htlc.hashlock = hashlock;
        htlc.timelock = timelock;
        storage.contracts.insert(Id, htlc);
        log(TokenLockAdded {
            Id,
            hashlock,
            timelock,
        });
        Id
    }
    /// Locks funds in a new hashed time-locked contract (HTLC).
    /// Creates an HTLC with the specified details and emits a `TokenLocked` event.
    #[payable]
    #[storage(read, write)]
    fn lock(
        Id: u256,
        hashlock: b256,
        reward: u64,
        rewardTimelock: u64,
        timelock: u64,
        srcReceiver: Address,
        srcAsset: str[64],
        dstChain: str[64],
        dstAddress: str[64],
        dstAsset: str[64],
    ) -> u256 {
        reentrancy_guard();
        require(!has_htlc(Id), "Contract Already Exists");
        require(msg_amount() > reward, "Funds Not Sent");
        require(timelock > timestamp() + 1800, "Not Future Timelock");
        require(
            rewardTimelock < timelock && rewardTimelock > timestamp(),
            "Invalid Reward Timelock",
        );
        let htlc = HTLC {
            sender: msg_sender().unwrap().as_address().unwrap(),
            srcReceiver,
            hashlock,
            timelock,
            amount: msg_amount() - reward,
            secret: 1,
            assetId: msg_asset_id(),
            claimed: 1,
        };
        let result = storage.contracts.try_insert(Id, htlc);
        assert(result.is_ok());
        if reward != 0 {
            let reward_data = Reward {
                amount: reward,
                timelock: rewardTimelock,
            };
            let reward_result = storage.rewards.try_insert(Id, reward_data);
            assert(reward_result.is_ok());
        }
        log(TokenLocked {
            Id,
            hashlock,
            dstChain,
            dstAddress,
            dstAsset,
            sender: msg_sender().unwrap().as_address().unwrap(),
            srcReceiver,
            srcAsset,
            amount: msg_amount() - reward,
            reward,
            rewardTimelock,
            timelock,
            assetId: msg_asset_id(),
        });
        Id
    }
    /// Redeems funds from an HTLC using the correct secret.
    /// Verifies the provided secret against the hashlock and transfers the funds to the recipient. Emits a `TokenRedeemed` event.
    #[storage(read, write)]
    fn redeem(Id: u256, secret: u256) -> bool {
        reentrancy_guard();
        require(has_htlc(Id), "Contract Does Not Exist");
        let mut htlc: HTLC = storage.contracts.get(Id).try_read().unwrap();
        require(htlc.hashlock == sha256(secret), "Hashlock Not Match");
        require(htlc.claimed == 1, "Already Claimed");
        htlc.secret = secret;
        htlc.claimed = 3;
        storage.contracts.insert(Id, htlc);
        if has_reward(Id) {
            let reward: Reward = storage.rewards.get(Id).try_read().unwrap();
            // Check if reward timelock has passed and distribute funds accordingly
            if reward.timelock < timestamp() {
                transfer(
                    Identity::Address(htlc.srcReceiver),
                    htlc.assetId,
                    htlc.amount,
                );
                transfer(Identity::Address(htlc.sender), htlc.assetId, reward.amount);
            } else {
                let sender = match msg_sender().unwrap() {
                    Identity::Address(addr) => addr,
                    _ => {
                        require(false, "Not an Address");
                        Address::from(0x0000000000000000000000000000000000000000000000000000000000000000)
                    }
                };
                if htlc.srcReceiver == sender {
                    transfer(
                        Identity::Address(htlc.srcReceiver),
                        htlc.assetId,
                        reward
                            .amount + htlc.amount,
                    );
                } else {
                    transfer(Identity::Address(sender), htlc.assetId, reward.amount);
                    transfer(
                        Identity::Address(htlc.srcReceiver),
                        htlc.assetId,
                        htlc.amount,
                    );
                }
            }
        } else {
            transfer(
                Identity::Address(htlc.srcReceiver),
                htlc.assetId,
                htlc.amount,
            );
        }
        log(TokenRedeemed {
            Id,
            redeemAddress: msg_sender().unwrap(),
            secret,
            hashlock: htlc.hashlock,
        });
        true
    }
    /// Retrieves the details of a specific HTLC.
    /// Returns the HTLC structure associated with the given identifier.
    #[storage(read)]
    fn get_htlc_details(Id: u256) -> Option<HTLC> {
        match storage.contracts.get(Id).try_read() {
            Some(htlc) => Some(htlc),
            None => {
                log("Contract Does Not Exist");
                None
            }
        }
    }
    /// Retrieves the reward details for a specific HTLC.
    /// Returns the reward amount and the timelock after which it can be claimed.
    #[storage(read)]
    fn get_reward_details(Id: u256) -> Option<Reward> {
        match storage.rewards.get(Id).try_read() {
            Some(reward) => Some(reward),
            None => {
                log("Reward Does Not Exist");
                None
            }
        }
    }
}
