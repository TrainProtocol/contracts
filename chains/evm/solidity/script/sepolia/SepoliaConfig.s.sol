// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { Train } from '../../src/Train.sol';
import { TrainRouter } from '../../src/TrainRouter.sol';
import { ITrain } from '../../src/interfaces/ITrain.sol';
import { ISignatureTransfer } from '../../src/interfaces/ISignatureTransfer.sol';

interface IUSDC {
  function balanceOf(address) external view returns (uint256);
  function approve(address, uint256) external returns (bool);
  function allowance(address, address) external view returns (uint256);
  function nonces(address) external view returns (uint256);
  function DOMAIN_SEPARATOR() external view returns (bytes32);
  function decimals() external view returns (uint8);
}

interface IHasDomain {
  function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice Shared config + EIP-712 signing helpers for the Sepolia on-chain test scripts.
/// @dev Env vars (set in your shell; never commit keys):
///   USER_PK    — the user/signer key. Holds USDC, signs gasless intents. (uint256, 0x-hex ok)
///   RELAYER_PK — the broadcaster key that submits TrainRouter txs and pays gas. Defaults to USER_PK.
///   TRAIN      — deployed Train address.
///   ROUTER     — deployed TrainRouter address.
/// All ERC20 flows use Sepolia USDC (6 decimals); Permit2 is the canonical deployment.
abstract contract SepoliaConfig is Script {
  // ── Sepolia well-known addresses ──
  IUSDC internal constant USDC = IUSDC(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238);
  address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

  // ── EIP-712 typehashes (token side) ──
  bytes32 internal constant PERMIT_TYPEHASH =
    keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');
  bytes32 internal constant RECEIVE_TYPEHASH =
    keccak256('ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');
  bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256('TokenPermissions(address token,uint256 amount)');
  string internal constant PERMIT2_STUB =
    'PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,';

  // ── native ETH sentinel (Train treats address(0) as native) ──
  address internal constant NATIVE_ETH = address(0);

  // ── Test sizing (tiny, to conserve faucet USDC; funds cycle back on redeem) ──
  uint256 internal constant AMOUNT = 10_000; // 0.01 USDC
  uint256 internal constant REWARD = 2_000; //  0.002 USDC
  // native sizing (wei) — tiny so a little Sepolia ETH covers many runs; funds cycle back on redeem
  uint256 internal constant NATIVE_AMOUNT = 0.0002 ether;
  uint256 internal constant NATIVE_REWARD = 0.0001 ether;

  // ── intent replay params (nonce differentiates deliberate re-runs; deadline bounds intent lifetime) ──
  uint256 internal constant INTENT_NONCE = 1;
  uint256 internal constant INTENT_DEADLINE = type(uint256).max;

  // ── loaded config ──
  uint256 internal userPk;
  address internal user;
  uint256 internal relayerPk;
  address internal relayer;
  Train internal train;
  TrainRouter internal router;

  function _load() internal {
    userPk = vm.envUint('USER_PK');
    user = vm.addr(userPk);
    relayerPk = vm.envOr('RELAYER_PK', userPk);
    relayer = vm.addr(relayerPk);
    train = Train(vm.envAddress('TRAIN'));
    router = TrainRouter(vm.envAddress('ROUTER'));
    console.log('user    :', user);
    console.log('relayer :', relayer);
    console.log('train   :', address(train));
    console.log('router  :', address(router));
    console.log('USDC bal (user, 6dp):', USDC.balanceOf(user));
  }

  // ── unique secret per run so hashlocks never collide (SwapAlreadyExists) ──
  function _secret(string memory tag) internal returns (uint256) {
    return uint256(keccak256(abi.encodePacked(vm.unixTime(), tag, user)));
  }

  function _hashlock(uint256 secret) internal pure returns (bytes32) {
    return sha256(abi.encodePacked(secret));
  }

  // ── param builders (ITrain.* for TrainRouter calls) ──
  function _userParamsI(bytes32 hashlock, uint256 amount, uint48 timelockDelta)
    internal view returns (ITrain.UserLockParams memory)
  {
    return ITrain.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: timelockDelta,
      rewardTimelockDelta: timelockDelta / 2, quoteExpiry: uint48(block.timestamp + 600),
      recipient: user, refundTo: user, token: address(USDC),
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'USDC', rewardRecipient: '', srcChain: 'SEPOLIA'
    });
  }

  function _dstI() internal pure returns (ITrain.DestinationInfo memory) {
    return ITrain.DestinationInfo({ dstChain: 'SEPOLIA', dstAddress: 'self', dstAmount: AMOUNT, dstToken: 'USDC' });
  }

  // ── param builders (Train.* for direct Train calls) ──
  function _userParamsT(bytes32 hashlock, uint256 amount, uint48 timelockDelta, address recipient, address refundTo)
    internal view returns (Train.UserLockParams memory)
  {
    return Train.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: timelockDelta,
      rewardTimelockDelta: timelockDelta / 2, quoteExpiry: uint48(block.timestamp + 600),
      recipient: recipient, refundTo: refundTo, token: address(USDC),
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'USDC', rewardRecipient: '', srcChain: 'SEPOLIA'
    });
  }

  function _solverParamsT(bytes32 hashlock, uint48 timelockDelta)
    internal view returns (Train.SolverLockParams memory)
  {
    return Train.SolverLockParams({
      hashlock: hashlock, amount: AMOUNT, reward: REWARD, timelockDelta: timelockDelta,
      rewardTimelockDelta: timelockDelta / 2, recipient: user, rewardRecipient: user,
      refundTo: user, token: address(USDC), rewardToken: address(USDC),
      payoutCurve: address(0), payoutCurveData: '', srcChain: 'SEPOLIA'
    });
  }

  function _dstT() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'SEPOLIA', dstAddress: 'self', dstAmount: AMOUNT, dstToken: 'USDC' });
  }

  // ── native-ETH param builders (token = address(0); Train.userLock/solverLock are payable) ──
  function _userParamsTNative(bytes32 hashlock, uint256 amount, uint48 timelockDelta, address recipient, address refundTo)
    internal view returns (Train.UserLockParams memory)
  {
    return Train.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: timelockDelta,
      rewardTimelockDelta: timelockDelta / 2, quoteExpiry: uint48(block.timestamp + 600),
      recipient: recipient, refundTo: refundTo, token: NATIVE_ETH,
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'ETH', rewardRecipient: '', srcChain: 'SEPOLIA'
    });
  }

  function _solverParamsTNative(bytes32 hashlock, uint48 timelockDelta)
    internal view returns (Train.SolverLockParams memory)
  {
    return Train.SolverLockParams({
      hashlock: hashlock, amount: NATIVE_AMOUNT, reward: NATIVE_REWARD, timelockDelta: timelockDelta,
      rewardTimelockDelta: timelockDelta / 2, recipient: user, rewardRecipient: user,
      refundTo: user, token: NATIVE_ETH, rewardToken: NATIVE_ETH,
      payoutCurve: address(0), payoutCurveData: '', srcChain: 'SEPOLIA'
    });
  }

  function _dstTNative() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'SEPOLIA', dstAddress: 'self', dstAmount: NATIVE_AMOUNT, dstToken: 'ETH' });
  }

  // native-balance logger (ETH cycles back on redeem; small net loss = gas only)
  function _logNative(bytes32 hashlock) internal view {
    Train.UserLock memory l = train.getUserLock(hashlock);
    console.log('  lock.sender :', l.sender);
    console.log('  lock.amount (wei):', l.amount);
    console.log('  lock.status :', uint256(l.status)); // 1=Pending 2=Refunded 3=Redeemed
  }

  // ── the user-signed call the router forwards to Train (a normal encoded userLockFor) ──
  function _callData(ITrain.UserLockParams memory p, ITrain.DestinationInfo memory d)
    internal view returns (bytes memory)
  {
    return abi.encodeCall(ITrain.userLockFor, (user, p, d, bytes(''), bytes('')));
  }

  // ── signing helpers (sign as `user`; verified equivalent in RouterFork.t.sol) ──
  function _signIntent(uint256 amount, bytes memory callData) internal view returns (bytes memory) {
    bytes32 digest =
      router.intentDigest(user, address(train), address(USDC), amount, keccak256(callData), INTENT_NONCE, INTENT_DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    return abi.encodePacked(r, s, v);
  }

  function _signPermit(uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
    uint256 nonce = USDC.nonces(user);
    bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, user, address(router), value, nonce, deadline));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', USDC.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(userPk, digest);
  }

  function _sign3009(uint256 value, bytes32 nonce) internal view returns (uint8 v, bytes32 r, bytes32 s) {
    bytes32 structHash =
      keccak256(abi.encode(RECEIVE_TYPEHASH, user, address(router), value, uint256(0), type(uint256).max, nonce));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', USDC.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(userPk, digest);
  }

  function _signPermit2(ISignatureTransfer.PermitTransferFrom memory permit, bytes32 witness)
    internal view returns (bytes memory)
  {
    bytes32 typeHash = keccak256(abi.encodePacked(PERMIT2_STUB, router.WITNESS_TYPE_STRING()));
    bytes32 tph = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount));
    bytes32 structHash = keccak256(abi.encode(typeHash, tph, address(router), permit.nonce, permit.deadline, witness));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', IHasDomain(PERMIT2).DOMAIN_SEPARATOR(), structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    return abi.encodePacked(r, s, v);
  }

  function _logLock(bytes32 hashlock) internal view {
    Train.UserLock memory l = train.getUserLock(hashlock);
    console.log('  lock.sender :', l.sender);
    console.log('  lock.amount :', l.amount);
    console.log('  lock.status :', uint256(l.status)); // 1=Pending 2=Refunded 3=Redeemed
  }
}
