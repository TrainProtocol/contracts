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
pragma solidity 0.8.34;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { ReentrancyGuardTransient } from '@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol';
import { ERC165Checker } from '@openzeppelin/contracts/utils/introspection/ERC165Checker.sol';
import { IPayoutCurve } from '../IPayoutCurve.sol';

/// @title Train Protocol - Cross-Chain HTLC Bridge (Tempo)
/// @author Train Protocol
/// @notice Trustless cross-chain bridge using Hashed Time-Locked Contracts
/// @dev ERC20/TIP-20 only — Tempo has no native gas token (`CALLVALUE` always returns 0), so this
///      Tempo-specific variant drops the native-ETH paths present in the shared `src/Train.sol` used
///      on other EVM chains entirely, rather than leaving them in as unreachable code. There is also
///      no `userLockFor` here: its only purpose on other chains is letting `TrainRouter` attribute a
///      lock to a user other than `msg.sender` when it forwards a call, and `TrainRouter` is not
///      deployed on Tempo (native Tempo Transaction batching + fee-payer sponsorship already provides
///      gasless intake — see script/tempo/README.md). Hashlock = sha256(secret).
///      Supports an optional pluggable payout curve via STATICCALL (shipped ConstantPayoutCurve is a
///      no-op returning the full amount; arbitrary curves are caller-supplied — see README trust notes).
///      Handles fee-on-transfer tokens by measuring actual received amounts.
///      Uses transient-storage reentrancy guard (EIP-1153, requires Cancun+; Tempo targets Osaka).
contract Train is ReentrancyGuardTransient {
  using SafeERC20 for IERC20;
  using ERC165Checker for address;

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

  /// @notice Thrown when the calling solver already created a solver lock for this hashlock
  error SolverLockAlreadyExists();

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

  /// @notice Thrown when a required address (recipient / refundTo / rewardRecipient) is the zero address
  error ZeroAddress();

  /// @notice Lock lifecycle states
  enum LockStatus {
    Empty,
    Pending,
    Refunded,
    Redeemed
  }

  /// @notice User-initiated lock storage structure.
  /// @dev Field order is packing-aware: {sender,timelock,startTime} fill one slot and
  ///      {status,recipient} the next; the trailing addresses take one slot each.
  struct UserLock {
    uint256 secret; //         slot 0
    uint256 amount; //         slot 1
    address sender; //         slot 2 [0:20]
    uint48 timelock; //        slot 2 [20:26]
    uint48 startTime; //       slot 2 [26:32]
    LockStatus status; //      slot 3 [0:1]
    address recipient; //      slot 3 [1:21]
    address refundTo; //       slot 4
    address token; //          slot 5
    address payoutCurve; //    slot 6
    bytes payoutCurveData; //  slot 7 (length) + data
  }

  /// @notice Solver-initiated lock storage structure.
  /// @dev Field order is packing-aware: {sender,timelock,rewardTimelock} fill one slot and
  ///      {startTime,recipient,status} the next; trailing addresses take one slot each.
  struct SolverLock {
    uint256 secret; //          slot 0
    uint256 amount; //          slot 1
    uint256 reward; //          slot 2
    address sender; //          slot 3 [0:20]
    uint48 timelock; //         slot 3 [20:26]
    uint48 rewardTimelock; //   slot 3 [26:32]
    uint48 startTime; //        slot 4 [0:6]
    address recipient; //       slot 4 [6:26]
    LockStatus status; //       slot 4 [26:27]
    address rewardRecipient; // slot 5
    address refundTo; //        slot 6
    address token; //           slot 7
    address rewardToken; //     slot 8
    address payoutCurve; //     slot 9
    bytes payoutCurveData; //   slot 10 (length) + data
  }

  /// @notice Emitted when a user creates a lock.
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param sender The lock owner of record — always the direct caller (there is no attributed-forwarding path).
  /// @param recipient The address that receives the payout on redeem.
  /// @param srcChain The source chain identifier.
  /// @param token The locked ERC20/TIP-20 token.
  /// @param amount The measured amount actually escrowed (fee-on-transfer safe).
  /// @param timelock Absolute timestamp after which a non-recipient may refund.
  /// @param payoutCurve The payout curve applied on redeem (address(0) if none).
  /// @param dstChain Destination chain identifier (logged only).
  /// @param dstAddress Destination recipient address as a string (logged only).
  /// @param dstAmount Destination amount (logged only).
  /// @param dstToken Destination token identifier (logged only).
  /// @param rewardAmount Reward offered to the solver on the destination side (informational).
  /// @param rewardToken Reward token identifier on the destination side (informational).
  /// @param rewardRecipient Reward recipient identifier on the destination side (informational).
  /// @param rewardTimelockDelta Reward timelock delta echoed for the solver (informational).
  /// @param quoteExpiry Absolute timestamp after which the quote was no longer valid at creation.
  /// @param userData Opaque user-supplied data (logged only).
  /// @param solverData Opaque solver-supplied data (logged only).
  event UserLocked(
    bytes32 indexed hashlock,
    address indexed sender,
    address indexed recipient,
    string srcChain,
    address token,
    uint256 amount,
    uint48 timelock,
    address payoutCurve,
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

  /// @notice Emitted when a solver creates a lock.
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param sender The solver that created and funded the lock (at most one lock per solver per hashlock).
  /// @param recipient The address that receives the payout on redeem.
  /// @param srcChain The source chain identifier.
  /// @param token The locked ERC20/TIP-20 token.
  /// @param amount The measured amount actually escrowed (fee-on-transfer safe).
  /// @param reward The measured reward actually escrowed.
  /// @param rewardToken The reward ERC20/TIP-20 token.
  /// @param rewardRecipient The reward recipient before rewardTimelock.
  /// @param timelock Absolute timestamp after which the lock may be refunded.
  /// @param rewardTimelock Absolute timestamp after which the reward routes to the redeemer instead.
  /// @param payoutCurve The payout curve applied on redeem (address(0) if none).
  /// @param dstChain Destination chain identifier (logged only).
  /// @param dstAddress Destination recipient address as a string (logged only).
  /// @param dstAmount Destination amount (logged only).
  /// @param dstToken Destination token identifier (logged only).
  /// @param data Opaque solver-supplied data (logged only).
  event SolverLocked(
    bytes32 indexed hashlock,
    address indexed sender,
    address indexed recipient,
    string srcChain,
    address token,
    uint256 amount,
    uint256 reward,
    address rewardToken,
    address rewardRecipient,
    uint48 timelock,
    uint48 rewardTimelock,
    address payoutCurve,
    string dstChain,
    string dstAddress,
    uint256 dstAmount,
    string dstToken,
    bytes data
  );

  /// @notice Emitted when a user lock is refunded (full amount returned to refundTo).
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param refundTo The address the locked amount was returned to.
  /// @param amount The amount returned.
  event UserRefunded(bytes32 indexed hashlock, address refundTo, uint256 amount);

  /// @notice Emitted when a solver lock is refunded (amount + reward returned to refundTo).
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param solver The solver whose lock was refunded.
  /// @param refundTo The address the amount and reward were returned to.
  /// @param amount The principal amount returned.
  /// @param reward The reward returned.
  event SolverRefunded(
    bytes32 indexed hashlock,
    address indexed solver,
    address refundTo,
    uint256 amount,
    uint256 reward
  );

  /// @notice Emitted when a user lock is redeemed with the secret preimage.
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param redeemer The caller that triggered the redemption (not necessarily the recipient).
  /// @param secret The revealed preimage (sha256(secret) == hashlock).
  /// @param payout Amount paid to the recipient (== amount when no payout curve).
  /// @param excess Remainder returned to refundTo (amount - payout; 0 when no payout curve).
  event UserRedeemed(bytes32 indexed hashlock, address redeemer, uint256 secret, uint256 payout, uint256 excess);

  /// @notice Emitted when a solver lock is redeemed with the secret preimage.
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param solver The solver whose lock was redeemed.
  /// @param redeemer The caller that triggered the redemption.
  /// @param secret The revealed preimage (sha256(secret) == hashlock).
  /// @param payout Amount paid to the recipient (== amount when no payout curve).
  /// @param excess Remainder returned to refundTo (amount - payout; 0 when no payout curve).
  /// @param rewardTo Address that received the reward (rewardRecipient before rewardTimelock, else the redeemer).
  /// @param reward Reward amount paid to rewardTo.
  event SolverRedeemed(
    bytes32 indexed hashlock,
    address indexed solver,
    address redeemer,
    uint256 secret,
    uint256 payout,
    uint256 excess,
    address rewardTo,
    uint256 reward
  );

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

  /// @dev hashlock => solver => SolverLock. At most ONE lock per (hashlock, solver), ever — the
  ///      per-solver uniqueness guard in `_validateSolverLockParams` makes a blind `solverLock`
  ///      retry revert instead of double-funding the same swap.
  mapping(bytes32 => mapping(address => SolverLock)) private solverLocks;

  /// @dev Historical hashlocks per user address
  mapping(address => bytes32[]) private userLockHashes;

  /// @notice Create a user lock to initiate a cross-chain swap (caller funds the lock).
  /// @dev ERC20/TIP-20 only (non-payable — Tempo has no native gas token).
  /// @param params Lock parameters: hashlock, amount, token, recipient, refundTo, timelock/quote bounds,
  ///        optional payout curve, and destination reward metadata (the latter logged only).
  /// @param dst Destination-chain details (logged only).
  /// @param userData Opaque user-supplied data (logged only).
  /// @param solverData Opaque solver-supplied data (logged only).
  function userLock(
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata userData,
    bytes calldata solverData
  ) external nonReentrant {
    _validateUserLockParams(params);
    uint256 received = _transferIn(params.token, params.amount);
    _userLockCore(msg.sender, received, params, dst, userData, solverData);
  }

  /// @notice Create a solver lock to fulfill a swap (solver funds the lock).
  /// @dev ERC20/TIP-20 only (non-payable — Tempo has no native gas token).
  ///      At most ONE solver lock per (hashlock, msg.sender), EVER: a repeat call reverts with
  ///      SolverLockAlreadyExists before any funds are pulled, so a blind retry (e.g. after an
  ///      unreliable or malicious RPC reported the first tx as missing) cannot double-fund the
  ///      same swap. Probe idempotently via `getSolverLock(hashlock, solver).sender != 0` — on
  ///      several independent RPCs if needed. The guard never lifts, not even after a refund; a
  ///      deliberate re-fill of the same hashlock requires a different solver address.
  /// @param params Solver lock parameters: amount, optional reward (+ reward token/recipient/timelock),
  ///        recipient, refundTo, token, and optional payout curve.
  /// @param dst Destination-chain details (logged only).
  /// @param data Opaque solver-supplied data (logged only).
  function solverLock(
    SolverLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata data
  ) external nonReentrant {
    _validateSolverLockParams(params);

    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;
    uint48 rewardTimelock = uint48(block.timestamp) + params.rewardTimelockDelta;

    (uint256 actualAmount, uint256 actualReward) = _transferInMixed(
      params.token,
      params.amount,
      params.rewardToken,
      params.reward
    );
    // An extreme fee-on-transfer token could floor the proportional split to 0; reject it rather
    // than persist a zero-amount Pending lock.
    if (actualAmount == 0) revert ZeroAmount();

    SolverLock storage lock = solverLocks[params.hashlock][msg.sender];
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

    _emitSolverLocked(params, actualAmount, actualReward, dst, timelock, rewardTimelock, data);
  }

  /// @notice Refund a user lock (returns the full amount to refundTo).
  /// @dev Recipient can refund anytime; others only after timelock expires. Full amount, no decay.
  /// @param hashlock The lock identifier (sha256 of the secret).
  function refundUser(bytes32 hashlock) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (msg.sender != lock.recipient && lock.timelock > block.timestamp) {
      revert RefundNotAllowed();
    }

    lock.status = LockStatus.Refunded;
    address refundTo = lock.refundTo; // cache: read for the transfer and the event
    uint256 amount = lock.amount; //    cache: read for the transfer and the event
    _transferOut(lock.token, payable(refundTo), amount);
    emit UserRefunded(hashlock, refundTo, amount);
  }

  /// @notice Refund a solver lock (full amount + reward returned to refundTo, no decay).
  /// @dev Callable by anyone, but only after the timelock expires.
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param solver The solver whose lock to refund.
  function refundSolver(bytes32 hashlock, address solver) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][solver];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (lock.timelock > block.timestamp) revert RefundNotAllowed();

    lock.status = LockStatus.Refunded;
    address payable refundTo = payable(lock.refundTo); // cache: used as both amount and reward sink
    uint256 amount = lock.amount; // cache: read for the transfer and the event
    uint256 reward = lock.reward; // cache: read for the transfer and the event
    _transferOutMixed(lock.token, amount, refundTo, lock.rewardToken, reward, refundTo);
    emit SolverRefunded(hashlock, solver, refundTo, amount, reward);
  }

  /// @notice Redeem a user lock with the secret preimage (pays the lock's recipient).
  /// @dev Permissionless: any caller holding the secret can trigger it; the payout goes to the lock's
  ///      recipient, never to the caller. If a payout curve is set, payout is computed via staticcall
  ///      and any excess (amount - payout) is sent to `refundTo`.
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param secret The preimage; must satisfy sha256(secret) == hashlock.
  function redeemUser(bytes32 hashlock, uint256 secret) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;

    uint256 amount = lock.amount; // cache: read for payout and excess
    address token = lock.token; //  cache: read for both outbound transfers
    uint256 payout = amount;
    if (lock.payoutCurve != address(0)) {
      payout = _computePayout(lock.payoutCurve, amount, lock.startTime, lock.payoutCurveData);
    }

    // _computePayout guarantees 0 < payout <= amount (and payout == amount when no curve), so the
    // subtraction cannot underflow.
    uint256 excess;
    unchecked {
      excess = amount - payout;
    }

    _transferOut(token, payable(lock.recipient), payout);
    if (excess > 0) _transferOut(token, payable(lock.refundTo), excess);

    emit UserRedeemed(hashlock, msg.sender, secret, payout, excess);
  }

  /// @notice Redeem a solver lock with the secret preimage (pays the recipient; routes the reward).
  /// @dev Permissionless. The payout curve applies to the main amount only; any excess goes to
  ///      `refundTo`. The reward routes to `rewardRecipient` before `rewardTimelock`, otherwise to the
  ///      caller (the redeemer).
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param solver The solver whose lock to redeem.
  /// @param secret The preimage; must satisfy sha256(secret) == hashlock.
  function redeemSolver(bytes32 hashlock, address solver, uint256 secret) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][solver];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;

    uint256 amount = lock.amount; // cache: read for payout and excess
    address token = lock.token; //  cache: read for both outbound transfers
    uint256 reward = lock.reward; // cache: read for the guard, the transfer, and the event
    uint256 payout = amount;
    if (lock.payoutCurve != address(0)) {
      payout = _computePayout(lock.payoutCurve, amount, lock.startTime, lock.payoutCurveData);
    }

    address rewardTo = lock.rewardTimelock > block.timestamp ? lock.rewardRecipient : msg.sender;

    // _computePayout guarantees 0 < payout <= amount (and payout == amount when no curve), so the
    // subtraction cannot underflow.
    uint256 excess;
    unchecked {
      excess = amount - payout;
    }

    _transferOut(token, payable(lock.recipient), payout);
    if (excess > 0) _transferOut(token, payable(lock.refundTo), excess);
    if (reward > 0) _transferOut(lock.rewardToken, payable(rewardTo), reward);

    emit SolverRedeemed(hashlock, solver, msg.sender, secret, payout, excess, rewardTo, reward);
  }

  /// @notice Get user lock details.
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @return The stored UserLock (zero-valued if none exists).
  function getUserLock(bytes32 hashlock) external view returns (UserLock memory) {
    return userLocks[hashlock];
  }

  /// @notice Get solver lock details.
  /// @dev Doubles as the solver's idempotency probe: `sender == address(0)` means `solver` has
  ///      never locked under `hashlock`. Discovery of other solvers' locks stays event-driven
  ///      (`SolverLocked`).
  /// @param hashlock The lock identifier (sha256 of the secret).
  /// @param solver The solver whose lock to read.
  /// @return The stored SolverLock (zero-valued if none exists).
  function getSolverLock(bytes32 hashlock, address solver) external view returns (SolverLock memory) {
    return solverLocks[hashlock][solver];
  }

  /// @notice Paginated hashlocks of the user locks created by `user`.
  /// @dev Read-only enumeration intended for off-chain `eth_call`. It reads ONLY the requested
  ///      window directly from storage and never copies the whole array into memory, so it stays
  ///      callable at any array size, however many locks `user` has created over time. Filter by
  ///      `UserLock.status` off-chain on the returned data, or use `getUserLocks`.
  /// @param user   The lock owner to enumerate.
  /// @param offset Start index into the user's hashlock list.
  /// @param limit  Maximum number of entries to return.
  /// @return hashlocks The page in [offset, min(offset+limit, total)).
  /// @return total     The full number of hashlocks for `user` (for client-side pagination).
  function getUserLockHashes(
    address user,
    uint256 offset,
    uint256 limit
  ) external view returns (bytes32[] memory hashlocks, uint256 total) {
    bytes32[] storage all = userLockHashes[user];
    total = all.length;
    if (limit == 0 || offset >= total) {
      return (new bytes32[](0), total);
    }
    // offset < total here (guarded above), so total - offset is safe; the else-branch runs only when
    // limit <= total - offset, so offset + limit <= total and cannot overflow.
    uint256 end = limit > total - offset ? total : offset + limit;
    uint256 size = end - offset;
    hashlocks = new bytes32[](size);
    for (uint256 i = 0; i < size; ) {
      hashlocks[i] = all[offset + i];
      unchecked {
        ++i;
      }
    }
  }

  /// @notice Paginated user-lock details created by `user`.
  /// @dev Same scale-safe design as `getUserLockHashes`: reads only the requested window from
  ///      storage (no whole-array copy), so it remains callable at any size. Filter by
  ///      `UserLock.status` off-chain on the returned data.
  /// @param user   The lock owner to enumerate.
  /// @param offset Start index into the user's lock list.
  /// @param limit  Maximum number of locks to return.
  /// @return locks The page in [offset, min(offset+limit, total)).
  /// @return total The full number of locks for `user`.
  function getUserLocks(
    address user,
    uint256 offset,
    uint256 limit
  ) external view returns (UserLock[] memory locks, uint256 total) {
    bytes32[] storage all = userLockHashes[user];
    total = all.length;
    if (limit == 0 || offset >= total) {
      return (new UserLock[](0), total);
    }
    // offset < total here (guarded above), so total - offset is safe; the else-branch runs only when
    // limit <= total - offset, so offset + limit <= total and cannot overflow.
    uint256 end = limit > total - offset ? total : offset + limit;
    uint256 size = end - offset;
    locks = new UserLock[](size);
    for (uint256 i = 0; i < size; ) {
      locks[i] = userLocks[all[offset + i]];
      unchecked {
        ++i;
      }
    }
  }

  // ─── Internal Helpers ───────────────────────────────────────

  /// @dev Shared validation for both user-lock entrypoints. Runs before any funds are pulled.
  function _validateUserLockParams(UserLockParams calldata params) internal view {
    if (params.amount == 0) revert ZeroAmount();
    if (params.timelockDelta == 0) revert InvalidTimelock();
    if (block.timestamp >= params.quoteExpiry) revert QuoteExpired();
    if (params.token.code.length == 0) revert InvalidToken();
    if (params.recipient == address(0) || params.refundTo == address(0)) revert ZeroAddress();
    if (userLocks[params.hashlock].sender != address(0)) revert SwapAlreadyExists();
    if (params.payoutCurve != address(0)) _validatePayoutCurve(params.payoutCurve);
  }

  /// @dev Validation for `solverLock`, mirroring `_validateUserLockParams`. Runs before any funds are
  ///      pulled. Solver locks have no quote expiry; uniqueness is per (hashlock, msg.sender) — a
  ///      hashlock may hold locks from many DIFFERENT solvers, but a repeat by the same solver reverts
  ///      (permanent retry/replay guard, see `solverLock`). Adds reward-leg checks: a reward token must
  ///      have code, `rewardTimelockDelta < timelockDelta`, and a non-zero reward needs a non-zero
  ///      rewardRecipient.
  function _validateSolverLockParams(SolverLockParams calldata params) internal view {
    if (params.amount == 0) revert ZeroAmount();
    if (params.timelockDelta == 0) revert InvalidTimelock();
    if (params.token.code.length == 0) revert InvalidToken();
    if (params.reward > 0 && params.rewardTimelockDelta >= params.timelockDelta) revert InvalidRewardTimelock();
    if (params.reward > 0 && params.rewardToken.code.length == 0) revert InvalidToken();
    if (params.recipient == address(0) || params.refundTo == address(0)) revert ZeroAddress();
    if (params.reward > 0 && params.rewardRecipient == address(0)) revert ZeroAddress();
    if (solverLocks[params.hashlock][msg.sender].sender != address(0)) revert SolverLockAlreadyExists();
    if (params.payoutCurve != address(0)) _validatePayoutCurve(params.payoutCurve);
  }

  /// @dev Write the user lock and emit. `user` is the lock owner of record; `received` is the
  ///      measured amount already pulled into the contract by the caller. Assumes
  ///      `_validateUserLockParams` has already run.
  function _userLockCore(
    address user,
    uint256 received,
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata userData,
    bytes calldata solverData
  ) internal {
    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;

    UserLock storage lock = userLocks[params.hashlock];
    lock.sender = user;
    lock.amount = received;
    lock.recipient = params.recipient;
    lock.refundTo = params.refundTo;
    lock.timelock = timelock;
    lock.startTime = uint48(block.timestamp);
    lock.status = LockStatus.Pending;
    lock.token = params.token;
    lock.payoutCurve = params.payoutCurve;
    if (params.payoutCurveData.length > 0) lock.payoutCurveData = params.payoutCurveData;

    userLockHashes[user].push(params.hashlock);

    _emitUserLocked(user, received, params, dst, timelock, userData, solverData);
  }

  /// @dev Reverts with InvalidPayoutCurve unless `curve` is a contract that advertises IPayoutCurve via
  ///      EIP-165. ERC165Checker runs the full handshake (gas-capped probe, return-data-length check,
  ///      IERC165 support + 0xffffffff rejection) and returns false — never reverts — for EOAs,
  ///      non-ERC165 contracts, or reverting probes, so this single guard covers every rejection case.
  function _validatePayoutCurve(address curve) internal view {
    if (!curve.supportsInterface(type(IPayoutCurve).interfaceId)) revert InvalidPayoutCurve();
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
    try IPayoutCurve(curve).computePayout(amount, startTime, uint48(block.timestamp), curveData) returns (
      uint256 result
    ) {
      payout = result;
    } catch {
      revert InvalidPayout();
    }
    if (payout == 0 || payout > amount) revert InvalidPayout();
  }

  /// @dev Transfer ERC20/TIP-20 into the contract. Returns actual received amount (handles
  ///      fee-on-transfer). `userLock`/`solverLock` are non-payable, so `msg.value` is always 0 here.
  function _transferIn(address token, uint256 amount) internal returns (uint256 received) {
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

    if (reward > 0 && rewardToken != token) {
      uint256 rewardBefore = IERC20(rewardToken).balanceOf(address(this));
      IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), reward);
      actualReward = IERC20(rewardToken).balanceOf(address(this)) - rewardBefore;
    }
  }

  /// @dev Transfer ERC20/TIP-20 out of the contract.
  function _transferOut(address token, address payable to, uint256 amount) internal {
    IERC20(token).safeTransfer(to, amount);
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

  /// @dev Emit UserLocked event (separated to avoid stack too deep). `user` is the lock owner and
  ///      `lockedAmount` is the measured amount actually received (matches `lock.amount`), not the
  ///      requested `params.amount`, so the event is accurate for fee-on-transfer tokens.
  function _emitUserLocked(
    address user,
    uint256 lockedAmount,
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    uint48 timelock,
    bytes calldata userData,
    bytes calldata solverData
  ) internal {
    emit UserLocked(
      params.hashlock,
      user,
      params.recipient,
      params.srcChain,
      params.token,
      lockedAmount,
      timelock,
      params.payoutCurve,
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

  /// @dev Emit SolverLocked event (separated to avoid stack too deep). `lockedAmount`/`lockedReward`
  ///      are the measured amounts actually received (match `lock.amount`/`lock.reward`), not the
  ///      requested values, so the event is accurate for fee-on-transfer tokens.
  function _emitSolverLocked(
    SolverLockParams calldata params,
    uint256 lockedAmount,
    uint256 lockedReward,
    DestinationInfo calldata dst,
    uint48 timelock,
    uint48 rewardTimelock,
    bytes calldata data
  ) internal {
    emit SolverLocked(
      params.hashlock,
      msg.sender,
      params.recipient,
      params.srcChain,
      params.token,
      lockedAmount,
      lockedReward,
      params.rewardToken,
      params.rewardRecipient,
      timelock,
      rewardTimelock,
      params.payoutCurve,
      dst.dstChain,
      dst.dstAddress,
      dst.dstAmount,
      dst.dstToken,
      data
    );
  }
}
