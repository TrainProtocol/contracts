use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::errors::TrainError;
use crate::events::{SolverRedeemed, UserRedeemed};
use crate::state::*;
use crate::utils;

// INVARIANT (redeem): sha256(secret) == hashlock is the only authorization; the
// payout always goes to the stored recipient (never the caller), excess to the
// stored refund_to. Status flips to Redeemed and the secret is stored BEFORE any
// funds move or any curve CPI runs.
//
// INVARIANT (payout curve): 0 < payout <= amount, so excess = amount - payout never
// underflows and refunds are never inflated. The curve CPI receives zero accounts
// and zero signers, so it can touch no state, and the runtime forbids it from
// re-entering this program.

// ── RedeemUser: native SOL ──────────────────────────────────────────────────────

pub fn redeem_user_sol(
    ctx: Context<RedeemUserSol>,
    hashlock: [u8; 32],
    secret: [u8; 32],
) -> Result<()> {
    utils::verify_hashlock(&secret, &hashlock)?;
    let now = Clock::get()?.unix_timestamp as u64;

    let lock = &mut ctx.accounts.user_lock;
    lock.status = STATUS_REDEEMED;
    lock.secret = secret;
    let amount = lock.amount;
    let payout_curve = lock.payout_curve;
    let start_time = lock.start_time;
    let curve_data = lock.payout_curve_data.clone();

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    let (payout, excess) = utils::compute_payout_checked(
        payout_curve,
        curve_account.as_ref(),
        amount,
        start_time,
        now,
        &curve_data,
    )?;

    ctx.accounts.user_lock.sub_lamports(amount)?;
    ctx.accounts.recipient.add_lamports(payout)?;
    if excess > 0 {
        ctx.accounts.refund_to.add_lamports(excess)?;
    }

    emit!(UserRedeemed {
        hashlock,
        redeemer: ctx.accounts.caller.key(),
        secret,
        payout,
        excess,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32])]
pub struct RedeemUserSol<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_lock", hashlock.as_ref()],
        bump,
        constraint = user_lock.status == STATUS_PENDING @ TrainError::NotPending,
        // A token lock shares this PDA; without this guard a token lock could be
        // settled through the SOL path, treating token base-units as lamports and
        // stranding the token vault. SOL locks store token_mint == default.
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

    /// CHECK: verified via user_lock.recipient
    #[account(
        mut,
        constraint = recipient.key() == user_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via user_lock.refund_to (receives curve excess)
    #[account(
        mut,
        constraint = refund_to.key() == user_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    /// CHECK: payout curve program; validated in the handler against
    /// user_lock.payout_curve. Required when the lock has a curve.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

// ── RedeemUser: SPL / Token-2022 token ──────────────────────────────────────────

pub fn redeem_user_token(
    ctx: Context<RedeemUserToken>,
    hashlock: [u8; 32],
    secret: [u8; 32],
) -> Result<()> {
    utils::verify_hashlock(&secret, &hashlock)?;
    let now = Clock::get()?.unix_timestamp as u64;

    let lock = &mut ctx.accounts.user_lock;
    lock.status = STATUS_REDEEMED;
    lock.secret = secret;
    let amount = lock.amount;
    let payout_curve = lock.payout_curve;
    let start_time = lock.start_time;
    let curve_data = lock.payout_curve_data.clone();

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    let (payout, excess) = utils::compute_payout_checked(
        payout_curve,
        curve_account.as_ref(),
        amount,
        start_time,
        now,
        &curve_data,
    )?;

    let bump = ctx.bumps.user_lock;
    let signer_seeds: &[&[&[u8]]] = &[&[b"user_lock", hashlock.as_ref(), &[bump]]];

    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.recipient_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.user_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        payout,
        ctx.accounts.token_mint.decimals,
    )?;

    if excess > 0 {
        let refund_to_ata = ctx
            .accounts
            .refund_to_token_account
            .as_ref()
            .ok_or(TrainError::WrongRefundTo)?;
        utils::transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            refund_to_ata.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.user_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            excess,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.user_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(UserRedeemed {
        hashlock,
        redeemer: ctx.accounts.caller.key(),
        secret,
        payout,
        excess,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32])]
pub struct RedeemUserToken<'info> {
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

    /// CHECK: verified via user_lock.recipient
    #[account(
        constraint = recipient.key() == user_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via user_lock.refund_to (curve excess authority)
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
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Required only when the lock has a payout curve (receives the excess).
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: Option<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RedeemSolver: native SOL ────────────────────────────────────────────────────

