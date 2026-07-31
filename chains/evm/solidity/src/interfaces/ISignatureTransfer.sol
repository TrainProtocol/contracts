// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title ISignatureTransfer - minimal Permit2 SignatureTransfer surface
/// @notice Only `permitWitnessTransferFrom` and the structs it needs. The TrainRouter passes the
///         user's intent hash as the `witness`, so the user's single Permit2 signature commits
///         to the full intent (destination Train, params, etc.).
/// @dev Mirrors Uniswap's Permit2 ISignatureTransfer. The Permit2 contract address is supplied
///      per call to the TrainRouter (no hardcoded address).
interface ISignatureTransfer {
  struct TokenPermissions {
    address token;
    uint256 amount;
  }

  struct PermitTransferFrom {
    TokenPermissions permitted;
    uint256 nonce;
    uint256 deadline;
  }

  struct SignatureTransferDetails {
    address to;
    uint256 requestedAmount;
  }

  /// @notice Permit2 transfer that additionally commits an arbitrary `witness` in the signed payload.
  /// @param permit The permitted token/amount plus nonce and deadline.
  /// @param transferDetails The recipient (`to`) and `requestedAmount`.
  /// @param owner The token owner who signed the permit.
  /// @param witness The extra data hash bound into the signature (here, the intent hash).
  /// @param witnessTypeString The EIP-712 type string describing the witness struct.
  /// @param signature The owner's Permit2 signature.
  function permitWitnessTransferFrom(
    PermitTransferFrom calldata permit,
    SignatureTransferDetails calldata transferDetails,
    address owner,
    bytes32 witness,
    string calldata witnessTypeString,
    bytes calldata signature
  ) external;
}
