// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";
import "../src/SqrtPayoutCurve.sol";
import "../src/LinearPayoutCurve.sol";
import "../src/VolatilityDecayCurve.sol";

/// @title Deploy Script for Payout Curve Libraries
/// @dev Usage:
///   forge script script/DeployPayoutCurves.s.sol --rpc-url $RPC_URL --broadcast --verify
contract DeployPayoutCurvesScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        address sqrtCurve = _deployLib(type(SqrtPayoutCurve).creationCode);
        console.log("SqrtPayoutCurve deployed at:      ", sqrtCurve);

        address linearCurve = _deployLib(type(LinearPayoutCurve).creationCode);
        console.log("LinearPayoutCurve deployed at:    ", linearCurve);

        address volCurve = _deployLib(type(VolatilityDecayCurve).creationCode);
        console.log("VolatilityDecayCurve deployed at: ", volCurve);

        vm.stopBroadcast();

        // Example LinearPayoutCurve config
        // Scenario: 1 ETH lock that decays to a 0.8 ETH floor over 1 hour after a 60-second grace period.
        //
        //   gracePeriod = 60 seconds
        //   Pmin        = 0.8 ether
        //   rate        = (1 ether - 0.8 ether) / 3600 seconds = 0.2 ether / 3600 s
        //               = 0.2e18 / 3600 ≈ 55_555_555_555_555 wei/s
        //   rate_scaled = rate × 1e18 = 55_555_555_555_555 * 1e18
        //               ≈ 5.556e31
        //
        // Any lock using this config and amount=1 ether will reach Pmin after exactly 3600 s post-grace.
        bytes memory linearConfig = abi.encode(
            uint256(60),                        // gracePeriod: 60 s relay buffer
            uint256(55_555_555_555_555 * 1e18), // rate: ~0.2 ETH decays over 3600 s (scaled ×1e18)
            uint256(0.8 ether)                  // Pmin: 80% floor (absolute, in token-wei)
        );
        console.log("Example LinearPayoutCurve config (hex):");
        console.logBytes(linearConfig);
    }

    function _deployLib(bytes memory bytecode) internal returns (address addr) {
        assembly { addr := create(0, add(bytecode, 0x20), mload(bytecode)) }
        require(addr != address(0), 'lib deploy failed');
    }
}