pub fn redeem_solver_sol(
    ctx: Context<RedeemSolverSol>,
    hashlock: [u8; 32],
    solver: Pubkey,
    secret: [u8; 32],
) -> Result<()> {
    utils::verify_hashlock(&secret, &hashlock)?;
    let now = Clock::get()?.unix_timestamp as u64;

    let lock = &mut ctx.accounts.solver_lock;
    lock.status = STATUS_REDEEMED;
    lock.secret = secret;
    let amount = lock.amount;
    let reward = lock.reward;
    let reward_timelock = lock.reward_timelock;
    let payout_curve = lock.payout_curve;
    let start_time = lock.start_time;
    let curve_data = lock.payout_curve_data.clone();

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    let (payout, excess) = utils::compute_payout_checked(
        payout_curve,
        curve_account.as_ref(),
        amount,
        start_time,
        now,
        &curve_data,
    )?;

    ctx.accounts.solver_lock.sub_lamports(amount)?;
    ctx.accounts.recipient.add_lamports(payout)?;
    if excess > 0 {
        ctx.accounts.refund_to.add_lamports(excess)?;
    }

    // Reward routing: before the reward timelock → reward_recipient; at/after it →
    // the caller as a relayer bounty. The curve never touches the reward.
    let reward_to = if reward > 0 {
        ctx.accounts.solver_lock.sub_lamports(reward)?;
        if now < reward_timelock {
            ctx.accounts.reward_recipient.add_lamports(reward)?;
            ctx.accounts.reward_recipient.key()
        } else {
            ctx.accounts.caller.add_lamports(reward)?;
            ctx.accounts.caller.key()
        }
    } else {
        Pubkey::default()
    };

    emit!(SolverRedeemed {
        hashlock,
        solver,
        redeemer: ctx.accounts.caller.key(),
        secret,
        payout,
        excess,
        reward_to,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RedeemSolverSol<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), solver.as_ref()],
        bump,
        constraint = solver_lock.sender == solver @ TrainError::WrongSender,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
        // Guard against settling a token solver lock through the SOL path (see the
        // equivalent note on RedeemUserSol). SOL locks store token_mint == default.
        constraint = solver_lock.token_mint == Pubkey::default() @ TrainError::WrongToken,
        constraint = solver_lock.reward_token_mint == Pubkey::default() @ TrainError::WrongToken,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.recipient
    #[account(
        mut,
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.reward_recipient (only meaningful when the
    /// lock carries a reward; zero-reward locks store the default pubkey)
    #[account(
        mut,
        constraint = solver_lock.reward == 0
            || reward_recipient.key() == solver_lock.reward_recipient
            @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.refund_to (receives curve excess)
    #[account(
        mut,
        constraint = refund_to.key() == solver_lock.refund_to @ TrainError::WrongRefundTo,
    )]
    pub refund_to: UncheckedAccount<'info>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

// ── RedeemSolver: native SOL amount + SPL token reward ─────────────────────────

pub fn redeem_solver_sol_token_reward(
    ctx: Context<RedeemSolverSolTokenReward>,
    hashlock: [u8; 32],
    solver: Pubkey,
    secret: [u8; 32],
) -> Result<()> {
    utils::verify_hashlock(&secret, &hashlock)?;
    let now = Clock::get()?.unix_timestamp as u64;

    let lock = &mut ctx.accounts.solver_lock;
    lock.status = STATUS_REDEEMED;
    lock.secret = secret;
    let amount = lock.amount;
    let reward = lock.reward;
    let reward_timelock = lock.reward_timelock;
    let payout_curve = lock.payout_curve;
    let start_time = lock.start_time;
    let curve_data = lock.payout_curve_data.clone();

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    let (payout, excess) = utils::compute_payout_checked(
        payout_curve,
        curve_account.as_ref(),
        amount,
        start_time,
        now,
        &curve_data,
    )?;

    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];
    let (destination, reward_to) = if now < reward_timelock {
        (
            ctx.accounts
                .reward_recipient_token_account
                .to_account_info(),
            ctx.accounts.reward_recipient.key(),
        )
    } else {
        (
            ctx.accounts.caller_reward_token_account.to_account_info(),
            ctx.accounts.caller.key(),
        )
    };
    utils::transfer_from_vault(
        ctx.accounts.reward_vault.to_account_info(),
        destination,
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

    // Keep each token CPI's lamport snapshot balanced before mutating the native
    // principal leg in this mixed-asset instruction.
    ctx.accounts.solver_lock.sub_lamports(amount)?;
    ctx.accounts.recipient.add_lamports(payout)?;
    if excess > 0 {
        ctx.accounts.refund_to.add_lamports(excess)?;
    }

    emit!(SolverRedeemed {
        hashlock,
        solver,
        redeemer: ctx.accounts.caller.key(),
        secret,
        payout,
        excess,
        reward_to,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RedeemSolverSolTokenReward<'info> {
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

    /// CHECK: native principal recipient.
    #[account(
        mut,
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: authority for the early reward ATA.
    #[account(
        constraint = reward_recipient.key() == solver_lock.reward_recipient @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    /// CHECK: receives payout-curve excess.
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
        associated_token::authority = reward_recipient,
        associated_token::token_program = token_program,
    )]
    pub reward_recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = caller,
        associated_token::token_program = token_program,
    )]
    pub caller_reward_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RedeemSolver: SPL token (single vault) ──────────────────────────────────────

