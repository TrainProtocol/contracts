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

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use sha2::{Digest, Sha256};

declare_id!("7ZT5gs8CG7BAv34bLYSke31DJeg5RRUa4G7p9GNcbPE");

// Status constants (mirrors Solidity LockStatus enum)
const STATUS_PENDING: u8 = 0;
const STATUS_REFUNDED: u8 = 1;
const STATUS_REDEEMED: u8 = 2;

// ─── Helper functions ──────────────────────────────────────────────────────────

fn verify_hashlock(secret: &[u8; 32], hashlock: &[u8; 32]) -> Result<()> {
    let mut hasher = Sha256::new();
    hasher.update(secret);
    let computed: [u8; 32] = hasher.finalize().into();
    require!(computed == *hashlock, TrainError::HashlockMismatch);
    Ok(())
}

fn transfer_from_vault<'info>(
    vault: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let cpi_ctx = CpiContext::new_with_signer(
        token_program,
        TransferChecked {
            from: vault,
            to: destination,
            mint,
            authority,
        },
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, decimals)
}

fn close_vault_if_empty<'info>(
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    vault.reload()?;
    if vault.amount == 0 {
        let cpi_ctx = CpiContext::new_with_signer(
            token_program,
            CloseAccount {
                account: vault.to_account_info(),
                destination,
                authority,
            },
            signer_seeds,
        );
        token_interface::close_account(cpi_ctx)?;
    }
    Ok(())
}

// ─── Program ───────────────────────────────────────────────────────────────────

#[program]
pub mod train_htlc {
    use super::*;

    // ── UserLock: native SOL ───────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn user_lock_sol(
        ctx: Context<UserLockSol>,
        hashlock: [u8; 32],
        amount: u64,
        timelock_delta: u64,
        quote_expiry: u64,
        sender: Pubkey,
        recipient: Pubkey,
        src_chain: String,
        dst_chain: String,
        dst_address: String,
        dst_amount: u64,
        dst_token: String,
        reward_amount: u64,
        reward_token: String,
        reward_recipient: String,
        reward_timelock_delta: u64,
        user_data: Vec<u8>,
        solver_data: Vec<u8>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        require!(amount > 0, TrainError::ZeroAmount);
        require!(timelock_delta > 0, TrainError::ZeroTimelockDelta);
        require!(now < quote_expiry, TrainError::QuoteExpired);

        let timelock = now.checked_add(timelock_delta).ok_or(TrainError::Overflow)?;

        // Transfer SOL from signer into the lock PDA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.user_lock.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, amount)?;

        let lock = &mut ctx.accounts.user_lock;
        lock.secret = [0u8; 32];
        lock.amount = amount;
        lock.sender = sender;
        lock.timelock = timelock;
        lock.status = STATUS_PENDING;
        lock.recipient = recipient;
        lock.token_mint = Pubkey::default();

