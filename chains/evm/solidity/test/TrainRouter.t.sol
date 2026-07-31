// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import '../src/TrainRouter.sol';
import './mocks/TestToken.sol';
import { FeeOnTransferToken, NoPullTrain, ReentrantTrain } from './mocks/Mocks.sol';
import '../src/interfaces/ITrain.sol';
import '../src/interfaces/ISignatureTransfer.sol';
import { ERC20 } from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import { EIP712 } from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import { IERC20Permit } from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

/// @notice End-to-end tests for the target-agnostic gasless TrainRouter across all three standards, plus
///         the trust-boundary negatives (intent binding, replay, expiry, native, zero-user, conservation,
///         reentrancy). The router forwards a user-signed `callData` (here an encoded Train.userLockFor)
///         to `train`; ITrain is used only to encode that calldata.
contract TrainRouterTest is Test {
  Train train;
  TrainRouter router;
  TestToken token;
  MockERC3009 token3009;
  MockPermit2 permit2;

  uint256 userPk = 0xA11CE;
  address user;
  address payable recipient;
  address relayer = address(0xBEEF);

  uint256 constant SECRET = 7;
  bytes32 hashlock;
  uint256 constant AMOUNT = 100 ether;

  // Fixed intent nonce/deadline used by the helpers so most tests re-use one signed intent shape.
  uint256 constant INTENT_NONCE = 1;
  uint256 constant INTENT_DEADLINE = type(uint256).max;

  bytes32 constant PERMIT_TYPEHASH =
    keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');
  bytes32 constant RECEIVE_TYPEHASH =
    keccak256('ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');
  bytes32 constant TOKEN_PERMISSIONS_TYPEHASH = keccak256('TokenPermissions(address token,uint256 amount)');
  string constant PERMIT2_STUB =
    'PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,';

  function setUp() public {
    train = new Train();
    router = new TrainRouter();
    token = new TestToken();
    token3009 = new MockERC3009();
    permit2 = new MockPermit2();

    user = vm.addr(userPk);
    recipient = payable(makeAddr('recipient'));

    token.mint(user, 1000 ether);
    token3009.mint(user, 1000 ether);

    vm.prank(user);
    token.approve(address(permit2), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  // ─── helpers ────────────────────────────────────────────────

  function _params(address tokenAddr) internal view returns (ITrain.UserLockParams memory) {
    return ITrain.UserLockParams({
      hashlock: hashlock, amount: AMOUNT, rewardAmount: 0, timelockDelta: 3600,
      rewardTimelockDelta: 1800, quoteExpiry: uint48(block.timestamp + 1000),
      recipient: recipient, refundTo: user, token: tokenAddr,
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'ETH', rewardRecipient: 'rr', srcChain: 'SRC'
    });
  }

  function _dst() internal pure returns (ITrain.DestinationInfo memory) {
    return ITrain.DestinationInfo({ dstChain: 'DST', dstAddress: '0xabc', dstAmount: 42, dstToken: 'USDC' });
  }

  /// @dev The user-signed call the router forwards to `train`: a normal encoded Train.userLockFor.
  function _callData(ITrain.UserLockParams memory p, ITrain.DestinationInfo memory d)
    internal view returns (bytes memory)
  {
    return abi.encodeCall(ITrain.userLockFor, (user, p, d, bytes(''), bytes('')));
  }

  function _signIntent(address tokenAddr, bytes memory callData, address trainAddr)
    internal view returns (bytes memory)
  {
    bytes32 digest =
      router.intentDigest(user, trainAddr, tokenAddr, AMOUNT, keccak256(callData), INTENT_NONCE, INTENT_DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    return abi.encodePacked(r, s, v);
  }

  function _signPermit(address spender, uint256 value, uint256 deadline)
    internal view returns (uint8 v, bytes32 r, bytes32 s)
  {
    uint256 nonce = IERC20Permit(address(token)).nonces(user);
    bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, user, spender, value, nonce, deadline));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', token.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(userPk, digest);
  }

  function _sign3009(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
    internal view returns (uint8 v, bytes32 r, bytes32 s)
  {
    bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, user, to, value, validAfter, validBefore, nonce));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', token3009.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(userPk, digest);
  }

  function _signPermit2(ISignatureTransfer.PermitTransferFrom memory permit, address spender, bytes32 witness)
    internal view returns (bytes memory)
  {
    bytes32 typeHash = keccak256(abi.encodePacked(PERMIT2_STUB, router.WITNESS_TYPE_STRING()));
    bytes32 tph = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount));
    bytes32 structHash = keccak256(abi.encode(typeHash, tph, spender, permit.nonce, permit.deadline, witness));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', permit2.DOMAIN_SEPARATOR(), structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    return abi.encodePacked(r, s, v);
  }

  function _permit() internal view returns (ISignatureTransfer.PermitTransferFrom memory) {
    return ISignatureTransfer.PermitTransferFrom({
      permitted: ISignatureTransfer.TokenPermissions({ token: address(token), amount: AMOUNT }),
      nonce: 1,
      deadline: type(uint256).max
    });
  }

  function _assertLanded(address tokenAddr) internal view {
    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.sender, user, 'lock owner = user');
    assertEq(lock.amount, AMOUNT, 'credited amount');
    assertEq(lock.recipient, recipient);
    assertEq(IERC20(tokenAddr).balanceOf(address(train)), AMOUNT, 'train holds funds');
    assertEq(IERC20(tokenAddr).balanceOf(address(router)), 0, 'router holds nothing');
    assertEq(IERC20(tokenAddr).allowance(address(router), address(train)), 0, 'no residual allowance');
  }

  // ─── ERC-2612 permit path ───────────────────────────────────

  function test_permit_HappyPath() public {
    bytes memory cd = _callData(_params(address(token)), _dst());
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(router), AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(train));

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);

    _assertLanded(address(token));
  }

  function test_permit_RevertsOnTamperedTrain() public {
    bytes memory cd = _callData(_params(address(token)), _dst());
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(router), AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(train)); // signed for `train`

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.InvalidIntentSignature.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(0xDEAD), cd, INTENT_NONCE, INTENT_DEADLINE, // ...forwarded elsewhere
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);
  }

  function test_permit_RevertsOnReplay() public {
    test_permit_HappyPath();
    bytes memory cd = _callData(_params(address(token)), _dst());
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(router), AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(train));

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector); // router consumed this intent on the happy path
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);
  }

  function test_permit_RevertsOnExpiredIntent() public {
    uint256 deadline = block.timestamp + 100;
    bytes memory cd = _callData(_params(address(token)), _dst());
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(router), AMOUNT, type(uint256).max);
    bytes32 digest =
      router.intentDigest(user, address(train), address(token), AMOUNT, keccak256(cd), INTENT_NONCE, deadline);
    (uint8 iv, bytes32 ir, bytes32 isig) = vm.sign(userPk, digest);
    bytes memory intentSig = abi.encodePacked(ir, isig, iv);

    vm.warp(deadline + 1);
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentExpired.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, deadline,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);
  }

  function test_permit_RevertsOnNativeToken() public {
    bytes memory cd = _callData(_params(address(0)), _dst());
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.NativeNotSupported.selector);
    router.forwardWithPermit(user, address(0), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: 0, r: 0, s: 0 }), '');
  }

  function test_permit_RevertsOnZeroUser() public {
    bytes memory cd = _callData(_params(address(token)), _dst());
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.InvalidUser.selector);
    router.forwardWithPermit(address(0), address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: 0, r: 0, s: 0 }), '');
  }

  // ─── EIP-3009 path ──────────────────────────────────────────

  function test_authorization_HappyPath() public {
    bytes memory cd = _callData(_params(address(token3009)), _dst());
    bytes32 nonce = router.hashIntent(user, address(train), address(token3009), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = _sign3009(address(router), AMOUNT, 0, type(uint256).max, nonce);

    vm.prank(relayer);
    router.forwardWithAuthorization(user, address(token3009), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: v, r: r, s: s }));

    _assertLanded(address(token3009));
  }

  function test_authorization_RevertsOnTamperedTrain() public {
    bytes memory cd = _callData(_params(address(token3009)), _dst());
    bytes32 nonce = router.hashIntent(user, address(train), address(token3009), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = _sign3009(address(router), AMOUNT, 0, type(uint256).max, nonce);

    vm.prank(relayer);
    vm.expectRevert(); // router recomputes a different nonce → token rejects sig
    router.forwardWithAuthorization(user, address(token3009), AMOUNT, address(0xDEAD), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: v, r: r, s: s }));
  }

  function test_authorization_RevertsOnReplay() public {
    test_authorization_HappyPath();
    bytes memory cd = _callData(_params(address(token3009)), _dst());
    bytes32 nonce = router.hashIntent(user, address(train), address(token3009), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = _sign3009(address(router), AMOUNT, 0, type(uint256).max, nonce);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector); // router blocks before the token's nonce check
    router.forwardWithAuthorization(user, address(token3009), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: v, r: r, s: s }));
  }

  // ─── Permit2 path ───────────────────────────────────────────

  function test_permit2_HappyPath() public {
    bytes memory cd = _callData(_params(address(token)), _dst());
    ISignatureTransfer.PermitTransferFrom memory permit = _permit();
    bytes32 witness = router.hashIntent(user, address(train), address(token), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    bytes memory sig = _signPermit2(permit, address(router), witness);

    vm.prank(relayer);
    router.forwardWithPermit2(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE, address(permit2), permit, sig);

    _assertLanded(address(token));
  }

  function test_permit2_RevertsOnTamperedTrain() public {
    bytes memory cd = _callData(_params(address(token)), _dst());
    ISignatureTransfer.PermitTransferFrom memory permit = _permit();
    bytes32 witness = router.hashIntent(user, address(train), address(token), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    bytes memory sig = _signPermit2(permit, address(router), witness);

    vm.prank(relayer);
    vm.expectRevert(); // router recomputes a different witness → Permit2 rejects sig
    router.forwardWithPermit2(user, address(token), AMOUNT, address(0xDEAD), cd, INTENT_NONCE, INTENT_DEADLINE, address(permit2), permit, sig);
  }

  function test_permit2_RevertsOnMismatch() public {
    bytes memory cd = _callData(_params(address(token)), _dst());
    ISignatureTransfer.PermitTransferFrom memory permit = _permit();
    permit.permitted.amount = AMOUNT - 1; // less than signed amount
    bytes32 witness = router.hashIntent(user, address(train), address(token), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    bytes memory sig = _signPermit2(permit, address(router), witness);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.Permit2Mismatch.selector);
    router.forwardWithPermit2(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE, address(permit2), permit, sig);
  }

  // ─── Conservation guards / native-zero / views / front-run / reentrancy ───

  function test_permit_RevertsOnInsufficientPulled_FoT() public {
    FeeOnTransferToken fot = new FeeOnTransferToken(100); // 1% fee
    fot.mint(user, 1000 ether);
    bytes memory cd = _callData(_params(address(fot)), _dst());
    uint256 nonce = IERC20Permit(address(fot)).nonces(user);
    bytes32 sh = keccak256(abi.encode(PERMIT_TYPEHASH, user, address(router), AMOUNT, nonce, type(uint256).max));
    bytes32 pd = keccak256(abi.encodePacked('\x19\x01', fot.DOMAIN_SEPARATOR(), sh));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, pd);
    bytes memory intentSig = _signIntent(address(fot), cd, address(train));

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.InsufficientPulled.selector);
    router.forwardWithPermit(user, address(fot), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);
  }

  function test_permit_RevertsOnResidualBalance_NoPullTrain() public {
    NoPullTrain badTrain = new NoPullTrain();
    bytes memory cd = _callData(_params(address(token)), _dst());
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(router), AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(badTrain)); // intent bound to bad train

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.ResidualBalance.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(badTrain), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);
  }

  function test_authorization_RevertsOnNativeToken() public {
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.NativeNotSupported.selector);
    router.forwardWithAuthorization(user, address(0), AMOUNT, address(train), '', INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: 0, r: 0, s: 0 }));
  }

  function test_authorization_RevertsOnZeroUser() public {
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.InvalidUser.selector);
    router.forwardWithAuthorization(address(0), address(token3009), AMOUNT, address(train), '', INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: 0, r: 0, s: 0 }));
  }

  function test_permit2_RevertsOnNativeToken() public {
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.NativeNotSupported.selector);
    router.forwardWithPermit2(user, address(0), AMOUNT, address(train), '', INTENT_NONCE, INTENT_DEADLINE, address(permit2), _permit(), '');
  }

  function test_permit2_RevertsOnZeroUser() public {
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.InvalidUser.selector);
    router.forwardWithPermit2(address(0), address(token), AMOUNT, address(train), '', INTENT_NONCE, INTENT_DEADLINE, address(permit2), _permit(), '');
  }

  function test_views_intentDigest_matchesDomainWrappedHashIntent() public view {
    bytes memory cd = _callData(_params(address(token)), _dst());
    bytes32 structHash = router.hashIntent(user, address(train), address(token), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    bytes32 expected = keccak256(abi.encodePacked('\x19\x01', router.DOMAIN_SEPARATOR(), structHash));
    assertEq(router.intentDigest(user, address(train), address(token), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE), expected);
  }

  function test_permit_FrontRunTolerated_AllowancePresent() public {
    bytes memory cd = _callData(_params(address(token)), _dst());
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(router), AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(train));

    // Front-run: apply the permit directly, consuming the nonce AND setting the allowance.
    token.permit(user, address(router), AMOUNT, type(uint256).max, v, r, s);

    // Router's own permit() now reverts (nonce used) but is caught; transferFrom still succeeds.
    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);

    _assertLanded(address(token));
  }

  function test_router_reentrancyDuringForward_blocked() public {
    ReentrantTrain rTrain = new ReentrantTrain();
    bytes memory cd = _callData(_params(address(token)), _dst());
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(router), AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(rTrain));

    bytes memory reentry = abi.encodeCall(
      TrainRouter.forwardWithPermit,
      (user, address(token), AMOUNT, address(rTrain), cd, INTENT_NONCE, INTENT_DEADLINE,
        TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig)
    );
    rTrain.arm(address(router), reentry);

    vm.prank(relayer);
    vm.expectRevert(); // ReentrancyGuardReentrantCall bubbled through the malicious train
    router.forwardWithPermit(user, address(token), AMOUNT, address(rTrain), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);
  }
}

