// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';
import { Train } from '../../src/Train.sol';

/// @notice Direct (non-gasless) Train flows on Sepolia: userLock->redeemUser,
///         solverLock->redeemSolver, userLockFor->redeemUser. Broadcast as the user.
///         Funds cycle back (recipient = refundTo = user), so net USDC ~ 0.
/// @dev forge script script/sepolia/TestDirect.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract TestDirect is SepoliaConfig {
  function run() external {
    _load();

    // 1) userLock -> redeemUser
    uint256 s1 = _secret('direct-user');
    bytes32 h1 = _hashlock(s1);
    vm.startBroadcast(userPk);
    train.userLock(_userParamsT(h1, AMOUNT, 3600, user, user), _dstT(), '', '');
    train.redeemUser(h1, s1);
    vm.stopBroadcast();
    console.log('[1] userLock -> redeemUser OK');
    _logLock(h1);

    // 2) solverLock -> redeemSolver (redeemed before rewardTimelock => reward -> rewardRecipient=user)
    uint256 s2 = _secret('direct-solver');
    bytes32 h2 = _hashlock(s2);
    vm.startBroadcast(userPk);
    uint256 idx = train.solverLock(_solverParamsT(h2, 3600), _dstT(), '');
    train.redeemSolver(h2, idx, s2);
    vm.stopBroadcast();
    console.log('[2] solverLock -> redeemSolver OK, index:', idx);

    // 3) userLockFor (attributed to a beneficiary != caller) -> redeemUser
    uint256 s3 = _secret('direct-userfor');
    bytes32 h3 = _hashlock(s3);
    address beneficiary = address(uint160(uint256(keccak256('train.sepolia.beneficiary'))));
    vm.startBroadcast(userPk);
    train.userLockFor(beneficiary, _userParamsT(h3, AMOUNT, 3600, user, user), _dstT(), '', '');
    train.redeemUser(h3, s3);
    vm.stopBroadcast();
    console.log('[3] userLockFor -> redeemUser OK (lock.sender should equal beneficiary):');
    console.log('    beneficiary:', beneficiary);
    _logLock(h3);
  }
}
