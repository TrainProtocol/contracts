// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import './mocks/TestToken.sol';

/// @notice Minimal tests for the permissionless `userLockFor` intake (the TrainRouter→Train boundary).
///         The `router` here is just a funded EOA standing in for a forwarder: it holds the funds
///         and calls userLockFor on behalf of a distinct `user`.
contract UserLockForTest is Test {
  Train public train;
  TestToken public token;

  address router;      // the forwarder/caller (funds the lock)
  address user;        // the lock owner of record
  address payable receiver;
  address payable refundTo;
  address relayer;

  uint256 constant SECRET = 999;
  bytes32 hashlock;
  address constant NATIVE_ETH = address(0);

  function setUp() public {
    train = new Train();
    token = new TestToken();

    router = makeAddr('router');
    user = makeAddr('user');
    receiver = payable(makeAddr('receiver'));
    refundTo = payable(makeAddr('refundTo'));
    relayer = makeAddr('relayer');

    token.mint(router, 1000 ether);
    vm.prank(router);
    token.approve(address(train), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  function _params(address tokenAddr, uint256 amount) internal view returns (Train.UserLockParams memory) {
    return Train.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: 3600,
      rewardTimelockDelta: 1800, quoteExpiry: uint48(block.timestamp + 60),
      recipient: receiver, refundTo: refundTo, token: tokenAddr,
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'ETH', rewardRecipient: 'rr', srcChain: 'ETH'
    });
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDst', dstAmount: 1, dstToken: 'ETH' });
  }

  function _countFor(address who) internal view returns (uint256 total) {
    (, total) = train.getUserLockHashes(who, 0, 1000);
  }

  // Lock is attributed to `user`, funds are pulled from the caller, amount is the measured delta.
  function test_userLockFor_RecordsLockUnderUser_PullsFromCaller() public {
    uint256 routerBefore = token.balanceOf(router);
    uint256 trainBefore = token.balanceOf(address(train));

    vm.prank(router);
    train.userLockFor(user, _params(address(token), 100 ether), _dst(), '', '');

    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.sender, user, 'lock owner must be user, not caller');
    assertEq(lock.amount, 100 ether, 'credited = measured delta');
    assertEq(lock.recipient, receiver);
    assertEq(lock.refundTo, refundTo);

    // Attribution: indexed under user, not the router/caller.
    assertEq(_countFor(user), 1);
    assertEq(_countFor(router), 0);

    // Funds came from the caller.
    assertEq(routerBefore - token.balanceOf(router), 100 ether);
    assertEq(token.balanceOf(address(train)) - trainBefore, 100 ether);
  }

  // A lock created via userLockFor redeems normally to the recipient.
  function test_userLockFor_RedeemPaysRecipient() public {
    vm.prank(router);
    train.userLockFor(user, _params(address(token), 100 ether), _dst(), '', '');

    uint256 before = token.balanceOf(receiver);
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    assertEq(token.balanceOf(receiver) - before, 100 ether);
  }

  function test_userLockFor_RevertsOnZeroUser() public {
    vm.prank(router);
    vm.expectRevert(Train.InvalidUser.selector);
    train.userLockFor(address(0), _params(address(token), 100 ether), _dst(), '', '');
  }

  function test_userLockFor_RevertsOnNativeToken() public {
    vm.prank(router);
    vm.expectRevert(Train.NativeNotSupported.selector);
    train.userLockFor(user, _params(NATIVE_ETH, 100 ether), _dst(), '', '');
  }

  // Sanity: the refactor preserved direct userLock — owner is the caller there.
  function test_userLock_StillAttributesToCaller() public {
    vm.prank(router);
    train.userLock(_params(address(token), 5 ether), _dst(), '', '');
    assertEq(train.getUserLock(hashlock).sender, router);
    assertEq(_countFor(router), 1);
  }
}
