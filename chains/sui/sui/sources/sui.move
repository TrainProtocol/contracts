module trainSui::train;

use std::bcs;
use std::hash;
use std::string::String;
use sui::coin::Coin;
use sui::dynamic_field as df;
use sui::ed25519;
use sui::event;
use sui::sui::SUI;

/// @dev The object that we will attach htlcs to.
public struct HTLCs has key, store {
  id: UID,
}

/// @dev The object that we will attach rewards to.
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
  timelock: u64,
  claimed: bool,
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

/// commit function to create a new PreHTLC
public entry fun commit(
  htlcs: &mut HTLCs,
  htlc_id: u256,
  coins: Coin<SUI>,
  timelock: u64,
  senderKey: vector<u8>,
  srcReceiver: address,
  srcAsset: String,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  ctx: &mut TxContext,
) {
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(coins.value() != 0, EFundsNotSent);

  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: vector[],
    secret: vector[],
    timelock: timelock,
    claimed: false,
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

  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
}

/// commit function to create a new PreHTLC with hop chains
public entry fun commit_hop(
  htlcs: &mut HTLCs,
  htlc_id: u256,
  hopChains: vector<String>,
  hopAssets: vector<String>,
  hopAddress: vector<String>,
  coins: Coin<SUI>,
  timelock: u64,
  senderKey: vector<u8>,
  srcReceiver: address,
  srcAsset: String,
  dstChain: String,
  dstAddress: String,
  dstAsset: String,
  ctx: &mut TxContext,
) {
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(coins.value() != 0, EFundsNotSent);

  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: vector[],
    secret: vector[],
    timelock: timelock,
    claimed: false,
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

  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
}

/// Lock function to create a new HTLC
public entry fun lock(
  htlcs: &mut HTLCs,
  htlc_id: u256,
  coins: Coin<SUI>,
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
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(coins.value() != 0, EFundsNotSent);

  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: hashlock,
    secret: vector[],
    timelock: timelock,
    claimed: false,
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

  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
}

/// Lock function to create a new HTLC and reward
public entry fun lock_with_reward(
  htlcs: &mut HTLCs,
  rewards: &mut Rewards,
  htlc_id: u256,
  coins: Coin<SUI>,
  reward_coins: Coin<SUI>,
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
  assert!(!df::exists_(&htlcs.id, htlc_id), EHTLCAlreadytExist);
  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(rewardTimelock > ctx.epoch_timestamp_ms() && rewardTimelock <= timelock, EInvalidRewardTimelock);
  assert!(coins.value() != 0, EFundsNotSent);

  let mut htlc = HTLC {
    id: object::new(ctx),
    amount: coins.value(),
    hashlock: hashlock,
    secret: vector[],
    timelock: timelock,
    claimed: false,
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
    reward: reward_coins.value(),
    timelock: timelock,
    rewardTimelock: rewardTimelock,
  });

  df::add(&mut htlc.id, HTLCObjectKey(), coins);
  df::add(&mut htlcs.id, htlc_id, htlc);
  let mut reward = Reward {
    id: object::new(ctx),
    amount: reward_coins.value(),
    timelock: rewardTimelock,
  };
  df::add(&mut reward.id, RewardObjectKey(), reward_coins);
  df::add(&mut rewards.id, htlc_id, reward);
}

public entry fun addLock(htlcs: &mut HTLCs, htlc_id: u256, hashlock: vector<u8>, timelock: u64, ctx: &mut TxContext) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);

  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(!htlc.claimed, EAlreadyClaimed);
  assert!(htlc.hashlock.is_empty(), EHashlockAlreadySet);
  assert!(htlc.sender == ctx.sender(), EUnAuthorizedAccess);

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

  assert!(timelock > ctx.epoch_timestamp_ms() + 900000, EInvalidTimelock);
  assert!(!htlc.claimed, EAlreadyClaimed);
  assert!(htlc.hashlock.is_empty(), EHashlockAlreadySet);
  assert!(sender_public_key.length() == 32, EInvalidKeyLen);

  let mut concatened: vector<u8> = vector::singleton(0);
  concatened.append(sender_public_key);
  let sender_address: address = sui::address::from_bytes(sui::hash::blake2b256(&concatened));
  assert!(htlc.sender == sender_address, EUnAuthorizedAccess);

  let msg = AddLockMsg {
    id: htlc_id,
    hashlock: hashlock,
    timelock: timelock,
  };
  let mut intent_msg = vector[3u8, 0u8, 0u8];
  vector::append(&mut intent_msg, bcs::to_bytes(&msg));
  let msg_hash = hash::sha2_256(intent_msg);

  assert!(ed25519::ed25519_verify(&signature, &sender_public_key, &msg_hash), EInvalidSignature);

  htlc.hashlock = hashlock;
  htlc.timelock = timelock;
  event::emit(TokenLockAdded {
    id: htlc_id,
    hashlock: hashlock,
    timelock: timelock,
  });
}