        emit!(UserLocked {
            hashlock,
            sender,
            recipient,
            src_chain,
            token_mint: Pubkey::default(),
            amount,
            timelock,
            dst_chain,
            dst_address,
            dst_amount,
            dst_token,
            reward_amount,
            reward_token,
            reward_recipient,
            reward_timelock_delta,
            quote_expiry,
            user_data,
            solver_data,
        });
        Ok(())
    }

    // ── UserLock: SPL token ────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn user_lock_token(
        ctx: Context<UserLockToken>,
        hashlock: [u8; 32],
        amount: u64,
        timelock_delta: u64,
        quote_expiry: u64,
        sender: Pubkey,
        recipient: Pubkey,
        src_chain: String,
        dst_chain: String,
        dst_address: String,
        dst_amount: u64,
        dst_token: String,
        reward_amount: u64,
        reward_token: String,
        reward_recipient: String,
        reward_timelock_delta: u64,
        user_data: Vec<u8>,
        solver_data: Vec<u8>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        require!(amount > 0, TrainError::ZeroAmount);
        require!(timelock_delta > 0, TrainError::ZeroTimelockDelta);
        require!(now < quote_expiry, TrainError::QuoteExpired);

        let timelock = now.checked_add(timelock_delta).ok_or(TrainError::Overflow)?;
        let token_mint_key = ctx.accounts.token_mint.key();

        // Transfer tokens from sender into vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.sender_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        );
        token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.token_mint.decimals)?;

        let lock = &mut ctx.accounts.user_lock;
        lock.secret = [0u8; 32];
        lock.amount = amount;
        lock.sender = sender;
        lock.timelock = timelock;
        lock.status = STATUS_PENDING;
        lock.recipient = recipient;
        lock.token_mint = token_mint_key;

        emit!(UserLocked {
            hashlock,
            sender,
            recipient,
            src_chain,
            token_mint: token_mint_key,
            amount,
            timelock,
            dst_chain,
            dst_address,
            dst_amount,
            dst_token,
            reward_amount,
            reward_token,
            reward_recipient,
            reward_timelock_delta,
            quote_expiry,
            user_data,
            solver_data,
        });
        Ok(())
    }

    // ── SolverLock: native SOL amount + SOL reward ─────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn solver_lock_sol(
        ctx: Context<SolverLockSol>,
        hashlock: [u8; 32],
        index: u64,
        amount: u64,
        reward: u64,
        timelock_delta: u64,
        reward_timelock_delta: u64,
        sender: Pubkey,
        recipient: Pubkey,
        reward_recipient: Pubkey,
        src_chain: String,
        dst_chain: String,
        dst_address: String,
        dst_amount: u64,
        dst_token: String,
        data: Vec<u8>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        require!(amount > 0, TrainError::ZeroAmount);
        require!(timelock_delta > 0, TrainError::ZeroTimelockDelta);
        if reward > 0 {
            require!(
                reward_timelock_delta < timelock_delta,
                TrainError::RewardTimelockNotLessThanTimelock
            );
        }
        require!(
            index == ctx.accounts.counter.count.checked_add(1).ok_or(TrainError::Overflow)?,
            TrainError::InvalidIndex
        );

        let timelock = now.checked_add(timelock_delta).ok_or(TrainError::Overflow)?;
        let reward_timelock = now.checked_add(reward_timelock_delta).ok_or(TrainError::Overflow)?;
        let total = amount.checked_add(reward).ok_or(TrainError::Overflow)?;

        // Transfer SOL into solver_lock PDA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.solver_lock.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, total)?;

        let lock = &mut ctx.accounts.solver_lock;
        lock.secret = [0u8; 32];
        lock.amount = amount;
        lock.reward = reward;
        lock.sender = sender;
        lock.timelock = timelock;
        lock.reward_timelock = reward_timelock;
        lock.recipient = recipient;
        lock.status = STATUS_PENDING;
        lock.reward_recipient = reward_recipient;
        lock.token_mint = Pubkey::default();
        lock.reward_token_mint = Pubkey::default();

        ctx.accounts.counter.count = index;

        emit!(SolverLocked {
            hashlock,
            sender,
            recipient,
            index,
            src_chain,
            token_mint: Pubkey::default(),
            amount,
            reward,
            reward_token_mint: Pubkey::default(),
            reward_recipient,
            timelock,
            reward_timelock,
            dst_chain,
            dst_address,
            dst_amount,
            dst_token,
            data,
        });
        Ok(())
    }

    // ── SolverLock: SPL token amount + same SPL token reward (single vault) ────

    #[allow(clippy::too_many_arguments)]
    pub fn solver_lock_token(
        ctx: Context<SolverLockToken>,
        hashlock: [u8; 32],
        index: u64,
        amount: u64,
        reward: u64,
        timelock_delta: u64,
        reward_timelock_delta: u64,
        sender: Pubkey,
        recipient: Pubkey,
        reward_recipient: Pubkey,
        src_chain: String,
        dst_chain: String,
        dst_address: String,
        dst_amount: u64,
        dst_token: String,
        data: Vec<u8>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        require!(amount > 0, TrainError::ZeroAmount);
        require!(timelock_delta > 0, TrainError::ZeroTimelockDelta);
        if reward > 0 {
            require!(
                reward_timelock_delta < timelock_delta,
                TrainError::RewardTimelockNotLessThanTimelock
            );
        }
        require!(
            index == ctx.accounts.counter.count.checked_add(1).ok_or(TrainError::Overflow)?,
            TrainError::InvalidIndex
        );

        let timelock = now.checked_add(timelock_delta).ok_or(TrainError::Overflow)?;
        let reward_timelock = now.checked_add(reward_timelock_delta).ok_or(TrainError::Overflow)?;
        let total = amount.checked_add(reward).ok_or(TrainError::Overflow)?;
        let token_mint_key = ctx.accounts.token_mint.key();

        // Transfer amount + reward tokens into vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.sender_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        );
        token_interface::transfer_checked(cpi_ctx, total, ctx.accounts.token_mint.decimals)?;

        let lock = &mut ctx.accounts.solver_lock;
        lock.secret = [0u8; 32];
        lock.amount = amount;
        lock.reward = reward;
        lock.sender = sender;
        lock.timelock = timelock;
        lock.reward_timelock = reward_timelock;
        lock.recipient = recipient;
        lock.status = STATUS_PENDING;
        lock.reward_recipient = reward_recipient;
        lock.token_mint = token_mint_key;
        lock.reward_token_mint = token_mint_key;

        ctx.accounts.counter.count = index;

        emit!(SolverLocked {
            hashlock,
            sender,
            recipient,
            index,
            src_chain,
            token_mint: token_mint_key,
            amount,
            reward,
            reward_token_mint: token_mint_key,
            reward_recipient,
            timelock,
            reward_timelock,
            dst_chain,
            dst_address,
            dst_amount,
            dst_token,
            data,
        });
        Ok(())
    }

    // ── SolverLock: SPL token amount + different SPL token reward (two vaults) ─

    #[allow(clippy::too_many_arguments)]
    pub fn solver_lock_token_diff_reward(
        ctx: Context<SolverLockTokenDiffReward>,
        hashlock: [u8; 32],
        index: u64,
        amount: u64,
        reward: u64,
        timelock_delta: u64,
        reward_timelock_delta: u64,
        sender: Pubkey,
        recipient: Pubkey,
        reward_recipient: Pubkey,
        src_chain: String,
        dst_chain: String,
        dst_address: String,
        dst_amount: u64,
        dst_token: String,
        data: Vec<u8>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        require!(amount > 0, TrainError::ZeroAmount);
        require!(timelock_delta > 0, TrainError::ZeroTimelockDelta);
        if reward > 0 {
            require!(
                reward_timelock_delta < timelock_delta,
                TrainError::RewardTimelockNotLessThanTimelock
            );
        }
        require!(
            ctx.accounts.token_mint.key() != ctx.accounts.reward_token_mint.key(),
            TrainError::WrongToken
        );
        require!(
            index == ctx.accounts.counter.count.checked_add(1).ok_or(TrainError::Overflow)?,
            TrainError::InvalidIndex
        );

        let timelock = now.checked_add(timelock_delta).ok_or(TrainError::Overflow)?;
        let reward_timelock = now.checked_add(reward_timelock_delta).ok_or(TrainError::Overflow)?;
        let token_mint_key = ctx.accounts.token_mint.key();
        let reward_token_mint_key = ctx.accounts.reward_token_mint.key();

        // Transfer amount tokens into vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.sender_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        );
        token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.token_mint.decimals)?;

        // Transfer reward tokens into reward_vault
        if reward > 0 {
            let cpi_ctx2 = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.sender_reward_token_account.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.reward_token_mint.to_account_info(),
                    authority: ctx.accounts.signer.to_account_info(),
                },
            );
            token_interface::transfer_checked(cpi_ctx2, reward, ctx.accounts.reward_token_mint.decimals)?;
        }

        let lock = &mut ctx.accounts.solver_lock;
        lock.secret = [0u8; 32];
        lock.amount = amount;
        lock.reward = reward;
        lock.sender = sender;
        lock.timelock = timelock;
        lock.reward_timelock = reward_timelock;
        lock.recipient = recipient;
        lock.status = STATUS_PENDING;
        lock.reward_recipient = reward_recipient;
        lock.token_mint = token_mint_key;
        lock.reward_token_mint = reward_token_mint_key;

        ctx.accounts.counter.count = index;

        emit!(SolverLocked {
            hashlock,
            sender,
            recipient,
            index,
            src_chain,
            token_mint: token_mint_key,
            amount,
            reward,
            reward_token_mint: reward_token_mint_key,
            reward_recipient,
            timelock,
            reward_timelock,
            dst_chain,
            dst_address,
            dst_amount,
            dst_token,
            data,
        });
        Ok(())
    }

    // ── RefundUser: native SOL ─────────────────────────────────────────────────

    pub fn refund_user_sol(ctx: Context<RefundUserSol>, hashlock: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.user_lock;

        let is_recipient = ctx.accounts.caller.key() == lock.recipient;
        if !is_recipient {
            require!(now >= lock.timelock, TrainError::TimelockNotExpired);
        }

        lock.status = STATUS_REFUNDED;
        let amount = lock.amount;

        ctx.accounts.user_lock.sub_lamports(amount)?;
        ctx.accounts.sender.add_lamports(amount)?;

        emit!(UserRefunded { hashlock });
        Ok(())
    }

    // ── RefundUser: SPL token ──────────────────────────────────────────────────

    pub fn refund_user_token(ctx: Context<RefundUserToken>, hashlock: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.user_lock;

        let is_recipient = ctx.accounts.caller.key() == lock.recipient;
        if !is_recipient {
            require!(now >= lock.timelock, TrainError::TimelockNotExpired);
        }

        lock.status = STATUS_REFUNDED;
        let amount = lock.amount;
        let bump = ctx.bumps.user_lock;
        let signer_seeds: &[&[&[u8]]] = &[&[b"user_lock", hashlock.as_ref(), &[bump]]];

        transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.sender_token_account.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.user_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        close_vault_if_empty(
            &mut ctx.accounts.vault,
            ctx.accounts.sender.to_account_info(),
            ctx.accounts.user_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
        )?;

        emit!(UserRefunded { hashlock });
        Ok(())
    }

    // ── RefundSolver: native SOL ───────────────────────────────────────────────

    pub fn refund_solver_sol(
        ctx: Context<RefundSolverSol>,
        hashlock: [u8; 32],
        _index: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.solver_lock;

        require!(now >= lock.timelock, TrainError::TimelockNotExpired);

        lock.status = STATUS_REFUNDED;
        let total = lock.amount.checked_add(lock.reward).ok_or(TrainError::Overflow)?;

        ctx.accounts.solver_lock.sub_lamports(total)?;
        ctx.accounts.sender.add_lamports(total)?;

        emit!(SolverRefunded { hashlock, index: _index });
        Ok(())
    }

    // ── RefundSolver: SPL token (single vault) ─────────────────────────────────

    pub fn refund_solver_token(
        ctx: Context<RefundSolverToken>,
        hashlock: [u8; 32],
        index: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.solver_lock;

        require!(now >= lock.timelock, TrainError::TimelockNotExpired);

        lock.status = STATUS_REFUNDED;
        let total = lock.amount.checked_add(lock.reward).ok_or(TrainError::Overflow)?;
        let index_bytes = index.to_le_bytes();
        let bump = ctx.bumps.solver_lock;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"solver_lock", hashlock.as_ref(), index_bytes.as_ref(), &[bump]]];

        transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.sender_token_account.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            total,
            ctx.accounts.token_mint.decimals,
        )?;

        close_vault_if_empty(
            &mut ctx.accounts.vault,
            ctx.accounts.sender.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
        )?;

        emit!(SolverRefunded { hashlock, index });
        Ok(())
    }

    // ── RefundSolver: SPL token diff reward (two vaults) ──────────────────────

    pub fn refund_solver_token_diff_reward(
        ctx: Context<RefundSolverTokenDiffReward>,
        hashlock: [u8; 32],
        index: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.solver_lock;

        require!(now >= lock.timelock, TrainError::TimelockNotExpired);

        lock.status = STATUS_REFUNDED;
        let amount = lock.amount;
        let reward = lock.reward;
        let index_bytes = index.to_le_bytes();
        let bump = ctx.bumps.solver_lock;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"solver_lock", hashlock.as_ref(), index_bytes.as_ref(), &[bump]]];

        // Return amount tokens
        transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.sender_token_account.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            amount,
            ctx.accounts.token_mint.decimals,
        )?;
        close_vault_if_empty(
            &mut ctx.accounts.vault,
            ctx.accounts.sender.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
        )?;

        // Return reward tokens
        if reward > 0 {
            transfer_from_vault(
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.sender_reward_token_account.to_account_info(),
                ctx.accounts.reward_token_mint.to_account_info(),
                ctx.accounts.solver_lock.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                signer_seeds,
                reward,
                ctx.accounts.reward_token_mint.decimals,
            )?;
            close_vault_if_empty(
                &mut ctx.accounts.reward_vault,
                ctx.accounts.sender.to_account_info(),
                ctx.accounts.solver_lock.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                signer_seeds,
            )?;
        }

        emit!(SolverRefunded { hashlock, index });
        Ok(())
    }

    // ── RedeemUser: native SOL ─────────────────────────────────────────────────

    pub fn redeem_user_sol(
        ctx: Context<RedeemUserSol>,
        hashlock: [u8; 32],
        secret: [u8; 32],
    ) -> Result<()> {
        verify_hashlock(&secret, &hashlock)?;

        let lock = &mut ctx.accounts.user_lock;

        lock.status = STATUS_REDEEMED;
        lock.secret = secret;
        let amount = lock.amount;

        ctx.accounts.user_lock.sub_lamports(amount)?;
        ctx.accounts.recipient.add_lamports(amount)?;

        emit!(UserRedeemed {
            hashlock,
            redeemer: ctx.accounts.caller.key(),
            secret,
        });
        Ok(())
    }

    // ── RedeemUser: SPL token ──────────────────────────────────────────────────

    pub fn redeem_user_token(
        ctx: Context<RedeemUserToken>,
        hashlock: [u8; 32],
        secret: [u8; 32],
    ) -> Result<()> {
        verify_hashlock(&secret, &hashlock)?;

        let lock = &mut ctx.accounts.user_lock;

        lock.status = STATUS_REDEEMED;
        lock.secret = secret;
        let amount = lock.amount;
        let bump = ctx.bumps.user_lock;
        let signer_seeds: &[&[&[u8]]] = &[&[b"user_lock", hashlock.as_ref(), &[bump]]];

        transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.recipient_token_account.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.user_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        close_vault_if_empty(
            &mut ctx.accounts.vault,
            ctx.accounts.caller.to_account_info(),
            ctx.accounts.user_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
        )?;

        emit!(UserRedeemed {
            hashlock,
            redeemer: ctx.accounts.caller.key(),
            secret,
        });
        Ok(())
    }

    // ── RedeemSolver: native SOL ───────────────────────────────────────────────

    pub fn redeem_solver_sol(
        ctx: Context<RedeemSolverSol>,
        hashlock: [u8; 32],
        index: u64,
        secret: [u8; 32],
    ) -> Result<()> {
        verify_hashlock(&secret, &hashlock)?;

        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.solver_lock;

        lock.status = STATUS_REDEEMED;
        lock.secret = secret;
        let amount = lock.amount;
        let reward = lock.reward;
        let reward_timelock = lock.reward_timelock;

        // Amount always → recipient
        ctx.accounts.solver_lock.sub_lamports(amount)?;
        ctx.accounts.recipient.add_lamports(amount)?;

        // Reward routing
        if reward > 0 {
            ctx.accounts.solver_lock.sub_lamports(reward)?;
            if now < reward_timelock {
                ctx.accounts.reward_recipient.add_lamports(reward)?;
            } else {
                ctx.accounts.caller.add_lamports(reward)?;
            }
        }

        emit!(SolverRedeemed {
            hashlock,
            index,
            redeemer: ctx.accounts.caller.key(),
            secret,
        });
        Ok(())
    }

    // ── RedeemSolver: SPL token single vault ──────────────────────────────────

    pub fn redeem_solver_token(
        ctx: Context<RedeemSolverToken>,
        hashlock: [u8; 32],
        index: u64,
        secret: [u8; 32],
    ) -> Result<()> {
        verify_hashlock(&secret, &hashlock)?;

        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.solver_lock;

        lock.status = STATUS_REDEEMED;
        lock.secret = secret;
        let amount = lock.amount;
        let reward = lock.reward;
        let reward_timelock = lock.reward_timelock;
        let index_bytes = index.to_le_bytes();
        let bump = ctx.bumps.solver_lock;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"solver_lock", hashlock.as_ref(), index_bytes.as_ref(), &[bump]]];

        // Amount always → recipient ATA
        transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.recipient_token_account.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        // Reward routing
        if reward > 0 {
            if now < reward_timelock {
                transfer_from_vault(
                    ctx.accounts.vault.to_account_info(),
                    ctx.accounts.reward_recipient_token_account.to_account_info(),
                    ctx.accounts.token_mint.to_account_info(),
                    ctx.accounts.solver_lock.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    signer_seeds,
                    reward,
                    ctx.accounts.token_mint.decimals,
                )?;
            } else {
                transfer_from_vault(
                    ctx.accounts.vault.to_account_info(),
                    ctx.accounts.caller_token_account.to_account_info(),
                    ctx.accounts.token_mint.to_account_info(),
                    ctx.accounts.solver_lock.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    signer_seeds,
                    reward,
                    ctx.accounts.token_mint.decimals,
                )?;
            }
        }

        close_vault_if_empty(
            &mut ctx.accounts.vault,
            ctx.accounts.caller.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
        )?;

        emit!(SolverRedeemed {
            hashlock,
            index,
            redeemer: ctx.accounts.caller.key(),
            secret,
        });
        Ok(())
    }

    // ── RedeemSolver: SPL token diff reward (two vaults) ─────────────────────

    pub fn redeem_solver_token_diff_reward(
        ctx: Context<RedeemSolverTokenDiffReward>,
        hashlock: [u8; 32],
        index: u64,
        secret: [u8; 32],
    ) -> Result<()> {
        verify_hashlock(&secret, &hashlock)?;

        let now = Clock::get()?.unix_timestamp as u64;
        let lock = &mut ctx.accounts.solver_lock;

        lock.status = STATUS_REDEEMED;
        lock.secret = secret;
        let amount = lock.amount;
        let reward = lock.reward;
        let reward_timelock = lock.reward_timelock;
        let index_bytes = index.to_le_bytes();
        let bump = ctx.bumps.solver_lock;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"solver_lock", hashlock.as_ref(), index_bytes.as_ref(), &[bump]]];

        // Amount always → recipient ATA (from main vault)
        transfer_from_vault(
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.recipient_token_account.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
            amount,
            ctx.accounts.token_mint.decimals,
        )?;
        close_vault_if_empty(
            &mut ctx.accounts.vault,
            ctx.accounts.caller.to_account_info(),
            ctx.accounts.solver_lock.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer_seeds,
        )?;

        // Reward routing (from reward vault)
        if reward > 0 {
            if now < reward_timelock {
                transfer_from_vault(
                    ctx.accounts.reward_vault.to_account_info(),
                    ctx.accounts.reward_recipient_token_account.to_account_info(),
                    ctx.accounts.reward_token_mint.to_account_info(),
                    ctx.accounts.solver_lock.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    signer_seeds,
                    reward,
                    ctx.accounts.reward_token_mint.decimals,
                )?;
            } else {
                transfer_from_vault(
                    ctx.accounts.reward_vault.to_account_info(),
                    ctx.accounts.caller_reward_token_account.to_account_info(),
                    ctx.accounts.reward_token_mint.to_account_info(),
                    ctx.accounts.solver_lock.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    signer_seeds,
                    reward,
                    ctx.accounts.reward_token_mint.decimals,
                )?;
            }
            close_vault_if_empty(
                &mut ctx.accounts.reward_vault,
                ctx.accounts.caller.to_account_info(),
                ctx.accounts.solver_lock.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                signer_seeds,
            )?;
        }

        emit!(SolverRedeemed {
            hashlock,
            index,
            redeemer: ctx.accounts.caller.key(),
            secret,
        });
        Ok(())
    }

    // ── Close: reclaim rent from terminal UserLock ────────────────────────────

    pub fn close_user_lock(_ctx: Context<CloseUserLock>, _hashlock: [u8; 32]) -> Result<()> {
        // Account is closed via the `close = caller` constraint
        Ok(())
    }

    // ── Close: reclaim rent from terminal SolverLock ────────────────────────

    pub fn close_solver_lock(
        _ctx: Context<CloseSolverLock>,
        _hashlock: [u8; 32],
        _index: u64,
    ) -> Result<()> {
        // Account is closed via the `close = caller` constraint
        Ok(())
    }

    // ── View: get UserLock ─────────────────────────────────────────────────────

    pub fn get_user_lock(ctx: Context<GetUserLock>, _hashlock: [u8; 32]) -> Result<UserLockData> {
        let lock = &ctx.accounts.user_lock;
        Ok(UserLockData {
            secret: lock.secret,
            amount: lock.amount,
            sender: lock.sender,
            timelock: lock.timelock,
            status: lock.status,
            recipient: lock.recipient,
            token_mint: lock.token_mint,
        })
    }

    // ── View: get SolverLock ───────────────────────────────────────────────────

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
            recipient: lock.recipient,
            status: lock.status,
            reward_recipient: lock.reward_recipient,
            token_mint: lock.token_mint,
            reward_token_mint: lock.reward_token_mint,
        })
    }

    // ── View: get SolverLock count ─────────────────────────────────────────────

    pub fn get_solver_lock_count(
        ctx: Context<GetSolverLockCount>,
        _hashlock: [u8; 32],
    ) -> Result<u64> {
        Ok(ctx.accounts.counter.count)
    }
}

