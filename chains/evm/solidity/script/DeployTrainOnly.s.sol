// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { Train } from '../src/Train.sol';

/// @dev Minimal CreateX surface used here. Full contract: https://github.com/pcaversaccio/createx
interface ICreateX {
  function deployCreate2(bytes32 salt, bytes memory initCode) external payable returns (address newContract);
}

/// @title Deterministic CreateX deploy of Train ONLY (mainnet scope decision)
/// @notice Same salt, factory, and guarding as DeployDeterministic.s.sol, restricted to Train:
///         ConstantPayoutCurve and TrainRouter are deliberately NOT deployed on mainnets for now
///         (locks accept payoutCurve = address(0) and pay the full amount; gasless rails are
///         unavailable until TrainRouter ships). Identical initcode + guarded salt means Train
///         still lands at the exact address DeployDeterministic predicts.
/// @dev Usage:
///   export PRIVATE_KEY=0x...
///   forge script script/DeployTrainOnly.s.sol --rpc-url <alias> --broadcast
///   forge script script/DeployTrainOnly.s.sol --sig 'predict()'   # offline preview
contract DeployTrainOnlyScript is Script {
  bytes32 internal constant DEFAULT_SALT = keccak256('train.protocol.v3');

  ICreateX internal constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

  function run() external {
    uint256 pk = vm.envUint('PRIVATE_KEY');
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);

    require(address(CREATEX).code.length > 0, 'CreateX factory not deployed on this chain');
    address saltPrefix = address(bytes20(salt));
    require(saltPrefix != vm.addr(pk) && saltPrefix != address(0), 'salt would trigger CreateX salt protection');

    address train = _predict(salt);

    vm.startBroadcast(pk);
    if (train.code.length == 0) {
      require(CREATEX.deployCreate2(salt, type(Train).creationCode) == train, 'train address mismatch');
    } else {
      console.log('Train already deployed, skipping');
    }
    vm.stopBroadcast();

    _logSummary(salt, train);
  }

  function predict() external view {
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);
    _logSummary(salt, _predict(salt));
  }

  function _predict(bytes32 salt) internal pure returns (address train) {
    bytes32 guardedSalt = keccak256(abi.encode(salt));
    train = vm.computeCreate2Address(guardedSalt, keccak256(type(Train).creationCode), address(CREATEX));
  }

  function _logSummary(bytes32 salt, address train) internal view {
    console.log('chain id           :', block.chainid);
    console.log('salt               :', vm.toString(salt));
    console.log('Train              :', train);
  }
}
