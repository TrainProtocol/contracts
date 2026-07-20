use anchor_lang::prelude::*;

use crate::state::*;

pub fn get_user_lock(ctx: Context<GetUserLock>, _hashlock: [u8; 32]) -> Result<UserLockData> {
    let lock = &ctx.accounts.user_lock;
    Ok(UserLockData {
        secret: lock.secret,
        amount: lock.amount,
        sender: lock.sender,
        timelock: lock.timelock,
        start_time: lock.start_time,
        status: lock.status,
        recipient: lock.recipient,
        refund_to: lock.refund_to,
        token_mint: lock.token_mint,
        rent_payer: lock.rent_payer,
        payout_curve: lock.payout_curve,
        payout_curve_data: lock.payout_curve_data.clone(),
    })
}

pub fn get_solver_lock(
    ctx: Context<GetSolverLock>,
    _hashlock: [u8; 32],
    _index: u64,
) -> Result<SolverLockData> {
    let lock = &ctx.accounts.solver_lock;
    Ok(SolverLockData {
        secret: lock.secret,
        amount: lock.amount,
        reward: lock.reward,
        sender: lock.sender,
        timelock: lock.timelock,
        reward_timelock: lock.reward_timelock,
        start_time: lock.start_time,
        recipient: lock.recipient,
        status: lock.status,
        reward_recipient: lock.reward_recipient,
        refund_to: lock.refund_to,
        token_mint: lock.token_mint,
        reward_token_mint: lock.reward_token_mint,
        rent_payer: lock.rent_payer,
        payout_curve: lock.payout_curve,
        payout_curve_data: lock.payout_curve_data.clone(),
    })
}

pub fn get_solver_lock_count(ctx: Context<GetSolverLockCount>, _hashlock: [u8; 32]) -> Result<u64> {
    Ok(ctx.accounts.counter.count)
}

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32])]
pub struct GetUserLock<'info> {
    #[account(
        seeds = [b"user_lock", _hashlock.as_ref()],
        bump,
    )]
    pub user_lock: Account<'info, UserLock>,
}

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32], _index: u64)]
pub struct GetSolverLock<'info> {
    #[account(
        seeds = [b"solver_lock", _hashlock.as_ref(), &_index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Account<'info, SolverLock>,
}

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32])]
pub struct GetSolverLockCount<'info> {
    #[account(
        seeds = [b"solver_count", _hashlock.as_ref()],
        bump,
    )]
    pub counter: Account<'info, SolverLockCounter>,
}