// ─── Account structs ───────────────────────────────────────────────────────────

#[account]
#[derive(Default, InitSpace)]
pub struct UserLock {
    pub secret:     [u8; 32],
    pub amount:     u64,
    pub sender:     Pubkey,
    pub timelock:   u64,
    pub status:     u8,
    pub recipient:  Pubkey,
    pub token_mint: Pubkey,
}

#[account]
#[derive(Default, InitSpace)]
pub struct SolverLock {
    pub secret:            [u8; 32],
    pub amount:            u64,
    pub reward:            u64,
    pub sender:            Pubkey,
    pub timelock:          u64,
    pub reward_timelock:   u64,
    pub recipient:         Pubkey,
    pub status:            u8,
    pub reward_recipient:  Pubkey,
    pub token_mint:        Pubkey,
    pub reward_token_mint: Pubkey,
}

#[account]
#[derive(Default, InitSpace)]
pub struct SolverLockCounter {
    pub count: u64,
}

// ─── Return data structs ───────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UserLockData {
    pub secret:     [u8; 32],
    pub amount:     u64,
    pub sender:     Pubkey,
    pub timelock:   u64,
    pub status:     u8,
    pub recipient:  Pubkey,
    pub token_mint: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SolverLockData {
    pub secret:            [u8; 32],
    pub amount:            u64,
    pub reward:            u64,
    pub sender:            Pubkey,
    pub timelock:          u64,
    pub reward_timelock:   u64,
    pub recipient:         Pubkey,
    pub status:            u8,
    pub reward_recipient:  Pubkey,
    pub token_mint:        Pubkey,
    pub reward_token_mint: Pubkey,
}

