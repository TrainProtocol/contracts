use anchor_lang::prelude::*;

use crate::errors::TrainError;
use crate::state::*;

// Reclaim rent from a settled SolverLock. The counter PDA is never closed, so the
// index can never be re-initialized (creation requires index == count + 1).

pub fn close_solver_lock(
    _ctx: Context<CloseSolverLock>,
    _hashlock: [u8; 32],
    _index: u64,
) -> Result<()> {
    // Account is closed via the `close = rent_payer` constraint
    Ok(())
}

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32], _index: u64)]
pub struct CloseSolverLock<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", _hashlock.as_ref(), &_index.to_le_bytes()],
        bump,
        constraint = solver_lock.status != STATUS_PENDING @ TrainError::StillPending,
        constraint = caller.key() == solver_lock.sender
            || caller.key() == solver_lock.rent_payer @ TrainError::WrongSender,
        close = rent_payer,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: rent destination, verified via solver_lock.rent_payer
    #[account(
        mut,
        constraint = rent_payer.key() == solver_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,
}
