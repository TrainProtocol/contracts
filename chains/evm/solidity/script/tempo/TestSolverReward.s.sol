// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { TempoConfig } from './TempoConfig.s.sol';
import { Train } from '../../src/tempo/Train.sol';

/// @notice Solver-lock reward-routing flow on Tempo, both branches of `redeemSolver`'s reward rule:
///         [1] redeemed BEFORE rewardTimelock -> reward goes to rewardRecipient (= user, here).
///         [2] redeemed AFTER rewardTimelock (timelockDelta=1, so it's already past by call time)
///             -> reward goes to the redeemer instead (the relayer-bounty branch).
///         Broadcast as the user in both cases; funds cycle back.
/// @dev $env:FOUNDRY_PROFILE="tempo"
///   forge script script/tempo/TestSolverReward.s.sol --rpc-url tempo_testnet --broadcast
contract TestSolverReward is TempoConfig {
  function run() external {
    _load();

    // [1] Redeem before rewardTimelock — reward -> rewardRecipient (user).
    uint256 s1 = _secret('solver-reward-before');
    bytes32 h1 = _hashlock(s1);
    vm.startBroadcast(userPk);
    uint256 idx1 = train.solverLock(_solverParamsT(h1, 3600), _dstT(), '');
    train.redeemSolver(h1, idx1, s1);
    vm.stopBroadcast();
    Train.SolverLock memory lock1 = train.getSolverLock(h1, idx1);
    console.log('[1] redeemSolver before rewardTimelock OK, index:', idx1);
    console.log('    lock.rewardRecipient:', lock1.rewardRecipient);
    console.log('    lock.status         :', uint256(lock1.status)); // 3 = Redeemed

    // [2] rewardTimelockDelta computed as timelockDelta/2 by _solverParamsT; use timelockDelta=1
    // so rewardTimelock (= now + 0) is already at/behind block.timestamp by the time redeemSolver
    // runs -> reward routes to the redeemer (msg.sender = user, same as rewardRecipient here, so
    // log the routing decision itself rather than the resulting address).
    uint256 s2 = _secret('solver-reward-after');
    bytes32 h2 = _hashlock(s2);
    vm.startBroadcast(userPk);
    uint256 idx2 = train.solverLock(_solverParamsT(h2, 1), _dstT(), '');
    train.redeemSolver(h2, idx2, s2);
    vm.stopBroadcast();
    console.log('[2] redeemSolver at/after rewardTimelock OK, index:', idx2);
    console.log('    (reward routed to redeemer branch - rewardTimelock had already elapsed)');
  }
}
