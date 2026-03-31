// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import 'forge-std/Test.sol';
import { ERC20 } from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '../src/Train.sol';
import '../src/TestToken.sol';

// ══════════════════════════════════════════════════════════════════════════════
// FeeToken — ERC20 that takes a 10% fee on transferFrom only.
// Fee is burned from the sender; recipient always receives 90% of amount.
// transfer() has no fee so outbound payments from the contract are exact.
// ══════════════════════════════════════════════════════════════════════════════
contract FeeToken is ERC20 {
  uint256 public constant FEE_BPS = 1000; // 10 %

  constructor() ERC20('FeeToken', 'FEE') {}

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  /// @dev Overrides transferFrom to take a 10% fee from the sender.
  ///      Sender loses `amount`; recipient receives `amount * 90%`.
  function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
    _spendAllowance(from, msg.sender, amount);
    uint256 fee = (amount * FEE_BPS) / 10_000;
    _transfer(from, to, amount - fee); // deliver reduced amount to recipient
    _burn(from, fee);                  // burn the fee portion from sender
    return true;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Fee-on-transfer token integration tests
// ══════════════════════════════════════════════════════════════════════════════
contract FeeTokenTest is Test {
  Train public train;
  FeeToken public feeToken;
  TestToken public regularToken;

  address payable initiator;
  address payable solver;
  address payable receiver;
  address payable rewardRecipient;
  address payable relayer;

  uint256 constant SECRET = 99999;
  bytes32 hashlock;

  address constant NATIVE_ETH = address(0);
  uint48 constant TIMELOCK_DELTA = 3600;       // 1 h
  uint48 constant REWARD_TIMELOCK_DELTA = 1800; // 30 min

  // 10% fee → 100 requested → 90 received
  uint256 constant FEE_BPS = 1000;

  function setUp() public {
    train = new Train();
    feeToken = new FeeToken();
    regularToken = new TestToken();

    initiator = payable(makeAddr('initiator'));
    solver = payable(makeAddr('solver'));
    receiver = payable(makeAddr('receiver'));
    rewardRecipient = payable(makeAddr('rewardRecipient'));
    relayer = payable(makeAddr('relayer'));

    feeToken.mint(initiator, 1_000 ether);
    feeToken.mint(solver, 1_000 ether);
    regularToken.mint(solver, 1_000 ether);

    vm.prank(initiator);
    feeToken.approve(address(train), type(uint256).max);

    vm.prank(solver);
    feeToken.approve(address(train), type(uint256).max);

    vm.prank(solver);
    regularToken.approve(address(train), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  function _received(uint256 requested) internal pure returns (uint256) {
    return requested - (requested * FEE_BPS) / 10_000;
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDst', dstAmount: 1, dstToken: 'ETH' });
  }

  function _userParams(uint256 amount, address token) internal view returns (Train.UserLockParams memory) {
    return Train.UserLockParams({
      hashlock: hashlock,
      amount: amount,
      rewardAmount: 0,
      timelockDelta: TIMELOCK_DELTA,
      rewardTimelockDelta: REWARD_TIMELOCK_DELTA,
      quoteExpiry: uint48(block.timestamp + 60),
      refundTo: address(0),
      recipient: receiver,
      token: token,
      rewardToken: '',
      rewardRecipient: '',
      srcChain: 'ETH'
    });
  }

  function _solverParams(
    uint256 amount,
    address token,
    uint256 reward,
    address rewardToken
  ) internal view returns (Train.SolverLockParams memory) {
    return Train.SolverLockParams({
      hashlock: hashlock,
      amount: amount,
      reward: reward,
      timelockDelta: TIMELOCK_DELTA,
      rewardTimelockDelta: REWARD_TIMELOCK_DELTA,
      refundTo: address(0),
      recipient: receiver,
      rewardRecipient: rewardRecipient,
      token: token,
      rewardToken: rewardToken,
      srcChain: 'ETH'
    });
  }

  // ── User lock ──────────────────────────────────────────────────────────────

  /// lock.amount stores the actually-received amount, not params.amount
  function test_feeToken_userLock_storesActualReceived() public {
    uint256 requested = 100 ether;
    uint256 expected = _received(requested); // 90 ether

    vm.prank(initiator);
    train.userLock(_userParams(requested, address(feeToken)), _dst(), '', '');

    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.amount, expected, 'lock.amount should equal actually received tokens');
    assertEq(feeToken.balanceOf(address(train)), expected, 'contract balance should equal actually received tokens');
  }

  /// redeemUser pays the receiver exactly lock.amount (what the contract holds)
  function test_feeToken_userLock_redeemPaysActualAmount() public {
    uint256 requested = 100 ether;
    uint256 expected = _received(requested);

    vm.prank(initiator);
    train.userLock(_userParams(requested, address(feeToken)), _dst(), '', '');

    uint256 receiverBefore = feeToken.balanceOf(receiver);

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    assertEq(feeToken.balanceOf(receiver), receiverBefore + expected, 'receiver should get actual locked amount');
    assertEq(feeToken.balanceOf(address(train)), 0, 'contract should be empty after redeem');
  }

  /// refundUser returns exactly lock.amount to refundTo (no double-counting)
  function test_feeToken_userLock_refundReturnsActualAmount() public {
    uint256 requested = 100 ether;
    uint256 expected = _received(requested);

    vm.prank(initiator);
    train.userLock(_userParams(requested, address(feeToken)), _dst(), '', '');

    uint256 senderBefore = feeToken.balanceOf(initiator);

    // recipient can refund any time
    vm.prank(receiver);
    train.refundUser(hashlock);

    // refundTo defaults to msg.sender (initiator) → gets back what was actually locked
    assertEq(feeToken.balanceOf(initiator), senderBefore + expected, 'initiator should recover actual locked amount');
    assertEq(feeToken.balanceOf(address(train)), 0, 'contract should be empty after refund');
  }

  // ── Solver lock — fee token as amount, no reward ───────────────────────────

  /// lock.amount stores actually received when solver token has a fee
  function test_feeToken_solverLock_storesActualReceived() public {
    uint256 requested = 100 ether;
    uint256 expected = _received(requested);

    vm.prank(solver);
    uint256 index = train.solverLock(_solverParams(requested, address(feeToken), 0, NATIVE_ETH), _dst(), '');

    Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
    assertEq(lock.amount, expected, 'lock.amount should equal actually received tokens');
    assertEq(feeToken.balanceOf(address(train)), expected, 'contract balance should equal actually received tokens');
  }

  /// redeemSolver pays recipient exactly lock.amount
  function test_feeToken_solverLock_redeemPaysActualAmount() public {
    uint256 requested = 100 ether;
    uint256 expected = _received(requested);

    vm.prank(solver);
    uint256 index = train.solverLock(_solverParams(requested, address(feeToken), 0, NATIVE_ETH), _dst(), '');

    uint256 receiverBefore = feeToken.balanceOf(receiver);

    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(feeToken.balanceOf(receiver), receiverBefore + expected, 'receiver gets actual locked amount');
    assertEq(feeToken.balanceOf(address(train)), 0, 'contract empty after redeem');
  }

  /// refundSolver returns lock.amount to refundTo after timelock
  function test_feeToken_solverLock_refundReturnsActualAmount() public {
    uint256 requested = 100 ether;
    uint256 expected = _received(requested);

    vm.prank(solver);
    uint256 index = train.solverLock(_solverParams(requested, address(feeToken), 0, NATIVE_ETH), _dst(), '');

    uint256 solverBefore = feeToken.balanceOf(solver);

    vm.warp(block.timestamp + TIMELOCK_DELTA + 1);
    train.refundSolver(hashlock, index);

    // refundTo defaults to solver (msg.sender at lock creation)
    assertEq(feeToken.balanceOf(solver), solverBefore + expected, 'solver recovers actual locked amount');
    assertEq(feeToken.balanceOf(address(train)), 0, 'contract empty after refund');
  }

  // ── Solver lock — same fee token for both amount and reward ───────────────

  /// When amount + reward share the same fee token, a single transferFrom is issued
  /// and the actually-received total is split proportionally between lock.amount and lock.reward
  function test_feeToken_solverLock_sameToken_splitProportionally() public {
    uint256 reqAmount = 80 ether;
    uint256 reqReward = 20 ether;
    uint256 totalRequested = reqAmount + reqReward; // 100 ether
    uint256 totalReceived = _received(totalRequested); // 90 ether

    // Expected proportional split:  90 * 80 / 100 = 72,  90 - 72 = 18
    uint256 expectedAmount = (totalReceived * reqAmount) / totalRequested; // 72 ether
    uint256 expectedReward = totalReceived - expectedAmount;               // 18 ether

    vm.prank(solver);
    uint256 index = train.solverLock(
      _solverParams(reqAmount, address(feeToken), reqReward, address(feeToken)),
      _dst(),
      ''
    );

    Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
    assertEq(lock.amount, expectedAmount, 'lock.amount should be proportional share of received total');
    assertEq(lock.reward, expectedReward, 'lock.reward should be proportional share of received total');
    assertEq(lock.amount + lock.reward, totalReceived, 'sum of amount + reward equals total received');
    assertEq(feeToken.balanceOf(address(train)), totalReceived, 'contract holds exactly what was received');
  }

  /// redeemSolver with same-fee-token: recipient gets lock.amount, rewardRecipient gets lock.reward
  function test_feeToken_solverLock_sameToken_redeemSplitsProperly() public {
    uint256 reqAmount = 80 ether;
    uint256 reqReward = 20 ether;
    uint256 totalReceived = _received(reqAmount + reqReward); // 90 ether
    uint256 expectedAmount = (totalReceived * reqAmount) / (reqAmount + reqReward); // 72
    uint256 expectedReward = totalReceived - expectedAmount;                         // 18

    vm.prank(solver);
    uint256 index = train.solverLock(
      _solverParams(reqAmount, address(feeToken), reqReward, address(feeToken)),
      _dst(),
      ''
    );

    uint256 receiverBefore = feeToken.balanceOf(receiver);
    uint256 rewardRecipientBefore = feeToken.balanceOf(rewardRecipient);

    // Redeem within rewardTimelock → reward goes to rewardRecipient
    vm.prank(relayer);
    train.redeemSolver(hashlock, index, SECRET);

    assertEq(feeToken.balanceOf(receiver), receiverBefore + expectedAmount, 'recipient gets lock.amount');
    assertEq(feeToken.balanceOf(rewardRecipient), rewardRecipientBefore + expectedReward, 'rewardRecipient gets lock.reward');
    assertEq(feeToken.balanceOf(address(train)), 0, 'contract empty after redeem');
  }

  /// refundSolver with same-fee-token: refundTo receives amount + reward in one transfer
  function test_feeToken_solverLock_sameToken_refundCombines() public {
    uint256 reqAmount = 80 ether;
    uint256 reqReward = 20 ether;
    uint256 totalReceived = _received(reqAmount + reqReward); // 90 ether

    vm.prank(solver);
    uint256 index = train.solverLock(
      _solverParams(reqAmount, address(feeToken), reqReward, address(feeToken)),
      _dst(),
      ''
    );

    uint256 solverBefore = feeToken.balanceOf(solver);

    vm.warp(block.timestamp + TIMELOCK_DELTA + 1);
    train.refundSolver(hashlock, index);

    // refundTo == solver; amount + reward share same token and same recipient → combined transfer
    assertEq(feeToken.balanceOf(solver), solverBefore + totalReceived, 'solver gets total received back');
    assertEq(feeToken.balanceOf(address(train)), 0, 'contract empty after refund');
  }

  // ── Solver lock — fee token as reward, regular token as amount ─────────────

  /// When only the reward token has a fee, lock.amount is unaffected
  function test_feeToken_solverLock_feeReward_regularAmount_storesCorrectly() public {
    uint256 reqAmount = 100 ether;      // regular token, no fee
    uint256 reqReward = 50 ether;       // fee token, 10% fee
    uint256 expectedReward = _received(reqReward); // 45 ether

    vm.prank(solver);
    uint256 index = train.solverLock(
      _solverParams(reqAmount, address(regularToken), reqReward, address(feeToken)),
      _dst(),
      ''
    );

    Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
    assertEq(lock.amount, reqAmount, 'lock.amount unaffected when amount token has no fee');
    assertEq(lock.reward, expectedReward, 'lock.reward stores actually received reward');
    assertEq(regularToken.balanceOf(address(train)), reqAmount, 'contract holds full amount token');
    assertEq(feeToken.balanceOf(address(train)), expectedReward, 'contract holds actual reward received');
  }

  /// When only the amount token has a fee, lock.reward is unaffected
  function test_feeToken_solverLock_feeAmount_regularReward_storesCorrectly() public {
    uint256 reqAmount = 100 ether;      // fee token, 10% fee
    uint256 reqReward = 50 ether;       // regular token, no fee
    uint256 expectedAmount = _received(reqAmount); // 90 ether

    vm.prank(solver);
    uint256 index = train.solverLock(
      _solverParams(reqAmount, address(feeToken), reqReward, address(regularToken)),
      _dst(),
      ''
    );

    Train.SolverLock memory lock = train.getSolverLock(hashlock, index);
    assertEq(lock.amount, expectedAmount, 'lock.amount stores actually received amount');
    assertEq(lock.reward, reqReward, 'lock.reward unaffected when reward token has no fee');
    assertEq(feeToken.balanceOf(address(train)), expectedAmount, 'contract holds actual amount received');
    assertEq(regularToken.balanceOf(address(train)), reqReward, 'contract holds full reward token');
  }
}
