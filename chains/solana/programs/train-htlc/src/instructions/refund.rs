use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::errors::TrainError;
use crate::events::{SolverRefunded, UserRefunded};
use crate::state::*;
use crate::utils;

// INVARIANT (refund): always returns the FULL measured amount (plus reward for
// solver locks) to the stored refund_to — never decayed by the payout curve, never
// to the caller. User refunds: the lock's recipient may refund anytime; anyone else
// only after the timelock. Solver refunds: anyone, only after the timelock.
// Rent always returns to rent_payer, never to refund_to (sponsored flows must not
// leak the relayer's rent to the user).

// ── RefundUser: native SOL ──────────────────────────────────────────────────────

pub fn refund_user_sol(ctx: Context<RefundUserSol>, hashlock: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let lock = &mut ctx.accounts.user_lock;

    let is_recipient = ctx.accounts.caller.key() == lock.recipient;
    if !is_recipient {
        require!(now >= lock.timelock, TrainError::TimelockNotExpired);
    }

    lock.status = STATUS_REFUNDED;
    let amount = lock.amount;
    let refund_to = lock.refund_to;

    ctx.accounts.user_lock.sub_lamports(amount)?;
    ctx.accounts.refund_to.add_lamports(amount)?;

    emit!(UserRefunded {
        hashlock,
        refund_to,
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32])]
pub struct RefundUserSol<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_lock", hashlock.as_ref()],
        bump,
        constraint = user_lock.status == STATUS_PENDING @ TrainError::NotPending,
        // Guard against refunding a token lock through the SOL path (permissionless
        // after timelock), which would strand the token vault. SOL locks store
        // token_mint == default.
        constraint = user_lock.token_mint == Pubkey::default() @ TrainError::WrongToken,
        close = rent_payer,
    )]
    pub user_lock: Account<'info, UserLock>,

    /// CHECK: rent destination, verified via user_lock.rent_payer
    #[account(
        mut,
        constraint = rent_payer.key() == user_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: verified via user_lock.refund_to
    #[account(
        mut,
        constraint = refund_to.key() == user_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ── RefundUser: SPL / Token-2022 token ──────────────────────────────────────────

pub fn refund_user_token(ctx: Context<RefundUserToken>, hashlock: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let lock = &mut ctx.accounts.user_lock;

    let is_recipient = ctx.accounts.caller.key() == lock.recipient;
    if !is_recipient {
        require!(now >= lock.timelock, TrainError::TimelockNotExpired);
    }

    lock.status = STATUS_REFUNDED;
    let amount = lock.amount;
    let refund_to = lock.refund_to;
    let bump = ctx.bumps.user_lock;
    let signer_seeds: &[&[&[u8]]] = &[&[b"user_lock", hashlock.as_ref(), &[bump]]];

    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.refund_to_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.user_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.user_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(UserRefunded {
        hashlock,
        refund_to,
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32])]
pub struct RefundUserToken<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_lock", hashlock.as_ref()],
        bump,
        constraint = user_lock.status == STATUS_PENDING @ TrainError::NotPending,
        close = rent_payer,
    )]
    pub user_lock: Account<'info, UserLock>,

    /// CHECK: rent destination, verified via user_lock.rent_payer
    #[account(
        mut,
        constraint = rent_payer.key() == user_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: verified via user_lock.refund_to
    #[account(
        constraint = refund_to.key() == user_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == user_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"user_vault", hashlock.as_ref()],
        bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RefundSolver: native SOL ────────────────────────────────────────────────────

pub fn refund_solver_sol(
    ctx: Context<RefundSolverSol>,
    hashlock: [u8; 32],
    solver: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let lock = &mut ctx.accounts.solver_lock;

    require!(now >= lock.timelock, TrainError::TimelockNotExpired);

    lock.status = STATUS_REFUNDED;
    let amount = lock.amount;
    let reward = lock.reward;
    let refund_to = lock.refund_to;
    let total = amount.checked_add(reward).ok_or(TrainError::Overflow)?;

    ctx.accounts.solver_lock.sub_lamports(total)?;
    ctx.accounts.refund_to.add_lamports(total)?;

    emit!(SolverRefunded {
        hashlock,
        solver,
        refund_to,
        amount,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RefundSolverSol<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), solver.as_ref()],
        bump,
        constraint = solver_lock.sender == solver @ TrainError::WrongSender,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
        // Guard against refunding a token solver lock through the SOL path, which
        // would strand its vault(s). SOL locks store token_mint == default.
        constraint = solver_lock.token_mint == Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward_token_mint == Pubkey::default() @ TrainError::WrongToken,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.refund_to
    #[account(
        mut,
        constraint = refund_to.key() == solver_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ── RefundSolver: native SOL amount + SPL token reward ─────────────────────────

pub fn refund_solver_sol_token_reward(
    ctx: Context<RefundSolverSolTokenReward>,
    hashlock: [u8; 32],
    solver: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let lock = &mut ctx.accounts.solver_lock;
    require!(now >= lock.timelock, TrainError::TimelockNotExpired);

    lock.status = STATUS_REFUNDED;
    let amount = lock.amount;
    let reward = lock.reward;
    let refund_to = lock.refund_to;

    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];
    utils::transfer_from_vault(
        ctx.accounts.reward_vault.to_account_info(),
        ctx.accounts
            .refund_to_reward_token_account
            .to_account_info(),
        ctx.accounts.reward_token_mint.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        reward,
        ctx.accounts.reward_token_mint.decimals,
    )?;
    utils::close_vault_if_empty(
        &mut ctx.accounts.reward_vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    // Keep token CPIs balanced before settling the native principal leg.
    ctx.accounts.solver_lock.sub_lamports(amount)?;
    ctx.accounts.refund_to.add_lamports(amount)?;

    emit!(SolverRefunded {
        hashlock,
        solver,
        refund_to,
        amount,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RefundSolverSolTokenReward<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), solver.as_ref()],
        bump,
        constraint = solver_lock.sender == solver @ TrainError::WrongSender,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
        constraint = solver_lock.token_mint == Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward_token_mint != Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward > 0 @ TrainError::ZeroAmount,
    )]
    pub solver_lock: Box<Account<'info, SolverLock>>,

    /// CHECK: receives vault rent, checked against the stored payer.
    #[account(
        mut,
        constraint = rent_payer.key() == solver_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: receives both refund legs.
    #[account(
        mut,
        constraint = refund_to.key() == solver_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    #[account(
        constraint = reward_token_mint.key() == solver_lock.reward_token_mint @ TrainError::WrongToken,
    )]
    pub reward_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"solver_reward_vault", hashlock.as_ref(), solver.as_ref()],
        bump,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_reward_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RefundSolver: SPL token (single vault) ──────────────────────────────────────

