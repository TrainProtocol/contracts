// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import '../src/TestToken.sol';

contract TrainTest is Test {
  Train public train;
  TestToken public token;
  TestToken public token2;

  address payable initiator;
  address payable solver;
  address payable receiver;
  address payable rewardRecipient;
  address payable relayer;

  uint256 constant SECRET = 12345;
  bytes32 hashlock;

  address constant NATIVE_ETH = address(0);

  function setUp() public {
    train = new Train();
    token = new TestToken();
    token2 = new TestToken();

    initiator = payable(makeAddr('initiator'));
    solver = payable(makeAddr('solver'));
    receiver = payable(makeAddr('receiver'));
    rewardRecipient = payable(makeAddr('rewardRecipient'));
    relayer = payable(makeAddr('relayer'));

    vm.deal(initiator, 100 ether);
    vm.deal(solver, 100 ether);
    vm.deal(relayer, 1 ether);

    token.mint(initiator, 1000 ether);
    token.mint(solver, 1000 ether);
    token2.mint(solver, 1000 ether);

    vm.prank(initiator);
    token.approve(address(train), type(uint256).max);

    vm.prank(solver);
    token.approve(address(train), type(uint256).max);

    vm.prank(solver);
    token2.approve(address(train), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  function _getTimelockDeltas() internal pure returns (uint48 timelockDelta, uint48 rewardTimelockDelta) {
    timelockDelta = 3600; // 1 hour
    rewardTimelockDelta = 1800; // 30 minutes
  }

  function _defaultDestination() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDstAddr', dstAmount: 1, dstToken: 'ETH' });
  }

  function _defaultUserParams(uint256 amount, address tokenAddr) internal view returns (Train.UserLockParams memory) {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    return
      Train.UserLockParams({
        hashlock: hashlock,
        amount: amount,
        rewardAmount: 0,
        timelockDelta: timelockDelta,
        rewardTimelockDelta: rewardTimelockDelta,
        quoteExpiry: uint48(block.timestamp + 60),
        refundTo: address(0),
        recipient: receiver,
        token: tokenAddr,
        rewardToken: 'ETH',
        rewardRecipient: 'rewardRecipient',
        srcChain: 'ETH'
      });
  }

  function _defaultSolverParams(
    uint256 amount,
    address tokenAddr,
    uint256 reward,
    address rewardTokenAddr
  ) internal view returns (Train.SolverLockParams memory) {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    return
      Train.SolverLockParams({
        hashlock: hashlock,
        amount: amount,
        reward: reward,
        timelockDelta: timelockDelta,
        rewardTimelockDelta: rewardTimelockDelta,
        refundTo: address(0),
        recipient: receiver,
        rewardRecipient: rewardRecipient,
        token: tokenAddr,
        rewardToken: rewardTokenAddr,
        srcChain: 'ETH'
      });
  }

  // ============ User Lock Tests ============

  function test_userLock_ETH_InitializesLock() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 1 ether;

    Train.UserLockParams memory params = _defaultUserParams(amount, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: amount }(params, _defaultDestination(), '', '');

    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.amount, amount);
    assertEq(lock.sender, initiator);
    assertEq(lock.recipient, receiver);
    assertEq(lock.token, NATIVE_ETH);
    assertEq(lock.timelock, uint48(block.timestamp) + timelockDelta);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Pending));
  }

  function test_userLock_ERC20_TransfersTokens() public {
    uint256 amount = 100 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, address(token));

    uint256 initiatorBalanceBefore = token.balanceOf(initiator);

    vm.prank(initiator);
    train.userLock(params, _defaultDestination(), '', '');

    assertEq(token.balanceOf(initiator), initiatorBalanceBefore - amount);
    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.amount, amount);
    assertEq(lock.token, address(token));
  }

  function test_userLock_RevertsOnQuoteExpired() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);
    params.quoteExpiry = uint48(block.timestamp - 1);

    vm.prank(initiator);
    vm.expectRevert(Train.QuoteExpired.selector);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');
  }

  function test_userLock_RevertsOnQuoteExpiryBoundary() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);
    params.quoteExpiry = uint48(block.timestamp);

    vm.prank(initiator);
    vm.expectRevert(Train.QuoteExpired.selector);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');
  }

  function test_userLock_RevertsOnMsgValueMismatch_ETH() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    vm.expectRevert(Train.MsgValueMismatch.selector);
    train.userLock{ value: 0.5 ether }(params, _defaultDestination(), '', '');
  }

  function test_userLock_RevertsOnMsgValueMismatch_ERC20() public {
    Train.UserLockParams memory params = _defaultUserParams(100 ether, address(token));

    vm.prank(initiator);
    vm.expectRevert(Train.MsgValueMismatch.selector);
    train.userLock{ value: 1 }(params, _defaultDestination(), '', '');
  }

  function test_userLock_RevertsOnInvalidToken() public {
    address fakeToken = makeAddr('fakeToken');
    Train.UserLockParams memory params = _defaultUserParams(1 ether, fakeToken);

    vm.prank(initiator);
    vm.expectRevert(Train.InvalidToken.selector);
    train.userLock(params, _defaultDestination(), '', '');
  }

  function test_userLock_RevertsOnZeroAmount() public {
    Train.UserLockParams memory params = _defaultUserParams(0, NATIVE_ETH);

    vm.prank(initiator);
    vm.expectRevert(Train.ZeroAmount.selector);
    train.userLock(params, _defaultDestination(), '', '');
  }

  function test_userLock_RevertsOnInvalidTimelock() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);
    params.timelockDelta = 0;

    vm.prank(initiator);
    vm.expectRevert(Train.InvalidTimelock.selector);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');
  }

  function test_userLock_RevertsOnDuplicateHashlock() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.prank(initiator);
    vm.expectRevert(Train.SwapAlreadyExists.selector);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');
  }

  // ============ Redeem / Refund User Tests ============

  function test_redeemUser_TransfersFunds() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    uint256 receiverBalanceBefore = receiver.balance;

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    assertEq(receiver.balance, receiverBalanceBefore + 1 ether);
    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.secret, SECRET);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Redeemed));
  }

  function test_redeemUser_RevertsOnWrongSecret() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.expectRevert(Train.HashlockMismatch.selector);
    train.redeemUser(hashlock, 99999);
  }

  function test_redeemUser_RevertsOnLockNotFound() public {
    vm.expectRevert(Train.LockNotFound.selector);
    train.redeemUser(hashlock, SECRET);
  }

  function test_refundUser_ByRecipient_BeforeTimelock() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    uint256 initiatorBalanceBefore = initiator.balance;

    vm.prank(receiver);
    train.refundUser(hashlock);

    assertEq(initiator.balance, initiatorBalanceBefore + 1 ether);
  }

  function test_refundUser_ByAnyone_AfterTimelock() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 initiatorBalanceBefore = initiator.balance;

    vm.prank(relayer);
    train.refundUser(hashlock);

    assertEq(initiator.balance, initiatorBalanceBefore + 1 ether);
  }

  function test_refundUser_RevertsIfNotRecipientBeforeTimelock() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.prank(relayer);
    vm.expectRevert(Train.RefundNotAllowed.selector);
    train.refundUser(hashlock);
  }

  function test_refundUser_RevertsOnLockNotFound() public {
    vm.expectRevert(Train.LockNotFound.selector);
    train.refundUser(hashlock);
  }

  function test_userLock_StateTransitions_RevertWhenNotPending() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.prank(receiver);
    train.refundUser(hashlock);

    vm.expectRevert(Train.LockNotPending.selector);
    train.redeemUser(hashlock, SECRET);
  }

  function test_userLock_StateTransitions_RefundAfterRedeemReverts() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    vm.expectRevert(Train.LockNotPending.selector);
    train.refundUser(hashlock);
  }

  // ============ Solver Lock Tests ============

  function test_solverLock_WithReward_StoresLock() public {
    uint256 amount = 0.5 ether;
    uint256 reward = 0.05 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    assertEq(index, 1);
    Train.SolverLock memory lock = train.getSolverLock(hashlock, 1);
    assertEq(lock.amount, amount);
    assertEq(lock.reward, reward);
    assertEq(lock.rewardRecipient, rewardRecipient);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Pending));
  }

  function test_solverLock_AllowsZeroRewardWithAnyRewardTimelockDelta() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH);
    params.rewardTimelockDelta = timelockDelta; // equal is fine when reward == 0

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');
    assertEq(index, 1);
  }

  function test_solverLock_RevertsOnInvalidRewardTimelock() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 1, NATIVE_ETH);
    params.timelockDelta = 100;
    params.rewardTimelockDelta = 100;

    vm.prank(solver);
    vm.expectRevert(Train.InvalidRewardTimelock.selector);
    train.solverLock{ value: 1 ether + 1 }(params, _defaultDestination(), '');
  }

  function test_solverLock_RevertsOnZeroAmount() public {
    Train.SolverLockParams memory params = _defaultSolverParams(0, NATIVE_ETH, 0, NATIVE_ETH);

    vm.prank(solver);
    vm.expectRevert(Train.ZeroAmount.selector);
    train.solverLock(params, _defaultDestination(), '');
  }

  function test_solverLock_RevertsOnInvalidTimelock() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH);
    params.timelockDelta = 0;

    vm.prank(solver);
    vm.expectRevert(Train.InvalidTimelock.selector);
    train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');
  }

  function test_solverLock_RevertsOnInvalidToken() public {
    address fakeToken = makeAddr('fakeToken');
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, fakeToken, 0, NATIVE_ETH);

    vm.prank(solver);
    vm.expectRevert(Train.InvalidToken.selector);
    train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');
  }

  function test_solverLock_RevertsOnInvalidRewardToken() public {
    address fakeToken = makeAddr('fakeToken');
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 1, fakeToken);

    vm.prank(solver);
    vm.expectRevert(Train.InvalidToken.selector);
    train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');
  }

  function test_solverLock_RevertsOnMsgValueMismatch() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH);

    vm.prank(solver);
    vm.expectRevert(Train.MsgValueMismatch.selector);
    train.solverLock(params, _defaultDestination(), '');
  }

  function test_solverLock_MixedTokens_ETHAmountERC20Reward() public {
    uint256 amount = 1 ether;
    uint256 reward = 50 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount }(params, _defaultDestination(), '');
    assertEq(index, 1);

    Train.SolverLock memory lock = train.getSolverLock(hashlock, 1);
    assertEq(lock.token, NATIVE_ETH);
    assertEq(lock.rewardToken, address(token));
    assertEq(lock.reward, reward);
  }

  function test_solverLock_MixedTokens_ERC20AmountETHReward() public {
    uint256 amount = 50 ether;
    uint256 reward = 0.1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: reward }(params, _defaultDestination(), '');
    assertEq(index, 1);

    Train.SolverLock memory lock = train.getSolverLock(hashlock, 1);
    assertEq(lock.token, address(token));
    assertEq(lock.rewardToken, NATIVE_ETH);
    assertEq(lock.reward, reward);
  }

  function test_solverLockCount_Increments() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH);

    vm.prank(solver);
    uint256 index1 = train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');
    assertEq(index1, 1);

    vm.prank(solver);
    uint256 index2 = train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');
    assertEq(index2, 2);

    assertEq(train.getSolverLockCount(hashlock), 2);
  }

  // ============ Redeem / Refund Solver Tests ============

  function test_redeemSolver_BeforeRewardTimelock_RewardToRecipient() public {
    uint256 amount = 1 ether;
    uint256 reward = 0.1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    uint256 receiverBalanceBefore = receiver.balance;
    uint256 rewardRecipientBefore = rewardRecipient.balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(receiver.balance, receiverBalanceBefore + amount);
    assertEq(rewardRecipient.balance, rewardRecipientBefore + reward);
  }

  function test_redeemSolver_AfterRewardTimelock_RewardToRedeemer() public {
    (, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 1 ether;
    uint256 reward = 0.1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + rewardTimelockDelta + 1);

    uint256 receiverBalanceBefore = receiver.balance;
    uint256 relayerBalanceBefore = relayer.balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(receiver.balance, receiverBalanceBefore + amount);
    assertEq(relayer.balance, relayerBalanceBefore + reward);
    Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Redeemed));
  }

  function test_redeemSolver_RevertsOnWrongSecret() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1 ether + 0.1 ether }(params, _defaultDestination(), '');

    vm.expectRevert(Train.HashlockMismatch.selector);
    train.redeemSolver(hashlock, index, 99999);
  }

  function test_redeemSolver_RevertsOnLockNotFound() public {
    vm.expectRevert(Train.LockNotFound.selector);
    train.redeemSolver(hashlock, 1, SECRET);
  }

  function test_refundSolver_RevertsBeforeTimelock() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');

    vm.prank(receiver);
    vm.expectRevert(Train.RefundNotAllowed.selector);
    train.refundSolver(hashlock, index);
  }

  function test_refundSolver_ReturnsAmountAndRewardAfterTimelock() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 1 ether;
    uint256 reward = 0.1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverBalanceBefore = solver.balance;

    vm.prank(receiver);
    train.refundSolver(hashlock, index);

    assertEq(solver.balance, solverBalanceBefore + amount + reward);
  }

  function test_solverLock_StateTransitions_RefundAfterRedeemReverts() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1 ether + 0.1 ether }(params, _defaultDestination(), '');

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    vm.expectRevert(Train.LockNotPending.selector);
    train.refundSolver(hashlock, index);
  }

  function test_solverLock_StateTransitions_RedeemAfterRefundReverts() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1 ether + 0.1 ether }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    vm.prank(receiver);
    train.refundSolver(hashlock, index);

    vm.expectRevert(Train.LockNotPending.selector);
    train.redeemSolver(hashlock, index, SECRET);
  }

  function test_refundSolver_RevertsOnLockNotFound() public {
    vm.expectRevert(Train.LockNotFound.selector);
    train.refundSolver(hashlock, 1);
  }

  function test_redeemSolver_ERC20_SameTokenRewardToReceiverBeforeRewardTimelock() public {
    uint256 amount = 50 ether;
    uint256 reward = 5 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token));
    params.rewardRecipient = receiver;

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    uint256 receiverBalanceBefore = token.balanceOf(receiver);

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(token.balanceOf(receiver), receiverBalanceBefore + amount + reward);
  }

  function test_refundSolver_ERC20_SameToken_ReturnsAmountAndReward() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 50 ether;
    uint256 reward = 5 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverBalanceBefore = token.balanceOf(solver);

    vm.prank(receiver);
    train.refundSolver(hashlock, index);

    assertEq(token.balanceOf(solver), solverBalanceBefore + amount + reward);
  }

  // ============ Event Tests ============

  function test_userLock_EmitsUserLockedEvent() public {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 1 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, NATIVE_ETH);
    params.rewardTimelockDelta = rewardTimelockDelta;
    uint48 expectedTimelock = uint48(block.timestamp) + timelockDelta;

    vm.expectEmit(true, true, true, true);
    emit Train.UserLocked(
      hashlock,
      initiator,
      receiver,
      initiator,
      'ETH',
      NATIVE_ETH,
      amount,
      expectedTimelock,
      'ETH',
      '0xDstAddr',
      1,
      'ETH',
      0,
      'ETH',
      'rewardRecipient',
      rewardTimelockDelta,
      params.quoteExpiry,
      '',
      ''
    );

    vm.prank(initiator);
    train.userLock{ value: amount }(params, _defaultDestination(), '', '');
  }

  function test_solverLock_EmitsSolverLockedEvent() public {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 0.5 ether;
    uint256 reward = 0.05 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);
    uint48 expectedTimelock = uint48(block.timestamp) + timelockDelta;
    uint48 expectedRewardTimelock = expectedTimelock - rewardTimelockDelta;

    vm.expectEmit(true, true, true, true);
    emit Train.SolverLocked(
      hashlock,
      solver,
      receiver,
      solver,
      1,
      'ETH',
      NATIVE_ETH,
      amount,
      reward,
      NATIVE_ETH,
      rewardRecipient,
      expectedTimelock,
      expectedRewardTimelock,
      'ETH',
      '0xDstAddr',
      1,
      'ETH',
      ''
    );

    vm.prank(solver);
    train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');
  }

  // ============ Timelock Boundary Tests ============

  function test_refundUser_AtExactTimelockBoundary_Succeeds() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.warp(block.timestamp + timelockDelta);

    uint256 initiatorBalanceBefore = initiator.balance;

    vm.prank(relayer);
    train.refundUser(hashlock);

    assertEq(initiator.balance, initiatorBalanceBefore + 1 ether);
  }

  function test_refundSolver_AtExactTimelockBoundary_Succeeds() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1.1 ether }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta);

    uint256 solverBalanceBefore = solver.balance;

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    assertEq(solver.balance, solverBalanceBefore + 1.1 ether);
  }

  function test_redeemSolver_AtExactRewardTimelockBoundary_RewardToRedeemer() public {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 1 ether;
    uint256 reward = 0.1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    // Warp to exactly rewardTimelock (timelock - rewardTimelockDelta)
    vm.warp(block.timestamp + timelockDelta - rewardTimelockDelta);

    uint256 relayerBalanceBefore = relayer.balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // At exact boundary, rewardTimelock > block.timestamp is false, so reward goes to redeemer
    assertEq(relayer.balance, relayerBalanceBefore + reward);
  }

  // ============ ERC20 Redemption/Refund Tests ============

  function test_redeemUser_ERC20_TransfersFunds() public {
    uint256 amount = 100 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, address(token));

    vm.prank(initiator);
    train.userLock(params, _defaultDestination(), '', '');

    uint256 receiverBalanceBefore = token.balanceOf(receiver);

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    assertEq(token.balanceOf(receiver), receiverBalanceBefore + amount);
    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.secret, SECRET);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Redeemed));
  }

  function test_refundUser_ERC20_ReturnsFunds() public {
    uint256 amount = 100 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, address(token));

    vm.prank(initiator);
    train.userLock(params, _defaultDestination(), '', '');

    uint256 initiatorBalanceBefore = token.balanceOf(initiator);

    vm.prank(receiver);
    train.refundUser(hashlock);

    assertEq(token.balanceOf(initiator), initiatorBalanceBefore + amount);
    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Refunded));
  }

  // ============ Solver Lock - Two Different ERC20 Tokens ============

  function test_solverLock_TwoDifferentERC20Tokens() public {
    uint256 amount = 50 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token2));

    uint256 solverToken1Before = token.balanceOf(solver);
    uint256 solverToken2Before = token2.balanceOf(solver);

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    assertEq(index, 1);
    assertEq(token.balanceOf(solver), solverToken1Before - amount);
    assertEq(token2.balanceOf(solver), solverToken2Before - reward);

    Train.SolverLock memory lock = train.getSolverLock(hashlock, 1);
    assertEq(lock.token, address(token));
    assertEq(lock.rewardToken, address(token2));
  }

  function test_redeemSolver_TwoDifferentERC20Tokens() public {
    uint256 amount = 50 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token2));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    uint256 receiverToken1Before = token.balanceOf(receiver);
    uint256 rewardRecipientToken2Before = token2.balanceOf(rewardRecipient);

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(token.balanceOf(receiver), receiverToken1Before + amount);
    assertEq(token2.balanceOf(rewardRecipient), rewardRecipientToken2Before + reward);
  }

  function test_refundSolver_TwoDifferentERC20Tokens() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 50 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token2));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverToken1Before = token.balanceOf(solver);
    uint256 solverToken2Before = token2.balanceOf(solver);

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    assertEq(token.balanceOf(solver), solverToken1Before + amount);
    assertEq(token2.balanceOf(solver), solverToken2Before + reward);
  }

  // ============ RedeemSolver Edge Cases ============

  function test_redeemSolver_RecipientRedeems_GetsBothAmountAndReward() public {
    uint256 amount = 1 ether;
    uint256 reward = 0.1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);
    params.rewardRecipient = receiver; // Same as recipient

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    uint256 receiverBalanceBefore = receiver.balance;

    // Recipient redeems before rewardTimelock
    vm.prank(receiver);
    train.redeemSolver(hashlock, index, SECRET);

    // Receiver gets both amount and reward (combined transfer optimization)
    assertEq(receiver.balance, receiverBalanceBefore + amount + reward);
  }

  function test_redeemSolver_ZeroReward() public {
    uint256 amount = 1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, 0, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount }(params, _defaultDestination(), '');

    uint256 receiverBalanceBefore = receiver.balance;
    uint256 relayerBalanceBefore = relayer.balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(receiver.balance, receiverBalanceBefore + amount);
    assertEq(relayer.balance, relayerBalanceBefore); // No reward
  }

  // ============ RefundSolver Edge Cases ============

  function test_refundSolver_MixedTokens_ETHAmountERC20Reward() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 1 ether;
    uint256 reward = 50 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverETHBefore = solver.balance;
    uint256 solverTokenBefore = token.balanceOf(solver);

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    assertEq(solver.balance, solverETHBefore + amount);
    assertEq(token.balanceOf(solver), solverTokenBefore + reward);
  }

  // ============ View Functions Tests ============

  function test_getUserLock_NonExistent_ReturnsEmptyStruct() public view {
    bytes32 nonExistentHashlock = sha256(abi.encodePacked(uint256(99999)));
    Train.UserLock memory lock = train.getUserLock(nonExistentHashlock);

    assertEq(lock.secret, 0);
    assertEq(lock.amount, 0);
    assertEq(lock.sender, address(0));
    assertEq(lock.timelock, 0);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Empty));
    assertEq(lock.recipient, address(0));
    assertEq(lock.token, address(0));
  }

  function test_getSolverLock_NonExistent_ReturnsEmptyStruct() public view {
    bytes32 nonExistentHashlock = sha256(abi.encodePacked(uint256(99999)));
    Train.SolverLock memory lock = train.getSolverLock(nonExistentHashlock, 1);

    assertEq(lock.secret, 0);
    assertEq(lock.amount, 0);
    assertEq(lock.reward, 0);
    assertEq(lock.sender, address(0));
    assertEq(lock.timelock, 0);
    assertEq(lock.rewardTimelock, 0);
    assertEq(lock.recipient, address(0));
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Empty));
    assertEq(lock.rewardRecipient, address(0));
    assertEq(lock.token, address(0));
    assertEq(lock.rewardToken, address(0));
  }

  function test_getSolverLockCount_NonExistent_ReturnsZero() public view {
    bytes32 nonExistentHashlock = sha256(abi.encodePacked(uint256(99999)));
    uint256 count = train.getSolverLockCount(nonExistentHashlock);

    assertEq(count, 0);
  }

  function test_getUserLockHashes_SingleLock() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(hashes.length, 1);
    assertEq(total, 1);
    assertEq(hashes[0], hashlock);
  }

  function test_getUserLockHashes_MultipleLocks() public {
    uint256 secret1 = 111;
    uint256 secret2 = 222;
    uint256 secret3 = 333;
    bytes32 hashlock1 = sha256(abi.encodePacked(secret1));
    bytes32 hashlock2 = sha256(abi.encodePacked(secret2));
    bytes32 hashlock3 = sha256(abi.encodePacked(secret3));

    Train.UserLockParams memory params1 = _defaultUserParams(1 ether, NATIVE_ETH);
    params1.hashlock = hashlock1;
    Train.UserLockParams memory params2 = _defaultUserParams(2 ether, NATIVE_ETH);
    params2.hashlock = hashlock2;
    Train.UserLockParams memory params3 = _defaultUserParams(3 ether, address(token));
    params3.hashlock = hashlock3;

    vm.startPrank(initiator);
    train.userLock{ value: 1 ether }(params1, _defaultDestination(), '', '');
    train.userLock{ value: 2 ether }(params2, _defaultDestination(), '', '');
    train.userLock(params3, _defaultDestination(), '', '');
    vm.stopPrank();

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(hashes.length, 3);
    assertEq(total, 3);
    assertEq(hashes[0], hashlock1);
    assertEq(hashes[1], hashlock2);
    assertEq(hashes[2], hashlock3);
  }

  function test_getUserLockHashes_EmptyForNewUser() public {
    address newUser = makeAddr('newUser');
    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(newUser, Train.LockStatus.Empty, 0, 10);

    assertEq(hashes.length, 0);
    assertEq(total, 0);
  }

  function test_getUserLockHashes_PersistsAfterRedemption() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(hashes.length, 1);
    assertEq(total, 1);
    assertEq(hashes[0], hashlock);
  }

  function test_getUserLockHashes_PersistsAfterRefund() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.warp(block.timestamp + timelockDelta + 1);

    vm.prank(relayer);
    train.refundUser(hashlock);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(hashes.length, 1);
    assertEq(total, 1);
    assertEq(hashes[0], hashlock);
  }

  function test_getUserLocks_SingleLock() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(locks.length, 1);
    assertEq(total, 1);
    assertEq(locks[0].amount, 1 ether);
    assertEq(locks[0].sender, initiator);
    assertEq(locks[0].recipient, receiver);
    assertEq(locks[0].token, NATIVE_ETH);
    assertEq(uint8(locks[0].status), uint8(Train.LockStatus.Pending));
  }

  function test_getUserLocks_MultipleLocks() public {
    uint256 secret1 = 111;
    uint256 secret2 = 222;
    bytes32 hashlock1 = sha256(abi.encodePacked(secret1));
    bytes32 hashlock2 = sha256(abi.encodePacked(secret2));

    Train.UserLockParams memory params1 = _defaultUserParams(1 ether, NATIVE_ETH);
    params1.hashlock = hashlock1;
    Train.UserLockParams memory params2 = _defaultUserParams(2 ether, address(token));
    params2.hashlock = hashlock2;

    vm.startPrank(initiator);
    train.userLock{ value: 1 ether }(params1, _defaultDestination(), '', '');
    train.userLock(params2, _defaultDestination(), '', '');
    vm.stopPrank();

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(locks.length, 2);
    assertEq(total, 2);
    assertEq(locks[0].amount, 1 ether);
    assertEq(locks[0].token, NATIVE_ETH);
    assertEq(locks[1].amount, 2 ether);
    assertEq(locks[1].token, address(token));
  }

  function test_getUserLocks_EmptyForNewUser() public {
    address newUser = makeAddr('newUser');
    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(newUser, Train.LockStatus.Empty, 0, 10);

    assertEq(locks.length, 0);
    assertEq(total, 0);
  }

  function test_getUserLocks_ReflectsRedeemedStatus() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(locks.length, 1);
    assertEq(total, 1);
    assertEq(uint8(locks[0].status), uint8(Train.LockStatus.Redeemed));
    assertEq(locks[0].secret, SECRET);
  }

  function test_getUserLocks_ReflectsRefundedStatus() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.warp(block.timestamp + timelockDelta + 1);

    vm.prank(relayer);
    train.refundUser(hashlock);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, Train.LockStatus.Empty, 0, 10);

    assertEq(locks.length, 1);
    assertEq(total, 1);
    assertEq(uint8(locks[0].status), uint8(Train.LockStatus.Refunded));
  }

  function test_getUserLocks_OnlyTracksUserAsInitiator() public {
    uint256 secret1 = 111;
    bytes32 hashlock1 = sha256(abi.encodePacked(secret1));

    // initiator creates a lock
    Train.UserLockParams memory params1 = _defaultUserParams(1 ether, NATIVE_ETH);
    params1.hashlock = hashlock1;

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params1, _defaultDestination(), '', '');

    // solver creates a different lock
    Train.UserLockParams memory params2 = _defaultUserParams(2 ether, NATIVE_ETH);

    vm.prank(solver);
    train.userLock{ value: 2 ether }(params2, _defaultDestination(), '', '');

    // Check initiator's locks
    (Train.UserLock[] memory initiatorLocks, uint256 initiatorTotal) = train.getUserLocks(
      initiator,
      Train.LockStatus.Empty,
      0,
      10
    );
    assertEq(initiatorLocks.length, 1);
    assertEq(initiatorTotal, 1);
    assertEq(initiatorLocks[0].amount, 1 ether);

    // Check solver's locks
    (Train.UserLock[] memory solverLocks, uint256 solverTotal) = train.getUserLocks(
      solver,
      Train.LockStatus.Empty,
      0,
      10
    );
    assertEq(solverLocks.length, 1);
    assertEq(solverTotal, 1);
    assertEq(solverLocks[0].amount, 2 ether);

    // Check receiver has no locks (they are only recipient, not sender)
    (Train.UserLock[] memory receiverLocks, uint256 receiverTotal) = train.getUserLocks(
      receiver,
      Train.LockStatus.Empty,
      0,
      10
    );
    assertEq(receiverLocks.length, 0);
    assertEq(receiverTotal, 0);
  }

  function test_getUserLocks_WithStatusFilter_Redeemed() public {
    uint256 secret1 = 111;
    uint256 secret2 = 222;
    uint256 secret3 = 333;
    bytes32 hashlock1 = sha256(abi.encodePacked(secret1));
    bytes32 hashlock2 = sha256(abi.encodePacked(secret2));
    bytes32 hashlock3 = sha256(abi.encodePacked(secret3));

    Train.UserLockParams memory params1 = _defaultUserParams(1 ether, NATIVE_ETH);
    params1.hashlock = hashlock1;
    Train.UserLockParams memory params2 = _defaultUserParams(2 ether, NATIVE_ETH);
    params2.hashlock = hashlock2;
    Train.UserLockParams memory params3 = _defaultUserParams(3 ether, NATIVE_ETH);
    params3.hashlock = hashlock3;

    vm.startPrank(initiator);
    train.userLock{ value: 1 ether }(params1, _defaultDestination(), '', '');
    train.userLock{ value: 2 ether }(params2, _defaultDestination(), '', '');
    train.userLock{ value: 3 ether }(params3, _defaultDestination(), '', '');
    vm.stopPrank();

    // Redeem 2 of them
    vm.prank(relayer);
    train.redeemUser(hashlock1, secret1);

    vm.prank(relayer);
    train.redeemUser(hashlock2, secret2);

    // Query only redeemed locks
    (Train.UserLock[] memory redeemedLocks, uint256 redeemedTotal) = train.getUserLocks(
      initiator,
      Train.LockStatus.Redeemed,
      0,
      10
    );

    assertEq(redeemedLocks.length, 2);
    assertEq(redeemedTotal, 2);
    assertEq(uint8(redeemedLocks[0].status), uint8(Train.LockStatus.Redeemed));
    assertEq(uint8(redeemedLocks[1].status), uint8(Train.LockStatus.Redeemed));

    // Query only pending locks
    (Train.UserLock[] memory pendingLocks, uint256 pendingTotal) = train.getUserLocks(
      initiator,
      Train.LockStatus.Pending,
      0,
      10
    );

    assertEq(pendingLocks.length, 1);
    assertEq(pendingTotal, 1);
    assertEq(uint8(pendingLocks[0].status), uint8(Train.LockStatus.Pending));
  }

  function test_getUserLocks_WithPagination() public {
    // Create 5 locks
    for (uint256 i = 1; i <= 5; i++) {
      uint256 secret = 1000 + i;
      bytes32 lockHashlock = sha256(abi.encodePacked(secret));

      Train.UserLockParams memory params = _defaultUserParams(i * 1 ether, NATIVE_ETH);
      params.hashlock = lockHashlock;

      vm.prank(initiator);
      train.userLock{ value: i * 1 ether }(params, _defaultDestination(), '', '');
    }

    // Page 1: Get first 2
    (Train.UserLock[] memory page1, uint256 total1) = train.getUserLocks(initiator, Train.LockStatus.Empty, 0, 2);
    assertEq(page1.length, 2);
    assertEq(total1, 5);

    // Page 2: Get next 2
    (Train.UserLock[] memory page2, uint256 total2) = train.getUserLocks(initiator, Train.LockStatus.Empty, 2, 2);
    assertEq(page2.length, 2);
    assertEq(total2, 5);

    // Page 3: Get last 1
    (Train.UserLock[] memory page3, uint256 total3) = train.getUserLocks(initiator, Train.LockStatus.Empty, 4, 2);
    assertEq(page3.length, 1);
    assertEq(total3, 5);

    // Out of range
    (Train.UserLock[] memory page4, uint256 total4) = train.getUserLocks(initiator, Train.LockStatus.Empty, 10, 2);
    assertEq(page4.length, 0);
    assertEq(total4, 5);
  }

  function test_getUserLockHashes_WithStatusFilter() public {
    uint256 secret1 = 111;
    uint256 secret2 = 222;
    bytes32 hashlock1 = sha256(abi.encodePacked(secret1));
    bytes32 hashlock2 = sha256(abi.encodePacked(secret2));

    Train.UserLockParams memory params1 = _defaultUserParams(1 ether, NATIVE_ETH);
    params1.hashlock = hashlock1;
    Train.UserLockParams memory params2 = _defaultUserParams(2 ether, NATIVE_ETH);
    params2.hashlock = hashlock2;

    vm.startPrank(initiator);
    train.userLock{ value: 1 ether }(params1, _defaultDestination(), '', '');
    train.userLock{ value: 2 ether }(params2, _defaultDestination(), '', '');
    vm.stopPrank();

    // Redeem one
    vm.prank(relayer);
    train.redeemUser(hashlock1, secret1);

    // Get only redeemed
    (bytes32[] memory redeemedHashes, uint256 redeemedTotal) = train.getUserLockHashes(
      initiator,
      Train.LockStatus.Redeemed,
      0,
      10
    );
    assertEq(redeemedHashes.length, 1);
    assertEq(redeemedTotal, 1);
    assertEq(redeemedHashes[0], hashlock1);

    // Get only pending
    (bytes32[] memory pendingHashes, uint256 pendingTotal) = train.getUserLockHashes(
      initiator,
      Train.LockStatus.Pending,
      0,
      10
    );
    assertEq(pendingHashes.length, 1);
    assertEq(pendingTotal, 1);
    assertEq(pendingHashes[0], hashlock2);
  }

  // ============ Additional Event Tests ============

  function test_refundUser_EmitsUserRefundedEvent() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.expectEmit(true, false, false, false);
    emit Train.UserRefunded(hashlock);

    vm.prank(receiver);
    train.refundUser(hashlock);
  }

  function test_refundSolver_EmitsSolverRefundedEvent() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1.1 ether }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    vm.expectEmit(true, true, false, false);
    emit Train.SolverRefunded(hashlock, index);

    vm.prank(relayer);
    train.refundSolver(hashlock, index);
  }

  function test_redeemUser_EmitsUserRedeemedEvent() public {
    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.expectEmit(true, false, false, true);
    emit Train.UserRedeemed(hashlock, relayer, SECRET);

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
  }

  function test_redeemSolver_EmitsSolverRedeemedEvent() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: 1.1 ether }(params, _defaultDestination(), '');

    vm.expectEmit(true, true, false, true);
    emit Train.SolverRedeemed(hashlock, index, relayer, SECRET);

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);
  }

  // ============ Contract Balance Verification ============

  function test_userLock_ETH_IncreasesContractBalance() public {
    uint256 amount = 1 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, NATIVE_ETH);

    uint256 contractBalanceBefore = address(train).balance;

    vm.prank(initiator);
    train.userLock{ value: amount }(params, _defaultDestination(), '', '');

    assertEq(address(train).balance, contractBalanceBefore + amount);
  }

  function test_userLock_ERC20_IncreasesContractBalance() public {
    uint256 amount = 100 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, address(token));

    uint256 contractBalanceBefore = token.balanceOf(address(train));

    vm.prank(initiator);
    train.userLock(params, _defaultDestination(), '', '');

    assertEq(token.balanceOf(address(train)), contractBalanceBefore + amount);
  }

  function test_solverLock_ETH_IncreasesContractBalance() public {
    uint256 amount = 1 ether;
    uint256 reward = 0.1 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    uint256 contractBalanceBefore = address(train).balance;

    vm.prank(solver);
    train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    assertEq(address(train).balance, contractBalanceBefore + amount + reward);
  }

  function test_redeemUser_ETH_DecreasesContractBalance() public {
    uint256 amount = 1 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: amount }(params, _defaultDestination(), '', '');

    uint256 contractBalanceBefore = address(train).balance;

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    assertEq(address(train).balance, contractBalanceBefore - amount);
  }

  function test_refundUser_ETH_DecreasesContractBalance() public {
    uint256 amount = 1 ether;
    Train.UserLockParams memory params = _defaultUserParams(amount, NATIVE_ETH);

    vm.prank(initiator);
    train.userLock{ value: amount }(params, _defaultDestination(), '', '');

    uint256 contractBalanceBefore = address(train).balance;

    vm.prank(receiver);
    train.refundUser(hashlock);

    assertEq(address(train).balance, contractBalanceBefore - amount);
  }

  // ============ Multiple Hashlocks Isolation ============

  function test_multipleUserLocks_DifferentHashlocks_Isolated() public {
    uint256 secret1 = 11111;
    uint256 secret2 = 22222;
    bytes32 hashlock1 = sha256(abi.encodePacked(secret1));
    bytes32 hashlock2 = sha256(abi.encodePacked(secret2));

    // Create first lock
    Train.UserLockParams memory params1 = _defaultUserParams(1 ether, NATIVE_ETH);
    params1.hashlock = hashlock1;

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params1, _defaultDestination(), '', '');

    // Create second lock
    Train.UserLockParams memory params2 = _defaultUserParams(2 ether, NATIVE_ETH);
    params2.hashlock = hashlock2;

    vm.prank(initiator);
    train.userLock{ value: 2 ether }(params2, _defaultDestination(), '', '');

    // Verify locks are separate
    Train.UserLock memory lock1 = train.getUserLock(hashlock1);
    Train.UserLock memory lock2 = train.getUserLock(hashlock2);

    assertEq(lock1.amount, 1 ether);
    assertEq(lock2.amount, 2 ether);

    // Redeem first lock
    vm.prank(relayer);
    train.redeemUser(hashlock1, secret1);

    // Second lock should still be pending
    lock1 = train.getUserLock(hashlock1);
    lock2 = train.getUserLock(hashlock2);

    assertEq(uint8(lock1.status), uint8(Train.LockStatus.Redeemed));
    assertEq(uint8(lock2.status), uint8(Train.LockStatus.Pending));
  }

  function test_multipleSolverLocks_SameHashlock_IndependentIndices() public {
    Train.SolverLockParams memory params = _defaultSolverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH);

    // Create multiple solver locks for same hashlock
    vm.prank(solver);
    uint256 index1 = train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');

    vm.prank(solver);
    uint256 index2 = train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');

    vm.prank(solver);
    uint256 index3 = train.solverLock{ value: 1 ether }(params, _defaultDestination(), '');

    assertEq(index1, 1);
    assertEq(index2, 2);
    assertEq(index3, 3);
    assertEq(train.getSolverLockCount(hashlock), 3);

    // Redeem only index 2
    vm.prank(relayer);
    train.redeemSolver(hashlock, index2, SECRET);

    // Verify status of each
    assertEq(uint8(train.getSolverLock(hashlock, 1).status), uint8(Train.LockStatus.Pending));
    assertEq(uint8(train.getSolverLock(hashlock, 2).status), uint8(Train.LockStatus.Redeemed));
    assertEq(uint8(train.getSolverLock(hashlock, 3).status), uint8(Train.LockStatus.Pending));
  }

  // ============ Data Parameter Tests ============

  function test_userLock_WithData_EmitsCorrectly() public {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 1 ether;
    bytes memory data = hex'deadbeef1234567890';
    Train.UserLockParams memory params = _defaultUserParams(amount, NATIVE_ETH);
    uint48 expectedTimelock = uint48(block.timestamp) + timelockDelta;

    vm.expectEmit(true, true, true, true);
    emit Train.UserLocked(
      hashlock,
      initiator,
      receiver,
      initiator,
      'ETH',
      NATIVE_ETH,
      amount,
      expectedTimelock,
      'ETH',
      '0xDstAddr',
      1,
      'ETH',
      0,
      'ETH',
      'rewardRecipient',
      rewardTimelockDelta,
      params.quoteExpiry,
      data,
      data
    );

    vm.prank(initiator);
    train.userLock{ value: amount }(params, _defaultDestination(), data, data);
  }

  function test_solverLock_WithData_EmitsCorrectly() public {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 1 ether;
    uint256 reward = 0.1 ether;
    bytes memory data = hex'cafebabe';
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);
    uint48 expectedTimelock = uint48(block.timestamp) + timelockDelta;
    uint48 expectedRewardTimelock = expectedTimelock - rewardTimelockDelta;

    vm.expectEmit(true, true, true, true);
    emit Train.SolverLocked(
      hashlock,
      solver,
      receiver,
      solver,
      1,
      'ETH',
      NATIVE_ETH,
      amount,
      reward,
      NATIVE_ETH,
      rewardRecipient,
      expectedTimelock,
      expectedRewardTimelock,
      'ETH',
      '0xDstAddr',
      1,
      'ETH',
      data
    );

    vm.prank(solver);
    train.solverLock{ value: amount + reward }(params, _defaultDestination(), data);
  }

  // ============ Gas Stipend Failure Test ============

  function test_redeemUser_ToContractWithHighGasUsage_Reverts() public {
    // Deploy a contract that uses more than 10k gas on receive
    GasConsumer gasConsumer = new GasConsumer();

    Train.UserLockParams memory params = _defaultUserParams(1 ether, NATIVE_ETH);
    params.recipient = address(gasConsumer);

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _defaultDestination(), '', '');

    vm.expectRevert(Train.TransferFailed.selector);
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
  }

  // ============================================================
  // TOKEN COMBINATION TESTS: (token, rewardToken) Combinations
  // ============================================================
  // Tests all 4 combinations: (ETH,ETH), (ETH,ERC20), (ERC20,ETH), (ERC20,ERC20)
  // Each validates: solverLock, redeemSolver (before/after rewardTimelock), refundSolver
  // Balance checks: sender, receiver, rewardRecipient, redeemer, contract

  // ============ Combination 1: (ETH, ETH) ============

  function test_solverLock_ETH_ETH_BalanceChanges() public {
    uint256 amount = 2 ether;
    uint256 reward = 0.2 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    uint256 solverBalanceBefore = solver.balance;
    uint256 contractETHBefore = address(train).balance;

    vm.prank(solver);
    train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    // Verify balance changes
    assertEq(solver.balance, solverBalanceBefore - amount - reward, 'Solver ETH should decrease by amount+reward');
    assertEq(
      address(train).balance,
      contractETHBefore + amount + reward,
      'Contract ETH should increase by amount+reward'
    );
  }

  function test_redeemSolver_ETH_ETH_BeforeRewardTimelock_BalanceChanges() public {
    uint256 amount = 2 ether;
    uint256 reward = 0.2 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    uint256 receiverBalanceBefore = receiver.balance;
    uint256 rewardRecipientBalanceBefore = rewardRecipient.balance;
    uint256 relayerBalanceBefore = relayer.balance;
    uint256 contractETHBefore = address(train).balance;

    // Redeem before rewardTimelock
    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(receiver.balance, receiverBalanceBefore + amount, 'Receiver should get amount');
    assertEq(rewardRecipient.balance, rewardRecipientBalanceBefore + reward, 'RewardRecipient should get reward');
    assertEq(relayer.balance, relayerBalanceBefore, 'Relayer should get nothing (before rewardTimelock)');
    assertEq(
      address(train).balance,
      contractETHBefore - amount - reward,
      'Contract ETH should decrease by amount+reward'
    );
  }

  function test_redeemSolver_ETH_ETH_AfterRewardTimelock_BalanceChanges() public {
    (, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 2 ether;
    uint256 reward = 0.2 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    // Warp past rewardTimelock
    vm.warp(block.timestamp + rewardTimelockDelta + 1);

    uint256 receiverBalanceBefore = receiver.balance;
    uint256 rewardRecipientBalanceBefore = rewardRecipient.balance;
    uint256 relayerBalanceBefore = relayer.balance;
    uint256 contractETHBefore = address(train).balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(receiver.balance, receiverBalanceBefore + amount, 'Receiver should get amount');
    assertEq(
      rewardRecipient.balance,
      rewardRecipientBalanceBefore,
      'RewardRecipient should get nothing (after rewardTimelock)'
    );
    assertEq(relayer.balance, relayerBalanceBefore + reward, 'Relayer should get reward (after rewardTimelock)');
    assertEq(
      address(train).balance,
      contractETHBefore - amount - reward,
      'Contract ETH should decrease by amount+reward'
    );
  }

  function test_refundSolver_ETH_ETH_BalanceChanges() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 2 ether;
    uint256 reward = 0.2 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    // Warp past timelock
    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverBalanceBefore = solver.balance;
    uint256 contractETHBefore = address(train).balance;

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    // Verify balance changes
    assertEq(solver.balance, solverBalanceBefore + amount + reward, 'Solver should get amount+reward back');
    assertEq(
      address(train).balance,
      contractETHBefore - amount - reward,
      'Contract ETH should decrease by amount+reward'
    );
  }

  // ============ Combination 2: (ETH, ERC20) ============

  function test_solverLock_ETH_ERC20_BalanceChanges() public {
    uint256 amount = 2 ether;
    uint256 reward = 100 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, address(token));

    uint256 solverETHBefore = solver.balance;
    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 contractETHBefore = address(train).balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(solver);
    train.solverLock{ value: amount }(params, _defaultDestination(), '');

    // Verify balance changes
    assertEq(solver.balance, solverETHBefore - amount, 'Solver ETH should decrease by amount');
    assertEq(token.balanceOf(solver), solverTokenBefore - reward, 'Solver token should decrease by reward');
    assertEq(address(train).balance, contractETHBefore + amount, 'Contract ETH should increase by amount');
    assertEq(token.balanceOf(address(train)), contractTokenBefore + reward, 'Contract token should increase by reward');
  }

  function test_redeemSolver_ETH_ERC20_BeforeRewardTimelock_BalanceChanges() public {
    uint256 amount = 2 ether;
    uint256 reward = 100 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount }(params, _defaultDestination(), '');

    uint256 receiverETHBefore = receiver.balance;
    uint256 rewardRecipientTokenBefore = token.balanceOf(rewardRecipient);
    uint256 relayerTokenBefore = token.balanceOf(relayer);
    uint256 contractETHBefore = address(train).balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(receiver.balance, receiverETHBefore + amount, 'Receiver should get ETH amount');
    assertEq(
      token.balanceOf(rewardRecipient),
      rewardRecipientTokenBefore + reward,
      'RewardRecipient should get token reward'
    );
    assertEq(token.balanceOf(relayer), relayerTokenBefore, 'Relayer should get no tokens (before rewardTimelock)');
    assertEq(address(train).balance, contractETHBefore - amount, 'Contract ETH should decrease by amount');
    assertEq(token.balanceOf(address(train)), contractTokenBefore - reward, 'Contract token should decrease by reward');
  }

  function test_redeemSolver_ETH_ERC20_AfterRewardTimelock_BalanceChanges() public {
    (, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 2 ether;
    uint256 reward = 100 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + rewardTimelockDelta + 1);

    uint256 receiverETHBefore = receiver.balance;
    uint256 rewardRecipientTokenBefore = token.balanceOf(rewardRecipient);
    uint256 relayerTokenBefore = token.balanceOf(relayer);
    uint256 contractETHBefore = address(train).balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(receiver.balance, receiverETHBefore + amount, 'Receiver should get ETH amount');
    assertEq(
      token.balanceOf(rewardRecipient),
      rewardRecipientTokenBefore,
      'RewardRecipient should get no tokens (after rewardTimelock)'
    );
    assertEq(
      token.balanceOf(relayer),
      relayerTokenBefore + reward,
      'Relayer should get token reward (after rewardTimelock)'
    );
    assertEq(address(train).balance, contractETHBefore - amount, 'Contract ETH should decrease by amount');
    assertEq(token.balanceOf(address(train)), contractTokenBefore - reward, 'Contract token should decrease by reward');
  }

  function test_refundSolver_ETH_ERC20_BalanceChanges() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 2 ether;
    uint256 reward = 100 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverETHBefore = solver.balance;
    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 contractETHBefore = address(train).balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    // Verify balance changes
    assertEq(solver.balance, solverETHBefore + amount, 'Solver should get ETH amount back');
    assertEq(token.balanceOf(solver), solverTokenBefore + reward, 'Solver should get token reward back');
    assertEq(address(train).balance, contractETHBefore - amount, 'Contract ETH should decrease by amount');
    assertEq(token.balanceOf(address(train)), contractTokenBefore - reward, 'Contract token should decrease by reward');
  }

  // ============ Combination 3: (ERC20, ETH) ============

  function test_solverLock_ERC20_ETH_BalanceChanges() public {
    uint256 amount = 100 ether;
    uint256 reward = 0.5 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, NATIVE_ETH);

    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 solverETHBefore = solver.balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));
    uint256 contractETHBefore = address(train).balance;

    vm.prank(solver);
    train.solverLock{ value: reward }(params, _defaultDestination(), '');

    // Verify balance changes
    assertEq(token.balanceOf(solver), solverTokenBefore - amount, 'Solver token should decrease by amount');
    assertEq(solver.balance, solverETHBefore - reward, 'Solver ETH should decrease by reward');
    assertEq(token.balanceOf(address(train)), contractTokenBefore + amount, 'Contract token should increase by amount');
    assertEq(address(train).balance, contractETHBefore + reward, 'Contract ETH should increase by reward');
  }

  function test_redeemSolver_ERC20_ETH_BeforeRewardTimelock_BalanceChanges() public {
    uint256 amount = 100 ether;
    uint256 reward = 0.5 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: reward }(params, _defaultDestination(), '');

    uint256 receiverTokenBefore = token.balanceOf(receiver);
    uint256 rewardRecipientETHBefore = rewardRecipient.balance;
    uint256 relayerETHBefore = relayer.balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));
    uint256 contractETHBefore = address(train).balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(token.balanceOf(receiver), receiverTokenBefore + amount, 'Receiver should get token amount');
    assertEq(rewardRecipient.balance, rewardRecipientETHBefore + reward, 'RewardRecipient should get ETH reward');
    assertEq(relayer.balance, relayerETHBefore, 'Relayer should get no ETH (before rewardTimelock)');
    assertEq(token.balanceOf(address(train)), contractTokenBefore - amount, 'Contract token should decrease by amount');
    assertEq(address(train).balance, contractETHBefore - reward, 'Contract ETH should decrease by reward');
  }

  function test_redeemSolver_ERC20_ETH_AfterRewardTimelock_BalanceChanges() public {
    (, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 100 ether;
    uint256 reward = 0.5 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: reward }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + rewardTimelockDelta + 1);

    uint256 receiverTokenBefore = token.balanceOf(receiver);
    uint256 rewardRecipientETHBefore = rewardRecipient.balance;
    uint256 relayerETHBefore = relayer.balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));
    uint256 contractETHBefore = address(train).balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(token.balanceOf(receiver), receiverTokenBefore + amount, 'Receiver should get token amount');
    assertEq(
      rewardRecipient.balance,
      rewardRecipientETHBefore,
      'RewardRecipient should get no ETH (after rewardTimelock)'
    );
    assertEq(relayer.balance, relayerETHBefore + reward, 'Relayer should get ETH reward (after rewardTimelock)');
    assertEq(token.balanceOf(address(train)), contractTokenBefore - amount, 'Contract token should decrease by amount');
    assertEq(address(train).balance, contractETHBefore - reward, 'Contract ETH should decrease by reward');
  }

  function test_refundSolver_ERC20_ETH_BalanceChanges() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 100 ether;
    uint256 reward = 0.5 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: reward }(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 solverETHBefore = solver.balance;
    uint256 contractTokenBefore = token.balanceOf(address(train));
    uint256 contractETHBefore = address(train).balance;

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    // Verify balance changes
    assertEq(token.balanceOf(solver), solverTokenBefore + amount, 'Solver should get token amount back');
    assertEq(solver.balance, solverETHBefore + reward, 'Solver should get ETH reward back');
    assertEq(token.balanceOf(address(train)), contractTokenBefore - amount, 'Contract token should decrease by amount');
    assertEq(address(train).balance, contractETHBefore - reward, 'Contract ETH should decrease by reward');
  }

  // ============ Combination 4: (ERC20, ERC20) - Same Token ============

  function test_solverLock_ERC20_ERC20_SameToken_BalanceChanges() public {
    uint256 amount = 100 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token));

    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(solver);
    train.solverLock(params, _defaultDestination(), '');

    // Verify balance changes (amount + reward transferred in single token)
    assertEq(
      token.balanceOf(solver),
      solverTokenBefore - amount - reward,
      'Solver token should decrease by amount+reward'
    );
    assertEq(
      token.balanceOf(address(train)),
      contractTokenBefore + amount + reward,
      'Contract token should increase by amount+reward'
    );
  }

  function test_redeemSolver_ERC20_ERC20_SameToken_BeforeRewardTimelock_BalanceChanges() public {
    uint256 amount = 100 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    uint256 receiverTokenBefore = token.balanceOf(receiver);
    uint256 rewardRecipientTokenBefore = token.balanceOf(rewardRecipient);
    uint256 relayerTokenBefore = token.balanceOf(relayer);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(token.balanceOf(receiver), receiverTokenBefore + amount, 'Receiver should get token amount');
    assertEq(
      token.balanceOf(rewardRecipient),
      rewardRecipientTokenBefore + reward,
      'RewardRecipient should get token reward'
    );
    assertEq(token.balanceOf(relayer), relayerTokenBefore, 'Relayer should get no tokens (before rewardTimelock)');
    assertEq(
      token.balanceOf(address(train)),
      contractTokenBefore - amount - reward,
      'Contract token should decrease by amount+reward'
    );
  }

  function test_redeemSolver_ERC20_ERC20_SameToken_AfterRewardTimelock_BalanceChanges() public {
    (, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 100 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    vm.warp(block.timestamp + rewardTimelockDelta + 1);

    uint256 receiverTokenBefore = token.balanceOf(receiver);
    uint256 rewardRecipientTokenBefore = token.balanceOf(rewardRecipient);
    uint256 relayerTokenBefore = token.balanceOf(relayer);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(token.balanceOf(receiver), receiverTokenBefore + amount, 'Receiver should get token amount');
    assertEq(
      token.balanceOf(rewardRecipient),
      rewardRecipientTokenBefore,
      'RewardRecipient should get no tokens (after rewardTimelock)'
    );
    assertEq(
      token.balanceOf(relayer),
      relayerTokenBefore + reward,
      'Relayer should get token reward (after rewardTimelock)'
    );
    assertEq(
      token.balanceOf(address(train)),
      contractTokenBefore - amount - reward,
      'Contract token should decrease by amount+reward'
    );
  }

  function test_refundSolver_ERC20_ERC20_SameToken_BalanceChanges() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 100 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    // Verify balance changes
    assertEq(
      token.balanceOf(solver),
      solverTokenBefore + amount + reward,
      'Solver should get token amount+reward back'
    );
    assertEq(
      token.balanceOf(address(train)),
      contractTokenBefore - amount - reward,
      'Contract token should decrease by amount+reward'
    );
  }

  // ============ Combination 5: (ERC20, ERC20) - Different Tokens ============

  function test_solverLock_ERC20_ERC20_DifferentTokens_BalanceChanges() public {
    uint256 amount = 100 ether;
    uint256 reward = 50 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token2));

    uint256 solverToken1Before = token.balanceOf(solver);
    uint256 solverToken2Before = token2.balanceOf(solver);
    uint256 contractToken1Before = token.balanceOf(address(train));
    uint256 contractToken2Before = token2.balanceOf(address(train));

    vm.prank(solver);
    train.solverLock(params, _defaultDestination(), '');

    // Verify balance changes
    assertEq(token.balanceOf(solver), solverToken1Before - amount, 'Solver token1 should decrease by amount');
    assertEq(token2.balanceOf(solver), solverToken2Before - reward, 'Solver token2 should decrease by reward');
    assertEq(
      token.balanceOf(address(train)),
      contractToken1Before + amount,
      'Contract token1 should increase by amount'
    );
    assertEq(
      token2.balanceOf(address(train)),
      contractToken2Before + reward,
      'Contract token2 should increase by reward'
    );
  }

  function test_redeemSolver_ERC20_ERC20_DifferentTokens_BeforeRewardTimelock_BalanceChanges() public {
    uint256 amount = 100 ether;
    uint256 reward = 50 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token2));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    uint256 receiverToken1Before = token.balanceOf(receiver);
    uint256 rewardRecipientToken2Before = token2.balanceOf(rewardRecipient);
    uint256 relayerToken2Before = token2.balanceOf(relayer);
    uint256 contractToken1Before = token.balanceOf(address(train));
    uint256 contractToken2Before = token2.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(token.balanceOf(receiver), receiverToken1Before + amount, 'Receiver should get token1 amount');
    assertEq(
      token2.balanceOf(rewardRecipient),
      rewardRecipientToken2Before + reward,
      'RewardRecipient should get token2 reward'
    );
    assertEq(token2.balanceOf(relayer), relayerToken2Before, 'Relayer should get no token2 (before rewardTimelock)');
    assertEq(
      token.balanceOf(address(train)),
      contractToken1Before - amount,
      'Contract token1 should decrease by amount'
    );
    assertEq(
      token2.balanceOf(address(train)),
      contractToken2Before - reward,
      'Contract token2 should decrease by reward'
    );
  }

  function test_redeemSolver_ERC20_ERC20_DifferentTokens_AfterRewardTimelock_BalanceChanges() public {
    (, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    uint256 amount = 100 ether;
    uint256 reward = 50 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token2));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    vm.warp(block.timestamp + rewardTimelockDelta + 1);

    uint256 receiverToken1Before = token.balanceOf(receiver);
    uint256 rewardRecipientToken2Before = token2.balanceOf(rewardRecipient);
    uint256 relayerToken2Before = token2.balanceOf(relayer);
    uint256 contractToken1Before = token.balanceOf(address(train));
    uint256 contractToken2Before = token2.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Verify balance changes
    assertEq(token.balanceOf(receiver), receiverToken1Before + amount, 'Receiver should get token1 amount');
    assertEq(
      token2.balanceOf(rewardRecipient),
      rewardRecipientToken2Before,
      'RewardRecipient should get no token2 (after rewardTimelock)'
    );
    assertEq(
      token2.balanceOf(relayer),
      relayerToken2Before + reward,
      'Relayer should get token2 reward (after rewardTimelock)'
    );
    assertEq(
      token.balanceOf(address(train)),
      contractToken1Before - amount,
      'Contract token1 should decrease by amount'
    );
    assertEq(
      token2.balanceOf(address(train)),
      contractToken2Before - reward,
      'Contract token2 should decrease by reward'
    );
  }

  function test_refundSolver_ERC20_ERC20_DifferentTokens_BalanceChanges() public {
    (uint48 timelockDelta, ) = _getTimelockDeltas();
    uint256 amount = 100 ether;
    uint256 reward = 50 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token2));

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverToken1Before = token.balanceOf(solver);
    uint256 solverToken2Before = token2.balanceOf(solver);
    uint256 contractToken1Before = token.balanceOf(address(train));
    uint256 contractToken2Before = token2.balanceOf(address(train));

    vm.prank(relayer);
    train.refundSolver(hashlock, index);

    // Verify balance changes
    assertEq(token.balanceOf(solver), solverToken1Before + amount, 'Solver should get token1 amount back');
    assertEq(token2.balanceOf(solver), solverToken2Before + reward, 'Solver should get token2 reward back');
    assertEq(
      token.balanceOf(address(train)),
      contractToken1Before - amount,
      'Contract token1 should decrease by amount'
    );
    assertEq(
      token2.balanceOf(address(train)),
      contractToken2Before - reward,
      'Contract token2 should decrease by reward'
    );
  }

  // ============ Special Case: Recipient == RewardRecipient Optimization ============

  function test_redeemSolver_ETH_ETH_RecipientIsRewardRecipient_OptimizedTransfer() public {
    uint256 amount = 2 ether;
    uint256 reward = 0.2 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, reward, NATIVE_ETH);
    params.rewardRecipient = receiver; // Same as recipient

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount + reward }(params, _defaultDestination(), '');

    uint256 receiverBalanceBefore = receiver.balance;
    uint256 contractETHBefore = address(train).balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Receiver gets both amount and reward (optimized single transfer)
    assertEq(receiver.balance, receiverBalanceBefore + amount + reward, 'Receiver should get amount+reward combined');
    assertEq(
      address(train).balance,
      contractETHBefore - amount - reward,
      'Contract ETH should decrease by amount+reward'
    );
  }

  function test_redeemSolver_ERC20_ERC20_SameToken_RecipientIsRewardRecipient_OptimizedTransfer() public {
    uint256 amount = 100 ether;
    uint256 reward = 10 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), reward, address(token));
    params.rewardRecipient = receiver; // Same as recipient

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    uint256 receiverTokenBefore = token.balanceOf(receiver);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    // Receiver gets both amount and reward (optimized single transfer)
    assertEq(
      token.balanceOf(receiver),
      receiverTokenBefore + amount + reward,
      'Receiver should get token amount+reward combined'
    );
    assertEq(
      token.balanceOf(address(train)),
      contractTokenBefore - amount - reward,
      'Contract token should decrease by amount+reward'
    );
  }

  // ============ Zero Reward Cases ============

  function test_solverLock_ETH_ZeroReward_BalanceChanges() public {
    uint256 amount = 2 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, 0, NATIVE_ETH);

    uint256 solverBalanceBefore = solver.balance;
    uint256 contractETHBefore = address(train).balance;

    vm.prank(solver);
    train.solverLock{ value: amount }(params, _defaultDestination(), '');

    assertEq(solver.balance, solverBalanceBefore - amount, 'Solver ETH should decrease by amount only');
    assertEq(address(train).balance, contractETHBefore + amount, 'Contract ETH should increase by amount only');
  }

  function test_redeemSolver_ETH_ZeroReward_BalanceChanges() public {
    uint256 amount = 2 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, NATIVE_ETH, 0, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock{ value: amount }(params, _defaultDestination(), '');

    uint256 receiverBalanceBefore = receiver.balance;
    uint256 rewardRecipientBalanceBefore = rewardRecipient.balance;
    uint256 relayerBalanceBefore = relayer.balance;
    uint256 contractETHBefore = address(train).balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(receiver.balance, receiverBalanceBefore + amount, 'Receiver should get amount');
    assertEq(rewardRecipient.balance, rewardRecipientBalanceBefore, 'RewardRecipient should get nothing');
    assertEq(relayer.balance, relayerBalanceBefore, 'Relayer should get nothing');
    assertEq(address(train).balance, contractETHBefore - amount, 'Contract ETH should decrease by amount');
  }

  function test_solverLock_ERC20_ZeroReward_BalanceChanges() public {
    uint256 amount = 100 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), 0, NATIVE_ETH);

    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(solver);
    train.solverLock(params, _defaultDestination(), '');

    assertEq(token.balanceOf(solver), solverTokenBefore - amount, 'Solver token should decrease by amount only');
    assertEq(
      token.balanceOf(address(train)),
      contractTokenBefore + amount,
      'Contract token should increase by amount only'
    );
  }

  function test_redeemSolver_ERC20_ZeroReward_BalanceChanges() public {
    uint256 amount = 100 ether;
    Train.SolverLockParams memory params = _defaultSolverParams(amount, address(token), 0, NATIVE_ETH);

    vm.prank(solver);
    uint256 index = train.solverLock(params, _defaultDestination(), '');

    uint256 receiverTokenBefore = token.balanceOf(receiver);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(token.balanceOf(receiver), receiverTokenBefore + amount, 'Receiver should get token amount');
    assertEq(token.balanceOf(address(train)), contractTokenBefore - amount, 'Contract token should decrease by amount');
  }
}

/// @notice Helper contract that consumes more than 10k gas on receive
contract GasConsumer {
  uint256 public counter;

  receive() external payable {
    // Consume more than 10k gas
    for (uint256 i = 0; i < 1000; i++) {
      counter += 1;
    }
  }
}
