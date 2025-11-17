//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

module trainCoin::train;

use std::bcs;
use std::hash;
use std::string::String;
use std::type_name::{get, TypeName};
use sui::coin::Coin;
use sui::dynamic_field as df;
use sui::ed25519;
use sui::event;

/// @dev The object that we will attach HTLCS to.
public struct HTLCs has key, store {
  id: UID,
}
/// @dev The object that we will attach Rewards to.
public struct Rewards has key, store {
  id: UID,
}
/// @dev Represents the data required to add a lock, used in the `addLockSig` function.
public struct AddLockMsg has copy, drop { id: u256, hashlock: vector<u8>, timelock: u64 }

/// @dev The `name` of DFs that holds the coins.
public struct HTLCObjectKey() has copy, drop, store;

public struct RewardObjectKey() has copy, drop, store;

public struct HTLC has key, store {
  id: UID,
  amount: u64,
  hashlock: vector<u8>,
  secret: vector<u8>,
  tokenContract: TypeName,
  timelock: u64,
  claimed: u8,
  sender: address,
  senderKey: vector<u8>,
  srcReceiver: address,
}

public struct Reward has key, store { id: UID, amount: u64, timelock: u64 }

#[error]
const EFundsNotSent: vector<u8> = b"Funds Can Not Be Zero";
#[error]
const ENotPassedTimelock: vector<u8> = b"Not Passed TimeLock";
#[error]
const EHTLCNotExist: vector<u8> = b"HTLC Does Not Exist";
#[error]
const ERewardNotExist: vector<u8> = b"Reward Does Not Exist";
#[error]
const EHTLCAlreadytExist: vector<u8> = b"HTLC Already Exists";
#[error]
const EHashlockNoMatch: vector<u8> = b"Does Not Match the Hashlock";
#[error]
const EAlreadyClaimed: vector<u8> = b"Funds Are Alredy Claimed";
#[error]
const EHashlockAlreadySet: vector<u8> = b"Hashlock Already Set";
#[error]
const EInvalidTimelock: vector<u8> = b"Invalid TimeLock";
#[error]
const EInvalidRewardTimelock: vector<u8> = b"Invalid Reward TimeLock";
#[error]
const EUnAuthorizedAccess: vector<u8> = b"Unauthorized Access";
#[error]
const EInvalidSignature: vector<u8> = b"Invalid Signature";
#[error]
const EInvalidKeyLen: vector<u8> = b"Invalid Public Key Length";

/// Events
public struct TokenCommitted has copy, drop {
  id: u256,
  hopChains: vector<String>,
  hopAssets: vector<String>,
  hopAddress: vector<String>,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  sender: address,
  srcReceiver: address,
  srcAsset: String,
  amount: u64,
  timelock: u64,
}

public struct TokenLocked has copy, drop {
  id: u256,
  hashlock: vector<u8>,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  sender: address,
  srcReceiver: address,
  srcAsset: String,
  amount: u64,
  reward: u64,
  timelock: u64,
  rewardTimelock: u64,
}

public struct TokenLockAdded has copy, drop {
  id: u256,
  hashlock: vector<u8>,
  timelock: u64,
}

public struct TokenRedeemed has copy, drop {
  id: u256,
  redeemAddress: address,
  secret: vector<u8>,
  hashlock: vector<u8>,
}

public struct TokenRefunded has copy, drop {
  id: u256,
}

// Called only once, upon module publication. It must be
// private to prevent external invocation.
fun init(ctx: &mut TxContext) {
  transfer::share_object(HTLCs {
    id: object::new(ctx),
  });
  transfer::share_object(Rewards {
    id: object::new(ctx),
  });
}

/// @dev Sender / Payer sets up a new pre-hash timelock contract depositing the
/// funds and providing the reciever/srcReceiver and terms.
/// @param srcReceiver reciever of the funds.
/// @param timelock UNIX epoch seconds time that the lock expires at.
///                  Refunds can be made after this time.
/// @return Id of the new HTLC. This is needed for subsequent calls.
/// If there is need in intermediate chains use commit_hop function instead
public entry fun commit<CoinType>(
  htlcs: &mut HTLCs,
  htlc_id: u256,
  coins: Coin<CoinType>,
  timelock: u64,
  senderKey: vector<u8>,
  srcReceiver: address,
  srcAsset: String,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  ctx: &mut TxContext,
) {
  //Check that the ID is unique
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(coins.value() != 0, EFundsNotSent);

  //Write the PreHTLC data into the storage
  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: vector[],
    secret: vector[],
    tokenContract: get<CoinType>(),
    timelock: timelock,
    claimed: 1,
    sender: ctx.sender(),
    senderKey: senderKey,
    srcReceiver: srcReceiver,
  };
  let empty: vector<String> = vector[];
  event::emit(TokenCommitted {
    id: htlc_id,
    hopChains: empty,
    hopAssets: empty,
    hopAddress: empty,
    dstChain: dstChain,
    dstAddress: dstAddress,
    dstAsset: dstAsset,
    sender: ctx.sender(),
    srcReceiver: srcReceiver,
    srcAsset: srcAsset,
    amount: coins.value(),
    timelock: timelock,
  });
  // transfer the token from the user into the HTLC object
  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
}

