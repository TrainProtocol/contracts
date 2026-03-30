// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IPayoutCurve } from "./IPayoutCurve.sol";

/// @title VolatilityDecayCurve
/// @notice Implements the decay function from the Decay Function Specification v1.0:
///
///         P(t) = max(Pmin, P0 - A*sqrt(Δt) - B*Δt)
///         where Δt = max(0, currentTime - startTime - gracePeriod)
///
/// @dev Unlike SqrtPayoutCurve (which stores raw A, B, Pmin in config), this curve
///      derives all three from market parameters at call time:
///
///          Pmin = r * amount
///          A    = amount * σ_ann / sqrt(SECONDS_PER_YEAR)     [early-delay penalty]
///          B    = (amount - Pmin) / H                          [sustained-delay penalty]
///
///      Because A, B, Pmin scale with `amount`, the same config bytes apply to any lock
///      size — callers configure market quantities once (volatility, horizon, floor ratio)
///      rather than recomputing token-denominated coefficients per lock.
///
///      config = abi.encode(uint256 gracePeriod, uint256 sigmaAnn, uint256 H, uint256 r)
///
///        gracePeriod  seconds of full payout before decay begins (relay latency buffer)
///        sigmaAnn     annualised volatility × 1e18  (e.g. 1.10 → 1.10e18 for 110% vol)
///        H            decay horizon in seconds — time for the linear term alone to exhaust
///                     (amount - Pmin); equivalently B * H = amount - Pmin
///        r            floor ratio × 1e18 (e.g. 0.85e18); must satisfy 0 ≤ r < 1e18
///                     Recommended range: [0.80e18, 0.90e18] per the specification
library VolatilityDecayCurve {
  /// @dev 365 * 24 * 3600
  uint256 private constant SECONDS_PER_YEAR = 31_536_000;

  error InvalidConfig();
  error InvalidFloorRatio(); // r >= 1e18 would set Pmin >= amount, leaving no decay headroom
  error InvalidHorizon();    // H == 0 causes division by zero when computing B

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

    (uint256 gracePeriod, uint256 sigmaAnn, uint256 H, uint256 r) =
      abi.decode(config, (uint256, uint256, uint256, uint256));

    if (H == 0) revert InvalidHorizon();
    if (r >= 1e18) revert InvalidFloorRatio();

    // Pmin = r * P0  (eq. 3)
    uint256 Pmin = (r * amount) / 1e18;

    if (currentTime <= startTime + gracePeriod) {
      return amount;
    }

    uint256 dt = uint256(currentTime) - uint256(startTime) - gracePeriod;

    // A (1e18-scaled coefficient, units: token-wei / sqrt(s))
    //
    // From spec eqs (4) and (5):
    //   σ_√s = σ_ann / sqrt(SECONDS_PER_YEAR)
    //   A     = P0 * σ_√s = amount * σ_ann / sqrt(SECONDS_PER_YEAR)
    //
    // In SqrtPayoutCurve convention the stored coefficient satisfies:
    //   decay_A = A_stored * sqrt(dt) / 1e18
    // so A_stored = A [token-wei/√s] * 1e18.
    //
    // Since sigmaAnn is stored as σ_ann * 1e18:
    //   A_stored = amount * σ_ann * 1e18 / sqrt(SECONDS_PER_YEAR)
    //            = amount * sigmaAnn    / sqrt(SECONDS_PER_YEAR)
    //
    // To avoid irrational sqrt, rewrite using sqrt(x * 1e18) = sqrt(x) * 1e9:
    //   A_stored = amount * sigmaAnn * 1e9 / sqrt(SECONDS_PER_YEAR * 1e18)
    uint256 sqrtYearWad = _sqrt(SECONDS_PER_YEAR * 1e18);
    uint256 A = (amount * sigmaAnn * 1e9) / sqrtYearWad;

    // B (1e18-scaled coefficient, units: token-wei / s)
    //
    // From spec eq (6):
    //   B = (P0 - Pmin) / H
    //
    // B_stored = B [token-wei/s] * 1e18 = (amount - Pmin) * 1e18 / H
    uint256 B = ((amount - Pmin) * 1e18) / H;

    // Apply combined decay
    uint256 decay = (A * _sqrt(dt)) / 1e18 + (B * dt) / 1e18;

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