// ─── Instruction account contexts ─────────────────────────────────────────────

// -- UserLock SOL --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32])]
pub struct UserLockSol<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + UserLock::INIT_SPACE,
        seeds = [b"user_lock", hashlock.as_ref()],
        bump,
    )]
    pub user_lock: Account<'info, UserLock>,

    pub system_program: Program<'info, System>,
}

// -- UserLock Token --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32])]
pub struct UserLockToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + UserLock::INIT_SPACE,
        seeds = [b"user_lock", hashlock.as_ref()],
        bump,
    )]
    pub user_lock: Account<'info, UserLock>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = sender_token_account.owner == signer.key() @ TrainError::WrongToken,
        constraint = sender_token_account.mint == token_mint.key() @ TrainError::WrongToken,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        seeds = [b"user_vault", hashlock.as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = user_lock,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- SolverLock SOL --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct SolverLockSol<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + SolverLockCounter::INIT_SPACE,
        seeds = [b"solver_count", hashlock.as_ref()],
        bump,
    )]
    pub counter: Account<'info, SolverLockCounter>,

    #[account(
        init,
        payer = signer,
        space = 8 + SolverLock::INIT_SPACE,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    pub system_program: Program<'info, System>,
}

// -- SolverLock Token (same token for amount + reward) --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct SolverLockToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + SolverLockCounter::INIT_SPACE,
        seeds = [b"solver_count", hashlock.as_ref()],
        bump,
    )]
    pub counter: Account<'info, SolverLockCounter>,

    #[account(
        init,
        payer = signer,
        space = 8 + SolverLock::INIT_SPACE,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = sender_token_account.owner == signer.key() @ TrainError::WrongToken,
        constraint = sender_token_account.mint == token_mint.key() @ TrainError::WrongToken,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        seeds = [b"solver_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = solver_lock,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- SolverLock Token with different reward token (two vaults) --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct SolverLockTokenDiffReward<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + SolverLockCounter::INIT_SPACE,
        seeds = [b"solver_count", hashlock.as_ref()],
        bump,
    )]
    pub counter: Account<'info, SolverLockCounter>,

    #[account(
        init,
        payer = signer,
        space = 8 + SolverLock::INIT_SPACE,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Box<Account<'info, SolverLock>>,

    pub token_mint: InterfaceAccount<'info, Mint>,
    pub reward_token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = sender_token_account.owner == signer.key() @ TrainError::WrongToken,
        constraint = sender_token_account.mint == token_mint.key() @ TrainError::WrongToken,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = sender_reward_token_account.owner == signer.key() @ TrainError::WrongToken,
        constraint = sender_reward_token_account.mint == reward_token_mint.key() @ TrainError::WrongToken,
    )]
    pub sender_reward_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        seeds = [b"solver_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = solver_lock,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        seeds = [b"solver_reward_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        token::mint = reward_token_mint,
        token::authority = solver_lock,
        token::token_program = token_program,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- RefundUser SOL --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32])]
