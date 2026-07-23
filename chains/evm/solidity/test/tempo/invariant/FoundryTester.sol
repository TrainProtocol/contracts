// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Handlers} from "./handlers/Handlers.sol";

/// @notice Contract to be used for quick testing with Foundry
/// @dev Ported unchanged from test/invariant/FoundryTester.sol.
contract FoundryTester is Test, Handlers {
    modifier asActor() override {
        vm.startPrank(actor);
        _;
        vm.stopPrank();
    }

    function setUp() public {
        setup();
    }

    // forge test --match-test test_sequence -vvv
    function test_sequence() public {
        // Add here call sequence to Handler's functions to reproduce failing property
    }

    // ── Violation repros ──────────────────────────────────────────────
    // Each test_repro_* function below replays a shrunk fuzzer call
    // sequence that violated a property. Run: forge test --match-contract FoundryTester -vvv
}
