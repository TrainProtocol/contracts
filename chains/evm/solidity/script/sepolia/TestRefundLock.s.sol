// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';
import { Train } from '../../src/Train.sol';

/// @notice Step 1 of the refund demo: create a user lock and a solver lock with a short 60s
///         timelock. The user lock's recipient is a counterparty (NOT the user) so the user must
///         wait for the timelock to refund (exercising the timelock-gated refund path).
/// @dev Set REFUND_SALT to a fresh value (e.g. $(date +%s)) and reuse the SAME value in
///      TestRefundClaim. Wait ~60s between the two.
///   REFUND_SALT=$(date +%s) forge script script/sepolia/TestRefundLock.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast
contract TestRefundLock is SepoliaConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');
    address counterparty = address(uint160(uint256(keccak256('train.sepolia.counterparty'))));

    uint256 su = uint256(keccak256(abi.encodePacked(salt, 'refund-user', user)));
    uint256 ss = uint256(keccak256(abi.encodePacked(salt, 'refund-solver', user)));
    bytes32 hu = _hashlock(su);
    bytes32 hs = _hashlock(ss);

    vm.startBroadcast(userPk);
    // recipient = counterparty so the user (sender) is NOT the recipient => refund needs timelock
    train.userLock(_userParamsT(hu, AMOUNT, 60, counterparty, user), _dstT(), '', '');
    train.solverLock(_solverParamsT(hs, 60), _dstT(), '');
    vm.stopBroadcast();

    console.log('Locked user + solver with a 60s timelock.');
    console.log('Wait ~60s, then run TestRefundClaim with the SAME REFUND_SALT.');
    console.log('  user   hashlock:', vm.toString(hu));
    console.log('  solver hashlock:', vm.toString(hs));
  }
}