pub struct RefundUserSol<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_lock", hashlock.as_ref()],
        bump,
        constraint = user_lock.status == STATUS_PENDING @ TrainError::NotPending,
    )]
    pub user_lock: Account<'info, UserLock>,

    /// CHECK: verified via user_lock.sender
    #[account(
        mut,
        constraint = sender.key() == user_lock.sender @ TrainError::WrongSender,
    )]
    pub sender: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// -- RefundUser Token --

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
    )]
    pub user_lock: Account<'info, UserLock>,

    /// CHECK: verified via user_lock.sender
    #[account(
        mut,
        constraint = sender.key() == user_lock.sender @ TrainError::WrongSender,
    )]
    pub sender: UncheckedAccount<'info>,

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
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- RefundSolver SOL --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], _index: u64)]
pub struct RefundSolverSol<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), &_index.to_le_bytes()],
        bump,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.sender
    #[account(
        mut,
        constraint = sender.key() == solver_lock.sender @ TrainError::WrongSender,
    )]
    pub sender: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// -- RefundSolver Token (single vault) --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct RefundSolverToken<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.sender
    #[account(
        mut,
        constraint = sender.key() == solver_lock.sender @ TrainError::WrongSender,
    )]
    pub sender: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"solver_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- RefundSolver Token DiffReward (two vaults) --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct RefundSolverTokenDiffReward<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.sender
    #[account(
        mut,
        constraint = sender.key() == solver_lock.sender @ TrainError::WrongSender,
    )]
    pub sender: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = reward_token_mint.key() == solver_lock.reward_token_mint @ TrainError::WrongToken,
    )]
    pub reward_token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"solver_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"solver_reward_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_reward_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- RedeemUser SOL --

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
    )]
    pub user_lock: Account<'info, UserLock>,

    /// CHECK: verified via user_lock.recipient
    #[account(
        mut,
        constraint = recipient.key() == user_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// -- RedeemUser Token --

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
    )]
    pub user_lock: Account<'info, UserLock>,

    /// CHECK: verified via user_lock.recipient
    #[account(
        constraint = recipient.key() == user_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

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

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- RedeemSolver SOL --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct RedeemSolverSol<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.recipient
    #[account(
        mut,
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.reward_recipient
    #[account(
        mut,
        constraint = reward_recipient.key() == solver_lock.reward_recipient @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// -- RedeemSolver Token (single vault) --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct RedeemSolverToken<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.recipient
    #[account(
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.reward_recipient
    #[account(
        constraint = reward_recipient.key() == solver_lock.reward_recipient @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"solver_vault", hashlock.as_ref(), &index.to_le_bytes()],
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

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = reward_recipient,
        associated_token::token_program = token_program,
    )]
    pub reward_recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = caller,
        associated_token::token_program = token_program,
    )]
    pub caller_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- RedeemSolver Token DiffReward (two vaults) --

