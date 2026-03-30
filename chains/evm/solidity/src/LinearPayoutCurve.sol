// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IPayoutCurve } from "./IPayoutCurve.sol";

/// @title LinearPayoutCurve - Linear time-based payout decay
/// @notice P(t) = max(Pmin, amount - (rate * Δt) / 1e18)
///         where Δt = max(0, currentTime - startTime - gracePeriod)
/// @dev Deployed as a standalone library; called by the HTLC via IPayoutCurve interface
///      (STATICCALL — Solidity emits STATICCALL for external view calls).
///      config = abi.encode(uint256 gracePeriod, uint256 rate, uint256 Pmin)
///      rate is tokens-per-second scaled by 1e18.
///      Example: rate = 1e33 decays 0.001 ether/second on a 1-ether lock.
library LinearPayoutCurve {
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
    if (config.length != 96) revert InvalidConfig();

    (uint256 gracePeriod, uint256 rate, uint256 Pmin) =
      abi.decode(config, (uint256, uint256, uint256));

    if (Pmin > amount) revert FloorExceedsAmount();

    if (currentTime <= startTime + gracePeriod) {
      return amount;
    }

    uint256 dt = uint256(currentTime) - uint256(startTime) - gracePeriod;
    uint256 decay = (rate * dt) / 1e18;

    if (decay >= amount - Pmin) {
      return Pmin;
    }

    return amount - decay;
  }
}