/// commit function to create a new PreHTLC with hop chains
public entry fun commit_hop<CoinType>(
  htlcs: &mut HTLCs,
  htlc_id: u256,
  hopChains: vector<String>,
  hopAssets: vector<String>,
  hopAddress: vector<String>,
  coins: Coin<CoinType>,
  timelock: u64,
  senderKey: vector<u8>,
  srcReceiver: address,
  srcAsset: String,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  ctx: &mut TxContext,
) {
  //Check that the ID is unique
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(coins.value() != 0, EFundsNotSent);
  //Write the PreHTLC data into the storage
  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: vector[],
    secret: vector[],
    tokenContract: get<CoinType>(),
    timelock: timelock,
    claimed: 1,
    sender: ctx.sender(),
    senderKey: senderKey,
    srcReceiver: srcReceiver,
  };
  event::emit(TokenCommitted {
    id: htlc_id,
    hopChains: hopChains,
    hopAssets: hopAssets,
    hopAddress: hopAddress,
    dstChain: dstChain,
    dstAddress: dstAddress,
    dstAsset: dstAsset,
    sender: ctx.sender(),
    srcReceiver: srcReceiver,
    srcAsset: srcAsset,
    amount: coins.value(),
    timelock: timelock,
  });
  // transfer the token from the user into the HTLC object
  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
}

/// @dev Sender / Payer sets up a new hash time lock contract depositing the
/// funds and providing the reciever and terms.
/// @param srcReceiver receiver of the funds.
/// @param hashlock A sha-256 hash hashlock.
/// @param timelock UNIX epoch seconds time that the lock expires at.
///                  Refunds can be made after this time.
/// @return Id of the new HTLC. This is needed for subsequent calls.
/// If there is need to lock reward coins too, use the lockWithReward instead
public entry fun lock<CoinType>(
  htlcs: &mut HTLCs,
  htlc_id: u256,
  coins: Coin<CoinType>,
  hashlock: vector<u8>,
  timelock: u64,
  senderKey: vector<u8>,
  srcReceiver: address,
  srcAsset: String,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  ctx: &mut TxContext,
) {
  //Check that the ID is unique
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 1800000, EInvalidTimelock);
  assert!(coins.value() != 0, EFundsNotSent);
  //Write the HTLC data into the storage
  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: hashlock,
    secret: vector[],
    tokenContract: get<CoinType>(),
    timelock: timelock,
    claimed: 1,
    sender: ctx.sender(),
    senderKey: senderKey,
    srcReceiver: srcReceiver,
  };

  event::emit(TokenLocked {
    id: htlc_id,
    hashlock: hashlock,
    dstChain: dstChain,
    dstAddress: dstAddress,
    dstAsset: dstAsset,
    sender: ctx.sender(),
    srcReceiver: srcReceiver,
    srcAsset: srcAsset,
    amount: coins.value(),
    reward: 0,
    timelock: timelock,
    rewardTimelock: 0,
  });
  // transfer the token from the user into the HTC object
  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
}

/// Lock function to create a new HTLC with reward
public entry fun lockWithReward<CoinType>(
  htlcs: &mut HTLCs,
  rewards: &mut Rewards,
  htlc_id: u256,
  coins: Coin<CoinType>,
  reward_coins: Coin<CoinType>,
  hashlock: vector<u8>,
  timelock: u64,
  rewardTimelock: u64,
  senderKey: vector<u8>,
  srcReceiver: address,
  srcAsset: String,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  ctx: &mut TxContext,
) {
  //Check that the ID is unique
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 1800000, EInvalidTimelock);
  assert!(rewardTimelock > ctx.epoch_timestamp_ms() && rewardTimelock <= timelock, EInvalidRewardTimelock);
  assert!(coins.value() != 0, EFundsNotSent);
  //Write the HTLC and the Reward data into the storage
  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: hashlock,
    secret: vector[],
    tokenContract: get<CoinType>(),
    timelock: timelock,
    claimed: 1,
    sender: ctx.sender(),
    senderKey: senderKey,
    srcReceiver: srcReceiver,
  };
  let mut reward = Reward {
    id: object::new(ctx),
    amount: reward_coins.value(),
    timelock: rewardTimelock,
  };

  event::emit(TokenLocked {
    id: htlc_id,
    hashlock: hashlock,
    dstChain: dstChain,
    dstAddress: dstAddress,
    dstAsset: dstAsset,
    sender: ctx.sender(),
    srcReceiver: srcReceiver,
    srcAsset: srcAsset,
    amount: coins.value(),
    reward: reward_coins.value(),
    timelock: timelock,
    rewardTimelock: rewardTimelock,
  });
  // transfer the tokens from the user into the HTLC and Reward objects
  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
  df::add(&mut reward.id, RewardObjectKey(), reward_coins);
  df::add(&mut rewards.id, htlc_id, reward);
}

