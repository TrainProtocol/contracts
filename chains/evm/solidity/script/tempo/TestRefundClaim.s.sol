// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';

/// @notice Step 2 of the user-lock refund demo (run ~60s after TestRefundLock, with the SAME
///         REFUND_SALT): refund the user lock (timelock-gated, since user != recipient). Funds
///         return to refundTo = user.
/// @dev REFUND_SALT=<same value> forge script script/tempo/TestRefundClaim.s.sol \
///        --rpc-url tempo_testnet --broadcast
contract TestRefundClaim is TempoConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');

    uint256 su = uint256(keccak256(abi.encodePacked(salt, 'refund-user', user)));
    bytes32 hu = _hashlock(su);

    uint256 balBefore = PATH_USD.balanceOf(user);
    vm.startBroadcast(userPk);
    train.refundUser(hu); // requires timelock expired (user != recipient)
    vm.stopBroadcast();

    console.log('Refunded user lock to refundTo = user.');
    console.log('  pathUSD reclaimed (6dp):', PATH_USD.balanceOf(user) - balBefore);
    _logLock(hu);
  }
}
