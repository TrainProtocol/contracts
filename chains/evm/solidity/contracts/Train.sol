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
  /// @dev Gas stipend for external calls to prevent griefing attacks
  uint256 constant GAS_STIPEND = 10_000;

  constructor() {}

  /// @dev Custom errors to simplify failure handling in the contract.
  error FundsNotSent();
  error NotPassedTimelock();
  error HTLCNotExists();
  error HashlockNotMatch();
  error AlreadyClaimed();
  error InvalidTimelock();
  error InvalidRewardTimelock();
  error SwapAlreadyInitialized();
  error InvalidRewardAmount();
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
  event SrcLocked(
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
  event DstLocked(
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

  /// @notice Locks funds in a new HTLC initiated by a user on the source chain.
  /// @dev Creates an HTLC at htlcId 0 for a new swap. Users can only initialize a swap once. Emits a `SrcLocked` event.
  /// @param swapId The identifier for the swap.
  /// @param hashlock The hash of the secret required for redeeming the HTLC.
  /// @param timelock The timestamp after which the funds can be refunded if not claimed.
  /// @param srcReceiver The recipient of the funds if the HTLC is successfully redeemed.
  /// @param srcAsset The asset being locked in the HTLC.
  /// @param dstChain The destination blockchain for the swap.
  /// @param dstAddress The recipient address on the destination chain.
  /// @param dstAsset The asset on the destination chain.
  /// @return (bytes32, uint256) Returns the swapId and htlcId (always 0 for users).
  function lockSrc(
    bytes32 swapId,
    bytes32 hashlock,
    uint48 timelock,
    address payable srcReceiver,
    string calldata srcAsset,
    string calldata dstChain,
    string calldata dstAddress,
    string calldata dstAsset
  ) external payable nonReentrant returns (bytes32, uint256) {
    if (msg.value == 0) revert FundsNotSent();
    if (block.timestamp + 1800 > timelock) revert InvalidTimelock();

    // User can only initialize a swap once and always maps to slot 0
    if (contracts[swapId][0].sender != address(0)) revert SwapAlreadyInitialized();

    userSwaps[msg.sender].push(swapId);

    contracts[swapId][0] = HTLC(
      msg.value,
      hashlock,
      uint256(1),
      payable(msg.sender),
      srcReceiver,
      timelock,
      uint8(1),
      0, // no reward for user HTLCs
      0 // no reward timelock
    );

    emit SrcLocked(
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

    return (swapId, 0);
  }

  /// @notice Locks funds in a new HTLC created by a solver on the destination chain.
  /// @dev Enforces the solver reward to be at least 10% of the swap amount using
  ///      multiplication (reward * 10 >= amount) to avoid integer-division rounding.
  ///      Overflow safety is guaranteed by Solidity 0.8+, and the check is performed
  ///      inside an `unchecked` block for a minor gas optimization. Multiple solver
  ///      HTLCs can be created per swapId; htlcId is 0 for first lock, otherwise the
  ///      next free index. Emits `DstLocked` on success.
  /// @param swapId The identifier for the swap (can have multiple solver HTLCs).
  /// @param hashlock The hash of the secret required for redeeming the HTLC.
  /// @param reward The reward amount in wei granted to the caller of redeem.
  /// @param rewardTimelock The timelock (timestamp) after which the reward can be claimed by anyone.
  /// @param timelock The timestamp after which the funds can be refunded if not claimed.
  /// @param srcReceiver The recipient of the funds if the HTLC is successfully redeemed.
  /// @param srcAsset The asset being locked in the HTLC.
  /// @param dstChain The destination blockchain for the swap.
  /// @param dstAddress The recipient address on the destination chain.
  /// @param dstAsset The asset on the destination chain.
  /// @return (bytes32, uint256) Returns the swapId and the unique htlcId of the created HTLC.
  function lockDst(
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
    if (msg.value == 0) revert FundsNotSent();

    uint256 amount = msg.value - reward;
    // Reject trivial invalid inputs; enforce reward >= 10% of amount
    if (amount == 0 || reward == 0) revert InvalidRewardAmount();
    // Multiplication form avoids division rounding: reward * 10 >= amount
    unchecked {
      if (reward * 10 < amount) revert InvalidRewardAmount();
    }

    if (block.timestamp + 900 > timelock) revert InvalidTimelock();
    if (rewardTimelock > timelock || rewardTimelock <= block.timestamp) revert InvalidRewardTimelock();

    uint256 htlcId;
    bool isNewSwap = (contracts[swapId][0].sender == address(0));

    if (isNewSwap) {
      htlcId = 0; // solver is first to open the swap so they occupy slot 0
    } else {
      htlcId = 1;
      while (contracts[swapId][htlcId].sender != address(0)) {
        unchecked {
          htlcId++; // find next free slot for additional solver HTLCs
        }
      }
    }

    contracts[swapId][htlcId] = HTLC(
      amount,
      hashlock,
      uint256(1),
      payable(msg.sender),
      srcReceiver,
      timelock,
      uint8(1),
      reward,
      rewardTimelock
    );

    emit DstLocked(
      swapId,
      htlcId,
      hashlock,
      dstChain,
      dstAddress,
      dstAsset,
      msg.sender,
      srcReceiver,
      srcAsset,
      amount,
      reward,
      rewardTimelock,
      timelock
    );

    return (swapId, htlcId);
  }

  /// @notice Refunds the locked funds from an HTLC after the timelock expires.
  /// @dev Can only be called if the HTLC exists and the timelock has passed. Emits a `TokenRefunded` event.
  /// @param swapId The swap identifier.
  /// @param htlcId The unique identifier of the HTLC to be refunded.
  /// @return bool Returns `true` if the refund is successful.
  function refund(bytes32 swapId, uint256 htlcId) external _exists(swapId, htlcId) nonReentrant returns (bool) {
    HTLC storage htlc = contracts[swapId][htlcId];
    if (htlc.claimed != 1) revert AlreadyClaimed();
    if (htlc.timelock > block.timestamp) revert NotPassedTimelock();

    htlc.claimed = 2;
    bool success;
    if (htlc.reward != 0) {
      (success, ) = htlc.sender.call{ value: htlc.amount + htlc.reward, gas: GAS_STIPEND }('');
    } else {
      (success, ) = htlc.sender.call{ value: htlc.amount, gas: GAS_STIPEND }('');
    }
    if (!success) revert TransferFailed();
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
    if (htlc.claimed != 1) revert AlreadyClaimed();

    htlc.claimed = 3;
    htlc.secret = secret;

    bool success;
    if (htlc.reward == 0) {
      (success, ) = htlc.srcReceiver.call{ value: htlc.amount, gas: GAS_STIPEND }('');
      if (!success) revert TransferFailed();
    } else if (htlc.rewardTimelock > block.timestamp) {
      (success, ) = htlc.srcReceiver.call{ value: htlc.amount, gas: GAS_STIPEND }('');
      if (!success) revert TransferFailed();
      (success, ) = htlc.sender.call{ value: htlc.reward, gas: GAS_STIPEND }('');
      if (!success) revert TransferFailed();
    } else {
      if (msg.sender == htlc.srcReceiver) {
        (success, ) = htlc.srcReceiver.call{ value: htlc.amount + htlc.reward, gas: GAS_STIPEND }('');
        if (!success) revert TransferFailed();
      } else {
        (success, ) = htlc.srcReceiver.call{ value: htlc.amount, gas: GAS_STIPEND }('');
        if (!success) revert TransferFailed();
        (success, ) = msg.sender.call{ value: htlc.reward, gas: GAS_STIPEND }('');
        if (!success) revert TransferFailed();
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
  /// @dev Returns swapIds where the user called lockSrc to initialize the swap.
  /// @param user The user address.
  /// @return bytes32[] Array of swap IDs created by the user.
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
