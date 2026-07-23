// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';

/// @notice Direct (happy-path) Train flow on Tempo: userLock -> redeemUser. Broadcast as the
///         user. Funds cycle back (recipient = refundTo = user), so net pathUSD ~ 0.
/// @dev $env:FOUNDRY_PROFILE="tempo"
///   forge script script/tempo/TestDirect.s.sol --rpc-url tempo_testnet --broadcast
contract TestDirect is TempoConfig {
  function run() external {
    _load();

    uint256 s1 = _secret('direct-user');
    bytes32 h1 = _hashlock(s1);
    vm.startBroadcast(userPk);
    train.userLock(_userParamsT(h1, AMOUNT, 3600, user, user), _dstT(), '', '');
    train.redeemUser(h1, s1);
    vm.stopBroadcast();
    console.log('[1] userLock -> redeemUser OK');
    _logLock(h1);
  }
}
