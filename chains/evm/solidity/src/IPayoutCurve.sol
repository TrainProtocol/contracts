// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IERC165 } from '@openzeppelin/contracts/utils/introspection/IERC165.sol';

/// @title IPayoutCurve
/// @notice Interface for time-based payout decay curves used by the HTLC.
/// @dev Any contract implementing this interface can be used as a payout curve.
///      The HTLC calls `computePayout` via an external `view` call, which the Solidity
///      compiler emits as a STATICCALL. This prevents any callee state mutation at the
///      EVM level, regardless of the actual mutability of the deployed implementation.
///
///      `payoutCurveData` stored in each lock is passed as `config` directly —
///      no selector prefix is needed since the function is fixed by this interface.
///
///      Extends EIP-165: a curve must answer `supportsInterface` true for both the ERC-165 id
///      (`type(IERC165).interfaceId`) and `type(IPayoutCurve).interfaceId`. Train probes this via
///      OpenZeppelin's `ERC165Checker` before trusting a curve (see `Train._validatePayoutCurve`).
interface IPayoutCurve is IERC165 {
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
}
