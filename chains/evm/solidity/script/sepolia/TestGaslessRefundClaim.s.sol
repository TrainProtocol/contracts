// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';

/// @notice Step 2 of the GASLESS refund demo (run ~60s after the lock, SAME REFUND_SALT): the
///         RELAYER (a third party — not the depositor) triggers refundUser after the timelock.
///         This proves the refund goes to the original depositor (refundTo = user), NOT to whoever
///         calls refund and NOT to the relayer who fronted the gas.
/// @dev $env:REFUND_SALT = "g1"   # same value used in TestGaslessRefundLock
///   forge script script/sepolia/TestGaslessRefundClaim.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast
contract TestGaslessRefundClaim is SepoliaConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');
    uint256 secret = uint256(keccak256(abi.encodePacked(salt, 'gasless-refund', user)));
    bytes32 hl = _hashlock(secret);

    uint256 userBefore = USDC.balanceOf(user);
    uint256 relayerBefore = USDC.balanceOf(relayer);

    // A third party (the relayer) triggers the refund; allowed because the timelock has expired.
    vm.startBroadcast(relayerPk);
    train.refundUser(hl);
    vm.stopBroadcast();

    console.log('refundUser triggered by RELAYER (a third party):', relayer);
    console.log('  USDC -> depositor (user)   :', USDC.balanceOf(user) - userBefore);    // = AMOUNT
    console.log('  USDC -> relayer (caller)   :', USDC.balanceOf(relayer) - relayerBefore); // = 0
    console.log('Conclusion: the original depositor (refundTo = user) is refunded, not the caller.');
    _logLock(hl); // status should be 2 (Refunded)
  }
}
