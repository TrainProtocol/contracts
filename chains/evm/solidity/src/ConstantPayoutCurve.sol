// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IERC165 } from '@openzeppelin/contracts/utils/introspection/IERC165.sol';
import { IPayoutCurve } from './IPayoutCurve.sol';

/// @title ConstantPayoutCurve - Constant (no-decay) payout
/// @notice P(t) = amount, for all t. The payout never decays and is independent of
///         startTime, currentTime, and config. This is the single curve retained by the
///         protocol; it makes the payout-curve mechanism an explicit no-op.
/// @dev Deployed as a standalone contract and called by the HTLC via the IPayoutCurve interface
///      (STATICCALL — Solidity emits STATICCALL for external view/pure calls).
///      Always returns `amount`, which satisfies the interface invariant 0 < payout <= amount
///      (Train independently guarantees amount > 0). `config` is ignored entirely.
///      Implements EIP-165: answers true for both the ERC-165 id and the IPayoutCurve id.
contract ConstantPayoutCurve is IPayoutCurve {
  /// @notice EIP-165 interface detection.
  /// @return True iff `interfaceId` is the ERC-165 id or the IPayoutCurve id (false for 0xffffffff).
  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == type(IERC165).interfaceId || interfaceId == type(IPayoutCurve).interfaceId;
  }

  /// @notice Returns the full locked amount, unchanged. See IPayoutCurve.computePayout.
  function computePayout(
    uint256 amount,
    uint48 /* startTime */,
    uint48 /* currentTime */,
    bytes calldata /* config */
  ) external pure returns (uint256) {
    return amount;
  }
}
