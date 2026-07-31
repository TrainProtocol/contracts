use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::TrainError;
use crate::events::IntentConsumed;
use crate::instructions::user_lock::{emit_user_locked, store_user_lock, validate_user_lock_params};
use crate::intent;
use crate::state::*;
use crate::utils;

// ─── Gasless intent path ────────────────────────────────────────────────────────
//
// The user signs an off-chain ed25519 message binding (domain, program, user, mint,
// amount, call_hash, nonce, deadline), after a one-time SPL `approve` of the
// program's delegate PDA that authorizes the pull. A relayer then submits
// [ed25519_verify, this ix], paying the fees and rent so the user spends no SOL.
//
// INVARIANT (relayer trust): an untrusted relayer can only execute the exact lock
// the user signed (call_hash binds every parameter), at most once (ConsumedIntent
// PDA init), before the deadline, moving exactly params.amount from the user's
// token account into the lock vault. Funds go straight from the user's ATA into the
// lock vault — the program never takes custody, so there is nothing to reconcile
// after the transfer.

// ── Initialize the per-deployment intent domain ─────────────────────────────────

pub fn initialize_intent_domain(
    ctx: Context<InitializeIntentDomain>,
    salt: [u8; 32],
) -> Result<()> {
    // A zero salt would weaken the cross-cluster replay barrier; require a real one.
    require!(salt != [0u8; 32], TrainError::InvalidIntentSignature);
    ctx.accounts.intent_domain.salt = salt;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeIntentDomain<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + IntentDomain::INIT_SPACE,
        seeds = [b"intent_domain"],
        bump,
    )]
    pub intent_domain: Account<'info, IntentDomain>,

    /// The salt is the cross-cluster replay barrier, so only the program upgrade
    /// authority may set it — once, before finalizing the upgrade authority.
    /// Genesis-loaded programs (anchor/solana test validators only) carry
    /// Some(Pubkey::default()) as their authority; real deployments via the
    /// upgradeable loader always record the deployer, so the default-pubkey branch
    /// is unreachable on devnet/mainnet.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ TrainError::Unauthorized)]
    pub program: Program<'info, crate::program::TrainHtlc>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            || program_data.upgrade_authority_address == Some(Pubkey::default())
            @ TrainError::Unauthorized,
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

// ── UserLock via signed intent (SPL tokens only) ────────────────────────────────

