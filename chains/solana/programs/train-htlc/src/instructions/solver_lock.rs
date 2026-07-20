use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::TrainError;
use crate::events::SolverLocked;
use crate::state::*;
use crate::utils;

/// Shared solver-lock parameter validation. Returns (timelock, reward_timelock),
/// both computed forward from `now`.
pub fn validate_solver_lock_params(params: &SolverLockParams, now: u64) -> Result<(u64, u64)> {
    require!(params.amount > 0, TrainError::ZeroAmount);
    require!(params.timelock_delta > 0, TrainError::ZeroTimelockDelta);
    require!(
        params.recipient != Pubkey::default() && params.refund_to != Pubkey::default(),
        TrainError::ZeroAddress
    );
    if params.reward > 0 {
        require!(
            params.reward_timelock_delta < params.timelock_delta,
            TrainError::RewardTimelockNotLessThanTimelock
        );
        require!(
            params.reward_recipient != Pubkey::default(),
            TrainError::ZeroAddress
        );
    }
    let timelock = now
        .checked_add(params.timelock_delta)
        .ok_or(TrainError::Overflow)?;
    let reward_timelock = now
        .checked_add(params.reward_timelock_delta)
        .ok_or(TrainError::Overflow)?;
    Ok((timelock, reward_timelock))
}

