#![allow(unexpected_cfgs, deprecated)]
//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

// Train Protocol HTLC — hash time-locked escrow for cross-chain atomic swaps.
//
// Protocol invariants:
// - Escrow solvency: each lock's vault (or lamport balance) holds exactly the
//   measured amount (+ reward) while Pending.
// - Status machine: Empty -> Pending -> {Refunded | Redeemed}; terminal states
//   final; settlement exactly once.
// - Redeem authorization is knowledge of the secret: sha256(secret) == hashlock;
//   payout always to the stored recipient, excess to the stored refund_to.
// - Refunds always return the full amount (+ reward) to refund_to, never decayed.
// - Solver reward routes to reward_recipient before reward_timelock, else to the
//   redeem caller (relayer bounty).
// - Payout curves: 0 < payout <= amount, invoked via a CPI with no accounts and no
//   signers so the curve can touch no state; curves never touch rewards or refunds.
// - Gasless intents are single-use (ConsumedIntent PDA), deadline-bound, and bind
//   every lock parameter via call_hash; an untrusted relayer can only execute the
//   exact lock the user signed.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod intent;
pub mod state;
pub mod utils;

use instructions::*;
use state::{SolverLockData, SolverLockParams, UserLockData, UserLockParams};

declare_id!("2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ");

#[program]
pub mod train_htlc {
    use super::*;

    // ── Locks ────────────────────────────────────────────────────────────────

    pub fn user_lock_sol(
        ctx: Context<UserLockSol>,
        params: UserLockParams,
        user_data: Vec<u8>,
        solver_data: Vec<u8>,
    ) -> Result<()> {
        instructions::user_lock_sol(ctx, params, user_data, solver_data)
    }

    pub fn user_lock_token(
        ctx: Context<UserLockToken>,
        params: UserLockParams,
        user_data: Vec<u8>,
        solver_data: Vec<u8>,
    ) -> Result<()> {
        instructions::user_lock_token(ctx, params, user_data, solver_data)
    }

    pub fn solver_lock_sol(
        ctx: Context<SolverLockSol>,
        params: SolverLockParams,
        data: Vec<u8>,
    ) -> Result<()> {
        instructions::solver_lock_sol(ctx, params, data)
    }

    pub fn solver_lock_token(
        ctx: Context<SolverLockToken>,
        params: SolverLockParams,
        data: Vec<u8>,
    ) -> Result<()> {
        instructions::solver_lock_token(ctx, params, data)
    }

    pub fn solver_lock_token_diff_reward(
        ctx: Context<SolverLockTokenDiffReward>,
        params: SolverLockParams,
        data: Vec<u8>,
    ) -> Result<()> {
        instructions::solver_lock_token_diff_reward(ctx, params, data)
    }

    // ── Gasless intent path ──────────────────────────────────────────────────

    pub fn initialize_intent_domain(
        ctx: Context<InitializeIntentDomain>,
        salt: [u8; 32],
    ) -> Result<()> {
        instructions::initialize_intent_domain(ctx, salt)
    }

    pub fn user_lock_token_with_intent(
        ctx: Context<UserLockTokenWithIntent>,
        params: UserLockParams,
        user_data: Vec<u8>,
        solver_data: Vec<u8>,
        nonce: u64,
        deadline: u64,
    ) -> Result<()> {
        instructions::user_lock_token_with_intent(ctx, params, user_data, solver_data, nonce, deadline)
    }

    pub fn close_consumed_intent(ctx: Context<CloseConsumedIntent>) -> Result<()> {
        instructions::close_consumed_intent(ctx)
    }

    // ── Redeems ──────────────────────────────────────────────────────────────

    pub fn redeem_user_sol(
        ctx: Context<RedeemUserSol>,
        hashlock: [u8; 32],
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::redeem_user_sol(ctx, hashlock, secret)
    }

    pub fn redeem_user_token(
        ctx: Context<RedeemUserToken>,
        hashlock: [u8; 32],
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::redeem_user_token(ctx, hashlock, secret)
    }

    pub fn redeem_solver_sol(
        ctx: Context<RedeemSolverSol>,
        hashlock: [u8; 32],
        index: u64,
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::redeem_solver_sol(ctx, hashlock, index, secret)
    }

    pub fn redeem_solver_token(
        ctx: Context<RedeemSolverToken>,
        hashlock: [u8; 32],
        index: u64,
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::redeem_solver_token(ctx, hashlock, index, secret)
    }

    pub fn redeem_solver_token_diff_reward(
        ctx: Context<RedeemSolverTokenDiffReward>,
        hashlock: [u8; 32],
        index: u64,
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::redeem_solver_token_diff_reward(ctx, hashlock, index, secret)
    }

    // ── Refunds ──────────────────────────────────────────────────────────────

    pub fn refund_user_sol(ctx: Context<RefundUserSol>, hashlock: [u8; 32]) -> Result<()> {
        instructions::refund_user_sol(ctx, hashlock)
    }

    pub fn refund_user_token(ctx: Context<RefundUserToken>, hashlock: [u8; 32]) -> Result<()> {
        instructions::refund_user_token(ctx, hashlock)
    }

    pub fn refund_solver_sol(
        ctx: Context<RefundSolverSol>,
        hashlock: [u8; 32],
        index: u64,
    ) -> Result<()> {
        instructions::refund_solver_sol(ctx, hashlock, index)
    }

    pub fn refund_solver_token(
        ctx: Context<RefundSolverToken>,
        hashlock: [u8; 32],
        index: u64,
    ) -> Result<()> {
        instructions::refund_solver_token(ctx, hashlock, index)
    }

    pub fn refund_solver_token_diff_reward(
        ctx: Context<RefundSolverTokenDiffReward>,
        hashlock: [u8; 32],
        index: u64,
    ) -> Result<()> {
        instructions::refund_solver_token_diff_reward(ctx, hashlock, index)
    }

    // ── Rent reclamation ─────────────────────────────────────────────────────

    pub fn close_solver_lock(
        ctx: Context<CloseSolverLock>,
        hashlock: [u8; 32],
        index: u64,
    ) -> Result<()> {
        instructions::close_solver_lock(ctx, hashlock, index)
    }

    // ── Views ────────────────────────────────────────────────────────────────

    pub fn get_user_lock(ctx: Context<GetUserLock>, hashlock: [u8; 32]) -> Result<UserLockData> {
        instructions::get_user_lock(ctx, hashlock)
    }

    pub fn get_solver_lock(
        ctx: Context<GetSolverLock>,
        hashlock: [u8; 32],
        index: u64,
    ) -> Result<SolverLockData> {
        instructions::get_solver_lock(ctx, hashlock, index)
    }

    pub fn get_solver_lock_count(
        ctx: Context<GetSolverLockCount>,
        hashlock: [u8; 32],
    ) -> Result<u64> {
        instructions::get_solver_lock_count(ctx, hashlock)
    }
}