// ─── Mocks ──────────────────────────────────────────────────

/// @dev Faithful EIP-3009 token (ReceiveWithAuthorization), pinned to `to == msg.sender`.
contract MockERC3009 is ERC20, EIP712 {
  mapping(address => mapping(bytes32 => bool)) public authState;
  bytes32 private constant RECEIVE_TYPEHASH =
    keccak256('ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');

  constructor() ERC20('Mock3009', 'M3009') EIP712('Mock3009', '1') {}

  function mint(address to, uint256 amt) external { _mint(to, amt); }
  function DOMAIN_SEPARATOR() external view returns (bytes32) { return _domainSeparatorV4(); }

  function receiveWithAuthorization(
    address from, address to, uint256 value,
    uint256 validAfter, uint256 validBefore, bytes32 nonce,
    uint8 v, bytes32 r, bytes32 s
  ) external {
    require(to == msg.sender, 'to != caller');
    require(block.timestamp > validAfter, 'not yet valid');
    require(block.timestamp < validBefore, 'expired');
    require(!authState[from][nonce], 'authorization used');
    bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
    require(ECDSA.recover(_hashTypedDataV4(structHash), v, r, s) == from, 'bad 3009 sig');
    authState[from][nonce] = true;
    _transfer(from, to, value);
  }
}