/// @dev Called by the sender to add hashlock to the HTLC
///
/// @param Id of the HTLC.
/// @param hashlock to be added.
/// @return Id of the locked HTLC
public entry fun addLock(htlcs: &mut HTLCs, htlc_id: u256, hashlock: vector<u8>, timelock: u64, ctx: &mut TxContext) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);

  // check that the hashlock is not set
  // funds are not claimed
  // the caller is the sender
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(htlc.claimed==1, EAlreadyClaimed);
  assert!(htlc.hashlock.is_empty(), EHashlockAlreadySet);
  assert!(htlc.sender == ctx.sender(), EUnAuthorizedAccess);

  // update the hashlock and the timelock
  htlc.hashlock = hashlock;
  htlc.timelock = timelock;

  event::emit(TokenLockAdded {
    id: htlc_id,
    hashlock: hashlock,
    timelock: timelock,
  });
}

public entry fun addLockSig(
  htlcs: &mut HTLCs,
  htlc_id: u256,
  hashlock: vector<u8>,
  timelock: u64,
  signature: vector<u8>,
  ctx: &mut TxContext,
) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);
  let sender_public_key = htlc.senderKey;

  // check that the hashlock is not set
  // funds are not claimed
  // the senderKey is the htlc.senders public key
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(htlc.claimed==1, EAlreadyClaimed);
  assert!(htlc.hashlock.is_empty(), EHashlockAlreadySet);
  assert!(sender_public_key.length() == 32, EInvalidKeyLen);

  let mut concatened: vector<u8> = vector::singleton(0);
  concatened.append(sender_public_key);
  let sender_address: address = sui::address::from_bytes(sui::hash::blake2b256(&concatened));
  assert!(htlc.sender == sender_address, EUnAuthorizedAccess);

  // construct and hash the message
  let msg = AddLockMsg {
    id: htlc_id,
    hashlock: hashlock,
    timelock: timelock,
  };
  let mut intent_msg = vector[3u8, 0u8, 0u8];
  vector::append(&mut intent_msg, bcs::to_bytes(&msg));
  let msg_hash = hash::sha2_256(intent_msg);
  // and check that the message's signature is correct
  assert!(ed25519::ed25519_verify(&signature, &sender_public_key, &msg_hash), EInvalidSignature);

  // update the hashlock and the timelock
  htlc.hashlock = hashlock;
  htlc.timelock = timelock;

  event::emit(TokenLockAdded {
    id: htlc_id,
    hashlock: hashlock,
    timelock: timelock,
  });
}

/// @dev Called by the srcReceiver once they know the secret of the hashlock.
/// This will transfer the locked funds to their address.
///
/// @param Id of the HTLC.
/// @param secret sha256(secret) should equal the contract hashlock.
/// @return bool true on success
/// If there are also locked reward coins use the redeemWithReward instead
public entry fun redeem<CoinType>(htlcs: &mut HTLCs, htlc_id: u256, secret: vector<u8>, ctx: &mut TxContext) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);

  assert!(htlc.claimed==1, EAlreadyClaimed);
  assert!(hash::sha2_256(secret) == htlc.hashlock, EHashlockNoMatch);

  // remove the coins from the HTLC object and transfer them
  let locked_coins: Coin<CoinType> = df::remove(&mut htlc.id, HTLCObjectKey());
  event::emit(TokenRedeemed {
    id: htlc_id,
    redeemAddress: ctx.sender(),
    secret: secret,
    hashlock: htlc.hashlock,
  });

  // set claimed to 3 and update the secret
  htlc.claimed = 3;
  htlc.secret = secret;
  transfer::public_transfer(locked_coins, htlc.srcReceiver);
}

