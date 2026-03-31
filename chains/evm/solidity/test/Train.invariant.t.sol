// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import '../src/TestToken.sol';

// ══════════════════════════════════════════════════════════════════════════════
// Handler
// Wraps every Train action with bounded, valid inputs and maintains ghost state
// that mirrors what the contract *should* hold at any point in time.
// ══════════════════════════════════════════════════════════════════════════════
contract TrainHandler is Test {
  Train public train;
  TestToken public token;

  // actor   → creates locks and redeems them
  // refunder → set as recipient on all user locks so it can early-refund
  address payable internal actor;
  address payable internal refunder;

  // ── Ghost accounting ────────────────────────────────────────────────────────
  // Sum of amounts in currently-Pending locks, per token type.
  // Invariant: train.balance      >= ghost_pendingEth
  //            token.balanceOf()  >= ghost_pendingToken
  uint256 public ghost_pendingEth;
  uint256 public ghost_pendingToken;

  // ── User lock tracking ──────────────────────────────────────────────────────
  bytes32[] public ghost_userHashlocks;
  mapping(bytes32 => uint256) internal _userSecret;

  // Set to Refunded/Redeemed once the handler successfully resolves a lock.
  // Stays Empty (default) for locks that are still Pending.
  mapping(bytes32 => Train.LockStatus) public ghost_userTerminal;

  // ── Solver lock tracking ────────────────────────────────────────────────────
  bytes32[] public ghost_solverHashlocks;
  mapping(bytes32 => bool) internal _solverHashSeen;
  mapping(bytes32 => uint256[]) public ghost_solverIndices;   // per hashlock: all created indices
  mapping(bytes32 => mapping(uint256 => uint256)) internal _solverSecret;
  mapping(bytes32 => mapping(uint256 => Train.LockStatus)) public ghost_solverTerminal;

  constructor(Train _train, TestToken _token) {
    train = _train;
    token = _token;
    actor = payable(makeAddr('actor'));
    refunder = payable(makeAddr('refunder'));

    vm.deal(actor, 100_000 ether);
    token.mint(actor, 100_000_000 ether);
    vm.prank(actor);
    token.approve(address(train), type(uint256).max);
  }

  // ── User lock: create ───────────────────────────────────────────────────────

  function createUserLockETH(uint256 seed, uint256 amount, uint48 timelockDelta) external {
    amount = bound(amount, 1, 100 ether);
    timelockDelta = uint48(bound(timelockDelta, 1, 30 days));
    uint256 secret = bound(seed, 1, type(uint256).max);
    bytes32 hashlock = sha256(abi.encodePacked(secret));

    // Skip if hashlock already exists (same secret reused)
    if (train.getUserLock(hashlock).sender != address(0)) return;

    vm.prank(actor);
    try train.userLock{ value: amount }(_userParams(hashlock, amount, address(0), timelockDelta), _dst(), '', '') {
      ghost_userHashlocks.push(hashlock);
      _userSecret[hashlock] = secret;
      ghost_pendingEth += amount;
    } catch {}
  }

  function createUserLockERC20(uint256 seed, uint256 amount, uint48 timelockDelta) external {
    amount = bound(amount, 1, 100_000 ether);
    timelockDelta = uint48(bound(timelockDelta, 1, 30 days));
    uint256 secret = bound(seed, 1, type(uint256).max);
    bytes32 hashlock = sha256(abi.encodePacked(secret));

    if (train.getUserLock(hashlock).sender != address(0)) return;

    vm.prank(actor);
    try train.userLock(_userParams(hashlock, amount, address(token), timelockDelta), _dst(), '', '') {
      ghost_userHashlocks.push(hashlock);
      _userSecret[hashlock] = secret;
      ghost_pendingToken += amount;
    } catch {}
  }

  // ── User lock: resolve ──────────────────────────────────────────────────────

  function redeemUserLock(uint256 idx) external {
    if (ghost_userHashlocks.length == 0) return;
    idx = bound(idx, 0, ghost_userHashlocks.length - 1);
    bytes32 hashlock = ghost_userHashlocks[idx];

    Train.UserLock memory lock = train.getUserLock(hashlock);
    if (lock.status != Train.LockStatus.Pending) return;

    bool isEth = lock.token == address(0);
    try train.redeemUser(hashlock, _userSecret[hashlock]) {
      ghost_userTerminal[hashlock] = Train.LockStatus.Redeemed;
      if (isEth) ghost_pendingEth -= lock.amount;
      else ghost_pendingToken -= lock.amount;
    } catch {}
  }

  function refundUserLock(uint256 idx) external {
    if (ghost_userHashlocks.length == 0) return;
    idx = bound(idx, 0, ghost_userHashlocks.length - 1);
    bytes32 hashlock = ghost_userHashlocks[idx];

    Train.UserLock memory lock = train.getUserLock(hashlock);
    if (lock.status != Train.LockStatus.Pending) return;

    bool isEth = lock.token == address(0);
    // Call as `refunder` (= lock.recipient) so no timelock warp is needed
    vm.prank(refunder);
    try train.refundUser(hashlock) {
      ghost_userTerminal[hashlock] = Train.LockStatus.Refunded;
      if (isEth) ghost_pendingEth -= lock.amount;
      else ghost_pendingToken -= lock.amount;
    } catch {}
  }

  // ── Solver lock: create (ETH only, zero reward for clarity) ─────────────────

  function createSolverLockETH(uint256 seed, uint256 amount, uint48 timelockDelta) external {
    amount = bound(amount, 1, 100 ether);
    timelockDelta = uint48(bound(timelockDelta, 1, 30 days));
    uint256 secret = bound(seed, 1, type(uint256).max);
    bytes32 hashlock = sha256(abi.encodePacked(secret));

    Train.SolverLockParams memory p = Train.SolverLockParams({
      hashlock: hashlock,
      amount: amount,
      reward: 0,
      timelockDelta: timelockDelta,
      rewardTimelockDelta: 0,
      refundTo: address(0),
      recipient: refunder,
      rewardRecipient: address(0),
      token: address(0),
      rewardToken: address(0),
      srcChain: 'ETH'
    });

    vm.prank(actor);
    try train.solverLock{ value: amount }(p, _dst(), '') returns (uint256 index) {
      if (!_solverHashSeen[hashlock]) {
        ghost_solverHashlocks.push(hashlock);
        _solverHashSeen[hashlock] = true;
      }
      ghost_solverIndices[hashlock].push(index);
      _solverSecret[hashlock][index] = secret;
      ghost_pendingEth += amount;
    } catch {}
  }

  // ── Solver lock: resolve ────────────────────────────────────────────────────

  function redeemSolverLock(uint256 hlIdx, uint256 lockIdx) external {
    if (ghost_solverHashlocks.length == 0) return;
    hlIdx = bound(hlIdx, 0, ghost_solverHashlocks.length - 1);
    bytes32 hashlock = ghost_solverHashlocks[hlIdx];

    uint256 indicesLen = ghost_solverIndices[hashlock].length;
    if (indicesLen == 0) return;
    lockIdx = bound(lockIdx, 0, indicesLen - 1);
    uint256 index = ghost_solverIndices[hashlock][lockIdx];

    Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
    if (lock.status != Train.LockStatus.Pending) return;

    uint256 secret = _solverSecret[hashlock][index];
    try train.redeemSolver(hashlock, index, secret) {
      ghost_solverTerminal[hashlock][index] = Train.LockStatus.Redeemed;
      ghost_pendingEth -= lock.amount;
    } catch {}
  }

  function refundSolverLock(uint256 hlIdx, uint256 lockIdx) external {
    if (ghost_solverHashlocks.length == 0) return;
    hlIdx = bound(hlIdx, 0, ghost_solverHashlocks.length - 1);
    bytes32 hashlock = ghost_solverHashlocks[hlIdx];

    uint256 indicesLen = ghost_solverIndices[hashlock].length;
    if (indicesLen == 0) return;
    lockIdx = bound(lockIdx, 0, indicesLen - 1);
    uint256 index = ghost_solverIndices[hashlock][lockIdx];

    Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
    if (lock.status != Train.LockStatus.Pending) return;

    // Must warp past timelock (no recipient-early-refund on solver locks)
    vm.warp(lock.timelock + 1);
    try train.refundSolver(hashlock, index) {
      ghost_solverTerminal[hashlock][index] = Train.LockStatus.Refunded;
      ghost_pendingEth -= lock.amount;
    } catch {}
  }

  // ── Exposed length helpers (for invariant iteration) ────────────────────────

  function ghost_userHashlocksLength() external view returns (uint256) {
    return ghost_userHashlocks.length;
  }

  function ghost_solverHashlocksLength() external view returns (uint256) {
    return ghost_solverHashlocks.length;
  }

  function ghost_solverIndicesLength(bytes32 hashlock) external view returns (uint256) {
    return ghost_solverIndices[hashlock].length;
  }

  // ── Internal param builders ──────────────────────────────────────────────────

  function _userParams(
    bytes32 hashlock,
    uint256 amount,
    address tokenAddr,
    uint48 timelockDelta
  ) internal view returns (Train.UserLockParams memory) {
    return Train.UserLockParams({
      hashlock: hashlock,
      amount: amount,
      rewardAmount: 0,
      timelockDelta: timelockDelta,
      rewardTimelockDelta: 0,
      // Always far in the future so vm.warp inside refundSolverLock doesn't expire it
      quoteExpiry: uint48(block.timestamp + 365 days),
      refundTo: address(0),
      recipient: refunder,
      token: tokenAddr,
      rewardToken: '',
      rewardRecipient: '',
      srcChain: 'ETH'
    });
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDst', dstAmount: 1, dstToken: 'ETH' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Invariant test contract
// ══════════════════════════════════════════════════════════════════════════════
/// @title Train Invariant Tests
/// @notice Stateful invariant tests covering fund conservation, status
///         monotonicity, refundTo safety, and structural sentinel correctness
///         across arbitrary sequences of lock / redeem / refund operations.
contract TrainInvariantTest is Test {
  Train public train;
  TestToken public token;
  TrainHandler public handler;

  function setUp() public {
    train = new Train();
    token = new TestToken();
    handler = new TrainHandler(train, token);
    targetContract(address(handler));
  }

  // ── Invariant 1: ETH conservation ──────────────────────────────────────────
  /// @notice The contract's ETH balance must always be ≥ the sum of all
  ///         currently-Pending ETH lock amounts.
  ///         A violation means funds from one user can be used to pay another.
  function invariant_ethConservation() public view {
    assertGe(address(train).balance, handler.ghost_pendingEth(), 'ETH conservation violated');
  }

  // ── Invariant 2: ERC20 conservation ────────────────────────────────────────
  /// @notice The contract's ERC20 balance must always be ≥ the sum of all
  ///         currently-Pending ERC20 lock amounts.
  function invariant_erc20Conservation() public view {
    assertGe(token.balanceOf(address(train)), handler.ghost_pendingToken(), 'ERC20 conservation violated');
  }

  // ── Invariant 3: User lock status monotonicity ──────────────────────────────
  /// @notice Once a user lock reaches a terminal state (Refunded or Redeemed)
  ///         it must remain in that state forever — no backwards transitions.
  function invariant_userLockStatusMonotonicity() public view {
    uint256 len = handler.ghost_userHashlocksLength();
    for (uint256 i = 0; i < len; i++) {
      bytes32 hashlock = handler.ghost_userHashlocks(i);
      Train.LockStatus recorded = handler.ghost_userTerminal(hashlock);
      if (recorded == Train.LockStatus.Empty) continue; // still Pending, skip

      Train.LockStatus actual = train.getUserLock(hashlock).status;
      assertEq(uint8(actual), uint8(recorded), 'user lock status went backwards');
    }
  }

  // ── Invariant 4: Solver lock status monotonicity ────────────────────────────
  /// @notice Same guarantee for solver locks.
  function invariant_solverLockStatusMonotonicity() public view {
    uint256 hlLen = handler.ghost_solverHashlocksLength();
    for (uint256 i = 0; i < hlLen; i++) {
      bytes32 hashlock = handler.ghost_solverHashlocks(i);
      uint256 idxLen = handler.ghost_solverIndicesLength(hashlock);
      for (uint256 j = 0; j < idxLen; j++) {
        uint256 index = handler.ghost_solverIndices(hashlock, j);
        Train.LockStatus recorded = handler.ghost_solverTerminal(hashlock, index);
        if (recorded == Train.LockStatus.Empty) continue;

        Train.LockStatus actual = train.getSolverLock(hashlock, index).status;
        assertEq(uint8(actual), uint8(recorded), 'solver lock status went backwards');
      }
    }
  }

  // ── Invariant 5: Solver index 0 is always the empty sentinel ───────────────
  /// @notice solverLocks use 1-based indexing (++solverLockCount).
  ///         Index 0 must always be an empty struct (sender == address(0)).
  function invariant_solverIndexZeroAlwaysEmpty() public view {
    uint256 len = handler.ghost_solverHashlocksLength();
    for (uint256 i = 0; i < len; i++) {
      bytes32 hashlock = handler.ghost_solverHashlocks(i);
      Train.SolverLock memory sentinel = train.getSolverLock(hashlock, 0);
      assertEq(sentinel.sender, address(0), 'solver index 0 is not empty');
      assertEq(sentinel.amount, 0, 'solver index 0 has non-zero amount');
    }
  }

  // ── Invariant 6: refundTo is never address(0) on any live lock ─────────────
  /// @notice lock.refundTo must always be a non-zero address after lock creation.
  ///         A zero refundTo would make refunds permanently fail.
  function invariant_refundToNeverZero() public view {
    uint256 uLen = handler.ghost_userHashlocksLength();
    for (uint256 i = 0; i < uLen; i++) {
      bytes32 hashlock = handler.ghost_userHashlocks(i);
      Train.UserLock memory lock = train.getUserLock(hashlock);
      if (lock.sender == address(0)) continue; // empty slot
      assertTrue(lock.refundTo != address(0), 'user lock refundTo is zero');
    }

    uint256 hlLen = handler.ghost_solverHashlocksLength();
    for (uint256 i = 0; i < hlLen; i++) {
      bytes32 hashlock = handler.ghost_solverHashlocks(i);
      uint256 idxLen = handler.ghost_solverIndicesLength(hashlock);
      for (uint256 j = 0; j < idxLen; j++) {
        uint256 index = handler.ghost_solverIndices(hashlock, j);
        Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
        if (lock.sender == address(0)) continue;
        assertTrue(lock.refundTo != address(0), 'solver lock refundTo is zero');
      }
    }
  }

  // ── Invariant 7: sender is never address(0) on any non-empty lock ───────────
  /// @notice lock.sender being address(0) is the "not found" sentinel.
  ///         A created lock must always have sender == msg.sender (non-zero).
  function invariant_senderNeverZeroOnLiveLock() public view {
    uint256 len = handler.ghost_userHashlocksLength();
    for (uint256 i = 0; i < len; i++) {
      bytes32 hashlock = handler.ghost_userHashlocks(i);
      Train.UserLock memory lock = train.getUserLock(hashlock);
      // The lock was successfully created, so sender must be non-zero
      assertTrue(lock.sender != address(0), 'user lock sender is zero');
    }
  }
}