#[derive(Accounts)]
#[instruction(hashlock: [u8; 32], index: u64)]
pub struct RedeemSolverTokenDiffReward<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"solver_lock", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
        constraint = solver_lock.status == STATUS_PENDING @ TrainError::NotPending,
    )]
    pub solver_lock: Account<'info, SolverLock>,

    /// CHECK: verified via solver_lock.recipient
    #[account(
        constraint = recipient.key() == solver_lock.recipient @ TrainError::WrongRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: verified via solver_lock.reward_recipient
    #[account(
        constraint = reward_recipient.key() == solver_lock.reward_recipient @ TrainError::WrongRecipient,
    )]
    pub reward_recipient: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == solver_lock.token_mint @ TrainError::WrongToken,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = reward_token_mint.key() == solver_lock.reward_token_mint @ TrainError::WrongToken,
    )]
    pub reward_token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"solver_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"solver_reward_vault", hashlock.as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = reward_recipient,
        associated_token::token_program = token_program,
    )]
    pub reward_recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = reward_token_mint,
        associated_token::authority = caller,
        associated_token::token_program = token_program,
    )]
    pub caller_reward_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// -- Close UserLock --

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32])]
pub struct CloseUserLock<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_lock", _hashlock.as_ref()],
        bump,
        constraint = user_lock.status != STATUS_PENDING @ TrainError::StillPending,
        close = caller,
    )]
    pub user_lock: Account<'info, UserLock>,
}

