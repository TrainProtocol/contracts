// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { Train } from '../../src/tempo/Train.sol';
import { ConstantPayoutCurve } from '../../src/ConstantPayoutCurve.sol';

/// @title Deterministic CREATE2 deploy of ConstantPayoutCurve + Train, for Tempo
/// @notice Tempo analogue of script/DeployDeterministic.s.sol. Deploys only two contracts —
///         no TrainRouter — because TrainRouter is not used on Tempo at all: native Tempo
///         Transaction batching + fee-payer sponsorship already provides gasless intake (see
///         script/tempo/README.md and script/tempo/native_flow.py). `Train` here is
///         src/tempo/Train.sol, a Tempo-specific contract (no native-ETH paths, no `userLockFor`
///         since there is no router to attribute a lock away from `msg.sender`) — not the shared
///         src/Train.sol used by the other 6 EVM chains.
/// @dev Same CREATE2 mechanics as DeployDeterministic.s.sol: goes through the Arachnid factory
///      (0x4e59b44847b379578588920cA78FbF26c0B4956C, confirmed predeployed on Tempo), so the
///      address depends only on (factory, salt, initcode) — not the deployer key or its nonce.
///      Idempotent: contracts already present at their predicted address are skipped.
/// @dev Usage:
///   export PRIVATE_KEY=0x...                          # deployer (funded with pathUSD, not ETH)
///   forge script script/tempo/DeployTempo.s.sol --sig 'predict()'   # offline address preview
///   $env:FOUNDRY_PROFILE="tempo"
///   forge script script/tempo/DeployTempo.s.sol --rpc-url tempo_testnet --broadcast \
///     --verify --verifier-url https://contracts.tempo.xyz
contract DeployTempoScript is Script {
  // Same salt as the shared deploy — deliberately not "the same address" as the other 7
  // testnets, since evm_version = osaka (vs cancun) already changes the initcode regardless.
  bytes32 internal constant DEFAULT_SALT = keccak256('train.protocol.v2');

  // pathUSD — Tempo's fee-fallback TIP-20 (0x20c0..., 6 decimals; same address on Moderato
  // testnet and mainnet). Train/ConstantPayoutCurve are not TIP-20 contracts, so calling them
  // resolves the fee token via Tempo's 5-level precedence, which falls back to pathUSD — the
  // deployer needs a pathUSD balance to pay gas, not a native token (Tempo has none).
  IERC20 internal constant PATH_USD = IERC20(0x20C0000000000000000000000000000000000000);
  uint256 internal constant TEMPO_TESTNET_CHAINID = 42431; // Moderato
  uint256 internal constant TEMPO_MAINNET_CHAINID = 4217;

  function run() external {
    uint256 pk = vm.envUint('PRIVATE_KEY');
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);

    _requireFeeTokenFundedOnTempo(vm.addr(pk));
    require(CREATE2_FACTORY.code.length > 0, 'CREATE2 factory not deployed on this chain');

    (address curve, address train) = _predict(salt);

    vm.startBroadcast(pk);
    if (curve.code.length == 0) {
      require(address(new ConstantPayoutCurve{ salt: salt }()) == curve, 'curve address mismatch');
    } else {
      console.log('ConstantPayoutCurve already deployed, skipping');
    }
    if (train.code.length == 0) {
      require(address(new Train{ salt: salt }()) == train, 'train address mismatch');
    } else {
      console.log('Train (tempo) already deployed, skipping');
    }
    vm.stopBroadcast();

    _logSummary(salt, curve, train);
  }

  /// @dev Offline preview of the deterministic addresses; needs no RPC state and no key.
  function predict() external view {
    bytes32 salt = vm.envOr('CREATE2_SALT', DEFAULT_SALT);
    (address curve, address train) = _predict(salt);
    _logSummary(salt, curve, train);
  }

  function _predict(bytes32 salt) internal pure returns (address curve, address train) {
    curve = vm.computeCreate2Address(salt, keccak256(type(ConstantPayoutCurve).creationCode));
    train = vm.computeCreate2Address(salt, keccak256(type(Train).creationCode));
  }

  function _logSummary(bytes32 salt, address curve, address train) internal view {
    console.log('chain id           :', block.chainid);
    console.log('salt               :', vm.toString(salt));
    console.log('ConstantPayoutCurve:', curve);
    console.log('Train (tempo)      :', train);
    console.log('');
    console.log('Export before running the test scripts:');
    console.log(string.concat('  export TRAIN=', vm.toString(train)));
    console.log(string.concat('  export CONSTANT_CURVE=', vm.toString(curve)));
  }

  /// @dev eth_getBalance always returns a fixed sentinel on Tempo regardless of actual balance
  ///      (no native gas token), so forge's own preflight funds check is silently meaningless
  ///      there. Verify the deployer's pathUSD balance explicitly instead. Off-Tempo chain ids
  ///      are a no-op (this script is never run against them, but stay defensive).
  function _requireFeeTokenFundedOnTempo(address deployer) internal view {
    if (block.chainid != TEMPO_TESTNET_CHAINID && block.chainid != TEMPO_MAINNET_CHAINID) return;
    uint256 bal = PATH_USD.balanceOf(deployer);
    require(bal > 0, 'deployer holds no pathUSD; eth_getBalance is NOT a valid affordability check on Tempo');
  }
}
