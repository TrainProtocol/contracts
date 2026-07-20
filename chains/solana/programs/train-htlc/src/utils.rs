use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::Instruction,
    program::{get_return_data, invoke},
};
use solana_sha256_hasher::hashv;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as MintState,
};
use anchor_spl::token_interface::{self, CloseAccount, TokenAccount, TransferChecked};

use crate::errors::TrainError;

/// hashlock = sha256(secret) over the raw 32 bytes. The secret is an opaque 32-byte
/// value, so this stays byte-compatible with counterpart chains that hash the same
/// 32-byte big-endian representation.
pub fn verify_hashlock(secret: &[u8; 32], hashlock: &[u8; 32]) -> Result<()> {
    let computed = hashv(&[secret]).to_bytes();
    require!(computed == *hashlock, TrainError::HashlockMismatch);
    Ok(())
}

pub fn transfer_from_vault<'info>(
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

pub fn close_vault_if_empty<'info>(
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
        // Rent-recovery only — NOT a fund transfer (principal/reward were already
        // moved out). A drained vault can still be un-closable under Token-2022
        // (e.g. a transfer-fee mint leaves `withheld_amount != 0` on the vault, and
        // CloseAccount then errors AccountHasWithheldTransferFees). We must NOT let
        // that brick redeem/refund, so a close failure is tolerated: the vault (and
        // its rent) is left for out-of-band recovery (harvest withheld fees, then
        // close). Settlement correctness does not depend on the close.
        if let Err(e) = token_interface::close_account(cpi_ctx) {
            msg!("vault close skipped (not closable, rent left for recovery): {:?}", e);
        }
    }
    Ok(())
}