// -- Close SolverLock --

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
        close = caller,
    )]
    pub solver_lock: Account<'info, SolverLock>,
}

// -- View: GetUserLock --

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32])]
pub struct GetUserLock<'info> {
    #[account(
        seeds = [b"user_lock", _hashlock.as_ref()],
        bump,
    )]
    pub user_lock: Account<'info, UserLock>,
}

// -- View: GetSolverLock --

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32], _index: u64)]
pub struct GetSolverLock<'info> {
    #[account(
        seeds = [b"solver_lock", _hashlock.as_ref(), &_index.to_le_bytes()],
        bump,
    )]
    pub solver_lock: Account<'info, SolverLock>,
}

// -- View: GetSolverLockCount --

#[derive(Accounts)]
#[instruction(_hashlock: [u8; 32])]
pub struct GetSolverLockCount<'info> {
    #[account(
        seeds = [b"solver_count", _hashlock.as_ref()],
        bump,
    )]
    pub counter: Account<'info, SolverLockCounter>,
}

// ─── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct UserLocked {
    pub hashlock:              [u8; 32],
    pub sender:                Pubkey,
    pub recipient:             Pubkey,
    pub src_chain:             String,
    pub token_mint:            Pubkey,
    pub amount:                u64,
    pub timelock:              u64,
    pub dst_chain:             String,
    pub dst_address:           String,
    pub dst_amount:            u64,
    pub dst_token:             String,
    pub reward_amount:         u64,
    pub reward_token:          String,
    pub reward_recipient:      String,
    pub reward_timelock_delta: u64,
    pub quote_expiry:          u64,
    pub user_data:             Vec<u8>,
    pub solver_data:           Vec<u8>,
}

