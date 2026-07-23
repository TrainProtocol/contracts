// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';

/// @notice Step 2 of the solver-refund demo (run ~60s after TestSolverRefund, with the SAME
///         REFUND_SALT): refund the solver lock (amount + reward return to refundTo = user).
/// @dev REFUND_SALT=<same value> forge script script/tempo/TestSolverRefundClaim.s.sol \
///        --rpc-url tempo_testnet --broadcast
contract TestSolverRefundClaim is TempoConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');

    uint256 ss = uint256(keccak256(abi.encodePacked(salt, 'solver-refund', user)));
    bytes32 hs = _hashlock(ss);

    uint256 balBefore = PATH_USD.balanceOf(user);
    vm.startBroadcast(userPk);
    train.refundSolver(hs, 1); // index 1 = first (only) solver lock for this hashlock
    vm.stopBroadcast();

    console.log('Refunded solver lock (amount + reward) to refundTo = user.');
    console.log('  pathUSD reclaimed (6dp):', PATH_USD.balanceOf(user) - balBefore);
  }
}
