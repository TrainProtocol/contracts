// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IPayoutCurve
/// @notice Interface for time-based payout decay curves used by the HTLC.
/// @dev Any contract implementing this interface can be used as a payout curve.
///      The HTLC calls `computePayout` via an external `view` call, which the Solidity
///      compiler emits as a STATICCALL. This prevents any callee state mutation at the
///      EVM level, regardless of the actual mutability of the deployed implementation.
///
///      `payoutCurveData` stored in each lock is passed as `config` directly —
///      no selector prefix is needed since the function is fixed by this interface.
interface IPayoutCurve {
  /// @notice Compute the payout for a given lock at the current time.
  /// @param amount      The locked token amount.
  /// @param startTime   The timestamp when the lock was created.
  /// @param currentTime The current timestamp (block.timestamp at redeem time).
  /// @param config      ABI-encoded curve configuration (implementation-defined layout).
  /// @return payout     Must satisfy: 0 < payout <= amount.
  function computePayout(
    uint256 amount,
    uint48 startTime,
    uint48 currentTime,
    bytes calldata config
  ) external view returns (uint256 payout);

  /// @notice ERC-165-style interface check.
  /// @return True if and only if interfaceId equals type(IPayoutCurve).interfaceId.
  function supportsInterface(bytes4 interfaceId) external pure returns (bool);
}
