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

/// @notice Mainnet-fork tests validating the TrainRouter against the REAL Permit2 deployment and REAL
///         USDC (EIP-3009 + ERC-2612). This is the canonical check that the TrainRouter's EIP-712 type
///         strings (witness type string, intent struct) match production contracts.
/// @dev Runs only when executed against a mainnet fork (`forge test --fork-url <mainnet>` or an
///      anvil fork). Otherwise every test self-skips, so the normal suite is unaffected.
contract TrainRouterForkTest is Test {
  address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
  IERC20 constant USDC = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

  bytes32 constant PERMIT_TYPEHASH =
    keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');
  bytes32 constant RECEIVE_TYPEHASH =
    keccak256('ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');
  bytes32 constant TOKEN_PERMISSIONS_TYPEHASH = keccak256('TokenPermissions(address token,uint256 amount)');
  string constant PERMIT2_STUB =
    'PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,';

  Train train;
  TrainRouter router;
  TestToken testToken;

  uint256 userPk = 0xBEEFCAFE;
  address user;
  address payable recipient;
  bytes32 hashlock;
  uint256 constant SECRET = 11;

  function setUp() public {
    if (block.chainid != 1) return; // only meaningful on a mainnet fork
    // If ROUTER_ADDR/TRAIN_ADDR are set, exercise the already-deployed bytecode (e.g. on an anvil
    // fork); otherwise deploy fresh instances.
    address routerAddr = vm.envOr('ROUTER_ADDR', address(0));
    if (routerAddr != address(0)) {
      router = TrainRouter(routerAddr);
      train = Train(vm.envAddress('TRAIN_ADDR'));
    } else {
      train = new Train();
      router = new TrainRouter();
    }
    testToken = new TestToken();
    user = vm.addr(userPk);
    recipient = payable(makeAddr('recipient'));
    hashlock = sha256(abi.encodePacked(SECRET));
  }

  function _forked() internal returns (bool ok) {
    ok = block.chainid == 1;
    if (!ok) vm.skip(true);
  }

  function _params(address token, uint256 amount) internal view returns (ITrain.UserLockParams memory) {
    return ITrain.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: 3600,
      rewardTimelockDelta: 1800, quoteExpiry: uint48(block.timestamp + 1000),
      recipient: recipient, refundTo: user, token: token,
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

  function _signIntent(address token, uint256 amount, bytes memory cd, address t)
    internal view returns (bytes memory)
  {
    (uint8 v, bytes32 r, bytes32 s) =
      vm.sign(userPk, router.intentDigest(user, t, token, amount, keccak256(cd)));
    return abi.encodePacked(r, s, v);
  }

  // ── Real Permit2: validates WITNESS_TYPE_STRING against the production contract ──
  function test_fork_permit2_realPermit2() public {
    if (!_forked()) return;
    uint256 amount = 100e18;
    testToken.mint(user, amount);
    vm.prank(user);
    testToken.approve(PERMIT2, type(uint256).max);

    ITrain.UserLockParams memory p = _params(address(testToken), amount);
    ITrain.DestinationInfo memory d = _dst();
    bytes memory cd = _callData(p, d);

    ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
      permitted: ISignatureTransfer.TokenPermissions({ token: address(testToken), amount: amount }),
      nonce: 0,
      deadline: block.timestamp + 1000
    });
    bytes32 witness = router.hashIntent(user, address(train), address(testToken), amount, keccak256(cd));

    // Sign exactly as the real Permit2 PermitHash computes it (spender = the TrainRouter).
    bytes32 typeHash = keccak256(abi.encodePacked(PERMIT2_STUB, router.WITNESS_TYPE_STRING()));
    bytes32 tph = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, address(testToken), amount));
    bytes32 structHash = keccak256(abi.encode(typeHash, tph, address(router), permit.nonce, permit.deadline, witness));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', _permit2Domain(), structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);

    router.forwardWithPermit2(user, address(testToken), amount, address(train), cd, PERMIT2, permit, abi.encodePacked(r, s, v));

    assertEq(train.getUserLock(hashlock).sender, user);
    assertEq(testToken.balanceOf(address(train)), amount);
    assertEq(testToken.balanceOf(address(router)), 0);
  }

  // ── Real USDC: EIP-3009 receiveWithAuthorization ──
  function test_fork_authorization_realUSDC() public {
    if (!_forked()) return;
    uint256 amount = 100e6; // USDC has 6 decimals
    deal(address(USDC), user, amount);
    assertEq(USDC.balanceOf(user), amount, 'deal USDC failed');

    ITrain.UserLockParams memory p = _params(address(USDC), amount);
    ITrain.DestinationInfo memory d = _dst();
    bytes memory cd = _callData(p, d);
    bytes32 nonce = router.hashIntent(user, address(train), address(USDC), amount, keccak256(cd));

    bytes32 structHash =
      keccak256(abi.encode(RECEIVE_TYPEHASH, user, address(router), amount, uint256(0), type(uint256).max, nonce));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', _usdcDomain(), structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);

    router.forwardWithAuthorization(user, address(USDC), amount, address(train), cd,
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: v, r: r, s: s }));

    assertEq(train.getUserLock(hashlock).sender, user);
    assertEq(USDC.balanceOf(address(train)), amount);
    assertEq(USDC.balanceOf(address(router)), 0);
  }

  // ── Real USDC: ERC-2612 permit + intent signature ──
  function test_fork_permit_realUSDC() public {
    if (!_forked()) return;
    uint256 amount = 100e6;
    deal(address(USDC), user, amount);
    assertEq(USDC.balanceOf(user), amount, 'deal USDC failed');

    ITrain.UserLockParams memory p = _params(address(USDC), amount);
    ITrain.DestinationInfo memory d = _dst();
    bytes memory cd = _callData(p, d);

    uint256 nonce = IERC20Permit(address(USDC)).nonces(user);
    bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, user, address(router), amount, nonce, type(uint256).max));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', _usdcDomain(), structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    bytes memory intentSig = _signIntent(address(USDC), amount, cd, address(train));

    router.forwardWithPermit(user, address(USDC), amount, address(train), cd,
      TrainRouter.Permit2612({ value: amount, deadline: type(uint256).max, v: v, r: r, s: s }), intentSig);

    assertEq(train.getUserLock(hashlock).sender, user);
    assertEq(USDC.balanceOf(address(train)), amount);
    assertEq(USDC.balanceOf(address(router)), 0);
  }

  function _permit2Domain() internal view returns (bytes32) {
    (bool ok, bytes memory data) = PERMIT2.staticcall(abi.encodeWithSignature('DOMAIN_SEPARATOR()'));
    require(ok, 'permit2 domain');
    return abi.decode(data, (bytes32));
  }

  function _usdcDomain() internal view returns (bytes32) {
    (bool ok, bytes memory data) = address(USDC).staticcall(abi.encodeWithSignature('DOMAIN_SEPARATOR()'));
    require(ok, 'usdc domain');
    return abi.decode(data, (bytes32));
  }
}
