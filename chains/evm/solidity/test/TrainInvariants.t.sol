// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import '../src/TrainRouter.sol';
import '../src/ConstantPayoutCurve.sol';
import '../src/IPayoutCurve.sol';
import './mocks/TestToken.sol';
import { FeeOnTransferToken } from './mocks/Mocks.sol';
import '../src/interfaces/ITrain.sol';
import { IERC20Permit } from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol';

/// @notice Property/fuzz tests: ConstantPayoutCurve identity, userLockFor attribution + measured amount,
///         and the TrainRouter "binds everything / holds nothing" guarantees.
contract TrainInvariantsTest is Test {
  Train train;
  TrainRouter router;
  TestToken token;
  ConstantPayoutCurve curve;

  uint256 userPk = 0xA11CE;
  address user;
  address routerCaller = makeAddr('routerCaller');
  address payable recipient;

  bytes32 constant PERMIT_TYPEHASH =
    keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');
  uint256 constant SECP_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

  function setUp() public {
    train = new Train();
    router = new TrainRouter();
    token = new TestToken();
    curve = new ConstantPayoutCurve();
    user = vm.addr(userPk);
    recipient = payable(makeAddr('recipient'));
  }

  function _params(address tokenAddr, uint256 amount, bytes32 hl) internal view returns (ITrain.UserLockParams memory) {
    return ITrain.UserLockParams({
      hashlock: hl, amount: amount, rewardAmount: 0, timelockDelta: 3600, rewardTimelockDelta: 1800,
      quoteExpiry: uint48(block.timestamp + 1000), recipient: recipient, refundTo: user, token: tokenAddr,
      payoutCurve: address(0), payoutCurveData: '', rewardToken: 'ETH', rewardRecipient: 'rr', srcChain: 'SRC'
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

  function testFuzz_constantCurve_alwaysReturnsAmount(uint256 amount, uint48 t0, uint48 tNow, bytes calldata cfg)
    public view
  {
    assertEq(curve.computePayout(amount, t0, tNow, cfg), amount);
  }

  function testFuzz_userLockFor_attributesToUser(address who, uint256 amount) public {
    vm.assume(who != address(0));
    amount = bound(amount, 1, 1e30);
    bytes32 hl = keccak256(abi.encodePacked('h', who, amount));
    token.mint(routerCaller, amount);
    vm.prank(routerCaller);
    token.approve(address(train), amount);
    vm.prank(routerCaller);
    ITrain(address(train)).userLockFor(who, _params(address(token), amount, hl), _dst(), '', '');
    Train.UserLock memory lock = train.getUserLock(hl);
    assertEq(lock.sender, who);
    assertEq(lock.amount, amount);
    assertEq(token.balanceOf(address(train)), amount);
    assertEq(token.balanceOf(routerCaller), 0);
  }

  function test_userLockFor_feeOnTransfer_creditsDelta() public {
    FeeOnTransferToken ft = new FeeOnTransferToken(100);
    uint256 amount = 100 ether;
    ft.mint(routerCaller, amount);
    vm.prank(routerCaller);
    ft.approve(address(train), amount);
    bytes32 hl = keccak256('fee');
    vm.prank(routerCaller);
    ITrain(address(train)).userLockFor(user, _params(address(ft), amount, hl), _dst(), '', '');
    assertEq(train.getUserLock(hl).amount, 99 ether);
    assertEq(ft.balanceOf(address(train)), 99 ether);
  }

  function testFuzz_hashIntent_bindsTrain(address a, address b) public view {
    vm.assume(a != b);
    bytes32 ch = keccak256(_callData(_params(address(token), 1 ether, bytes32(uint256(1))), _dst()));
    assertTrue(
      router.hashIntent(user, a, address(token), 1 ether, ch) !=
        router.hashIntent(user, b, address(token), 1 ether, ch)
    );
  }

  function testFuzz_hashIntent_bindsAmount(uint256 a, uint256 b) public view {
    vm.assume(a != b);
    bytes32 ch = keccak256(_callData(_params(address(token), 1 ether, bytes32(uint256(1))), _dst()));
    assertTrue(
      router.hashIntent(user, address(train), address(token), a, ch) !=
        router.hashIntent(user, address(train), address(token), b, ch)
    );
  }

  function testFuzz_router_wrongIntentSigner_reverts(uint256 wrongPk) public {
    wrongPk = bound(wrongPk, 1, SECP_ORDER - 1);
    vm.assume(vm.addr(wrongPk) != user);
    uint256 amount = 10 ether;
    token.mint(user, amount);
    bytes memory cd = _callData(_params(address(token), amount, keccak256('w')), _dst());
    (uint8 v, bytes32 r, bytes32 s) =
      vm.sign(wrongPk, router.intentDigest(user, address(train), address(token), amount, keccak256(cd)));
    vm.expectRevert(TrainRouter.InvalidIntentSignature.selector);
    router.forwardWithPermit(user, address(token), amount, address(train), cd,
      TrainRouter.Permit2612({ value: amount, deadline: type(uint256).max, v: 0, r: 0, s: 0 }), abi.encodePacked(r, s, v));
  }

  function testFuzz_router_holdsNothing_afterPermitLock(uint256 amount) public {
    amount = bound(amount, 1, 1_000_000 ether);
    token.mint(user, amount);
    bytes memory cd = _callData(_params(address(token), amount, keccak256('c')), _dst());
    (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(address(router), amount, type(uint256).max);
    (uint8 iv, bytes32 ir, bytes32 is_) =
      vm.sign(userPk, router.intentDigest(user, address(train), address(token), amount, keccak256(cd)));
    router.forwardWithPermit(user, address(token), amount, address(train), cd,
      TrainRouter.Permit2612({ value: amount, deadline: type(uint256).max, v: pv, r: pr, s: ps }),
      abi.encodePacked(ir, is_, iv));
    assertEq(train.getUserLock(keccak256('c')).amount, amount);
    assertEq(token.balanceOf(address(router)), 0);
    assertEq(token.allowance(address(router), address(train)), 0);
  }

  function _signPermit(address spender, uint256 value, uint256 deadline)
    internal view returns (uint8 v, bytes32 r, bytes32 s)
  {
    uint256 nonce = IERC20Permit(address(token)).nonces(user);
    bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, user, spender, value, nonce, deadline));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', token.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(userPk, digest);
  }
}
