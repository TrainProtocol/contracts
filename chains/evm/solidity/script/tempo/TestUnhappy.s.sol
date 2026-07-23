// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';
import { Train } from '../../src/tempo/Train.sol';

/// @notice Negative-path scenarios on Tempo: wrong-secret redeem (`HashlockMismatch`),
///         double-redeem (`LockNotPending`), and an early non-recipient refund attempt
///         (`RefundNotAllowed`). Each attempt is a plain `.call` (not the typed interface) with an
///         explicit gas stipend, so forge records a fixed gas limit instead of calling
///         `eth_estimateGas` (which would itself revert) -- letting the deliberately-reverting
///         transaction actually broadcast. `forge script --broadcast` still halts the whole run
///         the moment any transaction it sends reverts on-chain (there's no "expected revert,
///         continue anyway" flag), so each scenario is its own entrypoint, run as three separate
///         `--sig` invocations rather than one `run()` -- a revert in scenario 1 must not block
///         scenarios 2 and 3 from broadcasting. Broadcast as the user.
/// @dev $env:FOUNDRY_PROFILE="tempo"
///   forge script script/tempo/TestUnhappy.s.sol --sig 'wrongSecret()'  --rpc-url tempo_testnet --broadcast --skip-simulation
///   forge script script/tempo/TestUnhappy.s.sol --sig 'doubleRedeem()' --rpc-url tempo_testnet --broadcast --skip-simulation
///   forge script script/tempo/TestUnhappy.s.sol --sig 'earlyRefund()'  --rpc-url tempo_testnet --broadcast --skip-simulation
contract TestUnhappy is TempoConfig {
  /// [1] Wrong-secret redeem — create a normal lock, then redeem with a secret that does not
  ///     hash to its hashlock.
  function wrongSecret() external {
    _load();
    uint256 s1 = _secret('unhappy-wrong-secret');
    bytes32 h1 = _hashlock(s1);
    uint256 wrongSecretValue = s1 + 1;
    vm.startBroadcast(userPk);
    train.userLock(_userParamsT(h1, AMOUNT, 3600, user, user), _dstT(), '', '');
    (bool ok1, bytes memory ret1) =
      address(train).call{ gas: 200_000 }(abi.encodeCall(train.redeemUser, (h1, wrongSecretValue)));
    vm.stopBroadcast();
    console.log('[1] redeemUser(wrong secret) reverted as expected:', !ok1);
    _logRevertReason(ret1);
  }

  /// [2] Double-redeem — redeem once (succeeds), then redeem again with the correct secret.
  function doubleRedeem() external {
    _load();
    uint256 s2 = _secret('unhappy-double-redeem');
    bytes32 h2 = _hashlock(s2);
    vm.startBroadcast(userPk);
    train.userLock(_userParamsT(h2, AMOUNT, 3600, user, user), _dstT(), '', '');
    train.redeemUser(h2, s2); // first redeem succeeds
    (bool ok2, bytes memory ret2) = address(train).call{ gas: 200_000 }(abi.encodeCall(train.redeemUser, (h2, s2)));
    vm.stopBroadcast();
    console.log('[2] second redeemUser (already Redeemed) reverted as expected:', !ok2);
    _logRevertReason(ret2);
  }

  /// [3] Early non-recipient refund — recipient = counterparty (not the caller), long timelock
  ///     (3600s, nowhere near elapsed), caller (user) is neither recipient nor past timelock.
  function earlyRefund() external {
    _load();
    uint256 s3 = _secret('unhappy-early-refund');
    bytes32 h3 = _hashlock(s3);
    address counterparty = address(uint160(uint256(keccak256('train.tempo.unhappy.counterparty'))));
    vm.startBroadcast(userPk);
    train.userLock(_userParamsT(h3, AMOUNT, 3600, counterparty, user), _dstT(), '', '');
    (bool ok3, bytes memory ret3) = address(train).call{ gas: 200_000 }(abi.encodeCall(train.refundUser, (h3)));
    vm.stopBroadcast();
    console.log('[3] early non-recipient refundUser reverted as expected:', !ok3);
    _logRevertReason(ret3);
  }

  /// @dev Decodes a custom-error selector out of low-level call return data, if present, for
  ///      readable console output (forge doesn't auto-decode custom errors from raw call results).
  function _logRevertReason(bytes memory ret) internal pure {
    if (ret.length < 4) {
      console.log('    (no revert data / plain revert)');
      return;
    }
    bytes4 selector = bytes4(ret);
    if (selector == Train.HashlockMismatch.selector) {
      console.log('    reason: HashlockMismatch()');
    } else if (selector == Train.LockNotPending.selector) {
      console.log('    reason: LockNotPending()');
    } else if (selector == Train.RefundNotAllowed.selector) {
      console.log('    reason: RefundNotAllowed()');
    } else {
      console.log('    reason: unrecognized selector', vm.toString(selector));
    }
  }
}
