// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';
import { Train } from '../../src/Train.sol';

/// @notice Step 1 of the native-ETH refund demo: create a native user lock and a native solver lock with
///         a short 60s timelock. The user lock's recipient is a counterparty (NOT the user) so the user
///         must wait for the timelock to refund (exercising the timelock-gated native refund path).
/// @dev Set REFUND_SALT to a fresh value and reuse the SAME value in TestNativeRefundClaim; wait ~60s.
///   REFUND_SALT=$(date +%s) forge script script/sepolia/TestNativeRefundLock.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast
contract TestNativeRefundLock is SepoliaConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');
    address counterparty = address(uint160(uint256(keccak256('train.sepolia.counterparty'))));

    uint256 su = uint256(keccak256(abi.encodePacked(salt, 'native-refund-user', user)));
    uint256 ss = uint256(keccak256(abi.encodePacked(salt, 'native-refund-solver', user)));
    bytes32 hu = _hashlock(su);
    bytes32 hs = _hashlock(ss);

    vm.startBroadcast(userPk);
    // recipient = counterparty so the user (sender) is NOT the recipient => refund needs timelock
    train.userLock{ value: NATIVE_AMOUNT }(_userParamsTNative(hu, NATIVE_AMOUNT, 60, counterparty, user), _dstTNative(), '', '');
    train.solverLock{ value: NATIVE_AMOUNT + NATIVE_REWARD }(_solverParamsTNative(hs, 60), _dstTNative(), '');
    vm.stopBroadcast();

    console.log('Locked native user + solver with a 60s timelock.');
    console.log('Wait ~60s, then run TestNativeRefundClaim with the SAME REFUND_SALT.');
    console.log('  user   hashlock:', vm.toString(hu));
    console.log('  solver hashlock:', vm.toString(hs));
  }
}