pub fn user_lock_token_with_intent(
    ctx: Context<UserLockTokenWithIntent>,
    params: UserLockParams,
    user_data: Vec<u8>,
    solver_data: Vec<u8>,
    nonce: u64,
    deadline: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    require!(now <= deadline, TrainError::IntentExpired);
    let timelock = validate_user_lock_params(&params, now)?;

    // Reconstruct the canonical message from the submitted arguments and require
    // that the preceding ed25519 instruction proved the user signed its digest —
    // any tampering with params/user_data/solver_data/mint/amount/nonce/deadline
    // changes the digest and fails the comparison.
    let call_hash = intent::call_hash(&params, &user_data, &solver_data)?;
    let message = intent::build_intent_message(
        &ctx.accounts.intent_domain.salt,
        &ctx.accounts.user.key(),
        &ctx.accounts.token_mint.key(),
        params.amount,
        &call_hash,
        nonce,
        deadline,
    );
    let digest = intent::intent_digest(&message);
    intent::verify_ed25519_intent(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &ctx.accounts.user.key(),
        &digest,
    )?;

    // Explicit delegation checks for clear errors (SPL enforces them regardless).
    match ctx.accounts.user_token_account.delegate {
        COption::Some(delegate) => require_keys_eq!(
            delegate,
            ctx.accounts.delegate.key(),
            TrainError::InvalidDelegation
        ),
        COption::None => return err!(TrainError::InvalidDelegation),
    }
    require!(
        ctx.accounts.user_token_account.delegated_amount >= params.amount,
        TrainError::InvalidDelegation
    );

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

    // Record consumption before moving funds (checks-effects-interactions).
    let consumed = &mut ctx.accounts.consumed_intent;
    consumed.intent_hash = digest;
    consumed.user = ctx.accounts.user.key();
    consumed.deadline = deadline;
    consumed.rent_payer = ctx.accounts.payer.key();

    // Pull exactly params.amount from the user's token account via the delegate PDA.
    let delegate_bump = ctx.bumps.delegate;
    let delegate_seeds: &[&[&[u8]]] = &[&[b"delegate", &[delegate_bump]]];
    let received = utils::transfer_in_measured(
        ctx.accounts.user_token_account.to_account_info(),
        &mut ctx.accounts.vault,
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.delegate.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        delegate_seeds,
        params.amount,
        ctx.accounts.token_mint.decimals,
    )?;

    let user = ctx.accounts.user.key();
    let relayer = ctx.accounts.payer.key();
    let token_mint_key = ctx.accounts.token_mint.key();
    store_user_lock(
        &mut ctx.accounts.user_lock,
        &params,
        user,
        relayer,
        token_mint_key,
        received,
        timelock,
        now,
    );

    emit!(IntentConsumed {
        intent_hash: digest,
        user,
        relayer,
        token_mint: token_mint_key,
        amount: received,
        nonce,
        deadline,
    });
    emit_user_locked(
        params,
        user,
        token_mint_key,
        received,
        timelock,
        user_data,
        solver_data,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(
    params: UserLockParams,
    user_data: Vec<u8>,
    solver_data: Vec<u8>,
    nonce: u64,
)]
pub struct UserLockTokenWithIntent<'info> {
    /// The relayer: pays rent and fees, receives them back when accounts close.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: the intent signer. NOT a transaction signer — authorization is proven
    /// by the ed25519 instruction verified in the handler, and funds move only from
    /// a token account this key owns, only under its signed intent.
    pub user: UncheckedAccount<'info>,

    #[account(seeds = [b"intent_domain"], bump)]
    pub intent_domain: Box<Account<'info, IntentDomain>>,

    /// Single-use replay guard keyed by (user, nonce): `init` fails if this nonce was
    /// already used, so a signed intent can be executed at most once.
    #[account(
        init,
        payer = payer,
        space = 8 + ConsumedIntent::INIT_SPACE,
        seeds = [b"intent", user.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub consumed_intent: Box<Account<'info, ConsumedIntent>>,

    /// CHECK: the program's delegate PDA — the SPL delegate the user approved to
    /// authorize the token pull. Never holds funds.
    #[account(seeds = [b"delegate"], bump)]
    pub delegate: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + UserLock::INIT_SPACE,
        seeds = [b"user_lock", params.hashlock.as_ref()],
        bump,
    )]
    pub user_lock: Box<Account<'info, UserLock>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ TrainError::WrongSender,
        constraint = user_token_account.mint == token_mint.key() @ TrainError::WrongToken,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"user_vault", params.hashlock.as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = user_lock,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: payout curve program; validated in the handler.
    pub payout_curve_program: Option<UncheckedAccount<'info>>,

    /// CHECK: the instructions sysvar; address enforced here, and every load in the
    /// handler goes through the checked sysvar API (no sysvar spoofing).
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID @ TrainError::InvalidIntentSignature)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

// ── Close a consumed intent after its deadline (rent recovery) ──────────────────

pub fn close_consumed_intent(ctx: Context<CloseConsumedIntent>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    // Replay stays impossible after closing: consumption requires now <= deadline.
    require!(
        now > ctx.accounts.consumed_intent.deadline,
        TrainError::IntentNotExpired
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CloseConsumedIntent<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        constraint = rent_payer.key() == consumed_intent.rent_payer @ TrainError::WrongRentPayer,
        close = rent_payer,
    )]
    pub consumed_intent: Account<'info, ConsumedIntent>,

    /// CHECK: rent destination, verified via consumed_intent.rent_payer
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}
