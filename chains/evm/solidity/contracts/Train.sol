//                                                                                       ......
//             ....                                                                      .......
//             .....                                                                     .......
//             .....                                                                      ....
//             .....
//             .....
//             .....               ...        .......            .......                   ...        ...         .....
//       ...................      .....  .............      ..................            .....      .....  .................
//       ...................      ....................   .......................          .....      ..........................
//       ...................      ............          ............ .............        .....      ..............  ............
//             .....              ........            ........             ........       .....      ........              .......
//             .....              ......              ......                 .......      .....      .......                .......
//             .....              ......             ......                    .....      .....      ......                  ......
//             .....              .....             ......                     ......     .....      .....                    .....
//             .....              .....             .....                       .....     .....      .....                    .....
//             .....              .....             .....                       .....     .....      .....                    .....
//             .....              .....             .....                       .....     .....      .....                    .....
//             .....              .....             ......                      .....     .....      .....                    .....
//             .....              .....              ......                    ......     .....      .....                    .....
//             .....              .....              .......                 ........     .....      .....                    .....
//             .......            .....               ........              .........     .....      .....                    .....
//              .............     .....                .........         ............     .....      .....                    .....
//               .............    .....                  ...................... .....     .....      .....                    .....
//                 ...........    .....                     .................   .....     .....      .....                    .....
//                     ......      ...                           ........        ...       ...        ...                      ...

// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';
import '@openzeppelin/contracts/utils/cryptography/EIP712.sol';

/// @title Train Contract
/// @notice Implements the Train protocol, enabling secure and atomic cross-chain swaps.
/// @dev Manages HTLCs for trustless cross-chain transactions with event-based updates.

