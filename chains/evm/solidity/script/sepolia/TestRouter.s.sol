// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';
import { TrainRouter } from '../../src/TrainRouter.sol';
import { ITrain } from '../../src/interfaces/ITrain.sol';
import { ISignatureTransfer } from '../../src/interfaces/ISignatureTransfer.sol';

/// @notice Gasless TrainRouter intake on Sepolia against real USDC + canonical Permit2. The USER signs
///         (off-chain, via vm.sign); the RELAYER broadcasts and pays gas. Each path lands funds in
///         Train under `user`, then redeems back to the user (recipient = user).
/// @dev Requires Setup first (user must approve Permit2 for the permit2 path).
///   forge script script/sepolia/TestRouter.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract TestRouter is SepoliaConfig {
  function run() external {
    _load();
    _permitPath();
    _permit2Path();
    _authPath();
  }

  // ERC-2612 permit + separate EIP-712 intent signature
  function _permitPath() internal {
    uint256 secret = _secret('router-permit');
    bytes32 hl = _hashlock(secret);
    ITrain.UserLockParams memory p = _userParamsI(hl, AMOUNT, 3600);
    ITrain.DestinationInfo memory d = _dstI();
    bytes memory cd = _callData(p, d);
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(AMOUNT, cd);

    vm.startBroadcast(relayerPk);
    router.forwardWithPermit(
      user, address(USDC), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }),
      intentSig
    );
    train.redeemUser(hl, secret);
    vm.stopBroadcast();
    console.log('[permit]  TrainRouter -> Train -> redeem OK');
    _logLock(hl);
  }

  // Permit2 permitWitnessTransferFrom (witness = intent hash)
  function _permit2Path() internal {
    uint256 secret = _secret('router-permit2');
    bytes32 hl = _hashlock(secret);
    ITrain.UserLockParams memory p = _userParamsI(hl, AMOUNT, 3600);
    ITrain.DestinationInfo memory d = _dstI();
    bytes memory cd = _callData(p, d);
    ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
      permitted: ISignatureTransfer.TokenPermissions({ token: address(USDC), amount: AMOUNT }),
      nonce: uint256(keccak256(abi.encodePacked(vm.unixTime(), 'p2-nonce'))),
      deadline: type(uint256).max
    });
    bytes32 witness = router.hashIntent(user, address(train), address(USDC), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    bytes memory sig = _signPermit2(permit, witness);

    vm.startBroadcast(relayerPk);
    router.forwardWithPermit2(user, address(USDC), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE, PERMIT2, permit, sig);
    train.redeemUser(hl, secret);
    vm.stopBroadcast();
    console.log('[permit2] TrainRouter -> Train -> redeem OK');
    _logLock(hl);
  }

  // EIP-3009 receiveWithAuthorization (nonce = intent hash)
  function _authPath() internal {
    uint256 secret = _secret('router-3009');
    bytes32 hl = _hashlock(secret);
    ITrain.UserLockParams memory p = _userParamsI(hl, AMOUNT, 3600);
    ITrain.DestinationInfo memory d = _dstI();
    bytes memory cd = _callData(p, d);
    bytes32 nonce = router.hashIntent(user, address(train), address(USDC), AMOUNT, keccak256(cd), INTENT_NONCE, INTENT_DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = _sign3009(AMOUNT, nonce);

    vm.startBroadcast(relayerPk);
    router.forwardWithAuthorization(
      user, address(USDC), AMOUNT, address(train), cd, INTENT_NONCE, INTENT_DEADLINE,
      TrainRouter.Authorization3009({ validAfter: 0, validBefore: type(uint256).max, v: v, r: r, s: s })
    );
    train.redeemUser(hl, secret);
    vm.stopBroadcast();
    console.log('[3009]    TrainRouter -> Train -> redeem OK');
    _logLock(hl);
  }
}
