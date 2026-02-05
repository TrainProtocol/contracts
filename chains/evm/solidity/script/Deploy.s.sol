// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";
import "../src/Train.sol";

/// @title Deploy Script for Train Protocol
/// @dev Usage:
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        Train train = new Train();
        console.log("Train deployed at:", address(train));

        vm.stopBroadcast();
    }
}
