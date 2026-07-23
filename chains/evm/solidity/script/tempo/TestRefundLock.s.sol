// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';

/// @notice Step 1 of the user-lock refund demo: create a user lock with a short 60s timelock,
///         recipient = a counterparty (NOT the user), so the user must wait for the timelock to
///         refund (exercises the timelock-gated branch of `refundUser`, not the
///         "recipient-may-refund-anytime" branch).
/// @dev Set REFUND_SALT to a fresh value (e.g. $(date +%s)) and reuse the SAME value in
///      TestRefundClaim. Wait ~60s between the two.
///   REFUND_SALT=$(date +%s) forge script script/tempo/TestRefundLock.s.sol \
///     --rpc-url tempo_testnet --broadcast
contract TestRefundLock is TempoConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');
    address counterparty = address(uint160(uint256(keccak256('train.tempo.counterparty'))));

    uint256 su = uint256(keccak256(abi.encodePacked(salt, 'refund-user', user)));
    bytes32 hu = _hashlock(su);

    vm.startBroadcast(userPk);
    // recipient = counterparty so the user (sender) is NOT the recipient => refund needs timelock
    train.userLock(_userParamsT(hu, AMOUNT, 60, counterparty, user), _dstT(), '', '');
    vm.stopBroadcast();

    console.log('Locked user lock with a 60s timelock (recipient = counterparty, not user).');
    console.log('Wait ~60s, then run TestRefundClaim with the SAME REFUND_SALT.');
    console.log('  user hashlock:', vm.toString(hu));
  }
}
