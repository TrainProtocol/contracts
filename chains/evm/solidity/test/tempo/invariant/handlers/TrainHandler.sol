// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";
import {Train} from "../../../../src/tempo/Train.sol";

/// @notice Handles the interaction with Train.
/// @dev Ported from test/invariant/handlers/TrainHandler.sol, retargeted at src/tempo/Train.sol.
///      `handler_userLockFor` is dropped: `userLockFor` does not exist on Tempo's Train (it only ever
///      existed to let `TrainRouter` attribute a lock to a user other than the direct caller, and
///      `TrainRouter` is not deployed on Tempo at all — see src/tempo/Train.sol's contract-level dev
///      note). Every other handler drives plain `Train` (userLock/solverLock/redeem*/refund*), which
///      is unchanged, so they port with no logic changes.
///      Create handlers mint a fresh harness-owned secret and record the lock so redeem/refund
///      handlers can target real locks. Senders are actors; principal/refund/reward go to the three
///      dedicated payees (see Base.sol). On every successful settlement the matching specific
///      property checks exact per-address balance deltas.
abstract contract TrainHandler is Properties {
    uint48 internal constant MAX_TIMELOCK = 7 days;

    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    function handler_userLock(uint256 actorSeed, uint256 amountSeed, uint256 tldSeed) public {
        actor = actors[actorSeed % actors.length];
        uint256 bal = token.balanceOf(actor);
        if (bal == 0) return;
        uint256 amount = clampBetween(amountSeed, 1, bal);
        uint48 tld = uint48(clampBetween(tldSeed, 1, MAX_TIMELOCK));
        (uint256 s, bytes32 hl) = _freshLock();
        vm.prank(actor);
        try train.userLock(_userParams(hl, amount, tld), _dst(), "", "") {
            userHashlocks.push(hl);
            userSecretOf[hl] = s;
            _propUserLockCreated(hl, amount);
        } catch {}
    }

    function handler_solverLock(uint256 actorSeed, uint256 amountSeed, uint256 rewardSeed, uint256 tldSeed) public {
        actor = actors[actorSeed % actors.length];
        uint256 bal = token.balanceOf(actor);
        if (bal < 2) return;
        uint256 amount = clampBetween(amountSeed, 1, bal - 1);
        uint256 reward = clampBetween(rewardSeed, 0, bal - amount);
        uint48 tld = uint48(clampBetween(tldSeed, 2, MAX_TIMELOCK));
        (uint256 s, bytes32 hl) = _freshLock();
        vm.prank(actor);
        try train.solverLock(_solverParams(hl, amount, reward, tld), _dst(), "") returns (uint256 idx) {
            solverRefs.push(SolverRef(hl, idx, s));
            _propSolverLockCreated(hl, idx, amount, reward);
        } catch {}
    }

    /// @dev Creates a user lock backed by the decay curve, so redeem exercises the excess→refundTo split.
    function handler_userLockWithCurve(uint256 actorSeed, uint256 amountSeed, uint256 tldSeed) public {
        actor = actors[actorSeed % actors.length];
        uint256 bal = token.balanceOf(actor);
        if (bal < 2) return;
        uint256 amount = clampBetween(amountSeed, 2, bal); // >= 2 so amount/2 >= 1
        uint48 tld = uint48(clampBetween(tldSeed, 1, MAX_TIMELOCK));
        (uint256 s, bytes32 hl) = _freshLock();
        Train.UserLockParams memory p = _userParams(hl, amount, tld);
        p.payoutCurve = curve;
        vm.prank(actor);
        try train.userLock(p, _dst(), "", "") {
            userHashlocks.push(hl);
            userSecretOf[hl] = s;
            _propUserLockCreated(hl, amount);
        } catch {}
    }

    /// @dev Creates a solver lock backed by the decay curve (curve applies to the amount leg only).
    function handler_solverLockWithCurve(uint256 actorSeed, uint256 amountSeed, uint256 rewardSeed, uint256 tldSeed)
        public
    {
        actor = actors[actorSeed % actors.length];
        uint256 bal = token.balanceOf(actor);
        if (bal < 3) return;
        uint256 amount = clampBetween(amountSeed, 2, bal - 1); // >= 2 so amount/2 >= 1
        uint256 reward = clampBetween(rewardSeed, 0, bal - amount);
        uint48 tld = uint48(clampBetween(tldSeed, 2, MAX_TIMELOCK));
        (uint256 s, bytes32 hl) = _freshLock();
        Train.SolverLockParams memory p = _solverParams(hl, amount, reward, tld);
        p.payoutCurve = curve;
        vm.prank(actor);
        try train.solverLock(p, _dst(), "") returns (uint256 idx) {
            solverRefs.push(SolverRef(hl, idx, s));
            _propSolverLockCreated(hl, idx, amount, reward);
        } catch {}
    }

    function handler_redeemUser(uint256 pick, uint256 actorSeed) public {
        if (userHashlocks.length == 0) return;
        bytes32 hl = userHashlocks[pick % userHashlocks.length];
        Train.UserLock memory l = train.getUserLock(hl);
        if (l.status != Train.LockStatus.Pending) return;
        actor = actors[actorSeed % actors.length];
        uint256 recipBefore = token.balanceOf(recipientAddr);
        uint256 refundBefore = token.balanceOf(refundAddr);
        uint256 callerBefore = token.balanceOf(actor);
        vm.prank(actor);
        try train.redeemUser(hl, userSecretOf[hl]) {
            _propUserRedeemed(recipBefore, refundBefore, callerBefore, actor, l.amount, l.payoutCurve);
        } catch {}
    }

    function handler_redeemSolver(uint256 pick, uint256 actorSeed) public {
        if (solverRefs.length == 0) return;
        SolverRef storage ref = solverRefs[pick % solverRefs.length];
        Train.SolverLock memory l = train.getSolverLock(ref.hashlock, ref.index);
        if (l.status != Train.LockStatus.Pending) return;
        actor = actors[actorSeed % actors.length];
        uint256 recipBefore = token.balanceOf(recipientAddr);
        uint256 refundBefore = token.balanceOf(refundAddr);
        uint256 rewardBefore = token.balanceOf(rewardAddr);
        uint256 callerBefore = token.balanceOf(actor);
        uint256 ts = block.timestamp;
        vm.prank(actor);
        try train.redeemSolver(ref.hashlock, ref.index, ref.secret) {
            _propSolverRedeemed(
                recipBefore, refundBefore, rewardBefore, callerBefore, actor, l.amount, l.reward, l.rewardTimelock, ts, l.payoutCurve
            );
        } catch {}
    }

    function handler_refundUser(uint256 pick, uint256 actorSeed) public {
        if (userHashlocks.length == 0) return;
        bytes32 hl = userHashlocks[pick % userHashlocks.length];
        Train.UserLock memory l = train.getUserLock(hl);
        if (l.status != Train.LockStatus.Pending) return;
        if (block.timestamp <= l.timelock) skipTime(uint256(l.timelock) - block.timestamp + 1);
        actor = actors[actorSeed % actors.length];
        uint256 refundBefore = token.balanceOf(refundAddr);
        uint256 callerBefore = token.balanceOf(actor);
        vm.prank(actor);
        try train.refundUser(hl) {
            _propUserRefunded(refundBefore, callerBefore, actor, l.amount);
        } catch {}
    }

    /// @dev Exercises the recipient-can-refund-anytime authorization branch (no time skip): the lock
    ///      recipient triggers the refund, which still pays refundTo — never the recipient/caller.
    function handler_refundUserAsRecipient(uint256 pick) public {
        if (userHashlocks.length == 0) return;
        bytes32 hl = userHashlocks[pick % userHashlocks.length];
        Train.UserLock memory l = train.getUserLock(hl);
        if (l.status != Train.LockStatus.Pending) return;
        uint256 refundBefore = token.balanceOf(refundAddr);
        uint256 recipientBefore = token.balanceOf(recipientAddr);
        vm.prank(recipientAddr);
        try train.refundUser(hl) {
            eq(token.balanceOf(refundAddr) - refundBefore, l.amount, "URF-R: refund != amount");
            eq(token.balanceOf(recipientAddr) - recipientBefore, 0, "URF-R: recipient received the refund");
        } catch {}
    }

    function handler_refundSolver(uint256 pick, uint256 actorSeed) public {
        if (solverRefs.length == 0) return;
        SolverRef storage ref = solverRefs[pick % solverRefs.length];
        Train.SolverLock memory l = train.getSolverLock(ref.hashlock, ref.index);
        if (l.status != Train.LockStatus.Pending) return;
        if (block.timestamp <= l.timelock) skipTime(uint256(l.timelock) - block.timestamp + 1);
        actor = actors[actorSeed % actors.length];
        uint256 refundBefore = token.balanceOf(refundAddr);
        uint256 callerBefore = token.balanceOf(actor);
        vm.prank(actor);
        try train.refundSolver(ref.hashlock, ref.index) {
            _propSolverRefunded(refundBefore, callerBefore, actor, l.amount, l.reward);
        } catch {}
    }

    // Advance time so timelocks can expire (drives refund paths and time-dependent reward routing).
    function handler_skipTime(uint256 timeSeed) public {
        skipTime(clampBetween(timeSeed, 1, MAX_TIMELOCK));
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――
}
