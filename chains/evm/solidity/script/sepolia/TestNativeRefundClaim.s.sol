// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';

/// @notice Step 2 of the native-ETH refund demo (run ~60s after TestNativeRefundLock, SAME REFUND_SALT):
///         refund the native user lock (timelock-gated, since user != recipient) and the native solver
///         lock (always timelock-gated). ETH (amount + reward) returns to refundTo = user.
/// @dev REFUND_SALT=<same value> forge script script/sepolia/TestNativeRefundClaim.s.sol \
///        --rpc-url $SEPOLIA_RPC_URL --broadcast
contract TestNativeRefundClaim is SepoliaConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');

    uint256 su = uint256(keccak256(abi.encodePacked(salt, 'native-refund-user', user)));
    uint256 ss = uint256(keccak256(abi.encodePacked(salt, 'native-refund-solver', user)));
    bytes32 hu = _hashlock(su);
    bytes32 hs = _hashlock(ss);

    uint256 balBefore = user.balance;
    vm.startBroadcast(userPk);
    train.refundUser(hu); // requires timelock expired (user != recipient)
    train.refundSolver(hs, user); // solver locks are keyed by solver address; the lock was created by user
    vm.stopBroadcast();

    console.log('Refunded native user + solver locks to refundTo = user.');
    console.log('  ETH balance delta (wei, net of gas):', user.balance - balBefore);
    _logNative(hu);
  }
}
