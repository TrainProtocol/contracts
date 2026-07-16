// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { IERC20Permit } from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol';
import { EIP712 } from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import { SignatureChecker } from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';
import { ReentrancyGuardTransient } from '@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol';

import { IERC3009 } from './interfaces/IERC3009.sol';
import { ISignatureTransfer } from './interfaces/ISignatureTransfer.sol';

/// @title TrainRouter - gasless, target-agnostic signed-call forwarder
/// @notice Pulls a user's ERC20 gaslessly (Permit2 / ERC-2612 / EIP-3009) and forwards a
///         user-signed call to an arbitrary `train` contract. The router knows NOTHING about the
///         target's ABI: the caller ABI-encodes the destination call off-chain as `callData`, and the
///         user's intent signature commits to `(user, train, token, amount, keccak256(callData))`.
/// @dev SECURITY MODEL (no governance, no stored/hardcoded addresses, no target coupling):
///      - The router holds NO privileged state and no knowledge of the target's interface. `train`,
///        `token`, `amount`, `callData` and `permit2` are all supplied per call and bound into the
///        signed intent, so a relayer can only execute the EXACT call the user authorized.
///      - Funds route user -> router -> train. The router pulls exactly `amount`, approves the
///        (untrusted, user-chosen) `train` for EXACTLY `amount`, low-level-`call`s `callData`, then
///        resets the approval to 0. `train` can therefore consume at most `amount`.
///      - A post-forward conservation check requires the router's token balance to return to its
///        pre-pull value, guaranteeing `train` consumed exactly the pulled funds; otherwise the whole
///        tx reverts and the user keeps their funds. The router never custodies a balance and a
///        malicious/broken `train` cannot strand user funds.
///      - Intent binding per standard: ERC-2612 uses a standalone EIP-712 intent signature; Permit2
///        binds via the witness; EIP-3009 binds via the nonce. All commit to `hashIntent(...)`.
///      - Replay protection: every intent carries a user-chosen `nonce` and a `deadline`; its struct
///        hash is recorded in `consumedIntent` and rejected on re-use across ALL paths, so a signed
///        intent executes at most once. Vary the nonce to authorize a deliberate repeat of the same
///        call; the deadline bounds how long an unused intent stays forwardable.
///      - Because the router does not inspect `callData`, the "correct recipient / amount / target"
///        guarantee comes entirely from the user's signature over the intent — the router only
///        guarantees it forwards exactly that call and custodies nothing.
///      - ERC20 only: native ETH is unsupported (the gasless standards are ERC20). Fee-on-transfer
///        tokens are not intended: a fee on the user->router leg trips `InsufficientPulled`.
contract TrainRouter is EIP712, ReentrancyGuardTransient {
  using SafeERC20 for IERC20;

  /// @notice Thrown when the user address is zero
  error InvalidUser();
  /// @notice Thrown when the token is native ETH (address(0)) — unsupported on the gasless path
  error NativeNotSupported();
  /// @notice Thrown when the standalone intent signature (ERC-2612 path) is invalid
  error InvalidIntentSignature();
  /// @notice Thrown when the Permit2 permitted token/amount does not match the signed token/amount
  error Permit2Mismatch();
  /// @notice Thrown when fewer tokens than `amount` were pulled (e.g. fee-on-transfer / nothing)
  error InsufficientPulled();
  /// @notice Thrown when `train` did not consume exactly the pulled funds (residual left in router)
  error ResidualBalance();
  /// @notice Thrown when the intent has already been consumed (replay attempt) on any path
  error IntentAlreadyConsumed();
  /// @notice Thrown when the intent deadline has passed (block.timestamp > deadline)
  error IntentExpired();

  /// @notice Emitted when the router forwards a user-signed call to `train`.
  /// @param user The user whose funds were pulled and on whose behalf the call was forwarded.
  /// @param train The target contract the call was forwarded to.
  /// @param callHash keccak256 of the forwarded calldata (matches the signed intent).
  /// @param relayer The caller that submitted the gasless intent (msg.sender).
  /// @param token The ERC20 pulled and forwarded.
  /// @param amount The amount pulled and consumed by `train`.
  event IntentForwarded(
    address indexed user,
    address indexed train,
    bytes32 indexed callHash,
    address relayer,
    address token,
    uint256 amount
  );

  /// @notice The signed intent. `callHash` = keccak256(callData) binds the exact forwarded call
  ///         without the router needing to know the target's ABI.
  bytes32 private constant INTENT_TYPEHASH =
    keccak256('Intent(address user,address train,address token,uint256 amount,bytes32 callHash,uint256 nonce,uint256 deadline)');

  /// @notice Permit2 witness type string: completes the PermitWitnessTransferFrom stub with the
  ///         `Intent witness` field, then appends the referenced struct types alphabetically
  ///         (Intent, TokenPermissions).
  string public constant WITNESS_TYPE_STRING =
    'Intent witness)Intent(address user,address train,address token,uint256 amount,bytes32 callHash,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)';

  /// @notice Intents already consumed, keyed by the full EIP-712 struct hash (includes nonce+deadline).
  ///         Enforces single-use uniformly across the ERC-2612, EIP-3009, and Permit2 paths.
  mapping(bytes32 => bool) public consumedIntent;

  /// @notice ERC-2612 permit signature components (value is the permitted allowance)
  struct Permit2612 {
    uint256 value;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
  }

  /// @notice EIP-3009 authorization signature components. The nonce is NOT supplied by the caller —
  ///         the router forces it to the intent hash, binding the signature to the intent.
  struct Authorization3009 {
    uint256 validAfter;
    uint256 validBefore;
    uint8 v;
    bytes32 r;
    bytes32 s;
  }

  constructor() EIP712('TrainRouter', '1') {}

  // ─── Gasless forwarding entrypoints ─────────────────────────

  /// @notice Gasless forward via ERC-2612 permit + a standalone EIP-712 intent signature.
  /// @param user The user whose funds are pulled and who signed the intent.
  /// @param token The ERC20 to pull.
  /// @param amount The amount to pull and approve to `train`.
  /// @param train The target contract to forward to (bound into the signed intent).
  /// @param callData The ABI-encoded call to execute on `train` (bound via keccak256 into the intent).
  /// @param nonce User-chosen replay differentiator bound into the intent.
  /// @param deadline Unix timestamp after which this intent can no longer be forwarded.
  /// @param permitData ERC-2612 permit (value/deadline/v/r/s) granting this router the allowance.
  /// @param intentSig The user's EIP-712 signature over the intent, verified before funds are pulled.
  function forwardWithPermit(
    address user,
    address token,
    uint256 amount,
    address train,
    bytes calldata callData,
    uint256 nonce,
    uint256 deadline,
    Permit2612 calldata permitData,
    bytes calldata intentSig
  ) external nonReentrant {
    _requireSupported(user, token);

    bytes32 intentHash = hashIntent(user, train, token, amount, keccak256(callData), nonce, deadline);
    _consumeIntent(intentHash, deadline);

    bytes32 digest = _hashTypedDataV4(intentHash);
    if (!SignatureChecker.isValidSignatureNow(user, digest, intentSig)) revert InvalidIntentSignature();

    uint256 balBefore = IERC20(token).balanceOf(address(this));
    // Tolerate front-running of the permit: if the nonce was already consumed, proceed to
    // transferFrom which succeeds as long as the allowance is in place.
    try IERC20Permit(token).permit(user, address(this), permitData.value, permitData.deadline, permitData.v, permitData.r, permitData.s) {} catch {}
    // `transferFrom(user, ...)` with a permit — SAFE because the intent signature verified above binds
    // `user`, `train`, `token`, `amount`, and the exact `callData`: a relayer can only pull `user`'s
    // funds into the exact call `user` authorized. Funds never reach the caller.
    IERC20(token).safeTransferFrom(user, address(this), amount);

    _forward(user, train, token, amount, balBefore, callData);
  }

  /// @notice Gasless forward via EIP-3009 receiveWithAuthorization. The intent is bound through the
  ///         authorization nonce, which the router forces to the intent hash.
  /// @param user The user whose funds are pulled and who signed the authorization.
  /// @param token The ERC20 to pull (must support EIP-3009).
  /// @param amount The amount to pull and approve to `train`.
  /// @param train The target contract to forward to (bound into the intent nonce).
  /// @param callData The ABI-encoded call to execute on `train`.
  /// @param nonce User-chosen replay differentiator bound into the intent hash (the 3009 nonce).
  /// @param deadline Unix timestamp after which this intent can no longer be forwarded.
  /// @param auth EIP-3009 window + signature; the nonce is forced to the intent hash.
  function forwardWithAuthorization(
    address user,
    address token,
    uint256 amount,
    address train,
    bytes calldata callData,
    uint256 nonce,
    uint256 deadline,
    Authorization3009 calldata auth
  ) external nonReentrant {
    _requireSupported(user, token);

    bytes32 intentHash = hashIntent(user, train, token, amount, keccak256(callData), nonce, deadline);
    _consumeIntent(intentHash, deadline);

    uint256 balBefore = IERC20(token).balanceOf(address(this));
    IERC3009(token).receiveWithAuthorization(
      user, address(this), amount, auth.validAfter, auth.validBefore, intentHash, auth.v, auth.r, auth.s
    );

    _forward(user, train, token, amount, balBefore, callData);
  }

  /// @notice Gasless forward via Permit2 permitWitnessTransferFrom. The intent is bound through the
  ///         Permit2 witness (= the intent hash). `permit2` is supplied per call.
  /// @param user The user whose funds are pulled and who signed the Permit2 witness.
  /// @param token The ERC20 to pull.
  /// @param amount The amount to pull and approve to `train`.
  /// @param train The target contract to forward to (bound into the witness).
  /// @param callData The ABI-encoded call to execute on `train`.
  /// @param nonce User-chosen replay differentiator bound into the intent hash (the Permit2 witness).
  /// @param deadline Unix timestamp after which this intent can no longer be forwarded.
  /// @param permit2 The Permit2 contract to call (supplied per call; no hardcoded address).
  /// @param permit The Permit2 PermitTransferFrom; its token must equal `token` and amount >= `amount`.
  /// @param permit2Sig The user's Permit2 signature carrying the intent witness.
  function forwardWithPermit2(
    address user,
    address token,
    uint256 amount,
    address train,
    bytes calldata callData,
    uint256 nonce,
    uint256 deadline,
    address permit2,
    ISignatureTransfer.PermitTransferFrom calldata permit,
    bytes calldata permit2Sig
  ) external nonReentrant {
    _requireSupported(user, token);
    if (permit.permitted.token != token || permit.permitted.amount < amount) revert Permit2Mismatch();

    bytes32 intentHash = hashIntent(user, train, token, amount, keccak256(callData), nonce, deadline);
    _consumeIntent(intentHash, deadline);

    uint256 balBefore = IERC20(token).balanceOf(address(this));
    ISignatureTransfer(permit2).permitWitnessTransferFrom(
      permit,
      ISignatureTransfer.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
      user,
      intentHash,
      WITNESS_TYPE_STRING,
      permit2Sig
    );

    _forward(user, train, token, amount, balBefore, callData);
  }

  // ─── Views (intent hashing) ─────────────────────────────────

  /// @notice EIP-712 struct hash of the intent (the canonical intent identifier). Used directly as
  ///         the Permit2 witness and the EIP-3009 nonce, and domain-wrapped for the ERC-2612 path.
  /// @param user The user committing to the intent.
  /// @param train The destination contract.
  /// @param token The ERC20 to pull.
  /// @param amount The amount to pull.
  /// @param callHash keccak256 of the forwarded calldata.
  /// @param nonce User-chosen replay differentiator (vary it to authorize a deliberate repeat).
  /// @param deadline Unix timestamp after which the intent can no longer be forwarded.
  /// @return The EIP-712 struct hash of the intent.
  function hashIntent(
    address user,
    address train,
    address token,
    uint256 amount,
    bytes32 callHash,
    uint256 nonce,
    uint256 deadline
  ) public pure returns (bytes32) {
    return keccak256(abi.encode(INTENT_TYPEHASH, user, train, token, amount, callHash, nonce, deadline));
  }

  /// @notice The full EIP-712 digest signed in the ERC-2612 intent-signature path. Exposed for
  ///         off-chain signers and tests.
  /// @return The domain-separated EIP-712 digest the user signs on the ERC-2612 path.
  function intentDigest(
    address user,
    address train,
    address token,
    uint256 amount,
    bytes32 callHash,
    uint256 nonce,
    uint256 deadline
  ) external view returns (bytes32) {
    return _hashTypedDataV4(hashIntent(user, train, token, amount, callHash, nonce, deadline));
  }

  /// @notice EIP-712 domain separator, exposed for off-chain signers and tests.
  /// @return The EIP-712 domain separator for this router.
  function DOMAIN_SEPARATOR() external view returns (bytes32) {
    return _domainSeparatorV4();
  }

  // ─── Internal helpers ───────────────────────────────────────

  function _requireSupported(address user, address token) private pure {
    if (user == address(0)) revert InvalidUser();
    if (token == address(0)) revert NativeNotSupported();
  }

  /// @dev Enforce intent expiry + single-use, then mark it consumed — BEFORE any external
  ///      interaction (checks-effects-interactions; redundant with nonReentrant). A later revert in
  ///      the same tx rolls back this write, so an intent is durably consumed only on a fully
  ///      successful forward.
  function _consumeIntent(bytes32 intentHash, uint256 deadline) private {
    if (block.timestamp > deadline) revert IntentExpired();
    if (consumedIntent[intentHash]) revert IntentAlreadyConsumed();
    consumedIntent[intentHash] = true;
  }

  /// @dev Approve the untrusted `train` for EXACTLY `amount`, forward the user-signed `callData`,
  ///      reset the approval, and verify conservation: the router's token balance must return to
  ///      `balBefore`, proving `train` consumed exactly the pulled funds and the router custodies
  ///      nothing. Reverts (bubbling the target's revert) if the forwarded call fails.
  function _forward(
    address user,
    address train,
    address token,
    uint256 amount,
    uint256 balBefore,
    bytes calldata callData
  ) private {
    IERC20 t = IERC20(token);
    uint256 pulled = t.balanceOf(address(this)) - balBefore;
    if (pulled < amount) revert InsufficientPulled(); // FoT / nothing-received

    t.forceApprove(train, amount);
    (bool ok, bytes memory ret) = train.call(callData);
    if (!ok) {
      assembly {
        revert(add(ret, 0x20), mload(ret))
      }
    }
    t.forceApprove(train, 0);

    if (t.balanceOf(address(this)) != balBefore) revert ResidualBalance();

    emit IntentForwarded(user, train, keccak256(callData), msg.sender, token, amount);
  }
}
