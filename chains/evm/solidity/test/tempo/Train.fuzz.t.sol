// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../../src/tempo/Train.sol';
import '../mocks/TestToken.sol';

/// @title Train Fuzz Tests (Tempo)
/// @notice Fuzz/property tests for Train
/// @dev Ported from test/Train.fuzz.t.sol. Dropped entirely (no Tempo equivalent, since Tempo's Train
///      has no native-ETH path at all):
///        - `testFuzz_userLock_ETH_storesLock` (duplicate of the kept `..._ERC20_transfersTokens`)
///        - `testFuzz_solverLock_mixedTokens_ethAmount_erc20Reward` and
///          `testFuzz_solverLock_mixedTokens_erc20Amount_ethReward` (the "one leg native" mixed-token
///          case cannot occur on Tempo — every token is ERC20/TIP-20).
///      Everywhere else NATIVE_ETH was used purely as convenience funding for token-agnostic logic
///      (quote-expiry boundary, redeem/refund roundtrips, reward routing, per-solver locks, paginated
///      getters), it is switched to the ERC20 `token` fixture (same-token amount+reward where the
///      original used ETH for both legs) rather than dropped.
contract TrainFuzzTest is Test {
  Train public train;
  TestToken public token;
  TestToken public token2;

  address payable initiator;
  address payable solver;
  address payable receiver;
  address payable rewardRecipient;
  address payable relayer;

  function setUp() public {
    train = new Train();
    token = new TestToken();
    token2 = new TestToken();

    initiator = payable(makeAddr('initiator'));
    solver = payable(makeAddr('solver'));
    receiver = payable(makeAddr('receiver'));
    rewardRecipient = payable(makeAddr('rewardRecipient'));
    relayer = payable(makeAddr('relayer'));

    token.mint(initiator, 1_000_000 ether);
    token.mint(solver, 1_000_000 ether);
    token2.mint(solver, 1_000_000 ether);

    vm.prank(initiator);
    token.approve(address(train), type(uint256).max);

    vm.prank(solver);
    token.approve(address(train), type(uint256).max);

    vm.prank(solver);
    token2.approve(address(train), type(uint256).max);
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDstAddr', dstAmount: 1, dstToken: 'ETH' });
  }

  function _userParams(
    bytes32 hashlock,
    uint256 amount,
    address tokenAddr,
    uint48 timelockDelta,
    uint48 rewardTimelockDelta,
    uint48 quoteExpiry
  ) internal view returns (Train.UserLockParams memory) {
    return
      Train.UserLockParams({
        hashlock: hashlock,
        amount: amount,
        rewardAmount: 0,
        timelockDelta: timelockDelta,
        rewardTimelockDelta: rewardTimelockDelta,
        quoteExpiry: quoteExpiry,
        recipient: receiver,
        refundTo: initiator,
        token: tokenAddr,
        payoutCurve: address(0),
        payoutCurveData: '',
        rewardToken: 'ETH',
        rewardRecipient: 'rewardRecipient',
        srcChain: 'ETH'
      });
  }

  function _solverParams(
    bytes32 hashlock,
    uint256 amount,
    address tokenAddr,
    uint256 reward,
    address rewardTokenAddr,
    uint48 timelockDelta,
    uint48 rewardTimelockDelta,
    address rewardTo
  ) internal view returns (Train.SolverLockParams memory) {
    return
      Train.SolverLockParams({
        hashlock: hashlock,
        amount: amount,
        reward: reward,
        timelockDelta: timelockDelta,
        rewardTimelockDelta: rewardTimelockDelta,
        recipient: receiver,
        rewardRecipient: rewardTo,
        refundTo: solver,
        token: tokenAddr,
        rewardToken: rewardTokenAddr,
        payoutCurve: address(0),
        payoutCurveData: '',
        srcChain: 'ETH'
      });
  }

  function _boundTimelock(uint48 fuzzed) internal pure returns (uint48) {
    return uint48(bound(fuzzed, 1, 365 days));
  }

  function _boundTimelockForReward(uint48 fuzzed) internal pure returns (uint48) {
    return uint48(bound(fuzzed, 2, 365 days));
  }

  function _boundRewardDelta(uint48 fuzzed, uint48 timelockDelta) internal pure returns (uint48) {
    return uint48(bound(fuzzed, 1, timelockDelta - 1));
  }

  // ============ User Lock Fuzz Tests ============

  function testFuzz_userLock_ERC20_transfersTokens(uint256 amount, uint48 timelockFuzz) public {
    amount = bound(amount, 1, 500 ether);
    uint48 timelockDelta = _boundTimelock(timelockFuzz);
    uint48 quoteExpiry = uint48(block.timestamp + 60);

    uint256 secret = uint256(keccak256(abi.encodePacked(amount, timelockDelta, 'erc20')));
    bytes32 hashlock = sha256(abi.encodePacked(secret));

    Train.UserLockParams memory params = _userParams(hashlock, amount, address(token), timelockDelta, 0, quoteExpiry);

    uint256 senderBalanceBefore = token.balanceOf(initiator);
    uint256 contractBalanceBefore = token.balanceOf(address(train));

    vm.prank(initiator);
    train.userLock(params, _dst(), '', '');

    assertEq(token.balanceOf(initiator), senderBalanceBefore - amount);
    assertEq(token.balanceOf(address(train)), contractBalanceBefore + amount);
  }

  function testFuzz_userLock_quoteExpiryBoundary(uint48 quoteDelay) public {
    uint256 amount = 1 ether;
    uint48 timelockDelta = 3600;
    quoteDelay = uint48(bound(quoteDelay, 0, 3));
    uint48 quoteExpiry = uint48(block.timestamp + quoteDelay);

    bytes32 hashlock = sha256(abi.encodePacked(uint256(123)));
    Train.UserLockParams memory params = _userParams(hashlock, amount, address(token), timelockDelta, 0, quoteExpiry);

    vm.prank(initiator);
    if (quoteDelay == 0) {
      vm.expectRevert(Train.QuoteExpired.selector);
      train.userLock(params, _dst(), '', '');
    } else {
      train.userLock(params, _dst(), '', '');
    }
  }

  function testFuzz_redeemUser_roundtrip(uint256 amount, uint48 timelockFuzz, uint256 secret) public {
    amount = bound(amount, 1, 100 ether);
    uint48 timelockDelta = _boundTimelock(timelockFuzz);
    vm.assume(secret != 0);

    bytes32 hashlock = sha256(abi.encodePacked(secret));
    Train.UserLockParams memory params = _userParams(
      hashlock,
      amount,
      address(token),
      timelockDelta,
      0,
      uint48(block.timestamp + 60)
    );

    vm.prank(initiator);
    train.userLock(params, _dst(), '', '');

    uint256 receiverBalanceBefore = token.balanceOf(receiver);

    vm.prank(relayer);
    train.redeemUser(hashlock, secret);

    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(token.balanceOf(receiver), receiverBalanceBefore + amount);
    assertEq(lock.secret, secret);
    assertEq(uint8(lock.status), uint8(Train.LockStatus.Redeemed));
  }

  function testFuzz_refundUser_byNonRecipientAfterTimelock(uint256 amount, uint48 timelockFuzz) public {
    amount = bound(amount, 1, 100 ether);
    uint48 timelockDelta = _boundTimelock(timelockFuzz);

    bytes32 hashlock = sha256(abi.encodePacked(uint256(keccak256(abi.encodePacked(amount)))));
    Train.UserLockParams memory params = _userParams(
      hashlock,
      amount,
      address(token),
      timelockDelta,
      0,
      uint48(block.timestamp + 60)
    );

    vm.prank(initiator);
    train.userLock(params, _dst(), '', '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 senderBalanceBefore = token.balanceOf(initiator);

    vm.prank(relayer);
    train.refundUser(hashlock);

    assertEq(token.balanceOf(initiator), senderBalanceBefore + amount);
  }

  function testFuzz_refundUser_beforeTimelockReverts(uint256 amount, uint48 timelockFuzz) public {
    amount = bound(amount, 1, 100 ether);
    uint48 timelockDelta = _boundTimelock(timelockFuzz);

    bytes32 hashlock = sha256(abi.encodePacked(uint256(keccak256(abi.encodePacked(amount, 'refund')))));
    Train.UserLockParams memory params = _userParams(
      hashlock,
      amount,
      address(token),
      timelockDelta,
      0,
      uint48(block.timestamp + 60)
    );

    vm.prank(initiator);
    train.userLock(params, _dst(), '', '');

    vm.prank(relayer);
    vm.expectRevert(Train.RefundNotAllowed.selector);
    train.refundUser(hashlock);
  }

  // ============ Solver Lock Fuzz Tests ============

  function testFuzz_solverLock_rewardToRecipient_beforeRewardTimelock(
    uint256 amount,
    uint256 reward,
    uint48 timelockFuzz,
    uint48 rewardFuzz,
    uint256 secret
  ) public {
    amount = bound(amount, 1, 50 ether);
    reward = bound(reward, 1, 50 ether);
    vm.assume(secret != 0);

    uint48 timelockDelta = _boundTimelockForReward(timelockFuzz);
    uint48 rewardTimelockDelta = _boundRewardDelta(rewardFuzz, timelockDelta);

    bytes32 hashlock = sha256(abi.encodePacked(secret));
    Train.SolverLockParams memory params = _solverParams(
      hashlock,
      amount,
      address(token),
      reward,
      address(token),
      timelockDelta,
      rewardTimelockDelta,
      rewardRecipient
    );

    vm.prank(solver);
    train.solverLock(params, _dst(), '');

    uint256 receiverBalanceBefore = token.balanceOf(receiver);
    uint256 rewardRecipientBefore = token.balanceOf(rewardRecipient);

    vm.prank(relayer);
    train.redeemSolver(hashlock, solver, secret);

    assertEq(token.balanceOf(receiver), receiverBalanceBefore + amount);
    assertEq(token.balanceOf(rewardRecipient), rewardRecipientBefore + reward);
  }

  function testFuzz_solverLock_rewardToRedeemer_afterRewardTimelock(
    uint256 amount,
    uint256 reward,
    uint48 timelockFuzz,
    uint48 rewardFuzz,
    uint256 secret
  ) public {
    amount = bound(amount, 1, 50 ether);
    reward = bound(reward, 1, 50 ether);
    vm.assume(secret != 0);

    uint48 timelockDelta = _boundTimelockForReward(timelockFuzz);
    uint48 rewardTimelockDelta = _boundRewardDelta(rewardFuzz, timelockDelta);

    bytes32 hashlock = sha256(abi.encodePacked(secret));
    Train.SolverLockParams memory params = _solverParams(
      hashlock,
      amount,
      address(token),
      reward,
      address(token),
      timelockDelta,
      rewardTimelockDelta,
      rewardRecipient
    );

    vm.prank(solver);
    train.solverLock(params, _dst(), '');

    // rewardTimelock = block.timestamp + rewardTimelockDelta
    // Warp past the rewardTimelock
    vm.warp(block.timestamp + rewardTimelockDelta + 1);

    uint256 receiverBalanceBefore = token.balanceOf(receiver);
    uint256 relayerBalanceBefore = token.balanceOf(relayer);

    vm.prank(relayer);
    train.redeemSolver(hashlock, solver, secret);

    assertEq(token.balanceOf(receiver), receiverBalanceBefore + amount);
    assertEq(token.balanceOf(relayer), relayerBalanceBefore + reward);
  }

  function testFuzz_solverLock_refundAfterTimelock(
    uint256 amount,
    uint256 reward,
    uint48 timelockFuzz,
    uint48 rewardFuzz
  ) public {
    amount = bound(amount, 1, 50 ether);
    reward = bound(reward, 0, 50 ether);

    uint48 timelockDelta = _boundTimelockForReward(timelockFuzz);
    uint48 rewardTimelockDelta = _boundRewardDelta(rewardFuzz, timelockDelta);

    bytes32 hashlock = sha256(abi.encodePacked(uint256(keccak256(abi.encodePacked(amount, reward)))));
    Train.SolverLockParams memory params = _solverParams(
      hashlock,
      amount,
      address(token),
      reward,
      address(token),
      timelockDelta,
      rewardTimelockDelta,
      rewardRecipient
    );

    vm.prank(solver);
    train.solverLock(params, _dst(), '');

    vm.warp(block.timestamp + timelockDelta + 1);

    uint256 solverBalanceBefore = token.balanceOf(solver);

    vm.prank(receiver);
    train.refundSolver(hashlock, solver);

    assertEq(token.balanceOf(solver), solverBalanceBefore + amount + reward);
  }

  function testFuzz_solverLock_erc20SameToken_transfersAmountPlusReward(uint256 amount, uint256 reward) public {
    amount = bound(amount, 1, 200 ether);
    reward = bound(reward, 1, 50 ether);

    uint256 secret = uint256(keccak256(abi.encodePacked(amount, reward, 'same')));
    bytes32 hashlock = sha256(abi.encodePacked(secret));
    uint48 timelockDelta = 3600;
    uint48 rewardTimelockDelta = 1800;

    Train.SolverLockParams memory params = _solverParams(
      hashlock,
      amount,
      address(token),
      reward,
      address(token),
      timelockDelta,
      rewardTimelockDelta,
      receiver
    );

    uint256 solverTokenBefore = token.balanceOf(solver);
    uint256 contractTokenBefore = token.balanceOf(address(train));

    vm.prank(solver);
    train.solverLock(params, _dst(), '');

    assertEq(token.balanceOf(solver), solverTokenBefore - amount - reward);
    assertEq(token.balanceOf(address(train)), contractTokenBefore + amount + reward);

    uint256 receiverTokenBefore = token.balanceOf(receiver);

    vm.prank(relayer);
    train.redeemSolver(hashlock, solver, secret);

    assertEq(token.balanceOf(receiver), receiverTokenBefore + amount + reward);
  }

  function testFuzz_solverLock_manySolvers_sameHashlock(uint8 locks) public {
    locks = uint8(bound(locks, 1, 8));
    bytes32 hashlock = sha256(abi.encodePacked(uint256(12345)));

    Train.SolverLockParams memory params = _solverParams(
      hashlock,
      1 ether,
      address(token),
      0,
      address(token),
      3600,
      1,
      rewardRecipient
    );

    for (uint256 i = 0; i < locks; i++) {
      address freshSolver = makeAddr(string.concat('solver', vm.toString(i)));
      token.mint(freshSolver, 1 ether);
      vm.prank(freshSolver);
      token.approve(address(train), type(uint256).max);

      vm.prank(freshSolver);
      train.solverLock(params, _dst(), '');
    }

    for (uint256 i = 0; i < locks; i++) {
      address freshSolver = makeAddr(string.concat('solver', vm.toString(i)));
      Train.SolverLock memory lock = train.getSolverLock(hashlock, freshSolver);
      assertEq(lock.sender, freshSolver);
      assertEq(uint8(lock.status), uint8(Train.LockStatus.Pending));
    }
  }

  function testFuzz_getUserLockHashes_tracksMultipleLocks(uint8 numLocks) public {
    numLocks = uint8(bound(numLocks, 1, 20));

    bytes32[] memory expectedHashlocks = new bytes32[](numLocks);

    for (uint256 i = 0; i < numLocks; i++) {
      uint256 secret = 1000 + i;
      bytes32 hashlock = sha256(abi.encodePacked(secret));
      expectedHashlocks[i] = hashlock;

      Train.UserLockParams memory params = _userParams(
        hashlock,
        (i + 1) * 0.1 ether,
        address(token),
        3600,
        1800,
        uint48(block.timestamp + 60)
      );

      vm.prank(initiator);
      train.userLock(params, _dst(), '', '');
    }

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 0, 100);
    assertEq(hashes.length, numLocks);
    assertEq(total, numLocks);

    for (uint256 i = 0; i < numLocks; i++) {
      assertEq(hashes[i], expectedHashlocks[i]);
    }
  }

  function testFuzz_getUserLocks_returnsCorrectData(uint8 numLocks, uint256 baseAmount) public {
    numLocks = uint8(bound(numLocks, 1, 10));
    baseAmount = bound(baseAmount, 0.01 ether, 10 ether);

    for (uint256 i = 0; i < numLocks; i++) {
      uint256 secret = 2000 + i;
      bytes32 hashlock = sha256(abi.encodePacked(secret));
      uint256 amount = baseAmount + (i * 0.1 ether);

      Train.UserLockParams memory params = _userParams(
        hashlock,
        amount,
        address(token),
        3600,
        1800,
        uint48(block.timestamp + 60)
      );

      vm.prank(initiator);
      train.userLock(params, _dst(), '', '');
    }

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 0, 100);
    assertEq(locks.length, numLocks);
    assertEq(total, numLocks);

    for (uint256 i = 0; i < numLocks; i++) {
      assertEq(locks[i].sender, initiator);
      assertEq(locks[i].recipient, receiver);
      assertEq(locks[i].token, address(token));
      assertEq(locks[i].amount, baseAmount + (i * 0.1 ether));
      assertEq(uint8(locks[i].status), uint8(Train.LockStatus.Pending));
    }
  }

  function testFuzz_getUserLockHashes_persistsAfterRedeem(uint256 amount, uint256 secret) public {
    amount = bound(amount, 0.01 ether, 100 ether);
    secret = bound(secret, 1, type(uint256).max);
    bytes32 hashlock = sha256(abi.encodePacked(secret));

    Train.UserLockParams memory params = _userParams(
      hashlock,
      amount,
      address(token),
      3600,
      1800,
      uint48(block.timestamp + 60)
    );

    vm.prank(initiator);
    train.userLock(params, _dst(), '', '');

    vm.prank(relayer);
    train.redeemUser(hashlock, secret);

    (bytes32[] memory hashes, uint256 totalHashes) = train.getUserLockHashes(initiator, 0, 100);
    assertEq(hashes.length, 1);
    assertEq(totalHashes, 1);
    assertEq(hashes[0], hashlock);

    (Train.UserLock[] memory locks, uint256 totalLocks) = train.getUserLocks(initiator, 0, 100);
    assertEq(locks.length, 1);
    assertEq(totalLocks, 1);
    assertEq(uint8(locks[0].status), uint8(Train.LockStatus.Redeemed));
    assertEq(locks[0].secret, secret);
  }

  function testFuzz_getUserLockHashes_persistsAfterRefund(uint256 amount, uint48 timelockFuzz) public {
    amount = bound(amount, 0.01 ether, 100 ether);
    timelockFuzz = uint48(bound(timelockFuzz, 60, 30 days));
    uint256 secret = 54321;
    bytes32 hashlock = sha256(abi.encodePacked(secret));

    Train.UserLockParams memory params = _userParams(
      hashlock,
      amount,
      address(token),
      timelockFuzz,
      1,
      uint48(block.timestamp + 60)
    );

    vm.prank(initiator);
    train.userLock(params, _dst(), '', '');

    vm.warp(block.timestamp + timelockFuzz + 1);

    vm.prank(relayer);
    train.refundUser(hashlock);

    (bytes32[] memory hashes, uint256 totalHashes) = train.getUserLockHashes(initiator, 0, 100);
    assertEq(hashes.length, 1);
    assertEq(totalHashes, 1);
    assertEq(hashes[0], hashlock);

    (Train.UserLock[] memory locks, uint256 totalLocks) = train.getUserLocks(initiator, 0, 100);
    assertEq(locks.length, 1);
    assertEq(totalLocks, 1);
    assertEq(uint8(locks[0].status), uint8(Train.LockStatus.Refunded));
  }
}
