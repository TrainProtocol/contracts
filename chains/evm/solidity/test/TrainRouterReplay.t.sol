// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import '../src/TrainRouter.sol';
import './mocks/TestToken.sol';
import '../src/interfaces/ITrain.sol';
import '../src/interfaces/ISignatureTransfer.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { IERC20Permit } from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol';
// Reuse the faithful EIP-3009 / Permit2 mocks defined alongside the main router tests.
import { MockERC3009, MockPermit2 } from './TrainRouter.t.sol';

/// @notice A minimal NON-idempotent forwarding target. Unlike Train.userLockFor it has NO per-call
///         uniqueness guard: every call pulls exactly `amount` from the router (via the approval the
///         router granted) and bumps a counter. It satisfies the router's conservation check, so it is
///         a valid `train` target with no replay protection of its own — the "generic target" the
///         router's target-agnostic docs promise to support.
contract ReplayableSink {
  uint256 public calls;
  uint256 public totalPulled;

  function deposit(address token, uint256 amount) external {
    IERC20(token).transferFrom(msg.sender, address(this), amount); // pulls from the router
    calls += 1;
    totalPulled += amount;
  }
}

/// @notice Replay study for the intent-guarded TrainRouter. Confirms the router now enforces single-use
///         intents (nonce + deadline + consumedIntent) uniformly across all three gasless paths, so a
///         signed intent executes at most once even against a fully replayable target; that a deliberate
///         repeat requires a fresh nonce; that an expired intent is rejected; and that Train's permanent
///         hashlock reservation remains as defense-in-depth behind the router guard.
contract TrainRouterReplayTest is Test {
  Train train;
  TrainRouter router;
  TestToken token;
  MockERC3009 token3009;
  MockPermit2 permit2;

  uint256 userPk = 0xA11CE;
  address user;
  address payable recipient;
  address relayer = address(0xBEEF);
  address stranger = address(0x1234); // NOT the original relayer — the router has no access control

  uint256 constant SECRET = 7;
  bytes32 hashlock;
  uint256 constant AMOUNT = 100 ether;

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

  function _trainCallData(ITrain.UserLockParams memory p) internal view returns (bytes memory) {
    return abi.encodeCall(ITrain.userLockFor, (user, p, _dst(), bytes(''), bytes('')));
  }

  function _sinkCallData(address tokenAddr) internal pure returns (bytes memory) {
    return abi.encodeCall(ReplayableSink.deposit, (tokenAddr, AMOUNT));
  }

  function _signIntent(address tokenAddr, bytes memory callData, address trainAddr, uint256 nonce, uint256 deadline)
    internal view returns (bytes memory)
  {
    bytes32 digest = router.intentDigest(user, trainAddr, tokenAddr, AMOUNT, keccak256(callData), nonce, deadline);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    return abi.encodePacked(r, s, v);
  }

  function _signPermit(uint256 value, uint256 deadline)
    internal view returns (uint8 v, bytes32 r, bytes32 s)
  {
    uint256 nonce = IERC20Permit(address(token)).nonces(user);
    bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, user, address(router), value, nonce, deadline));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', token.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(userPk, digest);
  }

  function _permit2612(uint256 value, uint8 v, bytes32 r, bytes32 s)
    internal pure returns (TrainRouter.Permit2612 memory)
  {
    return TrainRouter.Permit2612({ value: value, deadline: type(uint256).max, v: v, r: r, s: s });
  }

  function _sign3009(uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
    internal view returns (uint8 v, bytes32 r, bytes32 s)
  {
    bytes32 structHash =
      keccak256(abi.encode(RECEIVE_TYPEHASH, user, address(router), value, validAfter, validBefore, nonce));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', token3009.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(userPk, digest);
  }

  function _signPermit2(ISignatureTransfer.PermitTransferFrom memory permit, bytes32 witness)
    internal view returns (bytes memory)
  {
    bytes32 typeHash = keccak256(abi.encodePacked(PERMIT2_STUB, router.WITNESS_TYPE_STRING()));
    bytes32 tph = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount));
    bytes32 structHash = keccak256(abi.encode(typeHash, tph, address(router), permit.nonce, permit.deadline, witness));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', permit2.DOMAIN_SEPARATOR(), structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    return abi.encodePacked(r, s, v);
  }

  function _permit(address tokenAddr) internal pure returns (ISignatureTransfer.PermitTransferFrom memory) {
    return ISignatureTransfer.PermitTransferFrom({
      permitted: ISignatureTransfer.TokenPermissions({ token: tokenAddr, amount: AMOUNT }),
      nonce: 1,
      deadline: type(uint256).max
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Single-use is enforced by the router across all three paths — replay of a
  //  signed intent is rejected with IntentAlreadyConsumed before any pull.
  // ══════════════════════════════════════════════════════════════════════════

  /// @dev Infinite approval no longer enables replay: the 2nd forward of the same intent reverts at the
  ///      router, and a different submitter cannot resubmit it either.
  function test_CANNOT_replayIntent_infiniteApproval() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(sink), INTENT_NONCE, INTENT_DEADLINE);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);

    uint256 userStart = token.balanceOf(user);

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);

    vm.prank(stranger);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);

    assertEq(sink.calls(), 1, 'intent executed exactly once');
    assertEq(token.balanceOf(user), userStart - AMOUNT, 'user charged exactly once');
    assertEq(token.balanceOf(address(sink)), AMOUNT);
  }

  /// @dev Residual allowance (value = 2x amount) no longer enables a second execution — the intent guard
  ///      fires before the allowance is even touched.
  function test_CANNOT_replayIntent_residualAllowance() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(2 * AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(sink), INTENT_NONCE, INTENT_DEADLINE);
    TrainRouter.Permit2612 memory pd = _permit2612(2 * AMOUNT, v, r, s);

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);
    assertEq(sink.calls(), 1);
  }

  /// @dev consumedIntent is permanent: re-granting allowance later does NOT revive a spent intent.
  function test_CANNOT_replayIntent_afterAllowanceReGranted() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(sink), INTENT_NONCE, INTENT_DEADLINE);
    TrainRouter.Permit2612 memory pd = _permit2612(AMOUNT, v, r, s);

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);
    assertEq(sink.calls(), 1);

    vm.prank(user);
    token.approve(address(router), AMOUNT);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);
    assertEq(sink.calls(), 1);
  }

  /// @dev With the exact-amount permit and no standing allowance the replay is still blocked — now by the
  ///      router's intent guard (not the incidental zero-allowance) and before the pull.
  function test_CANNOT_replay_exactPermit_noStandingAllowance() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(sink), INTENT_NONCE, INTENT_DEADLINE);
    TrainRouter.Permit2612 memory pd = _permit2612(AMOUNT, v, r, s);

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);
    assertEq(sink.calls(), 1);
  }

  /// @dev EIP-3009 path: replay blocked at the router before the token's own nonce check, proven against
  ///      the replayable sink.
  function test_CANNOT_replay_eip3009_path() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token3009));
    bytes32 nonce = router.hashIntent(user, address(sink), address(token3009), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = _sign3009(AMOUNT, 0, type(uint256).max, nonce);
    TrainRouter.Authorization3009 memory auth =
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: v, r: r, s: s });

    vm.prank(relayer);
    router.forwardWithAuthorization(user, address(token3009), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, auth);
    assertEq(sink.calls(), 1);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector);
    router.forwardWithAuthorization(user, address(token3009), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, auth);
    assertEq(sink.calls(), 1);
  }

  /// @dev Permit2 path: replay blocked at the router before Permit2's own nonce check.
  function test_CANNOT_replay_permit2_path() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token));
    ISignatureTransfer.PermitTransferFrom memory permit = _permit(address(token));
    bytes32 witness = router.hashIntent(user, address(sink), address(token), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    bytes memory sig = _signPermit2(permit, witness);

    vm.prank(relayer);
    router.forwardWithPermit2(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, address(permit2), permit, sig);
    assertEq(sink.calls(), 1);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector);
    router.forwardWithPermit2(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, INTENT_DEADLINE, address(permit2), permit, sig);
    assertEq(sink.calls(), 1);
  }

  /// @dev Real Train target: replaying the same intent is blocked by the router before it reaches Train.
  function test_CANNOT_replay_train_pending() public {
    bytes memory cd = _trainCallData(_params(address(token)));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(train), INTENT_NONCE, INTENT_DEADLINE);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentAlreadyConsumed.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Deliberate repeat requires a fresh nonce; expiry bounds an unused intent.
  // ══════════════════════════════════════════════════════════════════════════

  /// @dev Two DISTINCT nonces over the identical call are both allowed — the nonce is a user-controlled
  ///      replay differentiator, so a deliberate re-run is possible by design.
  function test_CAN_reRun_sameCall_withDifferentNonce() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);

    bytes memory sig1 = _signIntent(address(token), cd, address(sink), 1, INTENT_DEADLINE);
    bytes memory sig2 = _signIntent(address(token), cd, address(sink), 2, INTENT_DEADLINE);

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, 1, INTENT_DEADLINE, pd, sig1);
    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, 2, INTENT_DEADLINE, pd, sig2);

    assertEq(sink.calls(), 2, 'distinct nonces authorize a deliberate repeat');
    assertEq(token.balanceOf(address(sink)), 2 * AMOUNT);
  }

  /// @dev An intent past its deadline is rejected before any pull.
  function test_CANNOT_forward_afterIntentDeadline() public {
    ReplayableSink sink = new ReplayableSink();
    bytes memory cd = _sinkCallData(address(token));
    uint256 deadline = block.timestamp + 100;
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);
    bytes memory intentSig = _signIntent(address(token), cd, address(sink), INTENT_NONCE, deadline);

    vm.warp(deadline + 1);
    vm.prank(relayer);
    vm.expectRevert(TrainRouter.IntentExpired.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(sink), cd, INTENT_NONCE, deadline, pd, intentSig);
    assertEq(sink.calls(), 0);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Defense-in-depth: with a FRESH nonce (passing the router guard), Train's own
  //  guards still block a duplicate/expired lock behind the router.
  // ══════════════════════════════════════════════════════════════════════════

  /// @dev After redeem, a fresh-nonce intent passes the router guard and reaches Train, where the
  ///      permanent hashlock reservation blocks the duplicate lock.
  function test_defenseInDepth_train_afterRedeem_freshNonce() public {
    bytes memory cd = _trainCallData(_params(address(token)));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);

    bytes memory sig1 = _signIntent(address(token), cd, address(train), 1, INTENT_DEADLINE);
    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, 1, INTENT_DEADLINE, pd, sig1);

    train.redeemUser(hashlock, SECRET);
    assertEq(uint8(train.getUserLock(hashlock).status), uint8(Train.LockStatus.Redeemed));

    bytes memory sig2 = _signIntent(address(token), cd, address(train), 2, INTENT_DEADLINE);
    vm.prank(relayer);
    vm.expectRevert(Train.SwapAlreadyExists.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, 2, INTENT_DEADLINE, pd, sig2);
  }

  /// @dev Same permanence after a refund (recipient refunds pre-timelock, quote still valid).
  function test_defenseInDepth_train_afterRefund_freshNonce() public {
    bytes memory cd = _trainCallData(_params(address(token)));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);

    bytes memory sig1 = _signIntent(address(token), cd, address(train), 1, INTENT_DEADLINE);
    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, 1, INTENT_DEADLINE, pd, sig1);

    vm.prank(recipient);
    train.refundUser(hashlock);
    assertEq(uint8(train.getUserLock(hashlock).status), uint8(Train.LockStatus.Refunded));

    bytes memory sig2 = _signIntent(address(token), cd, address(train), 2, INTENT_DEADLINE);
    vm.prank(relayer);
    vm.expectRevert(Train.SwapAlreadyExists.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, 2, INTENT_DEADLINE, pd, sig2);
  }

  /// @dev With a fresh nonce after the lock's quote lapses, Train's QuoteExpired guard is reached
  ///      (checked before its uniqueness guard) — bounding a re-run on any real timeline.
  function test_defenseInDepth_train_afterQuoteExpiry_freshNonce() public {
    bytes memory cd = _trainCallData(_params(address(token)));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);

    bytes memory sig1 = _signIntent(address(token), cd, address(train), 1, INTENT_DEADLINE);
    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, 1, INTENT_DEADLINE, pd, sig1);

    vm.warp(block.timestamp + 1001); // past the lock's quoteExpiry
    bytes memory sig2 = _signIntent(address(token), cd, address(train), 2, INTENT_DEADLINE);
    vm.prank(relayer);
    vm.expectRevert(Train.QuoteExpired.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, 2, INTENT_DEADLINE, pd, sig2);
  }

  /// @dev You cannot dodge the intent binding by mutating the call: editing callData changes the
  ///      committed hash, so the original signature no longer validates.
  function test_CANNOT_dodgeIntent_byMutatingCallData() public {
    bytes memory cd = _trainCallData(_params(address(token)));
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(type(uint256).max, type(uint256).max);
    bytes memory intentSig = _signIntent(address(token), cd, address(train), INTENT_NONCE, INTENT_DEADLINE);
    TrainRouter.Permit2612 memory pd = _permit2612(type(uint256).max, v, r, s);

    vm.prank(relayer);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);

    ITrain.UserLockParams memory p2 = _params(address(token));
    p2.hashlock = keccak256('a different swap');
    bytes memory cd2 = _trainCallData(p2);

    vm.prank(relayer);
    vm.expectRevert(TrainRouter.InvalidIntentSignature.selector);
    router.forwardWithPermit(user, address(token), AMOUNT, address(train), cd2, INTENT_NONCE, INTENT_DEADLINE, pd, intentSig);
  }
}
