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

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { ReentrancyGuard } from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @title Train Protocol - Cross-Chain HTLC Bridge
/// @author Train Protocol
/// @notice Trustless cross-chain bridge using Hashed Time-Locked Contracts
/// @dev Supports native ETH (token=address(0)) and ERC20 tokens. Hashlock = sha256(secret).
contract Train is ReentrancyGuard {
  using SafeERC20 for IERC20;

  /// @notice Gas limit for ETH transfers to prevent griefing attacks
  uint256 constant GAS_STIPEND = 10_000;

  /// @notice Sentinel value representing native ETH
  address constant NATIVE_ETH = address(0);

  /// @notice Thrown when lock amount is zero
  error ZeroAmount();

  /// @notice Thrown when no lock exists for the given hashlock
  error LockNotFound();

  /// @notice Thrown when provided secret doesn't match hashlock
  error HashlockMismatch();

  /// @notice Thrown when lock is not in Pending status
  error LockNotPending();

  /// @notice Thrown when timelock delta is zero
  error InvalidTimelock();

  /// @notice Thrown when rewardTimelockDelta >= timelockDelta
  error InvalidRewardTimelock();

  /// @notice Thrown when user lock already exists for hashlock
  error SwapAlreadyExists();

  /// @notice Thrown when ETH transfer fails
  error TransferFailed();

  /// @notice Thrown when msg.value doesn't match expected ETH amount
  error MsgValueMismatch();

  /// @notice Thrown when refund is attempted before allowed
  error RefundNotAllowed();

  /// @notice Thrown when token address has no code
  error InvalidToken();

  /// @notice Thrown when quote has expired
  error QuoteExpired();

  /// @notice Lock lifecycle states
  enum LockStatus {
    Empty,
    Pending,
    Refunded,
    Redeemed
  }

  /// @notice User-initiated lock storage structure
  /// @dev Optimized for 5 storage slots
  struct UserLock {
    uint256 secret;
    uint256 amount;
    address sender;
    uint48 timelock;
    LockStatus status;
    address recipient;
    address token;
  }

  /// @notice Solver-initiated lock storage structure
  /// @dev Optimized for 8 storage slots
  struct SolverLock {
    uint256 secret;
    uint256 amount;
    uint256 reward;
    address sender;
    uint48 timelock;
    uint48 rewardTimelock;
    address recipient;
    LockStatus status;
    address rewardRecipient;
    address token;
    address rewardToken;
  }

  /// @notice Emitted when user creates a lock
  event UserLocked(
    bytes32 indexed hashlock,
    address indexed sender,
    address indexed recipient,
    string srcChain,
    address token,
    uint256 amount,
    uint48 timelock,
    string dstChain,
    string dstAddress,
    uint256 dstAmount,
    string dstToken,
    uint256 rewardAmount,
    string rewardToken,
    string rewardRecipient,
    uint48 rewardTimelockDelta,
    bytes data
  );

  /// @notice Emitted when solver creates a lock
  event SolverLocked(
    bytes32 indexed hashlock,
    address indexed sender,
    address indexed recipient,
    uint256 index,
    string srcChain,
    address token,
    uint256 amount,
    uint256 reward,
    address rewardToken,
    address rewardRecipient,
    uint48 timelock,
    uint48 rewardTimelock,
    string dstChain,
    string dstAddress,
    uint256 dstAmount,
    string dstToken,
    bytes data
  );

  /// @notice Emitted when user lock is refunded
  event UserRefunded(bytes32 indexed hashlock);

  /// @notice Emitted when solver lock is refunded
  event SolverRefunded(bytes32 indexed hashlock, uint256 indexed index);

  /// @notice Emitted when user lock is redeemed
  event UserRedeemed(bytes32 indexed hashlock, address redeemer, uint256 secret);

  /// @notice Emitted when solver lock is redeemed
  event SolverRedeemed(bytes32 indexed hashlock, uint256 indexed index, address redeemer, uint256 secret);

  /// @notice Cross-chain destination details (logged only, not stored)
  struct DestinationInfo {
    string dstChain;
    string dstAddress;
    uint256 dstAmount;
    string dstToken;
  }

  /// @notice Parameters for creating a user lock
  struct UserLockParams {
    bytes32 hashlock;
    uint256 amount;
    uint256 rewardAmount;
    uint48 timelockDelta;
    uint48 rewardTimelockDelta;
    uint48 quoteExpiry;
    address sender;
    address recipient;
    address token;
    string rewardToken;
    string rewardRecipient;
    string srcChain;
  }

  /// @notice Parameters for creating a solver lock
  struct SolverLockParams {
    bytes32 hashlock;
    uint256 amount;
    uint256 reward;
    uint48 timelockDelta;
    uint48 rewardTimelockDelta;
    address sender;
    address recipient;
    address rewardRecipient;
    address token;
    address rewardToken;
    string srcChain;
  }

  /// @dev hashlock => UserLock
  mapping(bytes32 => UserLock) private userLocks;

  /// @dev hashlock => index => SolverLock
  mapping(bytes32 => mapping(uint256 => SolverLock)) private solverLocks;

  /// @dev hashlock => count of solver locks
  mapping(bytes32 => uint256) private solverLockCount;

  /// @dev Historical hashlocks per user address
  mapping(address => bytes32[]) private userLockHashes;

  /// @notice Create a user lock to initiate a cross-chain swap
  /// @param params Lock parameters including hashlock, amount, addresses, and timelocks
  /// @param dst Destination chain details (logged only)
  /// @param data Arbitrary data for cross-chain coordination
  function userLock(
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata data
  ) external payable nonReentrant {
    if (params.amount == 0) revert ZeroAmount();
    if (params.timelockDelta == 0) revert InvalidTimelock();
    if (block.timestamp >= params.quoteExpiry) revert QuoteExpired();
    if (params.token != NATIVE_ETH && params.token.code.length == 0) revert InvalidToken();
    if (userLocks[params.hashlock].sender != address(0)) revert SwapAlreadyExists();

    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;

    UserLock storage lock = userLocks[params.hashlock];
    lock.sender = params.sender;
    lock.amount = params.amount;
    lock.recipient = params.recipient;
    lock.timelock = timelock;
    lock.status = LockStatus.Pending;
    lock.token = params.token;

    // Track hashlock for this user
    userLockHashes[params.sender].push(params.hashlock);

    _transferIn(params.token, params.amount);
    _emitUserLocked(params, dst, timelock, data);
  }

  /// @notice Create a solver lock to fulfill a swap
  /// @dev Reward goes to rewardRecipient if redeemed before rewardTimelock, else to redeemer
  /// @param params Lock parameters including hashlock, amount, reward, addresses, and timelocks
  /// @param dst Destination chain details (logged only)
  /// @param data Arbitrary data for cross-chain coordination
  /// @return index The index of this solver lock for the hashlock
  function solverLock(
    SolverLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata data
  ) external payable nonReentrant returns (uint256 index) {
    if (params.amount == 0) revert ZeroAmount();
    if (params.timelockDelta == 0) revert InvalidTimelock();
    if (params.token != NATIVE_ETH && params.token.code.length == 0) revert InvalidToken();
    if (params.reward > 0 && params.rewardTimelockDelta >= params.timelockDelta) revert InvalidRewardTimelock();
    if (params.reward > 0 && params.rewardToken != NATIVE_ETH && params.rewardToken.code.length == 0)
      revert InvalidToken();

    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;
    uint48 rewardTimelock = timelock - params.rewardTimelockDelta;

    index = ++solverLockCount[params.hashlock];
    SolverLock storage lock = solverLocks[params.hashlock][index];
    lock.sender = params.sender;
    lock.amount = params.amount;
    lock.recipient = params.recipient;
    lock.reward = params.reward;
    lock.rewardRecipient = params.rewardRecipient;
    lock.timelock = timelock;
    lock.rewardTimelock = rewardTimelock;
    lock.token = params.token;
    lock.status = LockStatus.Pending;
    lock.rewardToken = params.rewardToken;

    _transferInMixed(params.token, params.amount, params.rewardToken, params.reward);
    _emitSolverLocked(params, dst, index, timelock, rewardTimelock, data);
  }

  /// @notice Refund a user lock
  /// @dev Recipient can refund anytime; others only after timelock expires
  /// @param hashlock The hashlock identifying the lock
  function refundUser(bytes32 hashlock) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (msg.sender != lock.recipient && lock.timelock > block.timestamp) {
      revert RefundNotAllowed();
    }

    lock.status = LockStatus.Refunded;
    _transferOut(lock.token, payable(sender), lock.amount);
    emit UserRefunded(hashlock);
  }

  /// @notice Refund a solver lock (amount + reward returned to sender)
  /// @dev Only callable after timelock expires
  /// @param hashlock The hashlock identifying the lock
  /// @param index The index of the solver lock
  function refundSolver(bytes32 hashlock, uint256 index) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][index];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (lock.timelock > block.timestamp) revert RefundNotAllowed();

    lock.status = LockStatus.Refunded;
    _transferOutMixed(lock.token, lock.amount, payable(sender), lock.rewardToken, lock.reward, payable(sender));
    emit SolverRefunded(hashlock, index);
  }

  /// @notice Redeem a user lock with the secret preimage
  /// @param hashlock The hashlock identifying the lock
  /// @param secret The secret preimage where sha256(secret) == hashlock
  function redeemUser(bytes32 hashlock, uint256 secret) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;
    _transferOut(lock.token, payable(lock.recipient), lock.amount);
    emit UserRedeemed(hashlock, msg.sender, secret);
  }

  /// @notice Redeem a solver lock with the secret preimage
  /// @dev Amount goes to recipient. Reward goes to rewardRecipient before rewardTimelock, else to caller.
  /// @param hashlock The hashlock identifying the lock
  /// @param index The index of the solver lock
  /// @param secret The secret preimage where sha256(secret) == hashlock
  function redeemSolver(bytes32 hashlock, uint256 index, uint256 secret) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][index];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;

    address rewardTo = lock.rewardTimelock > block.timestamp ? lock.rewardRecipient : msg.sender;
    _transferOutMixed(
      lock.token,
      lock.amount,
      payable(lock.recipient),
      lock.rewardToken,
      lock.reward,
      payable(rewardTo)
    );
    emit SolverRedeemed(hashlock, index, msg.sender, secret);
  }

  /// @notice Get user lock details
  /// @param hashlock The hashlock identifying the lock
  /// @return The UserLock struct
  function getUserLock(bytes32 hashlock) external view returns (UserLock memory) {
    return userLocks[hashlock];
  }

  /// @notice Get solver lock details
  /// @param hashlock The hashlock identifying the lock
  /// @param index The index of the solver lock
  /// @return The SolverLock struct
  function getSolverLock(bytes32 hashlock, uint256 index) external view returns (SolverLock memory) {
    return solverLocks[hashlock][index];
  }

  /// @notice Get the number of solver locks for a hashlock
  /// @param hashlock The hashlock to query
  /// @return The count of solver locks
  function getSolverLockCount(bytes32 hashlock) external view returns (uint256) {
    return solverLockCount[hashlock];
  }

  /// @notice Get all hashlocks for user locks created by an address
  /// @param user The address to query
  /// @return Array of hashlocks
  function getUserLockHashes(address user) external view returns (bytes32[] memory) {
    return userLockHashes[user];
  }

  /// @notice Get all user lock details created by an address
  /// @param user The address to query
  /// @return Array of UserLock structs
  function getUserLocks(address user) external view returns (UserLock[] memory) {
    bytes32[] memory hashlocks = userLockHashes[user];
    UserLock[] memory locks = new UserLock[](hashlocks.length);
    for (uint256 i = 0; i < hashlocks.length; i++) {
      locks[i] = userLocks[hashlocks[i]];
    }
    return locks;
  }

  /// @dev Transfer ETH or ERC20 into the contract
  /// @param token Token address (NATIVE_ETH for ETH)
  /// @param amount Amount to transfer
  function _transferIn(address token, uint256 amount) internal {
    if (token == NATIVE_ETH) {
      if (msg.value != amount) revert MsgValueMismatch();
    } else {
      if (msg.value != 0) revert MsgValueMismatch();
      IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
  }

  /// @dev Transfer amount and reward tokens into the contract
  /// @param token Main token address
  /// @param amount Main amount to transfer
  /// @param rewardToken Reward token address
  /// @param reward Reward amount to transfer
  function _transferInMixed(address token, uint256 amount, address rewardToken, uint256 reward) internal {
    uint256 expectedEth;
    if (token == NATIVE_ETH) {
      expectedEth = amount;
      if (reward > 0 && rewardToken == NATIVE_ETH) {
        expectedEth += reward;
      }
    } else if (reward > 0 && rewardToken == NATIVE_ETH) {
      expectedEth = reward;
    }
    if (msg.value != expectedEth) revert MsgValueMismatch();

    if (token != NATIVE_ETH) {
      uint256 totalAmount = amount;
      if (reward > 0 && rewardToken == token) {
        totalAmount += reward;
      }
      IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
    }
    if (reward > 0 && rewardToken != NATIVE_ETH && rewardToken != token) {
      IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), reward);
    }
  }

  /// @dev Transfer ETH or ERC20 out of the contract
  /// @param token Token address (NATIVE_ETH for ETH)
  /// @param to Recipient address
  /// @param amount Amount to transfer
  function _transferOut(address token, address payable to, uint256 amount) internal {
    if (token == NATIVE_ETH) {
      (bool success, ) = to.call{ value: amount, gas: GAS_STIPEND }('');
      if (!success) revert TransferFailed();
    } else {
      IERC20(token).safeTransfer(to, amount);
    }
  }

  /// @dev Transfer amount and reward to potentially different recipients
  /// @param token Main token address
  /// @param amount Main amount to transfer
  /// @param amountTo Recipient for main amount
  /// @param rewardToken Reward token address
  /// @param reward Reward amount to transfer
  /// @param rewardTo Recipient for reward
  function _transferOutMixed(
    address token,
    uint256 amount,
    address payable amountTo,
    address rewardToken,
    uint256 reward,
    address payable rewardTo
  ) internal {
    if (reward > 0 && token == rewardToken && amountTo == rewardTo) {
      _transferOut(token, amountTo, amount + reward);
    } else {
      _transferOut(token, amountTo, amount);
      if (reward > 0) {
        _transferOut(rewardToken, rewardTo, reward);
      }
    }
  }

  /// @dev Emit UserLocked event (separated to avoid stack too deep)
  function _emitUserLocked(
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    uint48 timelock,
    bytes calldata data
  ) internal {
    emit UserLocked(
      params.hashlock,
      params.sender,
      params.recipient,
      params.srcChain,
      params.token,
      params.amount,
      timelock,
      dst.dstChain,
      dst.dstAddress,
      dst.dstAmount,
      dst.dstToken,
      params.rewardAmount,
      params.rewardToken,
      params.rewardRecipient,
      params.rewardTimelockDelta,
      data
    );
  }

  /// @dev Emit SolverLocked event (separated to avoid stack too deep)
  function _emitSolverLocked(
    SolverLockParams calldata params,
    DestinationInfo calldata dst,
    uint256 index,
    uint48 timelock,
    uint48 rewardTimelock,
    bytes calldata data
  ) internal {
    emit SolverLocked(
      params.hashlock,
      params.sender,
      params.recipient,
      index,
      params.srcChain,
      params.token,
      params.amount,
      params.reward,
      params.rewardToken,
      params.rewardRecipient,
      timelock,
      rewardTimelock,
      dst.dstChain,
      dst.dstAddress,
      dst.dstAmount,
      dst.dstToken,
      data
    );
  }
}
