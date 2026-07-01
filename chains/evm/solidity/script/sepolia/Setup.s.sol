// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';

/// @notice One-time approvals from the user: Train (for direct userLock/solverLock/userLockFor) and
///         Permit2 (for the TrainRouter permit2 path). Broadcast as the user.
/// @dev forge script script/sepolia/Setup.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract Setup is SepoliaConfig {
  function run() external {
    _load();
    vm.startBroadcast(userPk);
    USDC.approve(address(train), type(uint256).max);
    USDC.approve(PERMIT2, type(uint256).max);
    vm.stopBroadcast();
    console.log('Approvals set (user -> Train, user -> Permit2):');
    console.log('  allowance -> Train  :', USDC.allowance(user, address(train)));
    console.log('  allowance -> Permit2:', USDC.allowance(user, PERMIT2));
  }
}
