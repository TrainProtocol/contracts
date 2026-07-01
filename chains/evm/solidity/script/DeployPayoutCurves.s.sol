// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import "forge-std/Script.sol";
import "../src/ConstantPayoutCurve.sol";

/// @title Deploy Script for the Payout Curve
/// @notice The protocol retains a single curve: ConstantPayoutCurve (no decay, returns the
///         full locked amount). Configure a lock with this curve address and any (ignored)
///         payoutCurveData to opt into the curve mechanism as an explicit no-op.
/// @dev Usage:
///   forge script script/DeployPayoutCurves.s.sol --rpc-url $RPC_URL --broadcast --verify
contract DeployPayoutCurvesScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        address constantCurve = address(new ConstantPayoutCurve());
        console.log("ConstantPayoutCurve deployed at: ", constantCurve);

        vm.stopBroadcast();
    }
}