/// @dev Faithful-enough Permit2 SignatureTransfer mock (permitWitnessTransferFrom).
contract MockPermit2 is EIP712 {
  mapping(address => mapping(uint256 => bool)) public usedNonce;
  bytes32 private constant TOKEN_PERMISSIONS_TYPEHASH = keccak256('TokenPermissions(address token,uint256 amount)');
  string private constant STUB =
    'PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,';

  constructor() EIP712('Permit2', '1') {}

  function DOMAIN_SEPARATOR() external view returns (bytes32) { return _domainSeparatorV4(); }

  function permitWitnessTransferFrom(
    ISignatureTransfer.PermitTransferFrom calldata permit,
    ISignatureTransfer.SignatureTransferDetails calldata transferDetails,
    address owner,
    bytes32 witness,
    string calldata witnessTypeString,
    bytes calldata signature
  ) external {
    require(block.timestamp <= permit.deadline, 'permit expired');
    require(!usedNonce[owner][permit.nonce], 'nonce used');
    require(transferDetails.requestedAmount <= permit.permitted.amount, 'amount too high');

    bytes32 typeHash = keccak256(abi.encodePacked(STUB, witnessTypeString));
    bytes32 tph = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount));
    bytes32 structHash = keccak256(abi.encode(typeHash, tph, msg.sender, permit.nonce, permit.deadline, witness));
    require(ECDSA.recover(_hashTypedDataV4(structHash), signature) == owner, 'bad permit2 sig');

    usedNonce[owner][permit.nonce] = true;
    IERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
  }
}