contract Train is ReentrancyGuard, EIP712 {
  using ECDSA for bytes32;

  constructor() EIP712('Train', '1') {}

  /// @dev Custom errors to simplify failure handling in the contract.
  error FundsNotSent();
  error NotPassedTimelock();
  error HTLCAlreadyExists();
  error HTLCNotExists();
  error HashlockNotMatch();
  error AlreadyClaimed();
  error NoAllowance();
  error InvalidSignature();
  error HashlockAlreadySet();
  error InvalidTimelock();
  error InvaliRewardTimelock();

  /// @dev Represents a hashed time-locked contract (HTLC) used in the Train protocol.
  struct HTLC {
    /// @notice The amount of funds locked in the HTLC.
    uint256 amount;
    /// @notice The hash of the secret required for redeem.
    bytes32 hashlock;
    /// @notice The secret required to redeem.
    uint256 secret;
    /// @notice The creator of the HTLC.
    address payable sender;
    /// @notice The recipient of the funds if conditions are met.
    address payable srcReceiver;
    /// @notice The timestamp after which the funds can be refunded.
    uint48 timelock;
    /// @notice Indicates whether the funds were claimed (redeemed(3) or refunded (2)).
    uint8 claimed;
  }

  /// @dev Represents the details required to add a lock, used as part of the `addLockSig` parameters.
  struct addLockMsg {
    /// @notice The identifier of the HTLC to which the hashlock should be added and the timelock updated.
    bytes32 Id;
    /// @notice The hashlock to be added to the HTLC.
    bytes32 hashlock;
    /// @notice The new timelock to be set for the HTLC.
    uint48 timelock;
  }

  /// @dev Represents the reward details including the amount and the timelock for claiming the reward.
  struct Reward {
    /// @notice The amount of the reward in wei to be claimed.
    uint256 amount;
    /// @notice The timelock (timestamp) after which the reward can be claimed.
    uint48 timelock;
  }

  /// @dev Emitted when an HTLC is created and funds are committed.
  /// @param Id The unique identifier of the HTLC.
  /// @param hopChains The sequence of chains forming the path from the source to the destination chain.
  /// @param hopAssets The sequence of assets being swapped along the path.
  /// @param hopAddresses The sequence of addresses involved along the path.
  /// @param dstChain The destination blockchain.
  /// @param dstAddress The recipient address on the destination chain.
  /// @param dstAsset The asset on the destination chain.
  /// @param sender The creator of the HTLC.
  /// @param srcReceiver The recipient of the funds if conditions are met.
  /// @param srcAsset The asset being locked.
  /// @param amount The amount of funds locked in the HTLC.
  /// @param timelock The timestamp after which the funds can be refunded.
  event TokenCommitted(
    bytes32 indexed Id,
    string[] hopChains,
    string[] hopAssets,
    string[] hopAddresses,
    string dstChain,
    string dstAddress,
    string dstAsset,
    address indexed sender,
    address indexed srcReceiver,
    string srcAsset,
    uint256 amount,
    uint48 timelock
  );

  /// @dev Emitted when an HTLC is locked with a hashlock and timelock.
  /// @param reward The reward amount (in wei) associated with the HTLC.
  /// @param rewardTimelock The timelock (timestamp) after which the reward can be claimed.
  event TokenLocked(
    bytes32 indexed Id,
    bytes32 hashlock,
    string dstChain,
    string dstAddress,
    string dstAsset,
    address indexed sender,
    address indexed srcReceiver,
    string srcAsset,
    uint256 amount,
    uint256 reward,
    uint48 rewardTimelock,
    uint48 timelock
  );

  /// @dev Emitted when a hashlock and timelock are added to an existing HTLC.
  event TokenLockAdded(bytes32 indexed Id, bytes32 hashlock, uint48 timelock);

  /// @dev Emitted when funds are refunded from an HTLC after the timelock expires.
  event TokenRefunded(bytes32 indexed Id);

  /// @dev Emitted when funds are redeemed from an HTLC using the correct secret.
  event TokenRedeemed(bytes32 indexed Id, address redeemAddress, uint256 secret, bytes32 hashlock);

  /// @dev Modifier to ensure HTLC exists before proceeding.
  modifier _exists(bytes32 Id) {
    if (!hasHTLC(Id)) revert HTLCNotExists();
    _;
  }

  /// @dev Modifier to ensure the provided timelock is at least 15 minutes in the future.
  modifier _validTimelock(uint48 timelock) {
    if (block.timestamp + 900 > timelock) revert InvalidTimelock();
    _;
  }

  /// @dev Storage for HTLCs
  mapping(bytes32 => HTLC) private contracts;
  /// @dev Storage for rewards on unclaimed HTLCs
  mapping(bytes32 => Reward) private rewards;

  /// @notice Creates and commits a new hashed time-locked contract (HTLC).
  /// @dev Locks funds in the contract and emits a `TokenCommitted` event.
  /// @param hopChains The sequence of chains forming the path from the source to the destination chain.
  /// @param hopAssets The sequence of assets being swapped along the path.
  /// @param hopAddresses The sequence of addresses involved along the path.
  /// @param dstChain The destination blockchain.
  /// @param dstAsset The asset on the destination chain.
  /// @param dstAddress The recipient address on the destination chain.
  /// @param srcAsset The asset being locked.
  /// @param Id The unique identifier of the created HTLC.
  /// @param srcReceiver The recipient of the funds if conditions are met.
  /// @param timelock The timestamp after which the funds can be refunded.
  /// @return bytes32 The unique identifier of the created HTLC.
  function commit(
    string[] calldata hopChains,
    string[] calldata hopAssets,
    string[] calldata hopAddresses,
    string calldata dstChain,
    string calldata dstAsset,
    string calldata dstAddress,
    string calldata srcAsset,
    bytes32 Id,
    address srcReceiver,
    uint48 timelock
  ) external payable _validTimelock(timelock) nonReentrant returns (bytes32) {
    // Ensure the generated ID does not already exist to prevent overwriting.
    if (hasHTLC(Id)) revert HTLCAlreadyExists();
    if (msg.value == 0) revert FundsNotSent(); // Ensure funds are sent.

    // Store HTLC details.
    contracts[Id] = HTLC(
      msg.value,
      bytes32(bytes1(0x01)),
      uint256(1),
      payable(msg.sender),
      payable(srcReceiver),
      timelock,
      uint8(1)
    );

    // Emit the commit event.
    emit TokenCommitted(
      Id,
      hopChains,
      hopAssets,
      hopAddresses,
      dstChain,
      dstAddress,
      dstAsset,
      msg.sender,
      srcReceiver,
      srcAsset,
      msg.value,
      timelock
    );

    return Id;
  }

  /// @notice Refunds the locked funds from an HTLC after the timelock expires.
  /// @dev Can only be called if the HTLC exists and the timelock has passed. Emits a `TokenRefunded` event.
  /// @param Id The unique identifier of the HTLC to be refunded.
  /// @return bool Returns `true` if the refund is successful.
  function refund(bytes32 Id) external _exists(Id) nonReentrant returns (bool) {
    HTLC storage htlc = contracts[Id];
    if (htlc.claimed == 2 || htlc.claimed == 3) revert AlreadyClaimed(); // Prevent refund if already redeemed or refunded.
    if (htlc.timelock > block.timestamp) revert NotPassedTimelock(); // Ensure timelock has passed.

    htlc.claimed = 2;
    if (rewards[Id].amount != 0) {
      htlc.sender.call{ value: htlc.amount + rewards[Id].amount, gas: 10000 }('');
    } else {
      htlc.sender.call{ value: htlc.amount, gas: 10000 }('');
    }
    emit TokenRefunded(Id);
    return true;
  }

  /// @notice Adds a hashlock and updates the timelock for an existing HTLC.
  /// @dev Can only be called by the HTLC's creator if the HTLC exists and has not been claimed. Emits a `TokenLockAdded` event.
  /// @param Id The unique identifier of the HTLC to update.
  /// @param hashlock The hashlock to be added.
  /// @param timelock The new timelock to be set.
  /// @return bytes32 The updated HTLC identifier.
  function addLock(
    bytes32 Id,
    bytes32 hashlock,
    uint48 timelock
  ) external _exists(Id) _validTimelock(timelock) nonReentrant returns (bytes32) {
    HTLC storage htlc = contracts[Id];
    if (htlc.claimed == 2 || htlc.claimed == 3) revert AlreadyClaimed();
    if (msg.sender == htlc.sender) {
      if (htlc.hashlock == bytes32(bytes1(0x01))) {
        htlc.hashlock = hashlock;
        htlc.timelock = timelock;
      } else {
        revert HashlockAlreadySet(); // Prevent overwriting hashlock.
      }
      emit TokenLockAdded(Id, hashlock, timelock);
      return Id;
    } else {
      revert NoAllowance(); // Ensure only allowed accounts can add a lock.
    }
  }

  /// @notice Adds a hashlock and updates the timelock for an existing HTLC using a signed message.
  /// @dev Verifies the provided signature and updates the HTLC if valid. Emits a `TokenLockAdded` event.
  /// @param message The details of the lock to be added, including the HTLC ID, hashlock, and timelock.
  /// @param r The `r` value of the ECDSA signature.
  /// @param s The `s` value of the ECDSA signature.
  /// @param v The `v` value of the ECDSA signature.
  /// @return bytes32 The updated HTLC identifier.
  function addLockSig(
    addLockMsg calldata message,
    bytes32 r,
    bytes32 s,
    uint8 v
  ) external _exists(message.Id) _validTimelock(message.timelock) nonReentrant returns (bytes32) {
    HTLC storage htlc = contracts[message.Id];
    bool verified = false;
    if (htlc.sender.code.length == 0) {
      verified = verifyMessage(message, r, s, v);
    } else {
      bytes memory signature = abi.encodePacked(r, s, v);
      bytes32 digest = keccak256(abi.encodePacked('\x19\x01', _domainSeparatorV4(), hashMessage(message)));
      verified = SignatureChecker.isValidERC1271SignatureNow(htlc.sender, digest, signature);
    }

    if (!verified) revert InvalidSignature();
    if (htlc.claimed == 2 || htlc.claimed == 3) revert AlreadyClaimed();
    if (htlc.hashlock == bytes32(bytes1(0x01))) {
      htlc.hashlock = message.hashlock;
      htlc.timelock = message.timelock;
    } else {
      revert HashlockAlreadySet();
    }
    emit TokenLockAdded(message.Id, message.hashlock, message.timelock);
    return message.Id;
  }

  /// @notice Locks funds in a new hashed time-locked contract (HTLC).
  /// @dev Creates an HTLC with the specified details and emits a `TokenLocked` event.
  /// @param Id The unique identifier for the new HTLC.
  /// @param hashlock The hash of the secret required for redeeming the HTLC.
  /// @param reward The reward amount in wei granted to the caller of redeem.
  /// @param rewardTimelock The timelock (timestamp) after which the reward can be claimed.
  /// @param timelock The timestamp after which the funds can be refunded if not claimed.
  /// @param srcReceiver The recipient of the funds if the HTLC is successfully redeemed.
  /// @param srcAsset The asset being locked in the HTLC.
  /// @param dstChain The destination blockchain for the swap.
  /// @param dstAddress The recipient address on the destination chain.
  /// @param dstAsset The asset on the destination chain.
  /// @return bytes32 The unique identifier of the created HTLC.
  function lock(
    bytes32 Id,
    bytes32 hashlock,
    uint256 reward,
    uint48 rewardTimelock,
    uint48 timelock,
    address payable srcReceiver,
    string calldata srcAsset,
    string calldata dstChain,
    string calldata dstAddress,
    string calldata dstAsset
  ) external payable nonReentrant returns (bytes32) {
    if (hasHTLC(Id)) revert HTLCAlreadyExists();
    if (msg.value <= reward || msg.value == 0) revert FundsNotSent();
    if (block.timestamp + 1800 > timelock) revert InvalidTimelock();
    if (rewardTimelock > timelock || rewardTimelock <= block.timestamp) revert InvaliRewardTimelock();
    contracts[Id] = HTLC(
      msg.value - reward,
      hashlock,
      uint256(1),
      payable(msg.sender),
      srcReceiver,
      timelock,
      uint8(1)
    );

    if (reward != 0) {
      rewards[Id] = Reward(reward, rewardTimelock);
    }

    emit TokenLocked(
      Id,
      hashlock,
      dstChain,
      dstAddress,
      dstAsset,
      msg.sender,
      srcReceiver,
      srcAsset,
      msg.value - reward,
      reward,
      rewardTimelock,
      timelock
    );
    return Id;
  }

  /// @notice Redeems funds from an HTLC using the correct secret.
  /// @dev Verifies the provided secret against the hashlock and transfers the funds to the recipient. Emits a `TokenRedeemed` event.
  /// @param Id The unique identifier of the HTLC to be redeemed.
  /// @param secret The secret value used to unlock the HTLC.
  /// @return bool Returns `true` if the redemption is successful.
  function redeem(bytes32 Id, uint256 secret) external _exists(Id) nonReentrant returns (bool) {
    HTLC storage htlc = contracts[Id];

    if (htlc.hashlock != sha256(abi.encodePacked(secret))) revert HashlockNotMatch(); // Ensure secret matches hashlock.
    if (htlc.claimed == 3 || htlc.claimed == 2) revert AlreadyClaimed();

    htlc.claimed = 3;
    htlc.secret = secret;
    Reward storage reward = rewards[Id];

    if (reward.amount == 0) {
      htlc.srcReceiver.call{ value: htlc.amount, gas: 10000 }('');
    } else if (reward.timelock > block.timestamp) {
      htlc.srcReceiver.call{ value: htlc.amount, gas: 10000 }('');
      htlc.sender.call{ value: reward.amount, gas: 10000 }('');
    } else {
      if (msg.sender == htlc.srcReceiver) {
        htlc.srcReceiver.call{ value: htlc.amount + reward.amount, gas: 10000 }('');
      } else {
        htlc.srcReceiver.call{ value: htlc.amount, gas: 10000 }('');
        msg.sender.call{ value: reward.amount, gas: 10000 }('');
      }
    }

    emit TokenRedeemed(Id, msg.sender, secret, htlc.hashlock);
    return true;
  }

  /// @notice Retrieves the details of a specific HTLC.
  /// @dev Returns the HTLC structure associated with the given identifier.
  /// @param Id The unique identifier of the HTLC.
  /// @return HTLC The details of the specified HTLC.
  function getHTLCDetails(bytes32 Id) public view returns (HTLC memory) {
    return contracts[Id];
  }

  /// @notice Fetches the reward details for a specific HTLC.
  /// @dev Returns the reward amount (in wei) and the timelock after which it can be claimed.
  /// @param Id The unique identifier of the HTLC.
  /// @return Reward A struct with the reward amount and claimable timelock.
  function getRewardDetails(bytes32 Id) public view returns (Reward memory) {
    return rewards[Id];
  }

  /// @notice Generates a hash of the `addLockMsg` structure.
  /// @dev Encodes and hashes the `addLockMsg` fields for use in EIP-712 signature verification.
  /// @param message The `addLockMsg` structure containing the HTLC details to be hashed.
  /// @return bytes32 The hashed representation of the `addLockMsg` structure.
  function hashMessage(addLockMsg calldata message) private pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          keccak256('addLockMsg(bytes32 Id,bytes32 hashlock,uint48 timelock)'),
          message.Id,
          message.hashlock,
          message.timelock
        )
      );
  }

  /// @notice Verifies that an EIP-712 message signature matches the sender of the specified HTLC.
  /// @dev Combines the domain separator and the hashed message to create the digest, then verifies the signature.
  /// @param message The `addLockMsg` structure containing the HTLC details.
  /// @param r The `r` value of the ECDSA signature.
  /// @param s The `s` value of the ECDSA signature.
  /// @param v The `v` value of the ECDSA signature.
  /// @return bool Returns `true` if the signature is valid and matches the sender of the HTLC.
  function verifyMessage(addLockMsg calldata message, bytes32 r, bytes32 s, uint8 v) private view returns (bool) {
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', _domainSeparatorV4(), hashMessage(message)));
    return (ECDSA.recover(digest, v, r, s) == contracts[message.Id].sender);
  }

  /// @notice Checks whether an HTLC with the given Id exists.
  /// @dev An HTLC exists if the sender address in its details is non-zero.
  /// @param Id The unique identifier of the HTLC to check.
  /// @return bool Returns `true` if the HTLC exists, otherwise `false`.
  function hasHTLC(bytes32 Id) private view returns (bool) {
    return (contracts[Id].sender != address(0));
  }
}