/// Transfer `amount` into `vault` and return the measured received amount
/// (vault balance delta), making accounting fee-on-transfer safe for Token-2022
/// transfer-fee mints.
#[allow(clippy::too_many_arguments)]
pub fn transfer_in_measured<'info>(
    from: AccountInfo<'info>,
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    mint: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<u64> {
    let before = vault.amount;
    let cpi_ctx = CpiContext::new_with_signer(
        token_program,
        TransferChecked {
            from,
            to: vault.to_account_info(),
            mint,
            authority,
        },
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;
    vault.reload()?;
    let received = vault
        .amount
        .checked_sub(before)
        .ok_or(TrainError::Overflow)?;
    require!(received > 0, TrainError::NothingReceived);
    Ok(received)
}

/// Split a measured single-vault total between principal and reward proportionally
/// to the requested split.
pub fn split_measured(received: u64, amount: u64, reward: u64) -> Result<(u64, u64)> {
    let total = amount.checked_add(reward).ok_or(TrainError::Overflow)?;
    let actual_amount = ((received as u128)
        .checked_mul(amount as u128)
        .ok_or(TrainError::Overflow)?
        / total as u128) as u64;
    require!(actual_amount > 0, TrainError::NothingReceived);
    let actual_reward = received
        .checked_sub(actual_amount)
        .ok_or(TrainError::Overflow)?;
    Ok((actual_amount, actual_reward))
}

/// INVARIANT (Token-2022 policy): mints whose extensions can break escrow solvency
/// (permanent delegate can seize vault funds) or permanently strand funds (a
/// reverting transfer hook bricks refunds) are rejected at lock creation. All other
/// extensions (e.g. transfer fee) are accepted with measured-received accounting.
pub fn validate_mint_extensions(mint: &AccountInfo) -> Result<()> {
    if *mint.owner == anchor_spl::token_2022::ID {
        let data = mint.try_borrow_data()?;
        let state = StateWithExtensions::<MintState>::unpack(&data)
            .map_err(|_| error!(TrainError::WrongToken))?;
        let extensions = state
            .get_extension_types()
            .map_err(|_| error!(TrainError::WrongToken))?;
        for ext in extensions {
            // Reject ONLY extensions that break escrow solvency or PERMANENTLY
            // strand funds — i.e. that can cause loss no honest party can recover:
            // - PermanentDelegate: the mint authority can seize funds straight out
            //   of the vault, breaking the solvency invariant (unrecoverable).
            // - TransferHook: runs arbitrary third-party code on every transfer; a
            //   reverting hook permanently bricks refunds (unrecoverable).
            //
            // Extensions that only let a TRUSTED ISSUER temporarily delay transfers
            // are intentionally ACCEPTED — the same trust model callers already take
            // on for issuer-frozen/blacklistable stablecoins like USDC: e.g.
            // `Pausable`, the base-field freeze authority, `DefaultAccountState`. If
            // such a token is paused or an account frozen mid-swap, settlement waits
            // but nothing is lost — once unpaused/thawed, redeem and refund work and
            // the timelock/refund path still returns funds. Transfer fees are
            // accepted too (measured accounting + tolerant vault close).
            if matches!(
                ext,
                ExtensionType::PermanentDelegate | ExtensionType::TransferHook
            ) {
                return err!(TrainError::UnsupportedMintExtension);
            }
        }
    }
    Ok(())
}

fn compute_payout_discriminator() -> [u8; 8] {
    let hash = hashv(&[b"global:compute_payout"]);
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

/// CPI into a payout curve program with ZERO accounts and no signers, so the curve
/// can touch no state and the runtime forbids it from re-entering this program.
/// Result is read from return data.
pub fn compute_payout_cpi(
    curve_program: &AccountInfo,
    amount: u64,
    start_time: u64,
    current_time: u64,
    config: &[u8],
) -> Result<u64> {
    let mut data = Vec::with_capacity(8 + 8 + 8 + 8 + 4 + config.len());
    data.extend_from_slice(&compute_payout_discriminator());
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&start_time.to_le_bytes());
    data.extend_from_slice(&current_time.to_le_bytes());
    data.extend_from_slice(&(config.len() as u32).to_le_bytes());
    data.extend_from_slice(config);

    let ix = Instruction {
        program_id: curve_program.key(),
        accounts: vec![],
        data,
    };
    invoke(&ix, &[curve_program.clone()]).map_err(|_| error!(TrainError::InvalidPayout))?;

    let (returning_program, ret) = get_return_data().ok_or(TrainError::InvalidPayout)?;
    require_keys_eq!(returning_program, curve_program.key(), TrainError::InvalidPayout);
    require!(ret.len() >= 8, TrainError::InvalidPayout);
    let mut payout_bytes = [0u8; 8];
    payout_bytes.copy_from_slice(&ret[..8]);
    Ok(u64::from_le_bytes(payout_bytes))
}

/// Lock-creation validation of a caller-supplied payout curve: the account must
/// match the declared curve id, be executable, and answer a probe compute_payout
/// call with parseable return data. Value bounds are enforced at redeem, not here.
pub fn validate_payout_curve(
    declared_curve: Pubkey,
    curve_account: Option<&AccountInfo>,
    curve_data: &[u8],
    amount: u64,
    now: u64,
) -> Result<()> {
    require!(
        curve_data.len() <= crate::state::MAX_CURVE_DATA,
        TrainError::CurveDataTooLarge
    );
    if declared_curve == Pubkey::default() {
        return Ok(());
    }
    let account = curve_account.ok_or(TrainError::InvalidPayoutCurve)?;
    require_keys_eq!(account.key(), declared_curve, TrainError::InvalidPayoutCurve);
    require!(account.executable, TrainError::InvalidPayoutCurve);
    // Probe: the curve must be callable with this lock's own parameters.
    compute_payout_cpi(account, amount, now, now, curve_data)
        .map_err(|_| error!(TrainError::InvalidPayoutCurve))?;
    Ok(())
}

/// Redeem-time payout computation. Returns (payout, excess) with the invariant
/// 0 < payout <= amount enforced, so `excess = amount - payout` cannot underflow.
/// Excess routes to refund_to; the curve never touches solver rewards.
pub fn compute_payout_checked(
    lock_curve: Pubkey,
    curve_account: Option<&AccountInfo>,
    amount: u64,
    start_time: u64,
    now: u64,
    curve_data: &[u8],
) -> Result<(u64, u64)> {
    if lock_curve == Pubkey::default() {
        return Ok((amount, 0));
    }
    let account = curve_account.ok_or(TrainError::InvalidPayoutCurve)?;
    require_keys_eq!(account.key(), lock_curve, TrainError::InvalidPayoutCurve);
    require!(account.executable, TrainError::InvalidPayoutCurve);
    let payout = compute_payout_cpi(account, amount, start_time, now, curve_data)?;
    require!(payout > 0 && payout <= amount, TrainError::InvalidPayout);
    Ok((payout, amount - payout))
}
