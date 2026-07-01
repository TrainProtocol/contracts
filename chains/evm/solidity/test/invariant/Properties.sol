// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Snapshots} from "./Snapshots.sol";
import {PropertiesAsserts} from "./utils/PropertiesAsserts.sol";
import {Train} from "../../src/Train.sol";

/// @notice Invariants for the Train HTLC escrow. See PROPERTIES.md for the spec, IDs and guarantees.
/// @dev Global properties are `public`, take no arguments and mutate no state, so the fuzzer calls
///      them after every step. Specific (per-transition) properties are `internal` and are invoked
///      at the end of the relevant handler on the success branch, with the pre-call balances passed
///      in as arguments.
abstract contract Properties is PropertiesAsserts, Snapshots {
    // ─────────────────────────── Global properties ───────────────────────────

    /// @notice [SOLV] Escrow solvency (exact). Train's token balance equals the sum of every Pending
    ///         lock's outstanding obligation (user: `amount`; solver: `amount + reward`, both in the
    ///         single harness token). Funds enter only via locks and leave only via redeem/refund, so
    ///         in this single-token, fee-free harness the identity is exact. A `>` would flag stuck
    ///         dust; a `<` flags a drain or a terminal→Pending regression. Covers CON-01/03, RT-09,
    ///         SPEC-01, ADV-01/02.
    function property_escrowSolvency() public {
        uint256 obligations;
        for (uint256 i; i < userHashlocks.length; i++) {
            Train.UserLock memory l = train.getUserLock(userHashlocks[i]);
            if (l.status == Train.LockStatus.Pending) obligations += l.amount;
        }
        for (uint256 i; i < solverRefs.length; i++) {
            Train.SolverLock memory l = train.getSolverLock(solverRefs[i].hashlock, solverRefs[i].index);
            if (l.status == Train.LockStatus.Pending) obligations += l.amount + l.reward;
        }
        eq(token.balanceOf(address(train)), obligations, "SOLV: train balance != sum of pending obligations");
    }

    /// @notice [CONS] Global token conservation. The protocol mints/burns nothing: every unit of the
    ///         token lives with an actor, a payee, or the escrow. Covers CON-02/06, SPEC-08/15, ADV-03.
    function property_tokenConservation() public {
        eq(sumSystemTokenBalance(), token.totalSupply(), "CONS: system token balance != totalSupply");
    }

    /// @notice [UWF] Every created user lock is well-formed and its immutable fields never drift.
    ///         The secret biconditional plus SOLV give terminal-state finality. Covers ST-05/07/09/11/13,
    ///         VS-01/03/05/07/13-style checks, SPEC-03/11/13.
    function property_userLocksWellFormed() public {
        for (uint256 i; i < userHashlocks.length; i++) {
            bytes32 hl = userHashlocks[i];
            Train.UserLock memory l = train.getUserLock(hl);
            t(l.status != Train.LockStatus.Empty, "UWF: created user lock has Empty status");
            t(l.sender != address(0), "UWF: zero sender (phantom lock)");
            t(l.recipient == recipientAddr, "UWF: recipient drifted from creation value");
            t(l.refundTo == refundAddr, "UWF: refundTo drifted from creation value");
            t(l.token == address(token), "UWF: token drifted from creation value");
            gt(l.amount, 0, "UWF: zero amount");
            t(l.timelock > l.startTime, "UWF: timelock <= startTime");
            if (l.status == Train.LockStatus.Redeemed) {
                t(hl == sha256(abi.encodePacked(l.secret)), "UWF: redeemed secret does not hash to hashlock");
            } else {
                eq(l.secret, 0, "UWF: non-redeemed lock has a non-zero secret");
            }
        }
    }

    /// @notice [SWF] Every created solver lock is well-formed and its immutable fields never drift,
    ///         including the reward-window ordering. Covers ST-06/08/10/12, VS-02/04/06/08, VT-03,
    ///         SPEC-09, secret invariants.
    function property_solverLocksWellFormed() public {
        for (uint256 i; i < solverRefs.length; i++) {
            bytes32 hl = solverRefs[i].hashlock;
            Train.SolverLock memory l = train.getSolverLock(hl, solverRefs[i].index);
            t(l.status != Train.LockStatus.Empty, "SWF: created solver lock has Empty status");
            t(l.sender != address(0), "SWF: zero sender (phantom lock)");
            t(l.recipient == recipientAddr, "SWF: recipient drifted from creation value");
            t(l.refundTo == refundAddr, "SWF: refundTo drifted from creation value");
            t(l.token == address(token), "SWF: token drifted from creation value");
            t(l.rewardToken == address(token), "SWF: rewardToken drifted from creation value");
            gt(l.amount, 0, "SWF: zero amount");
            t(l.timelock > l.startTime, "SWF: timelock <= startTime");
            if (l.reward > 0) {
                t(l.rewardRecipient == rewardAddr, "SWF: rewardRecipient drifted from creation value");
                t(l.rewardTimelock < l.timelock, "SWF: rewardTimelock >= timelock");
            }
            if (l.status == Train.LockStatus.Redeemed) {
                t(hl == sha256(abi.encodePacked(l.secret)), "SWF: redeemed secret does not hash to hashlock");
            } else {
                eq(l.secret, 0, "SWF: non-redeemed lock has a non-zero secret");
            }
        }
    }

    /// @notice [ENUM] The paginated enumeration getter stays callable at any size and stays
    ///         consistent with the harness registry. Regression guard for audit finding #1 (the
    ///         scale-safe getters) and ADV-18. Every user lock is owned by exactly one actor
    ///         (userLock: caller; userLockFor: the `user`), so the per-owner totals must sum to the
    ///         full registry count.
    function property_enumerationScaleSafe() public {
        uint256 sumTotals;
        for (uint256 a; a < actors.length; a++) {
            (, uint256 total) = train.getUserLockHashes(actors[a], 0, 0);
            (bytes32[] memory page, uint256 total2) = train.getUserLockHashes(actors[a], 0, total);
            eq(total, total2, "ENUM: total varied between calls");
            eq(page.length, total, "ENUM: full page length != reported total");
            sumTotals += total;
        }
        eq(sumTotals, userHashlocks.length, "ENUM: per-owner totals != registry count");
    }

    /// @notice [SCNT] Every registered solver-lock index lies within the on-chain monotonic count for
    ///         its hashlock (1-based, post-increment). Covers VT-01/02/03, VS-13.
    function property_solverIndicesInRange() public {
        for (uint256 i; i < solverRefs.length; i++) {
            uint256 count = train.getSolverLockCount(solverRefs[i].hashlock);
            t(solverRefs[i].index >= 1 && solverRefs[i].index <= count, "SCNT: solver index out of [1, count]");
        }
    }

    // ───────────────────── Specific (per-transition) properties ─────────────────────
    // Called at the end of the relevant handler on the success branch. The redeemer/refunder is
    // always an actor and therefore disjoint from the three payees, so each delta is unambiguous.

    /// @notice [ULC] A fresh user lock is Pending and stores the measured amount (== requested, since
    ///         the mock has no transfer fee). Covers ST-05, RD-04.
    function _propUserLockCreated(bytes32 hl, uint256 reqAmount) internal {
        Train.UserLock memory l = train.getUserLock(hl);
        eq(uint256(l.status), uint256(Train.LockStatus.Pending), "ULC: new user lock not Pending");
        eq(l.amount, reqAmount, "ULC: stored amount != requested (unexpected fee-on-transfer)");
    }

    /// @notice [SLC] A fresh solver lock is Pending and the same-token proportional split is exact:
    ///         stored amount/reward match the request and sum to the total pulled in. Covers ST-06,
    ///         RT-06/07.
    function _propSolverLockCreated(bytes32 hl, uint256 idx, uint256 reqAmount, uint256 reqReward) internal {
        Train.SolverLock memory l = train.getSolverLock(hl, idx);
        eq(uint256(l.status), uint256(Train.LockStatus.Pending), "SLC: new solver lock not Pending");
        eq(l.amount, reqAmount, "SLC: stored amount != requested");
        eq(l.reward, reqReward, "SLC: stored reward != requested");
        eq(l.amount + l.reward, reqAmount + reqReward, "SLC: amount+reward != total requested (lossy split)");
    }

    /// @notice [URD] redeemUser (no payout curve) pays exactly `amount` to the recipient, nothing to
    ///         refundTo, and nothing to the redeemer. Covers RT-01, RD-02, SPEC-06, ADV-07/14.
    function _propUserRedeemed(
        uint256 recipBefore,
        uint256 refundBefore,
        uint256 callerBefore,
        address caller,
        uint256 amount,
        address curveAddr
    ) internal {
        uint256 recv = token.balanceOf(recipientAddr) - recipBefore;
        uint256 refd = token.balanceOf(refundAddr) - refundBefore;
        eq(recv + refd, amount, "URD: payout + excess != amount");
        if (curveAddr == address(0)) {
            eq(recv, amount, "URD: recipient payout != amount (no curve)");
            eq(refd, 0, "URD: unexpected excess to refundTo (no curve)");
        } else {
            gt(recv, 0, "URD: payout must be > 0");
            lte(recv, amount, "URD: payout must be <= amount");
        }
        eq(token.balanceOf(caller) - callerBefore, 0, "URD: redeemer received the payout");
    }

    /// @notice [URF] refundUser returns exactly `amount` to refundTo and nothing to the caller.
    ///         Covers RT-03, ADV-08.
    function _propUserRefunded(uint256 refundBefore, uint256 callerBefore, address caller, uint256 amount)
        internal
    {
        eq(token.balanceOf(refundAddr) - refundBefore, amount, "URF: refund != amount");
        eq(token.balanceOf(caller) - callerBefore, 0, "URF: refunder received the funds");
    }

    /// @notice [SRD] redeemSolver (no payout curve) pays exactly `amount` to the recipient and routes
    ///         the reward by the rewardTimelock rule: to rewardRecipient before it, to the redeemer at
    ///         or after it — never to the wrong party. Covers RT-02/05, RD-03, SPEC-07, ADV-09/10.
    function _propSolverRedeemed(
        uint256 recipBefore,
        uint256 refundBefore,
        uint256 rewardBefore,
        uint256 callerBefore,
        address caller,
        uint256 amount,
        uint256 reward,
        uint256 rewardTimelock,
        uint256 ts,
        address curveAddr
    ) internal {
        uint256 recv = token.balanceOf(recipientAddr) - recipBefore;
        uint256 refd = token.balanceOf(refundAddr) - refundBefore;
        eq(recv + refd, amount, "SRD: payout + excess != amount");
        if (curveAddr == address(0)) {
            eq(recv, amount, "SRD: recipient payout != amount (no curve)");
            eq(refd, 0, "SRD: unexpected excess to refundTo (no curve)");
        } else {
            gt(recv, 0, "SRD: payout must be > 0");
            lte(recv, amount, "SRD: payout must be <= amount");
        }
        if (reward > 0) {
            if (rewardTimelock > ts) {
                eq(token.balanceOf(rewardAddr) - rewardBefore, reward, "SRD: reward not routed to rewardRecipient pre-timelock");
                eq(token.balanceOf(caller) - callerBefore, 0, "SRD: redeemer captured reward pre-timelock");
            } else {
                eq(token.balanceOf(caller) - callerBefore, reward, "SRD: reward not routed to redeemer post-timelock");
                eq(token.balanceOf(rewardAddr) - rewardBefore, 0, "SRD: reward leaked to rewardRecipient post-timelock");
            }
        }
    }

    /// @notice [SRF] refundSolver returns exactly `amount + reward` to refundTo (same token, single
    ///         consolidated transfer) and nothing to the caller. Covers RT-04, ADV-13.
    function _propSolverRefunded(
        uint256 refundBefore,
        uint256 callerBefore,
        address caller,
        uint256 amount,
        uint256 reward
    ) internal {
        eq(token.balanceOf(refundAddr) - refundBefore, amount + reward, "SRF: refund != amount + reward");
        eq(token.balanceOf(caller) - callerBefore, 0, "SRF: refunder received the funds");
    }
}