#[event]
pub struct SolverLocked {
    pub hashlock:          [u8; 32],
    pub sender:            Pubkey,
    pub recipient:         Pubkey,
    pub index:             u64,
    pub src_chain:         String,
    pub token_mint:        Pubkey,
    pub amount:            u64,
    pub reward:            u64,
    pub reward_token_mint: Pubkey,
    pub reward_recipient:  Pubkey,
    pub timelock:          u64,
    pub reward_timelock:   u64,
    pub dst_chain:         String,
    pub dst_address:       String,
    pub dst_amount:        u64,
    pub dst_token:         String,
    pub data:              Vec<u8>,
}

#[event]
pub struct UserRefunded {
    pub hashlock: [u8; 32],
}

#[event]
pub struct SolverRefunded {
    pub hashlock: [u8; 32],
    pub index:    u64,
}

#[event]
pub struct UserRedeemed {
    pub hashlock: [u8; 32],
    pub redeemer: Pubkey,
    pub secret:   [u8; 32],
}

#[event]
pub struct SolverRedeemed {
    pub hashlock: [u8; 32],
    pub index:    u64,
    pub redeemer: Pubkey,
    pub secret:   [u8; 32],
}

// ─── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum TrainError {
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Timelock delta must be greater than zero.")]
    ZeroTimelockDelta,
    #[msg("Quote has expired.")]
    QuoteExpired,
    #[msg("Lock is not in Pending status.")]
    NotPending,
    #[msg("Timelock has not expired yet.")]
    TimelockNotExpired,
    #[msg("Secret does not match hashlock.")]
    HashlockMismatch,
    #[msg("Reward timelock delta must be less than timelock delta.")]
    RewardTimelockNotLessThanTimelock,
    #[msg("Invalid index: must equal current count + 1.")]
    InvalidIndex,
    #[msg("Wrong token mint provided.")]
    WrongToken,
    #[msg("Wrong sender address.")]
    WrongSender,
    #[msg("Wrong recipient address.")]
    WrongRecipient,
    #[msg("Lock is still pending.")]
    StillPending,
    #[msg("Arithmetic overflow.")]
    Overflow,
}
