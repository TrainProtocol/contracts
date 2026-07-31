// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { Train } from '../src/Train.sol';
import { TrainRouter } from '../src/TrainRouter.sol';
import { ConstantPayoutCurve } from '../src/ConstantPayoutCurve.sol';

/// @dev Minimal CreateX surface used here. Full contract: https://github.com/pcaversaccio/createx
interface ICreateX {
  function deployCreate2(bytes32 salt, bytes memory initCode) external payable returns (address newContract);
}

/// @title Deterministic CREATE2 deploy of ConstantPayoutCurve + Train + TrainRouter
/// @notice Same address on every chain: deploys go through the CreateX factory
///         (0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed), so the address depends only on
///         (factory, guarded salt, initcode) — not on the deployer key or its nonce.
/// @dev CreateX salt guarding: our salt is a keccak hash, so its first 20 bytes match neither
///      `msg.sender` nor `address(0)` — CreateX classifies it as a "random" salt and applies
///      `guardedSalt = keccak256(abi.encode(salt))` with NO sender or chain-id mixed in. That
///      keeps the deploy permissionless and the address identical on every chain, same trust
///      model as the previous Arachnid-factory flow.
/// @dev Idempotent: contracts already present at their predicted address are skipped,
///      so re-runs and partial-failure recovery are safe. Permissionless by design:
///      anyone re-running this script lands the exact same bytecode at the same address.
/// @dev The address changes if the source, solc version, or optimizer settings change
///      (initcode embeds the metadata hash). Bump the salt deliberately for a new release.
/// @dev Usage:
///   export PRIVATE_KEY=0x...             # deployer (any funded key gives the same addresses)
///   forge script script/DeployDeterministic.s.sol --rpc-url <alias> --broadcast
///   forge script script/DeployDeterministic.s.sol --sig 'predict()'   # offline address preview
contract DeployDeterministicScript is Script {
  // Bump the string to rotate all addresses for a new release,
  // or override per-run with CREATE2_SALT (bytes32 hex).
  bytes32 internal constant DEFAULT_SALT = keccak256('train.protocol.v3');

  /// @notice CreateX — same address on every supported chain (presence asserted in run()).
  ICreateX internal constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

  function run() external {
    uint256 pk = vm.envUint('PRIVATE_KEY');
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);

    require(address(CREATEX).code.length > 0, 'CreateX factory not deployed on this chain');
    // A salt whose first 20 bytes equal the caller or zero would hit CreateX's protected paths
    // (sender-scoped / cross-chain-scoped guarding) and change or fragment the addresses.
    address saltPrefix = address(bytes20(salt));
    require(saltPrefix != vm.addr(pk) && saltPrefix != address(0), 'salt would trigger CreateX salt protection');

    (address curve, address train, address router) = _predict(salt);

    vm.startBroadcast(pk);
    if (curve.code.length == 0) {
      require(CREATEX.deployCreate2(salt, type(ConstantPayoutCurve).creationCode) == curve, 'curve address mismatch');
    } else {
      console.log('ConstantPayoutCurve already deployed, skipping');
    }
    if (train.code.length == 0) {
      require(CREATEX.deployCreate2(salt, type(Train).creationCode) == train, 'train address mismatch');
    } else {
      console.log('Train already deployed, skipping');
    }
    if (router.code.length == 0) {
      require(CREATEX.deployCreate2(salt, type(TrainRouter).creationCode) == router, 'router address mismatch');
    } else {
      console.log('TrainRouter already deployed, skipping');
    }
    vm.stopBroadcast();

    _logSummary(salt, curve, train, router);
  }

  /// @dev Offline preview of the deterministic addresses; needs no RPC state and no key.
  function predict() external view {
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);
    (address curve, address train, address router) = _predict(salt);
    _logSummary(salt, curve, train, router);
  }

  function _predict(bytes32 salt) internal pure returns (address curve, address train, address router) {
    // Mirrors CreateX's guarding for a "random" salt (see contract-level @dev note).
    bytes32 guardedSalt = keccak256(abi.encode(salt));
    curve = vm.computeCreate2Address(guardedSalt, keccak256(type(ConstantPayoutCurve).creationCode), address(CREATEX));
    train = vm.computeCreate2Address(guardedSalt, keccak256(type(Train).creationCode), address(CREATEX));
    router = vm.computeCreate2Address(guardedSalt, keccak256(type(TrainRouter).creationCode), address(CREATEX));
  }

  function _logSummary(bytes32 salt, address curve, address train, address router) internal view {
    console.log('chain id           :', block.chainid);
    console.log('salt               :', vm.toString(salt));
    console.log('ConstantPayoutCurve:', curve);
    console.log('Train              :', train);
    console.log('TrainRouter        :', router);
    console.log('');
    console.log('Export these before running the test scripts:');
    console.log(string.concat('  export TRAIN=', vm.toString(train)));
    console.log(string.concat('  export ROUTER=', vm.toString(router)));
    console.log(string.concat('  export CONSTANT_CURVE=', vm.toString(curve)));
  }
}
