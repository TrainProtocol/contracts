// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title IERC3009 - minimal EIP-3009 receiveWithAuthorization
/// @notice Used by the TrainRouter to pull funds gaslessly. `receiveWithAuthorization` requires the
///         caller to be `to` (front-run protection), which is enforced by compliant tokens.
/// @dev The `nonce` is a free-form bytes32 used by the token solely for replay protection; the
///      TrainRouter binds it to the user's intent hash so the 3009 signature commits to the full intent.
interface IERC3009 {
  /// @notice Pull `value` tokens from `from` to `to` using a signed authorization (caller must be `to`).
  /// @param from The token owner who signed the authorization.
  /// @param to The recipient of the tokens (must be msg.sender for compliant tokens).
  /// @param value The amount to transfer.
  /// @param validAfter Unix time after which the authorization becomes valid.
  /// @param validBefore Unix time before which the authorization remains valid.
  /// @param nonce Unique authorization nonce (the router binds this to the intent hash).
  /// @param v ECDSA signature recovery byte.
  /// @param r ECDSA signature r component.
  /// @param s ECDSA signature s component.
  function receiveWithAuthorization(
    address from,
    address to,
    uint256 value,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;
}