pub fn refund_solver_token(
    ctx: Context<RefundSolverToken>,
    hashlock: [u8; 32],
    solver: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let lock = &mut ctx.accounts.solver_lock;

    require!(now >= lock.timelock, TrainError::TimelockNotExpired);

    lock.status = STATUS_REFUNDED;
    let amount = lock.amount;
    let reward = lock.reward;
    let refund_to = lock.refund_to;
    let total = amount.checked_add(reward).ok_or(TrainError::Overflow)?;
    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];

    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.refund_to_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        total,
        ctx.accounts.token_mint.decimals,
    )?;

    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(SolverRefunded {
        hashlock,
        solver,
        refund_to,
        amount,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RefundSolverToken<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), solver.as_ref()],
        bump,
        constraint = solver_lock.sender == solver @ TrainError::WrongSender,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
        constraint = solver_lock.reward_token_mint == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: rent destination for the emptied vault, verified via
    /// solver_lock.rent_payer
    #[account(
        mut,
        constraint = rent_payer.key() == solver_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.refund_to
    #[account(
        constraint = refund_to.key() == solver_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"solver_vault", hashlock.as_ref(), solver.as_ref()],
        bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RefundSolver: SPL token amount + native SOL reward ─────────────────────────

pub fn refund_solver_token_sol_reward(
    ctx: Context<RefundSolverTokenSolReward>,
    hashlock: [u8; 32],
    solver: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let lock = &mut ctx.accounts.solver_lock;
    require!(now >= lock.timelock, TrainError::TimelockNotExpired);

    lock.status = STATUS_REFUNDED;
    let amount = lock.amount;
    let reward = lock.reward;
    let refund_to = lock.refund_to;
    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];

    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.refund_to_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        amount,
        ctx.accounts.token_mint.decimals,
    )?;
    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    ctx.accounts.solver_lock.sub_lamports(reward)?;
    ctx.accounts.refund_to.add_lamports(reward)?;

    emit!(SolverRefunded {
        hashlock,
        solver,
        refund_to,
        amount,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RefundSolverTokenSolReward<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), solver.as_ref()],
        bump,
        constraint = solver_lock.sender == solver @ TrainError::WrongSender,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
        constraint = solver_lock.token_mint != Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward_token_mint == Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward > 0 @ TrainError::ZeroAmount,
    )]
    pub solver_lock: Box<Account<'info, SolverLock>>,

    /// CHECK: receives vault rent, checked against the stored payer.
    #[account(
        mut,
        constraint = rent_payer.key() == solver_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: receives both refund legs.
    #[account(
        mut,
        constraint = refund_to.key() == solver_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"solver_vault", hashlock.as_ref(), solver.as_ref()],
        bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RefundSolver: SPL token, different reward token (two vaults) ────────────────

pub fn refund_solver_token_diff_reward(
    ctx: Context<RefundSolverTokenDiffReward>,
    hashlock: [u8; 32],
    solver: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let lock = &mut ctx.accounts.solver_lock;

    require!(now >= lock.timelock, TrainError::TimelockNotExpired);

    lock.status = STATUS_REFUNDED;
    let amount = lock.amount;
    let reward = lock.reward;
    let refund_to = lock.refund_to;
    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];

    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.refund_to_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        amount,
        ctx.accounts.token_mint.decimals,
    )?;
    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    if reward > 0 {
        utils::transfer_from_vault(
            ctx.accounts.reward_vault.to_account_info(),
            ctx.accounts
                .refund_to_reward_token_account
                .to_account_info(),
            ctx.accounts.reward_token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            reward,
            ctx.accounts.reward_token_mint.decimals,
        )?;
    }
    utils::close_vault_if_empty(
        &mut ctx.accounts.reward_vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(SolverRefunded {
        hashlock,
        solver,
        refund_to,
        amount,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RefundSolverTokenDiffReward<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), solver.as_ref()],
        bump,
        constraint = solver_lock.sender == solver @ TrainError::WrongSender,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
        constraint = solver_lock.token_mint != Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward_token_mint != Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward_token_mint != solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub solver_lock: Box<Account<'info, SolverLock>>,

    /// CHECK: rent destination for emptied vaults, verified via
    /// solver_lock.rent_payer
    #[account(
        mut,
        constraint = rent_payer.key() == solver_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.refund_to
    #[account(
        constraint = refund_to.key() == solver_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = reward_token_mint.key() == solver_lock.reward_token_mint @ TrainError::WrongToken,
    )]
    pub reward_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"solver_vault", hashlock.as_ref(), solver.as_ref()],
        bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"solver_reward_vault", hashlock.as_ref(), solver.as_ref()],
        bump,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_reward_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
