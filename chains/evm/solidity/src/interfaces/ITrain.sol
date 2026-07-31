// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title ITrain - caller-side ABI for encoding a Train.userLockFor forwarding call
/// @notice Not used by TrainRouter (which is target-agnostic and forwards opaque `bytes`). This exists
///         only so off-chain callers/scripts/tests can build `callData` via
///         `abi.encodeCall(ITrain.userLockFor, (...))` in a type-checked way.
/// @dev IMPORTANT: `UserLockParams` and `DestinationInfo` MUST mirror the structs in `Train.sol`
///      field-for-field (names, types, order). They are ABI-identical so the encoded `userLockFor`
///      call decodes correctly at Train. Any divergence corrupts the forwarded calldata and is
///      caught by the router↔Train integration tests.
interface ITrain {
  /// @dev Mirror of Train.DestinationInfo
  struct DestinationInfo {
    string dstChain;
    string dstAddress;
    uint256 dstAmount;
    string dstToken;
  }

  /// @dev Mirror of Train.UserLockParams
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

  /// @notice Create a user lock on behalf of `user`, funded by the caller (the TrainRouter).
  function userLockFor(
    address user,
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata userData,
    bytes calldata solverData
  ) external;
}
