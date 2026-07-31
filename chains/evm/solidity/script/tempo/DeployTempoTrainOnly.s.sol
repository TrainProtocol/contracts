// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { Train } from '../../src/tempo/Train.sol';

/// @dev Minimal CreateX surface used here. Full contract: https://github.com/pcaversaccio/createx
interface ICreateX {
  function deployCreate2(bytes32 salt, bytes memory initCode) external payable returns (address newContract);
}

/// @title Deterministic CreateX deploy of the Tempo Train ONLY (mainnet scope decision)
/// @notice Same salt, factory, and guarding as script/tempo/DeployTempo.s.sol, restricted to
///         Train: ConstantPayoutCurve is deliberately NOT deployed on Tempo mainnet (locks pass
///         payoutCurve = address(0), validation skipped, full payout). Identical initcode +
///         guarded salt means Train lands at the exact address DeployTempo predicts.
/// @dev Build with FOUNDRY_PROFILE=tempo (evm_version = osaka) or the address will not match the
///      Moderato-verified bytecode.
/// @dev Usage:
///   export PRIVATE_KEY=0x...                          # deployer (funded with pathUSD, not ETH)
///   FOUNDRY_PROFILE=tempo forge script script/tempo/DeployTempoTrainOnly.s.sol \
///     --rpc-url https://rpc.tempo.xyz --broadcast --gas-limit 30000000
contract DeployTempoTrainOnlyScript is Script {
  bytes32 internal constant DEFAULT_SALT = keccak256('train.protocol.v3');

  ICreateX internal constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

  IERC20 internal constant PATH_USD = IERC20(0x20C0000000000000000000000000000000000000);
  uint256 internal constant TEMPO_TESTNET_CHAINID = 42431; // Moderato
  uint256 internal constant TEMPO_MAINNET_CHAINID = 4217;

  function run() external {
    uint256 pk = vm.envUint('PRIVATE_KEY');
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);

    require(
      block.chainid == TEMPO_TESTNET_CHAINID || block.chainid == TEMPO_MAINNET_CHAINID,
      'not a Tempo chain (this script is Tempo-only)'
    );
    _requireFeeTokenFunded(vm.addr(pk));
    require(address(CREATEX).code.length > 0, 'CreateX factory not deployed on this chain');
    address saltPrefix = address(bytes20(salt));
    require(saltPrefix != vm.addr(pk) && saltPrefix != address(0), 'salt would trigger CreateX salt protection');

    address train = _predict(salt);

    vm.startBroadcast(pk);
    if (train.code.length == 0) {
      require(CREATEX.deployCreate2(salt, type(Train).creationCode) == train, 'train address mismatch');
    } else {
      console.log('Train (tempo) already deployed, skipping');
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
    console.log('Train (tempo)      :', train);
  }

  /// @dev eth_getBalance returns a fixed sentinel on Tempo — check pathUSD instead. Tolerant of
  ///      forge builds whose revm cannot simulate Tempo-native contracts (OpcodeNotFound).
  function _requireFeeTokenFunded(address deployer) internal view {
    (bool ok, bytes memory ret) =
      address(PATH_USD).staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, deployer));
    if (!ok || ret.length < 32) {
      console.log('pathUSD balanceOf not simulatable on this forge build - check funding off-chain');
      return;
    }
    uint256 bal = abi.decode(ret, (uint256));
    console.log('deployer pathUSD balance (6 decimals):', bal);
    require(bal > 0, 'deployer holds no pathUSD; eth_getBalance is NOT a valid affordability check on Tempo');
  }
}
