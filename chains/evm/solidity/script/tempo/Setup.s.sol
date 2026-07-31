// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';

/// @notice One-time approval: USER approves `Train` (src/tempo/Train.sol) to move its pathUSD,
///         needed before any of the direct-call test scripts (TestDirect, TestSolverReward,
///         TestRefundLock, TestUnhappy) can pull funds via `userLock`/`solverLock`. No Permit2
///         approval step here, unlike the Sepolia Setup.s.sol -- there is no TrainRouter on
///         Tempo to use it.
/// @dev $env:FOUNDRY_PROFILE="tempo"
///   forge script script/tempo/Setup.s.sol --rpc-url tempo_testnet --broadcast
contract Setup is TempoConfig {
  function run() external {
    _load();
    vm.startBroadcast(userPk);
    PATH_USD.approve(address(train), type(uint256).max);
    vm.stopBroadcast();
    console.log('Approved Train for pathUSD, allowance:', PATH_USD.allowance(user, address(train)));
  }
}
