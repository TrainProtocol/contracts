// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {TrainHandler} from "./TrainHandler.sol";

/// @notice Inherits from all the handlers to expose all entry points in a single contract.
///         Manages environment changes (e.g. current actor, current token, mocks setup, etc.).
/// @dev Ported unchanged from test/invariant/handlers/Handlers.sol (only one handler contract exists
///      for the Tempo suite, so this aggregator is trivial, same as the shared one).
abstract contract Handlers is
    TrainHandler
{
    function setCurrentActor(uint256 entropy) public {
        actor = actors[entropy % actors.length];
    }
}
