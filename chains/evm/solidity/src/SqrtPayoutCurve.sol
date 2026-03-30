// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./IPayoutCurve.sol";

/// @title SqrtPayoutCurve - Square-root + linear time-based payout decay
/// @notice P(t) = max(Pmin, P0 - A * sqrt(Δt) - B * Δt)
///         where Δt = max(0, currentTime - startTime - gracePeriod)
/// @dev Deployed as a standalone library; called by the HTLC via IPayoutCurve interface
///      (STATICCALL — Solidity emits STATICCALL for external view calls).
///      config = abi.encode(uint256 gracePeriod, uint256 A, uint256 B, uint256 Pmin)
library SqrtPayoutCurve {
  error InvalidConfig();
  error FloorExceedsAmount();

  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == type(IPayoutCurve).interfaceId;
  }

  function computePayout(
    uint256 amount,
    uint48 startTime,
    uint48 currentTime,
    bytes calldata config
  ) external pure returns (uint256) {
    if (config.length != 128) revert InvalidConfig();

    (uint256 gracePeriod, uint256 A, uint256 B, uint256 Pmin) =
      abi.decode(config, (uint256, uint256, uint256, uint256));

    if (Pmin > amount) revert FloorExceedsAmount();

    if (currentTime <= startTime + gracePeriod) {
      return amount;
    }

    uint256 dt = uint256(currentTime) - uint256(startTime) - gracePeriod;
    uint256 sqrtDt = _sqrt(dt);
    uint256 decay = (A * sqrtDt) / 1e18 + (B * dt) / 1e18;

    if (decay >= amount - Pmin) {
      return Pmin;
    }

    return amount - decay;
  }

  function _sqrt(uint256 x) internal pure returns (uint256) {
    if (x == 0) return 0;
    uint256 z = (x + 1) / 2;
    uint256 y = x;
    while (z < y) {
      y = z;
      z = (x / z + z) / 2;
    }
    return y;
  }
}
