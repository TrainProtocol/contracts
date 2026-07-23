// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../../src/tempo/Train.sol';
import '../../src/ConstantPayoutCurve.sol';
import '../../src/IPayoutCurve.sol';
import { IERC165 } from '@openzeppelin/contracts/utils/introspection/IERC165.sol';
import '../mocks/TestToken.sol';
import { MockDecayCurve, FeeOnTransferToken } from '../mocks/Mocks.sol';

/// @notice ConstantPayoutCurve behavior + Train's curve plumbing (validation, full-payout/no-excess),
///         and the non-constant path where payout < amount routes the excess to refundTo.
/// @dev Ported from test/PayoutCurve.t.sol. The curve-validation/payout-bound tests fund locks with
///      native ETH purely as convenience scaffolding (the curve logic under test is token-agnostic),
///      so those are switched to ERC20 here. The `_ETH_`-suffixed tests that were pure duplicates of
///      an existing `_ERC20_` sibling in the same file (full-payout / curve-excess) are dropped rather
///      than ported twice; the ERC20 sibling already carries the coverage.
contract PayoutCurveTest is Test {
  Train train;
  TestToken token;
  FeeOnTransferToken fot; // 1% fee
  ConstantPayoutCurve constCurve;
  MockDecayCurve half; // returns amount / 2

  address payable initiator;
  address payable recipient;
  address payable refundTo;
  address payable rewardRecipient;
  address payable solver;
  address payable relayer;

  uint256 constant SECRET = 12345;
  bytes32 hashlock;

  function setUp() public {
    train = new Train();
    token = new TestToken();
    fot = new FeeOnTransferToken(100);
    constCurve = new ConstantPayoutCurve();
    half = new MockDecayCurve(1, 2);

    initiator = payable(makeAddr('initiator'));
    recipient = payable(makeAddr('recipient'));
    refundTo = payable(makeAddr('refundTo'));
    rewardRecipient = payable(makeAddr('rewardRecipient'));
    solver = payable(makeAddr('solver'));
    relayer = payable(makeAddr('relayer'));

    token.mint(initiator, 1_000_000 ether);
    token.mint(solver, 1_000_000 ether);
    vm.prank(initiator);
    token.approve(address(train), type(uint256).max);
    vm.prank(solver);
    token.approve(address(train), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDst', dstAmount: 1, dstToken: 'ETH' });
  }

  function _user(uint256 amount, address tokenAddr, address curve) internal view returns (Train.UserLockParams memory) {
    return Train.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: 3600, rewardTimelockDelta: 1800,
      quoteExpiry: uint48(block.timestamp + 60), recipient: recipient, refundTo: refundTo, token: tokenAddr,
      payoutCurve: curve, payoutCurveData: '', rewardToken: 'ETH', rewardRecipient: 'rr', srcChain: 'ETH'
    });
  }

  function _solver(uint256 amount, address tokenAddr, uint256 reward, address rewardTokenAddr, address curve)
    internal view returns (Train.SolverLockParams memory)
  {
    return Train.SolverLockParams({
      hashlock: hashlock, amount: amount, reward: reward, timelockDelta: 3600, rewardTimelockDelta: 1800,
      recipient: recipient, rewardRecipient: rewardRecipient, refundTo: refundTo, token: tokenAddr,
      rewardToken: rewardTokenAddr, payoutCurve: curve, payoutCurveData: '', srcChain: 'ETH'
    });
  }

  // ── ConstantPayoutCurve unit ──

  function test_constantCurve_returnsAmount_regardlessOfTime() public view {
    assertEq(constCurve.computePayout(1 ether, 100, 100, ''), 1 ether);
    assertEq(constCurve.computePayout(1 ether, 100, 160, ''), 1 ether);
    assertEq(constCurve.computePayout(1 ether, 100, 100_000_000, ''), 1 ether);
  }

  function test_constantCurve_ignoresConfig() public view {
    bytes memory cfg = abi.encode(uint256(60), uint256(123), uint256(0.5 ether));
    assertEq(constCurve.computePayout(7 ether, 1, type(uint48).max, cfg), 7 ether);
    assertEq(constCurve.computePayout(7 ether, 1, type(uint48).max, ''), 7 ether);
  }

  function test_constantCurve_scalesWithAmount() public view {
    assertEq(constCurve.computePayout(0, 0, 0, ''), 0);
    assertEq(constCurve.computePayout(123456789, 0, 0, ''), 123456789);
    assertEq(constCurve.computePayout(type(uint256).max, 0, 0, ''), type(uint256).max);
  }

  function test_constantCurve_supportsInterface() public view {
    assertTrue(constCurve.supportsInterface(type(IPayoutCurve).interfaceId));
    assertTrue(constCurve.supportsInterface(type(IERC165).interfaceId));
    assertFalse(constCurve.supportsInterface(0xffffffff));
  }

  // ── Constant curve: full payout, zero excess ──

  function test_userLock_constantCurve_stores() public {
    vm.prank(initiator);
    train.userLock(_user(1 ether, address(token), address(constCurve)), _dst(), '', '');
    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.amount, 1 ether);
    assertEq(lock.payoutCurve, address(constCurve));
    assertGt(lock.startTime, 0);
  }

  function test_redeemUser_ERC20_constantCurve_fullPayout() public {
    vm.prank(initiator);
    train.userLock(_user(100 ether, address(token), address(constCurve)), _dst(), '', '');
    vm.warp(block.timestamp + 100_000);
    uint256 r = token.balanceOf(recipient);
    uint256 f = token.balanceOf(refundTo);
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    assertEq(token.balanceOf(recipient) - r, 100 ether);
    assertEq(token.balanceOf(refundTo) - f, 0);
  }

  function test_redeemSolver_constantCurve_fullPayout_rewardIntact() public {
    vm.prank(solver);
    uint256 idx = train.solverLock(
      _solver(1 ether, address(token), 0.1 ether, address(token), address(constCurve)), _dst(), ''
    );
    vm.warp(block.timestamp + 600);
    uint256 r = token.balanceOf(recipient);
    uint256 f = token.balanceOf(refundTo);
    uint256 rr = token.balanceOf(rewardRecipient);
    vm.prank(relayer);
    train.redeemSolver(hashlock, idx, SECRET);
    assertEq(token.balanceOf(recipient) - r, 1 ether);
    assertEq(token.balanceOf(refundTo) - f, 0);
    assertEq(token.balanceOf(rewardRecipient) - rr, 0.1 ether);
  }

  // ── Curve validation / payout-bound guards ──

  function test_userLock_revertsOnInvalidPayoutCurve() public {
    vm.prank(initiator);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.userLock(_user(1 ether, address(token), address(0xdead)), _dst(), '', '');
  }

  function test_userLock_revertsWhenCurveReturnsFalseInterface() public {
    address bad = address(new FalseInterfaceCurve());
    vm.prank(initiator);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.userLock(_user(1 ether, address(token), bad), _dst(), '', '');
  }

  function test_userLock_revertsWhenCurveInterfaceReverts() public {
    address bad = address(new RevertingInterfaceCurve());
    vm.prank(initiator);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.userLock(_user(1 ether, address(token), bad), _dst(), '', '');
  }

  function test_redeemUser_revertsWhenCurveReverts() public {
    address bad = address(new RevertingCurve());
    vm.prank(initiator);
    train.userLock(_user(1 ether, address(token), bad), _dst(), '', '');
    vm.prank(relayer);
    vm.expectRevert(Train.InvalidPayout.selector);
    train.redeemUser(hashlock, SECRET);
  }

  function test_redeemUser_revertsWhenCurveReturnsZero() public {
    address bad = address(new ZeroPayoutCurve());
    vm.prank(initiator);
    train.userLock(_user(1 ether, address(token), bad), _dst(), '', '');
    vm.prank(relayer);
    vm.expectRevert(Train.InvalidPayout.selector);
    train.redeemUser(hashlock, SECRET);
  }

  function test_redeemUser_revertsWhenCurveExceedsAmount() public {
    address bad = address(new OverPayoutCurve());
    vm.prank(initiator);
    train.userLock(_user(1 ether, address(token), bad), _dst(), '', '');
    vm.prank(relayer);
    vm.expectRevert(Train.InvalidPayout.selector);
    train.redeemUser(hashlock, SECRET);
  }

  // ── Non-constant curve: excess > 0 routes to refundTo ──

  function test_redeemUser_ERC20_curveExcess_splits() public {
    vm.prank(initiator);
    train.userLock(_user(100 ether, address(token), address(half)), _dst(), '', '');
    uint256 r = token.balanceOf(recipient);
    uint256 f = token.balanceOf(refundTo);
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    assertEq(token.balanceOf(recipient) - r, 50 ether);
    assertEq(token.balanceOf(refundTo) - f, 50 ether);
  }

  function test_redeemSolver_curveExcess_amountSplit_rewardIntact() public {
    vm.prank(solver);
    uint256 idx = train.solverLock(_solver(100 ether, address(token), 10 ether, address(token), address(half)), _dst(), '');
    uint256 r = token.balanceOf(recipient);
    uint256 f = token.balanceOf(refundTo);
    uint256 rr = token.balanceOf(rewardRecipient);
    vm.expectEmit(true, true, false, true);
    emit Train.SolverRedeemed(hashlock, idx, relayer, SECRET, 50 ether, 50 ether, rewardRecipient, 10 ether);
    vm.prank(relayer);
    train.redeemSolver(hashlock, idx, SECRET);
    assertEq(token.balanceOf(recipient) - r, 50 ether);
    assertEq(token.balanceOf(refundTo) - f, 50 ether);
    assertEq(token.balanceOf(rewardRecipient) - rr, 10 ether);
  }

  function testFuzz_redeemUser_curveExcess_conservation(uint256 amount, uint256 numr, uint256 denr) public {
    amount = bound(amount, 2, 1_000_000 ether);
    denr = bound(denr, 1, 1_000_000);
    numr = bound(numr, 1, denr);
    MockDecayCurve c = new MockDecayCurve(numr, denr);
    token.mint(initiator, amount);
    vm.prank(initiator);
    train.userLock(_user(amount, address(token), address(c)), _dst(), '', '');
    uint256 r = token.balanceOf(recipient);
    uint256 f = token.balanceOf(refundTo);
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    uint256 rd = token.balanceOf(recipient) - r;
    uint256 fd = token.balanceOf(refundTo) - f;
    assertEq(rd + fd, amount);
    assertGt(rd, 0);
    assertLe(rd, amount);
  }

  // ── Fee-on-transfer proportional split + large amounts ──

  function testFuzz_solverSplit_FoT_noDustLost(uint256 amount, uint256 reward) public {
    amount = bound(amount, 1e9, 1_000 ether);
    reward = bound(reward, 0, 1_000 ether);
    fot.mint(solver, amount + reward);
    vm.prank(solver);
    fot.approve(address(train), type(uint256).max);
    uint256 before = fot.balanceOf(address(train));
    vm.prank(solver);
    uint256 idx = train.solverLock(_solver(amount, address(fot), reward, address(fot), address(0)), _dst(), '');
    uint256 received = fot.balanceOf(address(train)) - before;
    Train.SolverLock memory lock = train.getSolverLock(hashlock, idx);
    assertEq(lock.amount + lock.reward, received);
    assertLe(lock.amount, amount);
  }

  function test_solverSplit_largeAmounts_exact() public {
    uint256 amount = 1e30;
    uint256 reward = 5e29;
    token.mint(solver, amount + reward);
    vm.prank(solver);
    uint256 idx = train.solverLock(_solver(amount, address(token), reward, address(token), address(0)), _dst(), '');
    Train.SolverLock memory lock = train.getSolverLock(hashlock, idx);
    assertEq(lock.amount, amount);
    assertEq(lock.reward, reward);
  }
}

// ── Misbehaving curve mocks for the validation / payout-bound guards ──

contract RevertingCurve is IPayoutCurve {
  function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IERC165).interfaceId || id == type(IPayoutCurve).interfaceId; }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { revert('boom'); }
}

contract ZeroPayoutCurve is IPayoutCurve {
  function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IERC165).interfaceId || id == type(IPayoutCurve).interfaceId; }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { return 0; }
}

contract OverPayoutCurve is IPayoutCurve {
  function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IERC165).interfaceId || id == type(IPayoutCurve).interfaceId; }
  function computePayout(uint256 a, uint48, uint48, bytes calldata) external pure returns (uint256) { return a + 1; }
}

contract FalseInterfaceCurve {
  function supportsInterface(bytes4) external pure returns (bool) { return false; }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { return 0; }
}

contract RevertingInterfaceCurve {
  function supportsInterface(bytes4) external pure returns (bool) { revert(); }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { return 0; }
}
