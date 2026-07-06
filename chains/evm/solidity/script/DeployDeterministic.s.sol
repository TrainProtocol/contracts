// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { Train } from '../src/Train.sol';
import { TrainRouter } from '../src/TrainRouter.sol';
import { ConstantPayoutCurve } from '../src/ConstantPayoutCurve.sol';

/// @title Deterministic CREATE2 deploy of ConstantPayoutCurve + Train + TrainRouter
/// @notice Same address on every chain: deploys go through the Arachnid CREATE2 factory
///         (0x4e59b44847b379578588920cA78FbF26c0B4956C), so the address depends only on
///         (factory, salt, initcode) — not on the deployer key or its nonce.
/// @dev Idempotent: contracts already present at their predicted address are skipped,
///      so re-runs and partial-failure recovery are safe. Permissionless by design:
///      anyone re-running this script lands the exact same bytecode at the same address.
/// @dev The address changes if the source, solc version, or optimizer settings change
///      (initcode embeds the metadata hash). Bump the salt deliberately for a new release.
/// @dev Usage:
///   export PRIVATE_KEY=0x...             # deployer (any funded key gives the same addresses)
///   forge script script/DeployDeterministic.s.sol --rpc-url <alias> --broadcast [--verify ...]
///   forge script script/DeployDeterministic.s.sol --sig 'predict()'   # offline address preview
contract DeployDeterministicScript is Script {
  // Bump the string to rotate all addresses for a new release,
  // or override per-run with CREATE2_SALT (bytes32 hex).
  bytes32 internal constant DEFAULT_SALT = keccak256('train.protocol.v1');

  function run() external {
    uint256 pk = vm.envUint('PRIVATE_KEY');
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);

    require(CREATE2_FACTORY.code.length > 0, 'CREATE2 factory not deployed on this chain');

    (address curve, address train, address router) = _predict(salt);

    vm.startBroadcast(pk);
    if (curve.code.length == 0) {
      require(address(new ConstantPayoutCurve{ salt: salt }()) == curve, 'curve address mismatch');
    } else {
      console.log('ConstantPayoutCurve already deployed, skipping');
    }
    if (train.code.length == 0) {
      require(address(new Train{ salt: salt }()) == train, 'train address mismatch');
    } else {
      console.log('Train already deployed, skipping');
    }
    if (router.code.length == 0) {
      require(address(new TrainRouter{ salt: salt }()) == router, 'router address mismatch');
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
    curve = vm.computeCreate2Address(salt, keccak256(type(ConstantPayoutCurve).creationCode));
    train = vm.computeCreate2Address(salt, keccak256(type(Train).creationCode));
    router = vm.computeCreate2Address(salt, keccak256(type(TrainRouter).creationCode));
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