pub fn redeem_solver_token(
    ctx: Context<RedeemSolverToken>,
    hashlock: [u8; 32],
    solver: Pubkey,
    secret: [u8; 32],
) -> Result<()> {
    utils::verify_hashlock(&secret, &hashlock)?;
    let now = Clock::get()?.unix_timestamp as u64;

    let lock = &mut ctx.accounts.solver_lock;
    lock.status = STATUS_REDEEMED;
    lock.secret = secret;
    let amount = lock.amount;
    let reward = lock.reward;
    let reward_timelock = lock.reward_timelock;
    let payout_curve = lock.payout_curve;
    let start_time = lock.start_time;
    let curve_data = lock.payout_curve_data.clone();

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    let (payout, excess) = utils::compute_payout_checked(
        payout_curve,
        curve_account.as_ref(),
        amount,
        start_time,
        now,
        &curve_data,
    )?;

    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];

    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.recipient_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        payout,
        ctx.accounts.token_mint.decimals,
    )?;

    if excess > 0 {
        let refund_to_ata = ctx
            .accounts
            .refund_to_token_account
            .as_ref()
            .ok_or(TrainError::WrongRefundTo)?;
        utils::transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            refund_to_ata.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            excess,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    let reward_to = if reward > 0 {
        let (destination, destination_key) = if now < reward_timelock {
            (
                ctx.accounts
                    .reward_recipient_token_account
                    .to_account_info(),
                ctx.accounts.reward_recipient.key(),
            )
        } else {
            (
                ctx.accounts.caller_token_account.to_account_info(),
                ctx.accounts.caller.key(),
            )
        };
        utils::transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            destination,
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            reward,
            ctx.accounts.token_mint.decimals,
        )?;
        destination_key
    } else {
        Pubkey::default()
    };

    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(SolverRedeemed {
        hashlock,
        solver,
        redeemer: ctx.accounts.caller.key(),
        secret,
        payout,
        excess,
        reward_to,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RedeemSolverToken<'info> {
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
    pub solver_lock: Box<Account<'info, SolverLock>>,

    /// CHECK: rent destination for the emptied vault, verified via
    /// solver_lock.rent_payer
    #[account(
        mut,
        constraint = rent_payer.key() == solver_lock.rent_payer @ TrainError::WrongRentPayer,
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.recipient
    #[account(
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.reward_recipient (only meaningful when the
    /// lock carries a reward; zero-reward locks store the default pubkey)
    #[account(
        constraint = solver_lock.reward == 0
            || reward_recipient.key() == solver_lock.reward_recipient
            @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.refund_to (curve excess authority)
    #[account(
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
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = reward_recipient,
        associated_token::token_program = token_program,
    )]
    pub reward_recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = caller,
        associated_token::token_program = token_program,
    )]
    pub caller_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Required only when the lock has a payout curve (receives the excess).
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RedeemSolver: SPL token amount + native SOL reward ─────────────────────────

