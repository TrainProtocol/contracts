// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Test} from "forge-std/Test.sol";
import {Handlers} from "./handlers/Handlers.sol";

/// @notice Foundry-native stateful invariant target. It reuses the EXACT same handlers and global
///         `property_*` checks as the Echidna/Medusa suites, so every protocol-wide invariant is
///         expressed once and runs under all three engines.
/// @dev Ported from test/invariant/FoundryInvariant.t.sol. The `handler_userLockFor` selector is
///      dropped along with the handler itself (see TrainHandler.sol) — the fuzzer target array shrinks
///      from 12 to 11 entries accordingly.
contract FoundryInvariant is Test, Handlers {
    modifier asActor() override {
        vm.startPrank(actor);
        _;
        vm.stopPrank();
    }

    function setUp() public {
        setup();

        // Restrict the fuzzer to the handler entry points (exclude property_/view helpers).
        bytes4[] memory s = new bytes4[](11);
        s[0] = this.handler_userLock.selector;
        s[1] = this.handler_solverLock.selector;
        s[2] = this.handler_userLockWithCurve.selector;
        s[3] = this.handler_solverLockWithCurve.selector;
        s[4] = this.handler_solverLockDuplicateReverts.selector;
        s[5] = this.handler_redeemUser.selector;
        s[6] = this.handler_redeemSolver.selector;
        s[7] = this.handler_refundUser.selector;
        s[8] = this.handler_refundUserAsRecipient.selector;
        s[9] = this.handler_refundSolver.selector;
        s[10] = this.handler_skipTime.selector;
        targetContract(address(this));
        targetSelector(FuzzSelector({addr: address(this), selectors: s}));
    }

    function invariant_escrowSolvency() public {
        property_escrowSolvency();
    }

    function invariant_tokenConservation() public {
        property_tokenConservation();
    }

    function invariant_userLocksWellFormed() public {
        property_userLocksWellFormed();
    }

    function invariant_solverLocksWellFormed() public {
        property_solverLocksWellFormed();
    }

    function invariant_enumerationScaleSafe() public {
        property_enumerationScaleSafe();
    }

    function invariant_solverLockUniquePerSolver() public {
        property_solverLockUniquePerSolver();
    }
}
