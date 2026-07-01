// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';
import { Train } from '../../src/Train.sol';

/// @notice Direct native-ETH Train flows on Sepolia: userLock->redeemUser and solverLock->redeemSolver
///         with `token = address(0)` (Train's native sentinel). Broadcast as the user; funds cycle back
///         (recipient = refundTo = rewardRecipient = user), so net ETH ≈ gas only.
/// @dev Native is intentionally NOT available on the gasless TrainRouter or `userLockFor` (both are
///      ERC20-only — the gasless standards are token signatures, and `userLockFor` uses a pull model),
///      so this script uses only the payable `userLock`/`solverLock` entrypoints.
///   forge script script/sepolia/TestNative.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract TestNative is SepoliaConfig {
  function run() external {
    _load();
    console.log('ETH bal (user, wei):', user.balance);

    // 1) userLock (ETH) -> redeemUser (recipient = user, so funds cycle back)
    uint256 s1 = _secret('native-user');
    bytes32 h1 = _hashlock(s1);
    vm.startBroadcast(userPk);
    train.userLock{ value: NATIVE_AMOUNT }(_userParamsTNative(h1, NATIVE_AMOUNT, 3600, user, user), _dstTNative(), '', '');
    train.redeemUser(h1, s1);
    vm.stopBroadcast();
    console.log('[1] native userLock -> redeemUser OK');
    _logNative(h1);

    // 2) solverLock (ETH amount + ETH reward) -> redeemSolver (before rewardTimelock => reward -> user)
    uint256 s2 = _secret('native-solver');
    bytes32 h2 = _hashlock(s2);
    vm.startBroadcast(userPk);
    uint256 idx = train.solverLock{ value: NATIVE_AMOUNT + NATIVE_REWARD }(_solverParamsTNative(h2, 3600), _dstTNative(), '');
    train.redeemSolver(h2, idx, s2);
    vm.stopBroadcast();
    console.log('[2] native solverLock -> redeemSolver OK, index:', idx);
  }
}
