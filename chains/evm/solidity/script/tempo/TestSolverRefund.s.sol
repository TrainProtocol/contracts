// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';

/// @notice Step 1 of the solver-refund demo: create a solver lock with a short 60s timelock.
///         Run TestSolverRefundClaim ~60s later with the same REFUND_SALT.
/// @dev REFUND_SALT=$(date +%s) forge script script/tempo/TestSolverRefund.s.sol \
///        --rpc-url tempo_testnet --broadcast
contract TestSolverRefund is TempoConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');

    uint256 ss = uint256(keccak256(abi.encodePacked(salt, 'solver-refund', user)));
    bytes32 hs = _hashlock(ss);

    vm.startBroadcast(userPk);
    train.solverLock(_solverParamsT(hs, 60), _dstT(), '');
    vm.stopBroadcast();

    console.log('Locked solver lock with a 60s timelock, solver:', user);
    console.log('Wait ~60s, then run TestSolverRefundClaim with the SAME REFUND_SALT.');
    console.log('  solver hashlock:', vm.toString(hs));
  }
}
