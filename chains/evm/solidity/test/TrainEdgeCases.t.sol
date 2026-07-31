// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import './mocks/TestToken.sol';
import { FeeOnTransferToken, RejectETH } from './mocks/Mocks.sol';

/// @notice Train revert/edge branches: zero-address and fee-on-transfer-to-zero guards, invalid curve,
///         native-transfer failure, shared validator on userLockFor, double-settle, dust, scale-safe
///         windowed getters, measured-amount events, and timelock bounds.
contract TrainEdgeCasesTest is Test {
  Train train;
  TestToken token;
  FeeOnTransferToken fot1; // 1% fee
  FeeOnTransferToken fot100; // 100% fee
  RejectETH rejecter;

  address payable initiator;
  address payable recipient;
  address payable refundTo;
  address payable solver;
  address payable rewardRecipient;
  address payable relayer;

  uint256 constant SECRET = 12345;
  bytes32 hashlock;
  address constant NATIVE_ETH = address(0);

  function setUp() public {
    train = new Train();
    token = new TestToken();
    fot1 = new FeeOnTransferToken(100);
    fot100 = new FeeOnTransferToken(10_000);
    rejecter = new RejectETH();

    initiator = payable(makeAddr('initiator'));
    recipient = payable(makeAddr('recipient'));
    refundTo = payable(makeAddr('refundTo'));
    solver = payable(makeAddr('solver'));
    rewardRecipient = payable(makeAddr('rewardRecipient'));
    relayer = payable(makeAddr('relayer'));

    vm.deal(initiator, 1000 ether);
    vm.deal(solver, 1000 ether);
    token.mint(initiator, 1000 ether);
    token.mint(solver, 1000 ether);
    fot1.mint(initiator, 1000 ether);
    fot100.mint(initiator, 1000 ether);

    vm.startPrank(initiator);
    token.approve(address(train), type(uint256).max);
    fot1.approve(address(train), type(uint256).max);
    fot100.approve(address(train), type(uint256).max);
    vm.stopPrank();
    vm.prank(solver);
    token.approve(address(train), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDst', dstAmount: 1, dstToken: 'ETH' });
  }

  function _user(bytes32 hl, uint256 amount, address tokenAddr) internal view returns (Train.UserLockParams memory) {
    return Train.UserLockParams({
      hashlock: hl, amount: amount, rewardAmount: 0, timelockDelta: 3600, rewardTimelockDelta: 1800,
      quoteExpiry: uint48(block.timestamp + 60), recipient: recipient, refundTo: refundTo, token: tokenAddr,
      payoutCurve: address(0), payoutCurveData: '', rewardToken: 'ETH', rewardRecipient: 'rr', srcChain: 'ETH'
    });
  }

  function _solver(uint256 amount, address tokenAddr, uint256 reward) internal view returns (Train.SolverLockParams memory) {
    return Train.SolverLockParams({
      hashlock: hashlock, amount: amount, reward: reward, timelockDelta: 3600, rewardTimelockDelta: 1800,
      recipient: recipient, rewardRecipient: rewardRecipient, refundTo: refundTo, token: tokenAddr,
      rewardToken: tokenAddr, payoutCurve: address(0), payoutCurveData: '', srcChain: 'ETH'
    });
  }

  // ── Zero-received / zero-address / invalid-curve ──

  function test_userLock_FoT_receivedZero_revertsZeroAmount() public {
    vm.prank(initiator);
    vm.expectRevert(Train.ZeroAmount.selector);
    train.userLock(_user(hashlock, 100 ether, address(fot100)), _dst(), '', '');
  }

  function test_userLock_revertsOnZeroRecipient() public {
    Train.UserLockParams memory p = _user(hashlock, 1 ether, address(token));
    p.recipient = address(0);
    vm.prank(initiator);
    vm.expectRevert(Train.ZeroAddress.selector);
    train.userLock(p, _dst(), '', '');
  }

  function test_userLock_revertsOnZeroRefundTo() public {
    Train.UserLockParams memory p = _user(hashlock, 1 ether, address(token));
    p.refundTo = address(0);
    vm.prank(initiator);
    vm.expectRevert(Train.ZeroAddress.selector);
    train.userLock(p, _dst(), '', '');
  }

  function test_solverLock_revertsOnZeroRecipient() public {
    Train.SolverLockParams memory p = _solver(1 ether, NATIVE_ETH, 0);
    p.recipient = address(0);
    vm.prank(solver);
    vm.expectRevert(Train.ZeroAddress.selector);
    train.solverLock{ value: 1 ether }(p, _dst(), '');
  }

  function test_solverLock_revertsOnZeroRefundTo() public {
    Train.SolverLockParams memory p = _solver(1 ether, NATIVE_ETH, 0);
    p.refundTo = address(0);
    vm.prank(solver);
    vm.expectRevert(Train.ZeroAddress.selector);
    train.solverLock{ value: 1 ether }(p, _dst(), '');
  }

  function test_solverLock_rewardWithZeroRewardRecipient_reverts() public {
    Train.SolverLockParams memory p = _solver(1 ether, NATIVE_ETH, 0.1 ether);
    p.rewardRecipient = address(0);
    vm.prank(solver);
    vm.expectRevert(Train.ZeroAddress.selector);
    train.solverLock{ value: 1.1 ether }(p, _dst(), '');
  }

  function test_solverLock_invalidPayoutCurve_reverts() public {
    Train.SolverLockParams memory p = _solver(1 ether, NATIVE_ETH, 0);
    p.payoutCurve = address(0xdead);
    vm.prank(solver);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.solverLock{ value: 1 ether }(p, _dst(), '');
  }

  function test_solverLock_extremeFoT_zeroFloor_reverts() public {
    vm.prank(initiator);
    vm.expectRevert(Train.ZeroAmount.selector);
    train.solverLock(_solver(1, address(fot1), 1000), _dst(), '');
  }

  // ── Native transfer failure ──

  function test_refundUser_ETH_toRejectingRefundTo_revertsTransferFailed() public {
    Train.UserLockParams memory p = _user(hashlock, 1 ether, NATIVE_ETH);
    p.refundTo = payable(address(rejecter));
    vm.prank(initiator);
    train.userLock{ value: 1 ether }(p, _dst(), '', '');
    vm.warp(block.timestamp + 3601);
    vm.prank(relayer);
    vm.expectRevert(Train.TransferFailed.selector);
    train.refundUser(hashlock);
  }

  function test_refundSolver_ETH_toRejectingRefundTo_revertsTransferFailed() public {
    Train.SolverLockParams memory p = _solver(1 ether, NATIVE_ETH, 0);
    p.refundTo = payable(address(rejecter));
    vm.prank(solver);
    train.solverLock{ value: 1 ether }(p, _dst(), '');
    vm.warp(block.timestamp + 3601);
    vm.prank(relayer);
    vm.expectRevert(Train.TransferFailed.selector);
    train.refundSolver(hashlock, solver);
  }

  function test_redeemSolver_ETH_toRejectingRecipient_revertsTransferFailed() public {
    // payout (amount) -> recipient (rejecter) fails on native send => TransferFailed
    Train.SolverLockParams memory p = _solver(1 ether, NATIVE_ETH, 0);
    p.recipient = payable(address(rejecter));
    vm.prank(solver);
    train.solverLock{ value: 1 ether }(p, _dst(), '');
    vm.prank(relayer);
    vm.expectRevert(Train.TransferFailed.selector);
    train.redeemSolver(hashlock, solver, SECRET);
  }

  function test_redeemSolver_ETH_rewardToRejectingRewardRecipient_revertsTransferFailed() public {
    // amount -> recipient (EOA, ok); reward -> rewardRecipient (rejecter) before rewardTimelock => TransferFailed
    Train.SolverLockParams memory p = _solver(1 ether, NATIVE_ETH, 0.5 ether);
    p.rewardRecipient = payable(address(rejecter));
    vm.prank(solver);
    train.solverLock{ value: 1.5 ether }(p, _dst(), '');
    vm.prank(relayer);
    vm.expectRevert(Train.TransferFailed.selector);
    train.redeemSolver(hashlock, solver, SECRET);
  }

  // ── Shared validator reachable via userLockFor ──

  function test_userLockFor_expiredQuote_reverts() public {
    Train.UserLockParams memory p = _user(hashlock, 100 ether, address(token));
    p.quoteExpiry = uint48(block.timestamp);
    vm.prank(initiator);
    vm.expectRevert(Train.QuoteExpired.selector);
    train.userLockFor(initiator, p, _dst(), '', '');
  }

  // ── Double-settle (terminal states are final) ──

  function test_redeemUser_twice_revertsLockNotPending() public {
    vm.prank(initiator);
    train.userLock{ value: 1 ether }(_user(hashlock, 1 ether, NATIVE_ETH), _dst(), '', '');
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    vm.prank(relayer);
    vm.expectRevert(Train.LockNotPending.selector);
    train.redeemUser(hashlock, SECRET);
  }

  function test_refundUser_twice_revertsLockNotPending() public {
    vm.prank(initiator);
    train.userLock{ value: 1 ether }(_user(hashlock, 1 ether, NATIVE_ETH), _dst(), '', '');
    vm.warp(block.timestamp + 3601);
    vm.prank(relayer);
    train.refundUser(hashlock);
    vm.prank(relayer);
    vm.expectRevert(Train.LockNotPending.selector);
    train.refundUser(hashlock);
  }

  function test_redeemSolver_twice_revertsLockNotPending() public {
    vm.prank(solver);
    train.solverLock{ value: 1 ether }(_solver(1 ether, NATIVE_ETH, 0), _dst(), '');
    vm.prank(relayer);
    train.redeemSolver(hashlock, solver, SECRET);
    vm.prank(relayer);
    vm.expectRevert(Train.LockNotPending.selector);
    train.redeemSolver(hashlock, solver, SECRET);
  }

  function test_refundSolver_twice_revertsLockNotPending() public {
    vm.prank(solver);
    train.solverLock{ value: 1 ether }(_solver(1 ether, NATIVE_ETH, 0), _dst(), '');
    vm.warp(block.timestamp + 3601);
    vm.prank(relayer);
    train.refundSolver(hashlock, solver);
    vm.prank(relayer);
    vm.expectRevert(Train.LockNotPending.selector);
    train.refundSolver(hashlock, solver);
  }

  // ── Dust ──

  function test_userLock_dust_oneWei_redeems() public {
    vm.prank(initiator);
    train.userLock{ value: 1 }(_user(hashlock, 1, NATIVE_ETH), _dst(), '', '');
    uint256 before = recipient.balance;
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    assertEq(recipient.balance - before, 1);
  }

  function test_solverLock_dust_oneWeiEach_sameToken() public {
    token.mint(solver, 10);
    vm.prank(solver);
    train.solverLock(_solver(1, address(token), 1), _dst(), '');
    Train.SolverLock memory lock = train.getSolverLock(hashlock, solver);
    assertEq(lock.amount, 1);
    assertEq(lock.reward, 1);
  }

  // ── Scale-safe windowed getters ──

  function test_getters_windowedLargeN() public {
    address u = makeAddr('enum');
    uint256 N = 120;
    for (uint256 i = 0; i < N; i++) {
      vm.prank(initiator);
      train.userLockFor(u, _user(bytes32(uint256(i + 1)), 1 ether, address(token)), _dst(), '', '');
    }
    (bytes32[] memory h, uint256 total) = train.getUserLockHashes(u, 0, 10);
    assertEq(total, N);
    assertEq(h.length, 10);
    (Train.UserLock[] memory l, uint256 t2) = train.getUserLocks(u, 115, 10);
    assertEq(t2, N);
    assertEq(l.length, 5);
    (bytes32[] memory h2, uint256 t3) = train.getUserLockHashes(u, 200, 10);
    assertEq(t3, N);
    assertEq(h2.length, 0);
  }

  function test_getUserLockHashes_windowBranches() public {
    _lockFor(1);
    _lockFor(2);
    (bytes32[] memory a, uint256 t0) = train.getUserLockHashes(initiator, 0, 0);
    assertEq(a.length, 0);
    assertEq(t0, 2);
    (bytes32[] memory b, uint256 t1) = train.getUserLockHashes(initiator, 2, 10);
    assertEq(b.length, 0);
    assertEq(t1, 2);
    (bytes32[] memory c, uint256 t2) = train.getUserLockHashes(initiator, 0, 1000);
    assertEq(c.length, 2);
    assertEq(t2, 2);
    (bytes32[] memory d, ) = train.getUserLockHashes(initiator, 1, 1000);
    assertEq(d.length, 1);
  }

  function test_getUserLocks_windowBranches() public {
    _lockFor(1);
    _lockFor(2);
    (Train.UserLock[] memory a, uint256 t0) = train.getUserLocks(initiator, 0, 0);
    assertEq(a.length, 0);
    assertEq(t0, 2);
    (Train.UserLock[] memory b, ) = train.getUserLocks(initiator, 5, 10);
    assertEq(b.length, 0);
    (Train.UserLock[] memory c, ) = train.getUserLocks(initiator, 0, 1000);
    assertEq(c.length, 2);
  }

  function _lockFor(uint256 secret) internal {
    Train.UserLockParams memory p = _user(sha256(abi.encodePacked(secret)), 1 ether, NATIVE_ETH);
    vm.prank(initiator);
    train.userLock{ value: 1 ether }(p, _dst(), '', '');
  }

  // ── Measured-amount event (fee-on-transfer) ──

  function test_userLock_event_emitsMeasuredAmount_FoT() public {
    bytes32 hl = bytes32(uint256(0xFEE));
    Train.UserLockParams memory p = _user(hl, 100 ether, address(fot1));
    Train.DestinationInfo memory d = _dst();
    uint48 tl = uint48(block.timestamp) + p.timelockDelta;
    vm.expectEmit(true, true, true, true);
    emit Train.UserLocked(
      hl, initiator, recipient, p.srcChain, address(fot1), 99 ether, tl, p.payoutCurve,
      d.dstChain, d.dstAddress, d.dstAmount, d.dstToken, p.rewardAmount, p.rewardToken,
      p.rewardRecipient, p.rewardTimelockDelta, p.quoteExpiry, '', ''
    );
    vm.prank(initiator);
    train.userLock(p, d, '', '');
    assertEq(train.getUserLock(hl).amount, 99 ether);
  }

  // ── Timelock bound ──

  function test_userLock_largeTimelockDelta_stores() public {
    Train.UserLockParams memory p = _user(hashlock, 1 ether, NATIVE_ETH);
    p.timelockDelta = uint48(365 days);
    vm.prank(initiator);
    train.userLock{ value: 1 ether }(p, _dst(), '', '');
    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertGt(lock.timelock, lock.startTime);
    assertEq(uint256(lock.timelock), block.timestamp + 365 days);
  }
}
