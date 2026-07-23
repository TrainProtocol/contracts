// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../../src/tempo/Train.sol';
import { ReentrantToken } from '../mocks/Mocks.sol';

/// @notice E1 — a malicious token whose transferFrom reenters Train during `_transferIn` must be
///         blocked by the transient reentrancy guard (the create path writes state after the pull,
///         so the guard is the safety net).
contract ReentrancyTest is Test {
  Train train;
  ReentrantToken rt;

  address payable initiator;
  address payable recipient;
  address payable refundTo;

  uint256 constant SECRET = 12345;
  bytes32 hashlock;
  bytes4 constant REENTRANT = bytes4(keccak256('ReentrancyGuardReentrantCall()'));

  function setUp() public {
    train = new Train();
    rt = new ReentrantToken();
    initiator = payable(makeAddr('initiator'));
    recipient = payable(makeAddr('recipient'));
    refundTo = payable(makeAddr('refundTo'));

    rt.mint(initiator, 1000 ether);
    vm.prank(initiator);
    rt.approve(address(train), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDst', dstAmount: 1, dstToken: 'ETH' });
  }

  function _user() internal view returns (Train.UserLockParams memory) {
    return Train.UserLockParams({
      hashlock: hashlock, amount: 1 ether, rewardAmount: 0, timelockDelta: 3600, rewardTimelockDelta: 1800,
      quoteExpiry: uint48(block.timestamp + 60), recipient: recipient, refundTo: refundTo, token: address(rt),
      payoutCurve: address(0), payoutCurveData: '', rewardToken: 'ETH', rewardRecipient: 'rr', srcChain: 'ETH'
    });
  }

  function test_userLock_reentrantTokenDuringTransferIn_blocked() public {
    // Arm the token to reenter Train (any nonReentrant entrypoint) during transferFrom.
    rt.arm(address(train), abi.encodeWithSelector(Train.refundUser.selector, hashlock));

    vm.prank(initiator);
    vm.expectRevert(REENTRANT);
    train.userLock(_user(), _dst(), '', '');
  }
}
