// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';

/// @notice Step 2 of the refund demo (run ~60s after TestRefundLock, with the SAME REFUND_SALT):
///         refund the user lock (timelock-gated, since user != recipient) and the solver lock
///         (always timelock-gated). Funds return to refundTo = user.
/// @dev REFUND_SALT=<same value> forge script script/sepolia/TestRefundClaim.s.sol \
///        --rpc-url $SEPOLIA_RPC_URL --broadcast
contract TestRefundClaim is SepoliaConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');

    uint256 su = uint256(keccak256(abi.encodePacked(salt, 'refund-user', user)));
    uint256 ss = uint256(keccak256(abi.encodePacked(salt, 'refund-solver', user)));
    bytes32 hu = _hashlock(su);
    bytes32 hs = _hashlock(ss);

    uint256 balBefore = USDC.balanceOf(user);
    vm.startBroadcast(userPk);
    train.refundUser(hu); // requires timelock expired (user != recipient)
    train.refundSolver(hs, 1); // index 1 = first solver lock for this hashlock
    vm.stopBroadcast();

    console.log('Refunded user + solver locks to refundTo = user.');
    console.log('  USDC reclaimed (6dp):', USDC.balanceOf(user) - balBefore);
    _logLock(hu);
  }
}
