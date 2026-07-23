// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../../src/tempo/Train.sol';
import '../mocks/TestToken.sol';

/// @notice Pagination-window behavior for the two paginated view getters `getUserLockHashes`
///         and `getUserLocks`. Covers the `offset + limit` checked-arithmetic overflow and the
///         documented `[offset, min(offset+limit, total))` windowing.
/// @dev Ported from test/TrainPagination.t.sol: the shared file funds seed locks with native ETH,
///      which is purely incidental to this file's subject (pagination-window arithmetic, agnostic to
///      token type) — funding is switched to ERC20 here since Train (Tempo) has no payable entrypoint.
contract TrainPaginationTest is Test {
  Train public train;
  TestToken public token;

  address payable initiator;
  address payable receiver;

  function setUp() public {
    train = new Train();
    token = new TestToken();

    initiator = payable(makeAddr('initiator'));
    receiver = payable(makeAddr('receiver'));

    token.mint(initiator, 100 ether);
    vm.prank(initiator);
    token.approve(address(train), type(uint256).max);
  }

  function _getTimelockDeltas() internal pure returns (uint48 timelockDelta, uint48 rewardTimelockDelta) {
    timelockDelta = 3600; // 1 hour
    rewardTimelockDelta = 1800; // 30 minutes
  }

  function _defaultDestination() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDstAddr', dstAmount: 1, dstToken: 'ETH' });
  }

  function _userParams(bytes32 lockHashlock) internal view returns (Train.UserLockParams memory) {
    (uint48 timelockDelta, uint48 rewardTimelockDelta) = _getTimelockDeltas();
    return
      Train.UserLockParams({
        hashlock: lockHashlock,
        amount: 1 ether,
        rewardAmount: 0,
        timelockDelta: timelockDelta,
        rewardTimelockDelta: rewardTimelockDelta,
        quoteExpiry: uint48(block.timestamp + 60),
        recipient: receiver,
        refundTo: initiator,
        token: address(token),
        payoutCurve: address(0),
        payoutCurveData: '',
        rewardToken: 'ETH',
        rewardRecipient: 'rewardRecipient',
        srcChain: 'ETH'
      });
  }

  /// @dev Creates `count` user locks for `initiator`, each with a distinct hashlock, populating
  ///      `userLockHashes[initiator]`. Returns the hashlocks in creation (storage) order.
  function _seedLocks(uint256 count) internal returns (bytes32[] memory hashes) {
    hashes = new bytes32[](count);
    vm.startPrank(initiator);
    for (uint256 i = 0; i < count; i++) {
      bytes32 h = sha256(abi.encodePacked(uint256(1000 + i)));
      train.userLock(_userParams(h), _defaultDestination(), '', '');
      hashes[i] = h;
    }
    vm.stopPrank();
  }

  // ============ offset + limit clamp (no overflow) ============

  /// @notice With total == 2 and offset == 1, limit == type(uint256).max clamps `end` to `total`
  ///         instead of overflowing checked arithmetic, returning the single entry at index 1.
  function test_getUserLockHashes_OffsetPlusLimit_ClampsToTotal() public {
    bytes32[] memory seeded = _seedLocks(2);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 1, type(uint256).max);

    assertEq(total, 2);
    assertEq(hashes.length, 1);
    assertEq(hashes[0], seeded[1]);
  }

  /// @notice Same clamp for `getUserLocks`: total == 2, offset == 1, limit == type(uint256).max
  ///         returns the single lock at index 1 instead of overflowing.
  function test_getUserLocks_OffsetPlusLimit_ClampsToTotal() public {
    _seedLocks(2);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 1, type(uint256).max);

    assertEq(total, 2);
    assertEq(locks.length, 1);
    assertEq(locks[0].sender, initiator);
  }

  /// @notice offset == 0 with limit == type(uint256).max does not overflow (0 + max == max),
  ///         so `getUserLockHashes` returns the full list. Documents that the revert requires
  ///         offset >= 1.
  function test_getUserLockHashes_OffsetZeroMaxLimit_NoOverflow() public {
    bytes32[] memory seeded = _seedLocks(2);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 0, type(uint256).max);

    assertEq(total, 2);
    assertEq(hashes.length, 2);
    assertEq(hashes[0], seeded[0]);
    assertEq(hashes[1], seeded[1]);
  }

  /// @notice offset == 0 with limit == type(uint256).max does not overflow for `getUserLocks`
  ///         and returns the full list.
  function test_getUserLocks_OffsetZeroMaxLimit_NoOverflow() public {
    _seedLocks(2);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 0, type(uint256).max);

    assertEq(total, 2);
    assertEq(locks.length, 2);
  }

  // ============ full page ============

  /// @notice offset == 0, limit == total returns every entry in order for `getUserLockHashes`.
  function test_getUserLockHashes_FullPage() public {
    bytes32[] memory seeded = _seedLocks(3);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 0, 3);

    assertEq(total, 3);
    assertEq(hashes.length, 3);
    assertEq(hashes[0], seeded[0]);
    assertEq(hashes[1], seeded[1]);
    assertEq(hashes[2], seeded[2]);
  }

  /// @notice offset == 0, limit == total returns every entry in order for `getUserLocks`.
  function test_getUserLocks_FullPage() public {
    _seedLocks(3);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 0, 3);

    assertEq(total, 3);
    assertEq(locks.length, 3);
    assertEq(locks[0].sender, initiator);
    assertEq(locks[2].sender, initiator);
  }

  // ============ partial page ============

  /// @notice A partial window (offset == 1, limit == 1) returns exactly one entry, the one at
  ///         index 1, for `getUserLockHashes`.
  function test_getUserLockHashes_PartialPage() public {
    bytes32[] memory seeded = _seedLocks(3);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 1, 1);

    assertEq(total, 3);
    assertEq(hashes.length, 1);
    assertEq(hashes[0], seeded[1]);
  }

  /// @notice A partial window (offset == 1, limit == 1) returns exactly the lock at index 1 for
  ///         `getUserLocks`.
  function test_getUserLocks_PartialPage() public {
    _seedLocks(3);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 1, 1);

    assertEq(total, 3);
    assertEq(locks.length, 1);
    assertEq(locks[0].sender, initiator);
  }

  // ============ limit larger than remaining (no overflow) ============

  /// @notice With limit == total * 2 (larger than remaining but not overflowing) and offset == 0,
  ///         `getUserLockHashes` clamps `end` to total and returns the full list.
  function test_getUserLockHashes_LimitLargerThanRemaining() public {
    bytes32[] memory seeded = _seedLocks(3);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 0, 6);

    assertEq(total, 3);
    assertEq(hashes.length, 3);
    assertEq(hashes[0], seeded[0]);
    assertEq(hashes[2], seeded[2]);
  }

  /// @notice With limit == total * 2 and offset == 0, `getUserLocks` clamps `end` to total and
  ///         returns the full list.
  function test_getUserLocks_LimitLargerThanRemaining() public {
    _seedLocks(3);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 0, 6);

    assertEq(total, 3);
    assertEq(locks.length, 3);
  }

  /// @notice With a mid-list offset (offset == 2) and limit == total * 2 (larger than remaining
  ///         but not overflowing), `getUserLockHashes` returns only the remaining entry at index 2.
  function test_getUserLockHashes_MidOffsetLimitLargerThanRemaining() public {
    bytes32[] memory seeded = _seedLocks(3);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 2, 6);

    assertEq(total, 3);
    assertEq(hashes.length, 1);
    assertEq(hashes[0], seeded[2]);
  }

  /// @notice With offset == 2 and limit == total * 2, `getUserLocks` returns only the remaining
  ///         entry at index 2.
  function test_getUserLocks_MidOffsetLimitLargerThanRemaining() public {
    _seedLocks(3);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 2, 6);

    assertEq(total, 3);
    assertEq(locks.length, 1);
  }

  // ============ offset == total ============

  /// @notice offset == total hits the `offset >= total` guard and returns an empty page with the
  ///         true total for `getUserLockHashes`.
  function test_getUserLockHashes_OffsetEqualsTotal_ReturnsEmpty() public {
    _seedLocks(3);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 3, 10);

    assertEq(total, 3);
    assertEq(hashes.length, 0);
  }

  /// @notice offset == total returns an empty page with the true total for `getUserLocks`.
  function test_getUserLocks_OffsetEqualsTotal_ReturnsEmpty() public {
    _seedLocks(3);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 3, 10);

    assertEq(total, 3);
    assertEq(locks.length, 0);
  }

  // ============ limit == 0 ============

  /// @notice limit == 0 hits the guard and returns an empty page with the true total for
  ///         `getUserLockHashes`.
  function test_getUserLockHashes_LimitZero_ReturnsEmpty() public {
    _seedLocks(3);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 0, 0);

    assertEq(total, 3);
    assertEq(hashes.length, 0);
  }

  /// @notice limit == 0 returns an empty page with the true total for `getUserLocks`.
  function test_getUserLocks_LimitZero_ReturnsEmpty() public {
    _seedLocks(3);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 0, 0);

    assertEq(total, 3);
    assertEq(locks.length, 0);
  }

  // ============ offset > total ============

  /// @notice offset > total hits the `offset >= total` guard and returns an empty page with the
  ///         true total for `getUserLockHashes`.
  function test_getUserLockHashes_OffsetGreaterThanTotal_ReturnsEmpty() public {
    _seedLocks(3);

    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(initiator, 10, 5);

    assertEq(total, 3);
    assertEq(hashes.length, 0);
  }

  /// @notice offset > total returns an empty page with the true total for `getUserLocks`.
  function test_getUserLocks_OffsetGreaterThanTotal_ReturnsEmpty() public {
    _seedLocks(3);

    (Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(initiator, 10, 5);

    assertEq(total, 3);
    assertEq(locks.length, 0);
  }
}