public entry fun redeemWithReward<CoinType>(
  htlcs: &mut HTLCs,
  rewards: &mut Rewards,
  htlc_id: u256,
  secret: vector<u8>,
  ctx: &mut TxContext,
) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  assert!(df::exists_(&rewards.id, htlc_id), ERewardNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);
  let reward: &mut Reward = df::borrow_mut(&mut rewards.id, htlc_id);

  assert!(htlc.claimed==1, EAlreadyClaimed);
  assert!(hash::sha2_256(secret) == htlc.hashlock, EHashlockNoMatch);

  // remove the coins from the HTLC and Reward objects and transfer them
  let locked_coins: Coin<CoinType> = df::remove(&mut htlc.id, HTLCObjectKey());
  let reward_coins: Coin<CoinType> = df::remove(&mut reward.id, RewardObjectKey());
  event::emit(TokenRedeemed {
    id: htlc_id,
    redeemAddress: ctx.sender(),
    secret: secret,
    hashlock: htlc.hashlock,
  });

  // set claimed to 3 and update the secret
  htlc.claimed = 3;
  htlc.secret = secret;

  if (reward.timelock > ctx.epoch_timestamp_ms()) {
    // if redeem is called before the reward_timelock sender should get the reward back
    transfer::public_transfer(locked_coins, htlc.srcReceiver);
    transfer::public_transfer(reward_coins, htlc.sender);
  } else {
    if (ctx.sender() == htlc.srcReceiver) {
      // if the caller is the receiver then they should get
      //and the amount, and the reward
      transfer::public_transfer(locked_coins, htlc.srcReceiver);
      transfer::public_transfer(reward_coins, htlc.srcReceiver);
    } else {
      transfer::public_transfer(locked_coins, htlc.srcReceiver);
      transfer::public_transfer(reward_coins, ctx.sender());
    }
  };
}

/// @dev Called by the sender if there was no redeem AND the timelock has
/// expired. This will refund the contract amount.
///
/// @param Id of the HTLC to refund from.
/// @return bool true on success
/// If there are also locked reward coins use the refundWithReward instead
public entry fun refund<CoinType>(htlcs: &mut HTLCs, htlc_id: u256, ctx: &mut TxContext) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);

  //check that the timelock is passed and the tokens are not claimed
  assert!(htlc.claimed==1, EAlreadyClaimed);
  assert!(htlc.timelock <= ctx.epoch_timestamp_ms(), ENotPassedTimelock);

  // set claimed to 2 and send the tokens back to the sender
  htlc.claimed = 2;

  let locked_coins: Coin<CoinType> = df::remove(&mut htlc.id, HTLCObjectKey());
  event::emit(TokenRefunded { id: htlc_id });

  transfer::public_transfer(locked_coins, htlc.sender);
}

public entry fun refundWithReward<CoinType>(
  htlcs: &mut HTLCs,
  rewards: &mut Rewards,
  htlc_id: u256,
  ctx: &mut TxContext,
) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);

  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);
  let reward: &mut Reward = df::borrow_mut(&mut rewards.id, htlc_id);
  assert!(htlc.claimed==1, EAlreadyClaimed);
  assert!(htlc.timelock <= ctx.epoch_timestamp_ms(), ENotPassedTimelock);

  htlc.claimed = 2;

  let locked_coins: Coin<CoinType> = df::remove(&mut htlc.id, HTLCObjectKey());
  let reward_coins: Coin<CoinType> = df::remove(&mut reward.id, RewardObjectKey());
  event::emit(TokenRefunded { id: htlc_id });

  if (df::exists_(&rewards.id, htlc_id)) {};
  transfer::public_transfer(locked_coins, htlc.sender);
  transfer::public_transfer(reward_coins, htlc.sender);
}

/// @dev Returns the data of the HTLC with the given Id.
public fun getDetails(
  htlcs: &HTLCs,
  htlc_id: u256,
): (u64, vector<u8>, vector<u8>, TypeName, u64, u8, address, vector<u8>, address) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &HTLC = df::borrow(&htlcs.id, htlc_id);
  (
    htlc.amount,
    htlc.hashlock,
    htlc.secret,
    htlc.tokenContract,
    htlc.timelock,
    htlc.claimed,
    htlc.sender,
    htlc.senderKey,
    htlc.srcReceiver,
  )
}

/// @dev Returns the data of the Reward with the given Id.
public fun getRewardDetails(rewards: &Rewards, htlc_id: u256): (u64, u64) {
  assert!(df::exists_(&rewards.id, htlc_id), EHTLCNotExist);
  let reward: &Reward = df::borrow(&rewards.id, htlc_id);
  (reward.amount, reward.timelock)
}