public entry fun redeem(htlcs: &mut HTLCs, htlc_id: u256, secret: vector<u8>, ctx: &TxContext) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);

  assert!(!htlc.claimed, EAlreadyClaimed);
  assert!(hash::sha2_256(secret) == htlc.hashlock, EHashlockNoMatch);

  let locked_coins: Coin<SUI> = df::remove(&mut htlc.id, HTLCObjectKey());
  event::emit(TokenRedeemed {
    id: htlc_id,
    redeemAddress: ctx.sender(),
    secret: secret,
    hashlock: htlc.hashlock,
  });

  htlc.claimed = true;
  htlc.secret = secret;
  transfer::public_transfer(locked_coins, htlc.srcReceiver);
}

public entry fun redeem_with_reward(
  htlcs: &mut HTLCs,
  rewards: &mut Rewards,
  htlc_id: u256,
  secret: vector<u8>,
  ctx: &TxContext,
) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  assert!(df::exists_(&rewards.id, htlc_id), ERewardNotExist);
  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);
  let reward: &mut Reward = df::borrow_mut(&mut rewards.id, htlc_id);

  assert!(!htlc.claimed, EAlreadyClaimed);
  assert!(hash::sha2_256(secret) == htlc.hashlock, EHashlockNoMatch);

  let locked_coins: Coin<SUI> = df::remove(&mut htlc.id, HTLCObjectKey());
  let reward_coins: Coin<SUI> = df::remove(&mut reward.id, RewardObjectKey());
  event::emit(TokenRedeemed {
    id: htlc_id,
    redeemAddress: ctx.sender(),
    secret: secret,
    hashlock: htlc.hashlock,
  });

  htlc.claimed = true;
  htlc.secret = secret;

  if (reward.timelock > ctx.epoch_timestamp_ms()) {
    transfer::public_transfer(locked_coins, htlc.srcReceiver);
    transfer::public_transfer(reward_coins, htlc.sender);
  } else {
    if (ctx.sender() == htlc.srcReceiver) {
      transfer::public_transfer(locked_coins, htlc.srcReceiver);
      transfer::public_transfer(reward_coins, htlc.srcReceiver);
    } else {
      transfer::public_transfer(locked_coins, htlc.srcReceiver);
      transfer::public_transfer(reward_coins, ctx.sender());
    }
  };
}

public entry fun refund(htlcs: &mut HTLCs, htlc_id: u256, ctx: &TxContext) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);

  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);
  assert!(!htlc.claimed, EAlreadyClaimed);
  assert!(htlc.timelock <= ctx.epoch_timestamp_ms(), ENotPassedTimelock);

  htlc.claimed = true;

  let locked_coins: Coin<SUI> = df::remove(&mut htlc.id, HTLCObjectKey());
  event::emit(TokenRefunded { id: htlc_id });

  transfer::public_transfer(locked_coins, htlc.sender);
}

public entry fun refund_with_reward(htlcs: &mut HTLCs, rewards: &mut Rewards, htlc_id: u256, ctx: &TxContext) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);

  let htlc: &mut HTLC = df::borrow_mut(&mut htlcs.id, htlc_id);
  let reward: &mut Reward = df::borrow_mut(&mut rewards.id, htlc_id);
  assert!(!htlc.claimed, EAlreadyClaimed);
  assert!(htlc.timelock <= ctx.epoch_timestamp_ms(), ENotPassedTimelock);

  htlc.claimed = true;

  let locked_coins: Coin<SUI> = df::remove(&mut htlc.id, HTLCObjectKey());
  let reward_coins: Coin<SUI> = df::remove(&mut reward.id, RewardObjectKey());
  event::emit(TokenRefunded { id: htlc_id });

  if (df::exists_(&rewards.id, htlc_id)) {};
  transfer::public_transfer(locked_coins, htlc.sender);
  transfer::public_transfer(reward_coins, htlc.sender);
}

/// @dev Returns the data of the HTLC with the given Id.
public fun getDetails(
  htlcs: &HTLCs,
  htlc_id: u256,
): (u64, vector<u8>, vector<u8>, u64, bool, address, vector<u8>, address) {
  assert!(df::exists_(&htlcs.id, htlc_id), EHTLCNotExist);
  let htlc: &HTLC = df::borrow(&htlcs.id, htlc_id);
  (htlc.amount, htlc.hashlock, htlc.secret, htlc.timelock, htlc.claimed, htlc.sender, htlc.senderKey, htlc.srcReceiver)
}

/// @dev Returns the data of the Reward with the given Id.
public fun getRewardDetails(rewards: &Rewards, htlc_id: u256): (u64, u64) {
  assert!(df::exists_(&rewards.id, htlc_id), EHTLCNotExist);
  let reward: &Reward = df::borrow(&rewards.id, htlc_id);
  (reward.amount, reward.timelock)
}
