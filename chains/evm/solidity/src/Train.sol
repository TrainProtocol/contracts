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
import { IPayoutCurve } from './IPayoutCurve.sol';

/// @title Train Protocol - Cross-Chain HTLC Bridge
/// @author Train Protocol
/// @notice Trustless cross-chain bridge using Hashed Time-Locked Contracts
/// @dev Supports native ETH (token=address(0)) and ERC20 tokens. Hashlock = sha256(secret).
///      Supports optional external payout curves via staticcall for time-based decay.
///      Handles fee-on-transfer tokens by measuring actual received amounts.
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

  /// @notice Thrown when payout curve address has no code
  error InvalidPayoutCurve();

  /// @notice Thrown when payout curve staticcall fails or returns invalid bounds (0 < payout <= amount)
  error InvalidPayout();

  /// @notice Lock lifecycle states
  enum LockStatus {
    Empty,
    Pending,
    Refunded,
    Redeemed
  }

  /// @notice User-initiated lock storage structure
  struct UserLock {
    uint256 secret;
    uint256 amount;
    address sender;
    uint48 timelock;
    uint48 startTime;
    LockStatus status;
    address recipient;
    address refundTo;
    address token;
    address payoutCurve;
    bytes payoutCurveData;
  }

  /// @notice Solver-initiated lock storage structure
  struct SolverLock {
    uint256 secret;
    uint256 amount;
    uint256 reward;
    address sender;
    uint48 timelock;
    uint48 rewardTimelock;
    uint48 startTime;
    address recipient;
    LockStatus status;
    address rewardRecipient;
    address refundTo;
    address token;
    address rewardToken;
    address payoutCurve;
    bytes payoutCurveData;
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
    uint48 quoteExpiry,
    bytes userData,
    bytes solverData
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
    address recipient;
    address refundTo;
    address token;
    address payoutCurve;
    bytes payoutCurveData;
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
    address recipient;
    address rewardRecipient;
    address refundTo;
    address token;
    address rewardToken;
    address payoutCurve;
    bytes payoutCurveData;
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
  function userLock(
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata userData,
    bytes calldata solverData
  ) external payable nonReentrant {
    if (params.amount == 0) revert ZeroAmount();
    if (params.timelockDelta == 0) revert InvalidTimelock();
    if (block.timestamp >= params.quoteExpiry) revert QuoteExpired();
    if (params.token != NATIVE_ETH && params.token.code.length == 0) revert InvalidToken();
    if (userLocks[params.hashlock].sender != address(0)) revert SwapAlreadyExists();
    if (params.payoutCurve != address(0)) _validatePayoutCurve(params.payoutCurve);

    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;

    uint256 actualAmount = _transferIn(params.token, params.amount);

    UserLock storage lock = userLocks[params.hashlock];
    lock.sender = msg.sender;
    lock.amount = actualAmount;
    lock.recipient = params.recipient;
    lock.refundTo = params.refundTo;
    lock.timelock = timelock;
    lock.startTime = uint48(block.timestamp);
    lock.status = LockStatus.Pending;
    lock.token = params.token;
    lock.payoutCurve = params.payoutCurve;
    if (params.payoutCurveData.length > 0) lock.payoutCurveData = params.payoutCurveData;

    userLockHashes[msg.sender].push(params.hashlock);

    _emitUserLocked(params, dst, timelock, userData, solverData);
  }

  /// @notice Create a solver lock to fulfill a swap
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
    if (params.payoutCurve != address(0)) _validatePayoutCurve(params.payoutCurve);

    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;
    uint48 rewardTimelock = uint48(block.timestamp) + params.rewardTimelockDelta;

    (uint256 actualAmount, uint256 actualReward) = _transferInMixed(
      params.token,
      params.amount,
      params.rewardToken,
      params.reward
    );

    index = ++solverLockCount[params.hashlock];
    SolverLock storage lock = solverLocks[params.hashlock][index];
    lock.sender = msg.sender;
    lock.amount = actualAmount;
    lock.recipient = params.recipient;
    lock.refundTo = params.refundTo;
    lock.reward = actualReward;
    lock.rewardRecipient = params.rewardRecipient;
    lock.timelock = timelock;
    lock.rewardTimelock = rewardTimelock;
    lock.startTime = uint48(block.timestamp);
    lock.token = params.token;
    lock.status = LockStatus.Pending;
    lock.rewardToken = params.rewardToken;
    lock.payoutCurve = params.payoutCurve;
    if (params.payoutCurveData.length > 0) lock.payoutCurveData = params.payoutCurveData;

    _emitSolverLocked(params, dst, index, timelock, rewardTimelock, data);
  }

  /// @notice Refund a user lock
  /// @dev Recipient can refund anytime; others only after timelock expires. Full amount, no decay.
  function refundUser(bytes32 hashlock) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (msg.sender != lock.recipient && lock.timelock > block.timestamp) {
      revert RefundNotAllowed();
    }

    lock.status = LockStatus.Refunded;
    _transferOut(lock.token, payable(lock.refundTo), lock.amount);
    emit UserRefunded(hashlock);
  }

  /// @notice Refund a solver lock (full amount + reward returned to sender, no decay)
  function refundSolver(bytes32 hashlock, uint256 index) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][index];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (lock.timelock > block.timestamp) revert RefundNotAllowed();

    lock.status = LockStatus.Refunded;
    _transferOutMixed(lock.token, lock.amount, payable(lock.refundTo), lock.rewardToken, lock.reward, payable(lock.refundTo));
    emit SolverRefunded(hashlock, index);
  }

  /// @notice Redeem a user lock with the secret preimage
  /// @dev If a payout curve is set, payout is computed via staticcall; excess returns to sender.
  function redeemUser(bytes32 hashlock, uint256 secret) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;

    uint256 payout = lock.amount;
    if (lock.payoutCurve != address(0)) {
      payout = _computePayout(lock.payoutCurve, lock.amount, lock.startTime, lock.payoutCurveData);
    }

    _transferOut(lock.token, payable(lock.recipient), payout);
    uint256 excess = lock.amount - payout;
    if (excess > 0) _transferOut(lock.token, payable(lock.refundTo), excess);

    emit UserRedeemed(hashlock, msg.sender, secret);
  }

  /// @notice Redeem a solver lock with the secret preimage
  /// @dev Payout curve applies to main amount only. Reward unaffected by decay.
  function redeemSolver(bytes32 hashlock, uint256 index, uint256 secret) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][index];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;

    uint256 payout = lock.amount;
    if (lock.payoutCurve != address(0)) {
      payout = _computePayout(lock.payoutCurve, lock.amount, lock.startTime, lock.payoutCurveData);
    }

    address rewardTo = lock.rewardTimelock > block.timestamp ? lock.rewardRecipient : msg.sender;

    _transferOut(lock.token, payable(lock.recipient), payout);
    uint256 excess = lock.amount - payout;
    if (excess > 0) _transferOut(lock.token, payable(lock.refundTo), excess);
    if (lock.reward > 0) _transferOut(lock.rewardToken, payable(rewardTo), lock.reward);

    emit SolverRedeemed(hashlock, index, msg.sender, secret);
  }

  /// @notice Get user lock details
  function getUserLock(bytes32 hashlock) external view returns (UserLock memory) {
    return userLocks[hashlock];
  }

  /// @notice Get solver lock details
  function getSolverLock(bytes32 hashlock, uint256 index) external view returns (SolverLock memory) {
    return solverLocks[hashlock][index];
  }

  /// @notice Get the number of solver locks for a hashlock
  function getSolverLockCount(bytes32 hashlock) external view returns (uint256) {
    return solverLockCount[hashlock];
  }

  /// @notice Get all hashlocks for user locks created by an address with optional filtering and pagination
  function getUserLockHashes(
    address user,
    LockStatus status,
    uint256 offset,
    uint256 limit
  ) external view returns (bytes32[] memory hashlocks, uint256 total) {
    bytes32[] memory allHashes = userLockHashes[user];

    if (limit == 0) {
      return (new bytes32[](0), 0);
    }

    uint256 matchCount = 0;
    for (uint256 i = 0; i < allHashes.length; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        matchCount++;
      }
    }

    if (offset >= matchCount) {
      return (new bytes32[](0), matchCount);
    }

    uint256 end = offset + limit;
    if (end > matchCount) {
      end = matchCount;
    }
    uint256 size = end - offset;

    bytes32[] memory result = new bytes32[](size);
    uint256 resultIndex = 0;
    uint256 currentIndex = 0;

    for (uint256 i = 0; i < allHashes.length && resultIndex < size; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        if (currentIndex >= offset) {
          result[resultIndex] = allHashes[i];
          resultIndex++;
        }
        currentIndex++;
      }
    }

    return (result, matchCount);
  }

  /// @notice Get all user lock details created by an address with optional filtering and pagination
  function getUserLocks(
    address user,
    LockStatus status,
    uint256 offset,
    uint256 limit
  ) external view returns (UserLock[] memory locks, uint256 total) {
    bytes32[] memory allHashes = userLockHashes[user];

    if (limit == 0) {
      return (new UserLock[](0), 0);
    }

    uint256 matchCount = 0;
    for (uint256 i = 0; i < allHashes.length; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        matchCount++;
      }
    }

    if (offset >= matchCount) {
      return (new UserLock[](0), matchCount);
    }

    uint256 end = offset + limit;
    if (end > matchCount) {
      end = matchCount;
    }
    uint256 size = end - offset;

    UserLock[] memory result = new UserLock[](size);
    uint256 resultIndex = 0;
    uint256 currentIndex = 0;

    for (uint256 i = 0; i < allHashes.length && resultIndex < size; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        if (currentIndex >= offset) {
          result[resultIndex] = userLocks[allHashes[i]];
          resultIndex++;
        }
        currentIndex++;
      }
    }

    return (result, matchCount);
  }

  // ─── Internal Helpers ───────────────────────────────────────

  /// @dev Reverts with InvalidPayoutCurve if `curve` has no code or does not implement IPayoutCurve.
  function _validatePayoutCurve(address curve) internal view {
    if (curve.code.length == 0) revert InvalidPayoutCurve();
    try IPayoutCurve(curve).supportsInterface(type(IPayoutCurve).interfaceId) returns (bool ok) {
      if (!ok) revert InvalidPayoutCurve();
    } catch {
      revert InvalidPayoutCurve();
    }
  }

  /// @dev Compute payout by calling IPayoutCurve(curve).computePayout().
  ///      payoutCurveData is passed as-is as the `config` argument (ABI-encoded curve parameters).
  ///      Solidity emits STATICCALL for external view calls, preventing any state mutation
  ///      in the curve contract regardless of the callee's actual mutability.
  ///      Must return payout where 0 < payout <= amount.
  function _computePayout(
    address curve,
    uint256 amount,
    uint48 startTime,
    bytes memory curveData
  ) internal view returns (uint256 payout) {
    try IPayoutCurve(curve).computePayout(amount, startTime, uint48(block.timestamp), curveData) returns (uint256 result) {
      payout = result;
    } catch {
      revert InvalidPayout();
    }
    if (payout == 0 || payout > amount) revert InvalidPayout();
  }

  /// @dev Transfer ETH or ERC20 into the contract. Returns actual received amount (handles fee-on-transfer).
  function _transferIn(address token, uint256 amount) internal returns (uint256 received) {
    if (token == NATIVE_ETH) {
      if (msg.value != amount) revert MsgValueMismatch();
      return amount;
    }
    if (msg.value != 0) revert MsgValueMismatch();
    uint256 before = IERC20(token).balanceOf(address(this));
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    received = IERC20(token).balanceOf(address(this)) - before;
    if (received == 0) revert ZeroAmount();
  }

  /// @dev Transfer amount and reward tokens into the contract. Returns actual received amounts.
  function _transferInMixed(
    address token,
    uint256 amount,
    address rewardToken,
    uint256 reward
  ) internal returns (uint256 actualAmount, uint256 actualReward) {
    uint256 expectedEth;
    if (token == NATIVE_ETH) {
      expectedEth = amount;
      actualAmount = amount;
      if (reward > 0 && rewardToken == NATIVE_ETH) {
        expectedEth += reward;
        actualReward = reward;
      }
    } else if (reward > 0 && rewardToken == NATIVE_ETH) {
      expectedEth = reward;
      actualReward = reward;
    }
    if (msg.value != expectedEth) revert MsgValueMismatch();

    if (token != NATIVE_ETH) {
      uint256 totalRequested = amount;
      if (reward > 0 && rewardToken == token) {
        totalRequested += reward;
      }
      uint256 before = IERC20(token).balanceOf(address(this));
      IERC20(token).safeTransferFrom(msg.sender, address(this), totalRequested);
      uint256 received = IERC20(token).balanceOf(address(this)) - before;

      if (reward > 0 && rewardToken == token) {
        actualAmount = (received * amount) / totalRequested;
        actualReward = received - actualAmount;
      } else {
        actualAmount = received;
      }
    }
    if (reward > 0 && rewardToken != NATIVE_ETH && rewardToken != token) {
      uint256 before = IERC20(rewardToken).balanceOf(address(this));
      IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), reward);
      actualReward = IERC20(rewardToken).balanceOf(address(this)) - before;
    }
  }

  /// @dev Transfer ETH or ERC20 out of the contract
  function _transferOut(address token, address payable to, uint256 amount) internal {
    if (token == NATIVE_ETH) {
      (bool success, ) = to.call{ value: amount, gas: GAS_STIPEND }('');
      if (!success) revert TransferFailed();
    } else {
      IERC20(token).safeTransfer(to, amount);
    }
  }

  /// @dev Transfer amount and reward to potentially different recipients
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
    bytes calldata userData,
    bytes calldata solverData
  ) internal {
    emit UserLocked(
      params.hashlock,
      msg.sender,
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
      params.quoteExpiry,
      userData,
      solverData
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
      msg.sender,
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
