use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::TrainError;
use crate::events::UserLocked;
use crate::state::*;
use crate::utils;

/// Shared user-lock parameter validation. Returns the absolute timelock.
pub fn validate_user_lock_params(params: &UserLockParams, now: u64) -> Result<u64> {
    require!(params.amount > 0, TrainError::ZeroAmount);
    require!(params.timelock_delta > 0, TrainError::ZeroTimelockDelta);
    require!(now < params.quote_expiry, TrainError::QuoteExpired);
    require!(
        params.recipient != Pubkey::default() && params.refund_to != Pubkey::default(),
        TrainError::ZeroAddress
    );
    now.checked_add(params.timelock_delta)
        .ok_or_else(|| error!(TrainError::Overflow))
}

/// INVARIANT (attribution vs custody): `sender` is the owner-of-record only; custody
/// keys off recipient/refund_to from the (signed) params. Attribution never grants
/// custody, so crediting a lock to any `sender` cannot put funds at risk.
#[allow(clippy::too_many_arguments)]
pub fn store_user_lock(
    lock: &mut UserLock,
    params: &UserLockParams,
    sender: Pubkey,
    rent_payer: Pubkey,
    token_mint: Pubkey,
    received: u64,
    timelock: u64,
    now: u64,
) {
    lock.secret = [0u8; 32];
    lock.amount = received;
    lock.sender = sender;
    lock.timelock = timelock;
    lock.start_time = now;
    lock.status = STATUS_PENDING;
    lock.recipient = params.recipient;
    lock.refund_to = params.refund_to;
    lock.token_mint = token_mint;
    lock.rent_payer = rent_payer;
    lock.payout_curve = params.payout_curve;
    lock.payout_curve_data = params.payout_curve_data.clone();
}

pub fn emit_user_locked(
    params: UserLockParams,
    sender: Pubkey,
    token_mint: Pubkey,
    received: u64,
    timelock: u64,
    user_data: Vec<u8>,
    solver_data: Vec<u8>,
) {
    emit!(UserLocked {
        hashlock: params.hashlock,
        sender,
        recipient: params.recipient,
        refund_to: params.refund_to,
        src_chain: params.src_chain,
        token_mint,
        amount: received,
        timelock,
        payout_curve: params.payout_curve,
        dst_chain: params.dst_chain,
        dst_address: params.dst_address,
        dst_amount: params.dst_amount,
        dst_token: params.dst_token,
        reward_amount: params.reward_amount,
        reward_token: params.reward_token,
        reward_recipient: params.reward_recipient,
        reward_timelock_delta: params.reward_timelock_delta,
        quote_expiry: params.quote_expiry,
        user_data,
        solver_data,
    });
}

// ── UserLock: native SOL ────────────────────────────────────────────────────────

pub fn user_lock_sol(
    ctx: Context<UserLockSol>,
    params: UserLockParams,
    user_data: Vec<u8>,
    solver_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let timelock = validate_user_lock_params(&params, now)?;

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

    // Funds always move from the `sender` signer; `payer` only covers rent/fees
    // (relayer-sponsored flows pass a different payer).
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.sender.to_account_info(),
            to: ctx.accounts.user_lock.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, params.amount)?;

    let sender = ctx.accounts.sender.key();
    let rent_payer = ctx.accounts.payer.key();
    store_user_lock(
        &mut ctx.accounts.user_lock,
        &params,
        sender,
        rent_payer,
        Pubkey::default(),
        params.amount,
        timelock,
        now,
    );
    emit_user_locked(
        params,
        sender,
        Pubkey::default(),
        ctx.accounts.user_lock.amount,
        timelock,
        user_data,
        solver_data,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(params: UserLockParams)]
pub struct UserLockSol<'info> {
    /// Pays rent and fees; may differ from `sender` in sponsored flows.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Funds authority: the SOL leaves this signer.
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + UserLock::INIT_SPACE,
        seeds = [b"user_lock", params.hashlock.as_ref()],
        bump,
    )]
    pub user_lock: Account<'info, UserLock>,

    /// CHECK: payout curve program; validated in the handler against
    /// params.payout_curve (key match + executable + probe CPI).
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

// ── UserLock: SPL / Token-2022 token ────────────────────────────────────────────

pub fn user_lock_token(
    ctx: Context<UserLockToken>,
    params: UserLockParams,
    user_data: Vec<u8>,
    solver_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    let timelock = validate_user_lock_params(&params, now)?;

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

    let received = utils::transfer_in_measured(
        ctx.accounts.sender_token_account.to_account_info(),
        &mut ctx.accounts.vault,
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.sender.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        &[],
        params.amount,
        ctx.accounts.token_mint.decimals,
    )?;

    let sender = ctx.accounts.sender.key();
    let rent_payer = ctx.accounts.payer.key();
    let token_mint_key = ctx.accounts.token_mint.key();
    store_user_lock(
        &mut ctx.accounts.user_lock,
        &params,
        sender,
        rent_payer,
        token_mint_key,
        received,
        timelock,
        now,
    );
    emit_user_locked(
        params,
        sender,
        token_mint_key,
        received,
        timelock,
        user_data,
        solver_data,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(params: UserLockParams)]
pub struct UserLockToken<'info> {
    /// Pays rent and fees; may differ from `sender` in sponsored flows.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Funds authority: tokens leave this signer's token account.
    pub sender: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + UserLock::INIT_SPACE,
        seeds = [b"user_lock", params.hashlock.as_ref()],
        bump,
    )]
    pub user_lock: Account<'info, UserLock>,

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
        seeds = [b"user_vault", params.hashlock.as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = user_lock,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: payout curve program; validated in the handler against
    /// params.payout_curve (key match + executable + probe CPI).
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
