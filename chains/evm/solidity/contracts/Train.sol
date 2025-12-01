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
pragma solidity 0.8.30;
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @title Train Contract
/// @notice Implements the Train protocol, enabling secure and atomic cross-chain swaps.
/// @dev Manages HTLCs for trustless cross-chain transactions with event-based updates.

contract Train is ReentrancyGuard {
  constructor() {}

  /// @dev Custom errors to simplify failure handling in the contract.
  error FundsNotSent();
  error NotPassedTimelock();
  error HTLCNotExists();
  error HashlockNotMatch();
  error AlreadyClaimed();
  error InvalidTimelock();
  error InvaliRewardData();
  error SwapAlreadyInitialized();
  error SwapNotInitialized();
  error InvalidSwapOwner();
  error TransferFailed();

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
    /// @notice The reward amount in wei.
    uint256 reward;
    /// @notice The timelock (timestamp) after which the reward can be claimed.
    uint48 rewardTimelock;
  }

  /// @dev Emitted when an HTLC is locked by a user (no reward).
  event UserLocked(
    bytes32 indexed swapId,
    bytes32 hashlock,
    string dstChain,
    string dstAddress,
    string dstAsset,
    address indexed sender,
    address srcReceiver,
    string srcAsset,
    uint256 amount,
    uint48 timelock
  );

  /// @dev Emitted when an HTLC is locked by a solver (with reward).
  event SolverLocked(
    bytes32 indexed swapId,
    uint256 indexed htlcId,
    bytes32 hashlock,
    string dstChain,
    string dstAddress,
    string dstAsset,
    address indexed sender,
    address srcReceiver,
    string srcAsset,
    uint256 amount,
    uint256 reward,
    uint48 rewardTimelock,
    uint48 timelock
  );

  /// @dev Emitted when funds are refunded from an HTLC after the timelock expires.
  event TokenRefunded(bytes32 indexed swapId, uint256 indexed htlcId);

  /// @dev Emitted when funds are redeemed from an HTLC using the correct secret.
  event TokenRedeemed(
    bytes32 indexed swapId,
    uint256 indexed htlcId,
    address redeemAddress,
    uint256 secret,
    bytes32 hashlock
  );

  /// @dev Modifier to ensure HTLC exists before proceeding.
  modifier _exists(bytes32 swapId, uint256 htlcId) {
    if (!hasHTLC(swapId, htlcId)) revert HTLCNotExists();
    _;
  }

  /// @dev Storage for HTLCs - mapping from swapId to htlcId to HTLC
  mapping(bytes32 => mapping(uint256 => HTLC)) private contracts;
  /// @dev Storage for tracking historical swaps per user
  mapping(address => bytes32[]) private userSwaps;

  /// @notice Locks funds in a new hashed time-locked contract (HTLC).
  /// @dev Creates an HTLC with the specified details and emits a `TokenLocked` event. The htlcId is automatically generated.
  /// @param swapId The identifier for the swap (can have multiple HTLCs).
  /// @param hashlock The hash of the secret required for redeeming the HTLC.
  /// @param reward The reward amount in wei granted to the caller of redeem.
  /// @param rewardTimelock The timelock (timestamp) after which the reward can be claimed.
  /// @param timelock The timestamp after which the funds can be refunded if not claimed.
  /// @param srcReceiver The recipient of the funds if the HTLC is successfully redeemed.
  /// @param srcAsset The asset being locked in the HTLC.
  /// @param dstChain The destination blockchain for the swap.
  /// @param dstAddress The recipient address on the destination chain.
  /// @param dstAsset The asset on the destination chain.
  /// @return uint256 The unique identifier of the created HTLC.
  function lock(
    bytes32 swapId,
    bytes32 hashlock,
    uint256 reward,
    uint48 rewardTimelock,
    uint48 timelock,
    address payable srcReceiver,
    string calldata srcAsset,
    string calldata dstChain,
    string calldata dstAddress,
    string calldata dstAsset
  ) external payable nonReentrant returns (bytes32, uint256) {
    if (msg.value <= reward || msg.value == 0) revert FundsNotSent();
    if (block.timestamp + 900 > timelock) revert InvalidTimelock();
    bool isSolver = reward > 0;
    if (isSolver) {
      if (rewardTimelock > timelock || rewardTimelock <= block.timestamp) revert InvaliRewardData();
    }

    HTLC storage meta = contracts[swapId][0];

    bool isNewSwap = (meta.sender == address(0));
    uint256 htlcId = 0;

    if (isNewSwap && !isSolver) {
      userSwaps[msg.sender].push(swapId);
    }

    if (!isNewSwap && !isSolver) {
      revert SwapAlreadyInitialized();
    } else if (!isNewSwap && isSolver) {
      htlcId = 1;
      while (contracts[swapId][htlcId].sender != address(0)) {
        unchecked {
          htlcId++;
        }
      }
    }

    contracts[swapId][htlcId] = HTLC(
      msg.value - reward,
      hashlock,
      uint256(1),
      payable(msg.sender),
      srcReceiver,
      timelock,
      uint8(1),
      reward,
      rewardTimelock
    );

    // Emit different events based on whether this is a user or solver HTLC
    if (reward == 0) {
      emit UserLocked(
        swapId,
        hashlock,
        dstChain,
        dstAddress,
        dstAsset,
        msg.sender,
        srcReceiver,
        srcAsset,
        msg.value,
        timelock
      );
    } else {
      emit SolverLocked(
        swapId,
        htlcId,
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
    }
    return (swapId, htlcId);
  }

  /// @notice Refunds the locked funds from an HTLC after the timelock expires.
  /// @dev Can only be called if the HTLC exists and the timelock has passed. Emits a `TokenRefunded` event.
  /// @param swapId The swap identifier.
  /// @param htlcId The unique identifier of the HTLC to be refunded.
  /// @return bool Returns `true` if the refund is successful.
  function refund(bytes32 swapId, uint256 htlcId) external _exists(swapId, htlcId) nonReentrant returns (bool) {
    HTLC storage htlc = contracts[swapId][htlcId];
    if (htlc.claimed == 2 || htlc.claimed == 3) revert AlreadyClaimed();
    if (htlc.timelock > block.timestamp) revert NotPassedTimelock();

    htlc.claimed = 2;
    if (htlc.reward != 0) {
      htlc.sender.call{ value: htlc.amount + htlc.reward, gas: 10000 }('');
    } else {
      htlc.sender.call{ value: htlc.amount, gas: 10000 }('');
    }
    emit TokenRefunded(swapId, htlcId);
    return true;
  }

  /// @notice Redeems funds from an HTLC using the correct secret.
  /// @dev Verifies the provided secret against the hashlock and transfers the funds to the recipient. Emits a `TokenRedeemed` event.
  /// @param swapId The swap identifier.
  /// @param htlcId The unique identifier of the HTLC to be redeemed.
  /// @param secret The secret value used to unlock the HTLC.
  /// @return bool Returns `true` if the redemption is successful.
  function redeem(
    bytes32 swapId,
    uint256 htlcId,
    uint256 secret
  ) external _exists(swapId, htlcId) nonReentrant returns (bool) {
    HTLC storage htlc = contracts[swapId][htlcId];

    if (htlc.hashlock != sha256(abi.encodePacked(secret))) revert HashlockNotMatch();
    if (htlc.claimed == 3 || htlc.claimed == 2) revert AlreadyClaimed();

    htlc.claimed = 3;
    htlc.secret = secret;

    if (htlc.reward == 0) {
      htlc.srcReceiver.call{ value: htlc.amount, gas: 10000 }('');
    } else if (htlc.rewardTimelock > block.timestamp) {
      htlc.srcReceiver.call{ value: htlc.amount, gas: 10000 }('');
      htlc.sender.call{ value: htlc.reward, gas: 10000 }('');
    } else {
      if (msg.sender == htlc.srcReceiver) {
        htlc.srcReceiver.call{ value: htlc.amount + htlc.reward, gas: 10000 }('');
      } else {
        htlc.srcReceiver.call{ value: htlc.amount, gas: 10000 }('');
        msg.sender.call{ value: htlc.reward, gas: 10000 }('');
      }
    }

    emit TokenRedeemed(swapId, htlcId, msg.sender, secret, htlc.hashlock);
    return true;
  }

  /// @notice Retrieves the details of a specific HTLC.
  /// @dev Returns the HTLC structure associated with the given identifiers.
  /// @param swapId The swap identifier.
  /// @param htlcId The unique identifier of the HTLC.
  /// @return HTLC The details of the specified HTLC.
  function getHTLCDetails(bytes32 swapId, uint256 htlcId) public view returns (HTLC memory) {
    return contracts[swapId][htlcId];
  }

  /// @notice Retrieves all swaps created by a user.
  /// @dev Returns swapIds where the address initialized the swap (reward == 0 path).
  /// @param user The user address.
  /// @return bytes32[] Array of swap IDs owned by the user.
  function getUserSwaps(address user) public view returns (bytes32[] memory) {
    return userSwaps[user];
  }

  /// @notice Checks whether an HTLC with the given IDs exists.
  /// @dev An HTLC exists if the sender address in its details is non-zero.
  /// @param swapId The swap identifier.
  /// @param htlcId The unique identifier of the HTLC to check.
  /// @return bool Returns `true` if the HTLC exists, otherwise `false`.
  function hasHTLC(bytes32 swapId, uint256 htlcId) private view returns (bool) {
    address sender = contracts[swapId][htlcId].sender;
    return sender != address(0);
  }
}