pub fn redeem_solver_token_sol_reward(
    ctx: Context<RedeemSolverTokenSolReward>,
    hashlock: [u8; 32],
    solver: Pubkey,
    secret: [u8; 32],
) -> Result<()> {
    utils::verify_hashlock(&secret, &hashlock)?;
    let now = Clock::get()?.unix_timestamp as u64;

    let lock = &mut ctx.accounts.solver_lock;
    lock.status = STATUS_REDEEMED;
    lock.secret = secret;
    let amount = lock.amount;
    let reward = lock.reward;
    let reward_timelock = lock.reward_timelock;
    let payout_curve = lock.payout_curve;
    let start_time = lock.start_time;
    let curve_data = lock.payout_curve_data.clone();

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    let (payout, excess) = utils::compute_payout_checked(
        payout_curve,
        curve_account.as_ref(),
        amount,
        start_time,
        now,
        &curve_data,
    )?;

    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];
    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.recipient_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        payout,
        ctx.accounts.token_mint.decimals,
    )?;
    if excess > 0 {
        let refund_to_ata = ctx
            .accounts
            .refund_to_token_account
            .as_ref()
            .ok_or(TrainError::WrongRefundTo)?;
        utils::transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            refund_to_ata.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            excess,
            ctx.accounts.token_mint.decimals,
        )?;
    }
    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    ctx.accounts.solver_lock.sub_lamports(reward)?;
    let reward_to = if now < reward_timelock {
        ctx.accounts.reward_recipient.add_lamports(reward)?;
        ctx.accounts.reward_recipient.key()
    } else {
        ctx.accounts.caller.add_lamports(reward)?;
        ctx.accounts.caller.key()
    };

    emit!(SolverRedeemed {
        hashlock,
        solver,
        redeemer: ctx.accounts.caller.key(),
        secret,
        payout,
        excess,
        reward_to,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RedeemSolverTokenSolReward<'info> {
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

    /// CHECK: token recipient authority.
    #[account(
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: receives native reward before the reward timelock.
    #[account(
        mut,
        constraint = reward_recipient.key() == solver_lock.reward_recipient @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    /// CHECK: authority for payout-curve excess ATA.
    #[account(
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
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Required only when the lock has a payout curve.
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ── RedeemSolver: SPL token, different reward token (two vaults) ────────────────

pub fn redeem_solver_token_diff_reward(
    ctx: Context<RedeemSolverTokenDiffReward>,
    hashlock: [u8; 32],
    solver: Pubkey,
    secret: [u8; 32],
) -> Result<()> {
    utils::verify_hashlock(&secret, &hashlock)?;
    let now = Clock::get()?.unix_timestamp as u64;

    let lock = &mut ctx.accounts.solver_lock;
    lock.status = STATUS_REDEEMED;
    lock.secret = secret;
    let amount = lock.amount;
    let reward = lock.reward;
    let reward_timelock = lock.reward_timelock;
    let payout_curve = lock.payout_curve;
    let start_time = lock.start_time;
    let curve_data = lock.payout_curve_data.clone();

    let curve_account = ctx
        .accounts
        .payout_curve_program
        .as_ref()
        .map(|a| a.to_account_info());
    let (payout, excess) = utils::compute_payout_checked(
        payout_curve,
        curve_account.as_ref(),
        amount,
        start_time,
        now,
        &curve_data,
    )?;

    let bump = ctx.bumps.solver_lock;
    let signer_seeds: &[&[&[u8]]] =
        &[&[b"solver_lock", hashlock.as_ref(), solver.as_ref(), &[bump]]];

    utils::transfer_from_vault(
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.recipient_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
        payout,
        ctx.accounts.token_mint.decimals,
    )?;

    if excess > 0 {
        let refund_to_ata = ctx
            .accounts
            .refund_to_token_account
            .as_ref()
            .ok_or(TrainError::WrongRefundTo)?;
        utils::transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            refund_to_ata.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            excess,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    utils::close_vault_if_empty(
        &mut ctx.accounts.vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    let reward_to = if reward > 0 {
        let (destination, destination_key) = if now < reward_timelock {
            (
                ctx.accounts
                    .reward_recipient_token_account
                    .to_account_info(),
                ctx.accounts.reward_recipient.key(),
            )
        } else {
            (
                ctx.accounts.caller_reward_token_account.to_account_info(),
                ctx.accounts.caller.key(),
            )
        };
        utils::transfer_from_vault(
            ctx.accounts.reward_vault.to_account_info(),
            destination,
            ctx.accounts.reward_token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            reward,
            ctx.accounts.reward_token_mint.decimals,
        )?;
        destination_key
    } else {
        Pubkey::default()
    };

    utils::close_vault_if_empty(
        &mut ctx.accounts.reward_vault,
        ctx.accounts.rent_payer.to_account_info(),
        ctx.accounts.solver_lock.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(SolverRedeemed {
        hashlock,
        solver,
        redeemer: ctx.accounts.caller.key(),
        secret,
        payout,
        excess,
        reward_to,
        reward,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], solver: Pubkey)]
pub struct RedeemSolverTokenDiffReward<'info> {
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

    /// CHECK: verified via solver_lock.recipient
    #[account(
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.reward_recipient (only meaningful when the
    /// lock carries a reward; zero-reward locks store the default pubkey)
    #[account(
        constraint = solver_lock.reward == 0
            || reward_recipient.key() == solver_lock.reward_recipient
            @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.refund_to (curve excess authority)
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
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = reward_recipient,
        associated_token::token_program = token_program,
    )]
    pub reward_recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = caller,
        associated_token::token_program = token_program,
    )]
    pub caller_reward_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Required only when the lock has a payout curve (receives the excess).
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = refund_to,
        associated_token::token_program = token_program,
    )]
    pub refund_to_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
