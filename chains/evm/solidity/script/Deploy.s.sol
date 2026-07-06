// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { Train } from '../src/Train.sol';
import { TrainRouter } from '../src/TrainRouter.sol';
import { ConstantPayoutCurve } from '../src/ConstantPayoutCurve.sol';

/// @title Deploy Train + TrainRouter + ConstantPayoutCurve (Sepolia)
/// @dev Usage:
///   export USER_PK=0x...                 # deployer = user account
///   export ETHERSCAN_API_KEY=...         # for --verify
///   forge script script/Deploy.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast \
///     --verify --verifier etherscan --etherscan-api-key $ETHERSCAN_API_KEY
/// @dev Train, TrainRouter, and ConstantPayoutCurve are all deployed via `new`, so they auto-verify.
contract DeployScript is Script {
  function run() external {
    uint256 pk = vm.envUint('USER_PK');

    vm.startBroadcast(pk);
    address curve = address(new ConstantPayoutCurve());
    Train train = new Train();
    TrainRouter router = new TrainRouter();
    vm.stopBroadcast();

    console.log('ConstantPayoutCurve:', curve);
    console.log('Train              :', address(train));
    console.log('TrainRouter             :', address(router));
    console.log('');
    console.log('Export these before running the test scripts:');
    console.log(string.concat('  export TRAIN=', vm.toString(address(train))));
    console.log(string.concat('  export ROUTER=', vm.toString(address(router))));
    console.log(string.concat('  export CONSTANT_CURVE=', vm.toString(curve)));
  }
}