fn check_index(counter: &SolverLockCounter, index: u64) -> Result<()> {
    require!(
        index == counter.count.checked_add(1).ok_or(TrainError::Overflow)?,
        TrainError::InvalidIndex
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn store_solver_lock(
    lock: &mut SolverLock,
    params: &SolverLockParams,
    sender: Pubkey,
    rent_payer: Pubkey,
    token_mint: Pubkey,
    reward_token_mint: Pubkey,
    actual_amount: u64,
    actual_reward: u64,
    timelock: u64,
    reward_timelock: u64,
    now: u64,
) {
    lock.secret = [0u8; 32];
    lock.amount = actual_amount;
    lock.reward = actual_reward;
    lock.sender = sender;
    lock.timelock = timelock;
    lock.reward_timelock = reward_timelock;
    lock.start_time = now;
    lock.recipient = params.recipient;
    lock.status = STATUS_PENDING;
    lock.reward_recipient = params.reward_recipient;
    lock.refund_to = params.refund_to;
    lock.token_mint = token_mint;
    lock.reward_token_mint = reward_token_mint;
    lock.rent_payer = rent_payer;
    lock.payout_curve = params.payout_curve;
    lock.payout_curve_data = params.payout_curve_data.clone();
}

#[allow(clippy::too_many_arguments)]
fn emit_solver_locked(
    params: SolverLockParams,
    sender: Pubkey,
    token_mint: Pubkey,
    reward_token_mint: Pubkey,
    actual_amount: u64,
    actual_reward: u64,
    timelock: u64,
    reward_timelock: u64,
    data: Vec<u8>,
) {
    emit!(SolverLocked {
        hashlock: params.hashlock,
        sender,
        recipient: params.recipient,
        refund_to: params.refund_to,
        index: params.index,
        src_chain: params.src_chain,
        token_mint,
        amount: actual_amount,
        reward: actual_reward,
        reward_token_mint,
        reward_recipient: params.reward_recipient,
        timelock,
        reward_timelock,
        payout_curve: params.payout_curve,
        dst_chain: params.dst_chain,
        dst_address: params.dst_address,
        dst_amount: params.dst_amount,
        dst_token: params.dst_token,
        data,
    });
}

// ── SolverLock: native SOL amount + SOL reward ──────────────────────────────────

pub fn solver_lock_sol(
    ctx: Context<SolverLockSol>,
    params: SolverLockParams,
    data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let (timelock, reward_timelock) = validate_solver_lock_params(&params, now)?;
    check_index(&ctx.accounts.counter, params.index)?;

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    utils::validate_payout_curve(
        params.payout_curve,
        curve_account.as_ref(),
        &params.payout_curve_data,
        params.amount,
        now,
    )?;

    let total = params
        .amount
        .checked_add(params.reward)
        .ok_or(TrainError::Overflow)?;
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.sender.to_account_info(),
            to: ctx.accounts.solver_lock.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, total)?;

    let sender = ctx.accounts.sender.key();
    let rent_payer = ctx.accounts.payer.key();
    store_solver_lock(
        &mut ctx.accounts.solver_lock,
        &params,
        sender,
        rent_payer,
        Pubkey::default(),
        Pubkey::default(),
        params.amount,
        params.reward,
        timelock,
        reward_timelock,
        now,
    );
    ctx.accounts.counter.count = params.index;

    emit_solver_locked(
        params,
        sender,
        Pubkey::default(),
        Pubkey::default(),
        ctx.accounts.solver_lock.amount,
        ctx.accounts.solver_lock.reward,
        timelock,
        reward_timelock,
        data,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(params: SolverLockParams)]
pub struct SolverLockSol<'info> {
    /// Pays rent and fees; may differ from `sender` in sponsored flows.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Funds authority: the SOL leaves this signer.
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + SolverLockCounter::INIT_SPACE,
        seeds = [b"solver_count", params.hashlock.as_ref()],
        bump,
    )]
    pub counter: Account<'info, SolverLockCounter>,

    #[account(
        init,
        payer = payer,
        space = 8 + SolverLock::INIT_SPACE,
        seeds = [b"solver_lock", params.hashlock.as_ref(), &params.index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

// ── SolverLock: SPL token amount + same-token reward (single vault) ─────────────

pub fn solver_lock_token(
    ctx: Context<SolverLockToken>,
    params: SolverLockParams,
    data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let (timelock, reward_timelock) = validate_solver_lock_params(&params, now)?;
    check_index(&ctx.accounts.counter, params.index)?;

    utils::validate_mint_extensions(&ctx.accounts.token_mint.to_account_info())?;
    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    utils::validate_payout_curve(
        params.payout_curve,
        curve_account.as_ref(),
        &params.payout_curve_data,
        params.amount,
        now,
    )?;

    let total = params
        .amount
        .checked_add(params.reward)
        .ok_or(TrainError::Overflow)?;
    let received = utils::transfer_in_measured(
        ctx.accounts.sender_token_account.to_account_info(),
        &mut ctx.accounts.vault,
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.sender.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        &[],
        total,
        ctx.accounts.token_mint.decimals,
    )?;
    // Proportional split of the measured total (fee-on-transfer safe).
    let (actual_amount, actual_reward) = utils::split_measured(received, params.amount, params.reward)?;

    let sender = ctx.accounts.sender.key();
    let rent_payer = ctx.accounts.payer.key();
    let token_mint_key = ctx.accounts.token_mint.key();
    store_solver_lock(
        &mut ctx.accounts.solver_lock,
        &params,
        sender,
        rent_payer,
        token_mint_key,
        token_mint_key,
        actual_amount,
        actual_reward,
        timelock,
        reward_timelock,
        now,
    );
    ctx.accounts.counter.count = params.index;

    emit_solver_locked(
        params,
        sender,
        token_mint_key,
        token_mint_key,
        actual_amount,
        actual_reward,
        timelock,
        reward_timelock,
        data,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(params: SolverLockParams)]
pub struct SolverLockToken<'info> {
    /// Pays rent and fees; may differ from `sender` in sponsored flows.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Funds authority: tokens leave this signer's token account.
    pub sender: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + SolverLockCounter::INIT_SPACE,
        seeds = [b"solver_count", params.hashlock.as_ref()],
        bump,
    )]
    pub counter: Account<'info, SolverLockCounter>,

    #[account(
        init,
        payer = payer,
        space = 8 + SolverLock::INIT_SPACE,
        seeds = [b"solver_lock", params.hashlock.as_ref(), &params.index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = sender_token_account.owner == sender.key() @ TrainError::WrongToken,
        constraint = sender_token_account.mint == token_mint.key() @ TrainError::WrongToken,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        seeds = [b"solver_vault", params.hashlock.as_ref(), &params.index.to_le_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = solver_lock,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── SolverLock: SPL token amount + different-token reward (two vaults) ──────────

pub fn solver_lock_token_diff_reward(
    ctx: Context<SolverLockTokenDiffReward>,
    params: SolverLockParams,
    data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let (timelock, reward_timelock) = validate_solver_lock_params(&params, now)?;
    check_index(&ctx.accounts.counter, params.index)?;
    require!(
        ctx.accounts.token_mint.key() != ctx.accounts.reward_token_mint.key(),
        TrainError::WrongToken
    );

    utils::validate_mint_extensions(&ctx.accounts.token_mint.to_account_info())?;
    utils::validate_mint_extensions(&ctx.accounts.reward_token_mint.to_account_info())?;
    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    utils::validate_payout_curve(
        params.payout_curve,
        curve_account.as_ref(),
        &params.payout_curve_data,
        params.amount,
        now,
    )?;

    let actual_amount = utils::transfer_in_measured(
        ctx.accounts.sender_token_account.to_account_info(),
        &mut ctx.accounts.vault,
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.sender.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        &[],
        params.amount,
        ctx.accounts.token_mint.decimals,
    )?;
    let actual_reward = if params.reward > 0 {
        utils::transfer_in_measured(
            ctx.accounts.sender_reward_token_account.to_account_info(),
            &mut ctx.accounts.reward_vault,
            ctx.accounts.reward_token_mint.to_account_info(),
            ctx.accounts.sender.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            &[],
            params.reward,
            ctx.accounts.reward_token_mint.decimals,
        )?
    } else {
        0
    };

    let sender = ctx.accounts.sender.key();
    let rent_payer = ctx.accounts.payer.key();
    let token_mint_key = ctx.accounts.token_mint.key();
    let reward_token_mint_key = ctx.accounts.reward_token_mint.key();
    store_solver_lock(
        &mut ctx.accounts.solver_lock,
        &params,
        sender,
        rent_payer,
        token_mint_key,
        reward_token_mint_key,
        actual_amount,
        actual_reward,
        timelock,
        reward_timelock,
        now,
    );
    ctx.accounts.counter.count = params.index;

    emit_solver_locked(
        params,
        sender,
        token_mint_key,
        reward_token_mint_key,
        actual_amount,
        actual_reward,
        timelock,
        reward_timelock,
        data,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(params: SolverLockParams)]
pub struct SolverLockTokenDiffReward<'info> {
    /// Pays rent and fees; may differ from `sender` in sponsored flows.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Funds authority: tokens leave this signer's token accounts.
    pub sender: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + SolverLockCounter::INIT_SPACE,
        seeds = [b"solver_count", params.hashlock.as_ref()],
        bump,
    )]
    pub counter: Box<Account<'info, SolverLockCounter>>,

    #[account(
        init,
        payer = payer,
        space = 8 + SolverLock::INIT_SPACE,
        seeds = [b"solver_lock", params.hashlock.as_ref(), &params.index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Box<Account<'info, SolverLock>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub reward_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = sender_token_account.owner == sender.key() @ TrainError::WrongToken,
        constraint = sender_token_account.mint == token_mint.key() @ TrainError::WrongToken,
    )]
    pub sender_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = sender_reward_token_account.owner == sender.key() @ TrainError::WrongToken,
        constraint = sender_reward_token_account.mint == reward_token_mint.key() @ TrainError::WrongToken,
    )]
    pub sender_reward_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"solver_vault", params.hashlock.as_ref(), &params.index.to_le_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = solver_lock,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"solver_reward_vault", params.hashlock.as_ref(), &params.index.to_le_bytes()],
        bump,
        token::mint = reward_token_mint,
        token::authority = solver_lock,
        token::token_program = token_program,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
