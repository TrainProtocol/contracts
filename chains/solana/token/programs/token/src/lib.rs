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
use anchor_lang::solana_program::ed25519_program::ID as ED25519_ID;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::sysvar::instructions::{load_instruction_at_checked, ID as IX_ID};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{CloseAccount, Mint, Token, TokenAccount, Transfer},
};
use sha2::{Digest, Sha256};
use std::convert::TryInto;
use std::mem::size_of;

declare_id!("AN8Y7CGKNQcBCLxeNmnob786v8EkWhrGBBriPD2JzjK8");
/// @title Pre Hashed Timelock Contracts (PHTLCs) on Solana SPL tokens.
///
/// This contract provides a way to lock and keep PHTLCs for SPL tokens.
///
/// Protocol:
///
///  1) commit(src_receiver, timelock, tokenContract, amount) - a
///      sender calls this to create a new HTLC on a given token (tokenContract)
///      for the given amount. A [u8; 32] Id is returned.
///  2) lock(src_receiver, hashlock, timelock, tokenContract, amount) - a
///      sender calls this to create a new HTLC on a given token (tokenContract)
///      for the given amount. A [u8; 32] Id is returned.
///  3) add_lock(Id, hashlock) - the sender calls this function
///      to add hashlock to the HTLC.
///  4) redeem(Id, secret) - once the src_receiver knows the secret of
///      the hashlock hash they can claim the tokens with this function
///  5) refund(Id) - after timelock has expired and if the src_receiver did not
///      redeem the tokens the sender / creator of the HTLC can get their tokens
///      back with this function.

/// @dev A small utility function that allows us to transfer funds out of the htlc.
///
/// * `sender` - htlc creator's account
/// * `Id` - The index of the htlc
/// * `htlc` - the htlc public key (PDA)
/// * `htlc_bump` - the htlc public key (PDA) bump
/// * `htlc_token_account` - The htlc Token account
/// * `token_program` - the token program address
/// * `destination_wallet` - The public key of the destination address (where to send funds)
/// * `amount` - the amount of token that is sent from `htlc_token_account` to `destination_wallet`
fn transfer_htlc_out<'info>(
    sender: AccountInfo<'info>,
    Id: [u8; 32],
    htlc: AccountInfo<'info>,
    htlc_bump: u8,
    htlc_token_account: &mut Account<'info, TokenAccount>,
    token_program: AccountInfo<'info>,
    destination_wallet: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let bump_vector = htlc_bump.to_le_bytes();
    let inner = vec![Id.as_ref(), bump_vector.as_ref()];
    let outer = vec![inner.as_slice()];

    // Perform the actual transfer
    let transfer_instruction = Transfer {
        from: htlc_token_account.to_account_info(),
        to: destination_wallet,
        authority: htlc.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        transfer_instruction,
        outer.as_slice(),
    );
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    // Use the `reload()` function on an account to reload it's state. Since we performed the
    // transfer, we are expecting the `amount` field to have changed.
    let should_close = {
        htlc_token_account.reload()?;
        htlc_token_account.amount == 0
    };

    // If token account has no more tokens, it should be wiped out since it has no other use case.
    if should_close {
        let ca = CloseAccount {
            account: htlc_token_account.to_account_info(),
            destination: sender.to_account_info(),
            authority: htlc.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(token_program.to_account_info(), ca, outer.as_slice());
        anchor_spl::token::close_account(cpi_ctx)?;
    }

    Ok(())
}

fn transfer_htlc_reward_out<'info>(
    sender: AccountInfo<'info>,
    Id: [u8; 32],
    htlc: AccountInfo<'info>,
    htlc_bump: u8,
    htlc_token_account: &mut Account<'info, TokenAccount>,
    token_program: AccountInfo<'info>,
    destination_wallet: AccountInfo<'info>,
    reward_wallet: AccountInfo<'info>,
    amount: u64,
    reward: u64,
) -> Result<()> {
    let bump_vector = htlc_bump.to_le_bytes();
    let inner = vec![Id.as_ref(), bump_vector.as_ref()];
    let outer = vec![inner.as_slice()];

    // Perform the actual transfer
    let transfer_instruction = Transfer {
        from: htlc_token_account.to_account_info(),
        to: destination_wallet,
        authority: htlc.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        transfer_instruction,
        outer.as_slice(),
    );
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    // Perform the reward transfer
    let reward_instruction = Transfer {
        from: htlc_token_account.to_account_info(),
        to: reward_wallet,
        authority: htlc.to_account_info(),
    };
    let reward_cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        reward_instruction,
        outer.as_slice(),
    );
    anchor_spl::token::transfer(reward_cpi_ctx, reward)?;

    // Use the `reload()` function on an account to reload it's state. Since we performed the
    // transfer, we are expecting the `amount` field to have changed.
    let should_close = {
        htlc_token_account.reload()?;
        htlc_token_account.amount == 0
    };

    // If token account has no more tokens, it should be wiped out since it has no other use case.
    if should_close {
        let ca = CloseAccount {
            account: htlc_token_account.to_account_info(),
            destination: sender.to_account_info(),
            authority: htlc.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(token_program.to_account_info(), ca, outer.as_slice());
        anchor_spl::token::close_account(cpi_ctx)?;
    }

    Ok(())
}

/// Verify serialized Ed25519Program instruction data
pub fn check_ed25519_data(data: &[u8], pubkey: &[u8], msg: &[u8], sig: &[u8]) -> Result<()> {
    // According to this layout used by the Ed25519Program
    // https://github.com/solana-labs/solana-web3.js/blob/master/src/ed25519-program.ts#L33

    // "Deserializing" byte slices

    let num_signatures = &[data[0]]; // Byte  0
    let padding = &[data[1]]; // Byte  1
    let signature_offset = &data[2..=3]; // Bytes 2,3
    let signature_instruction_index = &data[4..=5]; // Bytes 4,5
    let public_key_offset = &data[6..=7]; // Bytes 6,7
    let public_key_instruction_index = &data[8..=9]; // Bytes 8,9
    let message_data_offset = &data[10..=11]; // Bytes 10,11
    let message_data_size = &data[12..=13]; // Bytes 12,13
    let message_instruction_index = &data[14..=15]; // Bytes 14,15

    let data_pubkey = &data[16..16 + 32]; // Bytes 16..16+32
    let data_sig = &data[48..48 + 64]; // Bytes 48..48+64
    let data_msg = &data[112..]; // Bytes 112..end

    // Expected values

    let exp_public_key_offset: u16 = 16; // 2*u8 + 7*u16
    let exp_signature_offset: u16 = exp_public_key_offset + pubkey.len() as u16;
    let exp_message_data_offset: u16 = exp_signature_offset + sig.len() as u16;
    let exp_num_signatures: u8 = 1;
    let exp_message_data_size: u16 = msg.len().try_into().unwrap();

    // Header and Arg Checks

    // Header
    if num_signatures != &exp_num_signatures.to_le_bytes()
        || padding != &[0]
        || signature_offset != &exp_signature_offset.to_le_bytes()
        || signature_instruction_index != &u16::MAX.to_le_bytes()
        || public_key_offset != &exp_public_key_offset.to_le_bytes()
        || public_key_instruction_index != &u16::MAX.to_le_bytes()
        || message_data_offset != &exp_message_data_offset.to_le_bytes()
        || message_data_size != &exp_message_data_size.to_le_bytes()
        || message_instruction_index != &u16::MAX.to_le_bytes()
    {
        return Err(HTLCError::SigVerificationFailed.into());
    }

    // Arguments
    if data_pubkey != pubkey || data_msg != msg || data_sig != sig {
        return Err(HTLCError::SigVerificationFailed.into());
    }

    Ok(())
}

#[program]
pub mod anchor_htlc {
    use super::*;

    /// @dev Sender / Payer sets up a new pre-hash time lock contract depositing the
    /// funds and providing the reciever/src_receiver and terms.
    /// @param src_receiver reciever of the funds.
    /// @param timelock UNIX epoch seconds time that the lock expires at.
    ///                  Refunds can be made after this time.
    /// @return Id of the new HTLC. This is needed for subsequent calls.
    pub fn commit(
        ctx: Context<Commit>,
        Id: [u8; 32],
        hopChains: Vec<String>,
        hopAssets: Vec<String>,
        hopAddress: Vec<String>,
        dst_chain: String,
        dst_asset: String,
        dst_address: String,
        src_asset: String,
        src_receiver: Pubkey,
        timelock: u64,
        amount: u64,
        commit_bump: u8,
    ) -> Result<[u8; 32]> {
        let clock = Clock::get().unwrap();
        let time: u64 = clock.unix_timestamp.try_into().unwrap();
        require!(timelock >= time + 900, HTLCError::InvalidTimeLock);
        require!(amount != 0, HTLCError::FundsNotSent);

        let htlc = &mut ctx.accounts.htlc;

        let bump_vector = commit_bump.to_le_bytes();
        let inner = vec![Id.as_ref(), bump_vector.as_ref()];
        let outer = vec![inner.as_slice()];
        let transfer_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sender_token_account.to_account_info(),
                to: ctx.accounts.htlc_token_account.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
            outer.as_slice(),
        );
        anchor_spl::token::transfer(transfer_context, amount)?;

        htlc.dst_address = dst_address;
        htlc.dst_chain = dst_chain;
        htlc.dst_asset = dst_asset;
        htlc.src_asset = src_asset;
        htlc.sender = *ctx.accounts.sender.to_account_info().key;
        htlc.src_receiver = src_receiver;
        htlc.hashlock = [0u8; 32];
        htlc.secret = [0u8; 32];
        htlc.amount = amount;
        htlc.timelock = timelock;
        htlc.reward = 0;
        htlc.reward_timelock = 0;
        htlc.token_contract = *ctx.accounts.token_contract.to_account_info().key;
        htlc.token_wallet = *ctx.accounts.htlc_token_account.to_account_info().key;
        htlc.claimed = 1;

        // msg!("hop chains: {:?}", hopChains);
        // msg!("hop assets: {:?}", hopAssets);
        // msg!("hop addresses: {:?}", hopAddresses);
        Ok(Id)
    }

    /// @dev Sender / Payer sets up a new hash time lock contract depositing the
    /// funds and providing the reciever and terms.
    /// @param src_receiver receiver of the funds.
    /// @param hashlock A sha-256 hash hashlock.
    /// @param timelock UNIX epoch seconds time that the lock expires at.
    ///                  Refunds can be made after this time.
    /// @return Id of the new HTLC. This is needed for subsequent calls.
    pub fn lock(
        ctx: Context<Lock>,
        Id: [u8; 32],
        hashlock: [u8; 32],
        timelock: u64,
        dst_chain: String,
        dst_address: String,
        dst_asset: String,
        src_asset: String,
        src_receiver: Pubkey,
        amount: u64,
        lock_bump: u8,
    ) -> Result<[u8; 32]> {
        let clock = Clock::get().unwrap();
        let time: u64 = clock.unix_timestamp.try_into().unwrap();
        require!(timelock >= time + 900, HTLCError::InvalidTimeLock);
        require!(amount != 0, HTLCError::FundsNotSent);

        let htlc = &mut ctx.accounts.htlc;

        let bump_vector = lock_bump.to_le_bytes();
        let inner = vec![Id.as_ref(), bump_vector.as_ref()];
        let outer = vec![inner.as_slice()];
        let transfer_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sender_token_account.to_account_info(),
                to: ctx.accounts.htlc_token_account.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
            outer.as_slice(),
        );
        anchor_spl::token::transfer(transfer_context, amount)?;

        htlc.dst_address = dst_address;
        htlc.dst_chain = dst_chain;
        htlc.dst_asset = dst_asset;
        htlc.src_asset = src_asset;
        htlc.sender = *ctx.accounts.sender.to_account_info().key;
        htlc.src_receiver = src_receiver;
        htlc.hashlock = hashlock;
        htlc.secret = [0u8; 32];
        htlc.amount = amount;
        htlc.timelock = timelock;
        htlc.reward = 0;
        htlc.reward_timelock = 0;
        htlc.token_contract = *ctx.accounts.token_contract.to_account_info().key;
        htlc.token_wallet = *ctx.accounts.htlc_token_account.to_account_info().key;
        htlc.claimed = 1;

        Ok(Id)
    }

    pub fn lock_reward(
        ctx: Context<LockReward>,
        Id: [u8; 32],
        reward_timelock: u64,
        reward: u64,
        lock_bump: u8,
    ) -> Result<bool> {
        let clock = Clock::get().unwrap();
        let htlc = &mut ctx.accounts.htlc;

        require!(
            reward_timelock < htlc.timelock
                && reward_timelock > clock.unix_timestamp.try_into().unwrap(),
            HTLCError::InvalidRewardTimeLock
        );
        require!(htlc.reward == 0, HTLCError::RewardAlreadyExists);

        htlc.reward_timelock = reward_timelock;
        htlc.reward = reward;

        let bump_vector = lock_bump.to_le_bytes();
        let inner = vec![Id.as_ref(), bump_vector.as_ref()];
        let outer = vec![inner.as_slice()];
        let transfer_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sender_token_account.to_account_info(),
                to: ctx.accounts.htlc_token_account.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
            outer.as_slice(),
        );
        anchor_spl::token::transfer(transfer_context, reward)?;

        Ok(true)
    }

    /// @dev Called by the sender to add hashlock to the HTLC
    ///
    /// @param Id of the HTLC.
    /// @param hashlock to be added.
    pub fn add_lock(
        ctx: Context<AddLock>,
        Id: [u8; 32],
        hashlock: [u8; 32],
        timelock: u64,
    ) -> Result<[u8; 32]> {
        let clock = Clock::get().unwrap();
        let time: u64 = clock.unix_timestamp.try_into().unwrap();
        require!(timelock >= time + 900, HTLCError::InvalidTimeLock);

        let htlc = &mut ctx.accounts.htlc;

        msg!("Id: {:?}", hex::encode(Id));
        msg!("hashlock: {:?}", hex::encode(hashlock));
        msg!("timelock: {:?}", timelock);

        htlc.hashlock = hashlock;
        htlc.timelock = timelock;

        Ok(Id)
    }

    /// @dev Called by the solver to add hashlock to the HTLC
    ///
    /// @param Id of the HTLC.
    /// @param hashlock to be added.
    pub fn add_lock_sig(
        ctx: Context<AddLockSig>,
        Id: [u8; 32],
        hashlock: [u8; 32],
        timelock: u64,
        signature: [u8; 64],
    ) -> Result<[u8; 32]> {
        let clock = Clock::get().unwrap();
        let time: u64 = clock.unix_timestamp.try_into().unwrap();
        require!(timelock >= time + 900, HTLCError::InvalidTimeLock);
        let htlc = &mut ctx.accounts.htlc;
        let signer = htlc.sender.to_bytes();

        let ix: Instruction = load_instruction_at_checked(0, &ctx.accounts.ix_sysvar)?;

        let mut hasher = Sha256::new();
        hasher.update(Id.clone());
        hasher.update(hashlock.clone());
        hasher.update(timelock.to_le_bytes());
        let hash = hasher.finalize();

        let signing_domain: &[u8; 16] = b"\xffsolana offchain";
        let header_version: [u8; 1] = [0u8]; // Version 0
        let mut application_domain = [0u8; 32];
        application_domain[..5].copy_from_slice(b"Train");
        let message_format = [0u8]; // Assuming Restricted ASCII
        let signer_count = [1u8]; // One signer
        let message_length = (hash.len() as u16).to_le_bytes();

        let mut raw_message = Vec::new();
        raw_message.extend_from_slice(signing_domain);
        raw_message.extend_from_slice(&header_version);
        raw_message.extend_from_slice(&application_domain);
        raw_message.extend_from_slice(&message_format);
        raw_message.extend_from_slice(&signer_count);
        raw_message.extend_from_slice(&signer);
        raw_message.extend_from_slice(&message_length);
        raw_message.extend_from_slice(&hash);

        let hex_message = hex::encode(raw_message);
        let full_message = hex_message.into_bytes();

        // Check that ix is what we expect to have been sent
        if ix.program_id!= ED25519_ID ||  // The program id we expect
        ix.accounts.len()!= 0
        // With no context accounts
        || ix.data.len()!= (16 + 64 + 32 + full_message.len())
        // And data of this size
        {
            return Err(HTLCError::SigVerificationFailed.into());
        }

        check_ed25519_data(&ix.data, &signer, &full_message, &signature)?;

        htlc.hashlock = hashlock;
        htlc.timelock = timelock;

        msg!("Id: {:?}", hex::encode(Id));
        msg!("hashlock: {:?}", hex::encode(hashlock));
        msg!("timelock: {:?}", timelock);

        Ok(Id)
    }

    /// @dev Called by the src_receiver once they know the secret of the hashlock.
    /// This will transfer the locked funds to the HTLC's src_receiver's address.
    ///
    /// @param Id of the HTLC.
    /// @param secret sha256(secret) should equal the contract hashlock.
    pub fn redeem(
        ctx: Context<Redeem>,
        Id: [u8; 32],
        secret: [u8; 32],
        htlc_bump: u8,
    ) -> Result<bool> {
        let htlc = &mut ctx.accounts.htlc;
        let mut hasher = Sha256::new();
        hasher.update(secret.clone());
        let hash = hasher.finalize();
        require!([0u8; 32] != htlc.hashlock, HTLCError::HashlockNotSet);
        require!(hash == htlc.hashlock.into(), HTLCError::HashlockNoMatch);

        htlc.claimed = 3;
        htlc.secret = secret;
        if htlc.reward != 0 {
            // if redeem is called before the reward_timelock sender should get the reward back
            if htlc.reward_timelock > Clock::get().unwrap().unix_timestamp.try_into().unwrap() {
                transfer_htlc_reward_out(
                    ctx.accounts.sender.to_account_info(),
                    Id,
                    htlc.to_account_info(),
                    htlc_bump,
                    &mut ctx.accounts.htlc_token_account,
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.src_receiver_token_account.to_account_info(),
                    ctx.accounts.sender_token_account.to_account_info(),
                    ctx.accounts.htlc.amount,
                    ctx.accounts.htlc.reward,
                )?;
            } else {
                // if the caller is the receiver then they should get and the amount,
                // and the reward
                if ctx.accounts.user_signing.key() == ctx.accounts.src_receiver.key() {
                    transfer_htlc_out(
                        ctx.accounts.sender.to_account_info(),
                        Id,
                        htlc.to_account_info(),
                        htlc_bump,
                        &mut ctx.accounts.htlc_token_account,
                        ctx.accounts.token_program.to_account_info(),
                        ctx.accounts.src_receiver_token_account.to_account_info(),
                        ctx.accounts.htlc.amount + ctx.accounts.htlc.reward,
                    )?;
                } else {
                    transfer_htlc_reward_out(
                        ctx.accounts.sender.to_account_info(),
                        Id,
                        htlc.to_account_info(),
                        htlc_bump,
                        &mut ctx.accounts.htlc_token_account,
                        ctx.accounts.token_program.to_account_info(),
                        ctx.accounts.src_receiver_token_account.to_account_info(),
                        ctx.accounts.reward_token_account.to_account_info(),
                        ctx.accounts.htlc.amount,
                        ctx.accounts.htlc.reward,
                    )?;
                }
            }
        } else {
            // send the tokens to the receiver if the reward is set to zero
            transfer_htlc_out(
                ctx.accounts.sender.to_account_info(),
                Id,
                htlc.to_account_info(),
                htlc_bump,
                &mut ctx.accounts.htlc_token_account,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.src_receiver_token_account.to_account_info(),
                ctx.accounts.htlc.amount,
            )?;
        }

        Ok(true)
    }

    /// @dev Called by the sender if there was no redeem AND the time lock has
    /// expired. This will refund the contract amount.
    ///
    /// @param Id of the HTLC to refund from.
    pub fn refund(ctx: Context<Refund>, Id: [u8; 32], htlc_bump: u8) -> Result<bool> {
        let htlc = &mut ctx.accounts.htlc;

        htlc.claimed = 2;

        transfer_htlc_out(
            ctx.accounts.sender.to_account_info(),
            Id,
            htlc.to_account_info(),
            htlc_bump,
            &mut ctx.accounts.htlc_token_account,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.sender_token_account.to_account_info(),
            ctx.accounts.htlc.amount + ctx.accounts.htlc.reward,
        )?;

        Ok(true)
    }

    /// @dev Get HTLC details.
    /// @param Id of the HTLC.
    pub fn getDetails(ctx: Context<GetDetails>, Id: [u8; 32]) -> Result<HTLC> {
        let htlc = &ctx.accounts.htlc;

        msg!("dst_address: {:?}", htlc.dst_address.clone());
        msg!("dst_chain: {:?}", htlc.dst_chain.clone());
        msg!("dst_asset: {:?}", htlc.dst_asset.clone());
        msg!("src_asset: {:?}", htlc.src_asset);
        msg!("sender: {:?}", htlc.sender);
        msg!("src_receiver: {:?}", htlc.src_receiver);
        msg!("hashlock: {:?}", hex::encode(htlc.hashlock));
        msg!("secret: {:?}", hex::encode(htlc.secret.clone()));
        msg!("amount: {:?}", htlc.amount);
        msg!("timelock: {:?}", htlc.timelock);
        msg!("reward: {:?}", htlc.reward);
        msg!("reward_timelock: {:?}", htlc.reward_timelock);
        msg!("token_contract: {:?}", htlc.token_contract);
        msg!("token_wallet: {:?}", htlc.token_wallet);
        msg!("claimed: {:?}", htlc.claimed);

        Ok(HTLC {
            dst_address: htlc.dst_address.clone(),
            dst_chain: htlc.dst_chain.clone(),
            dst_asset: htlc.dst_asset.clone(),
            src_asset: htlc.src_asset.clone(),
            sender: htlc.sender,
            src_receiver: htlc.src_receiver,
            hashlock: htlc.hashlock,
            secret: htlc.secret.clone(),
            amount: htlc.amount,
            timelock: htlc.timelock,
            reward: htlc.reward,
            reward_timelock: htlc.reward_timelock,
            token_contract: htlc.token_contract,
            token_wallet: htlc.token_wallet,
            claimed: htlc.claimed,
        })
    }
}

#[account]
#[derive(Default)]
pub struct HTLC {
    pub dst_address: String,
    pub dst_chain: String,
    pub dst_asset: String,
    pub src_asset: String,
    pub sender: Pubkey,
    pub src_receiver: Pubkey,
    pub hashlock: [u8; 32],
    pub secret: [u8; 32],
    pub amount: u64,
    pub timelock: u64, //TODO: check if this should be u256
    pub reward: u64,
    pub reward_timelock: u64, //TODO: check if this should be u256
    pub token_contract: Pubkey,
    pub token_wallet: Pubkey,
    pub claimed: u8,
}
#[derive(Accounts)]
#[instruction(Id: [u8;32], commit_bump: u8)]
pub struct Commit<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        init,
        payer = sender,
        space = size_of::<HTLC>() + 28,
        seeds = [
            Id.as_ref()
        ],
        bump,
    )]
    pub htlc: Box<Account<'info, HTLC>>,
    #[account(
        init,
        payer = sender,
        seeds = [
            b"htlc_token_account".as_ref(),
            Id.as_ref()
        ],
        bump,
        token::mint=token_contract,
        token::authority=htlc,
    )]
    pub htlc_token_account: Box<Account<'info, TokenAccount>>,
    pub token_contract: Account<'info, Mint>,
    #[account(
        mut,
        constraint=sender_token_account.owner == sender.key() @HTLCError::NotSender,
        constraint=sender_token_account.mint == token_contract.key() @HTLCError::NoToken,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(Id: [u8; 32], lock_bump: u8)]
pub struct Lock<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        init,
        payer = sender,
        space = size_of::<HTLC>() + 28,
        // space = 256,
        seeds = [
            Id.as_ref()
        ],
        bump,
    )]
    pub htlc: Box<Account<'info, HTLC>>,
    #[account(
        init,
        payer = sender,
        seeds = [
            b"htlc_token_account".as_ref(),
            Id.as_ref()
        ],
        bump,
        token::mint=token_contract,
        token::authority=htlc,
    )]
    pub htlc_token_account: Box<Account<'info, TokenAccount>>,

    pub token_contract: Account<'info, Mint>,
    #[account(
        mut,
        constraint=sender_token_account.owner == sender.key() @HTLCError::NotSender,
        constraint=sender_token_account.mint == token_contract.key() @ HTLCError::NoToken,
    )]
    pub sender_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(Id: [u8; 32])]
pub struct LockReward<'info> {
    #[account(mut)]
    sender: Signer<'info>,
    #[account(
    mut,
    seeds = [
        Id.as_ref()
    ],
    bump,
    constraint = htlc.claimed == 1 @ HTLCError::AlreadyClaimed,
    has_one = sender @ HTLCError::UnauthorizedAccess,
    )]
    pub htlc: Box<Account<'info, HTLC>>,

    pub htlc_token_account: Box<Account<'info, TokenAccount>>,

    pub token_contract: Account<'info, Mint>,
    #[account(
        mut,
        constraint=sender_token_account.owner == sender.key() @HTLCError::NotSender,
        constraint=sender_token_account.mint == token_contract.key() @ HTLCError::NoToken,
    )]
    pub sender_token_account: Box<Account<'info, TokenAccount>>,

    system_program: Program<'info, System>,
    token_program: Program<'info, Token>,
    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(Id: [u8;32], htlc_bump: u8)]
pub struct Redeem<'info> {
    #[account(mut)]
    user_signing: Signer<'info>,
    ///CHECK: The sender
    #[account(mut)]
    sender: UncheckedAccount<'info>,
    ///CHECK: The reciever
    pub src_receiver: UncheckedAccount<'info>,
    token_contract: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [
            Id.as_ref()
        ],
        bump,
        has_one = sender @HTLCError::NotSender,
        has_one = src_receiver @HTLCError::NotReciever,
        has_one = token_contract @HTLCError::NoToken,
        constraint = htlc.claimed == 1 @ HTLCError::AlreadyClaimed,
    )]
    pub htlc: Box<Account<'info, HTLC>>,
    #[account(
        mut,
        seeds = [
            b"htlc_token_account".as_ref(),
            Id.as_ref()
        ],
        bump,
    )]
    pub htlc_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint=sender_token_account.owner == sender.key() @HTLCError::NotSender,
        constraint=sender_token_account.mint == token_contract.key() @ HTLCError::NoToken,
    )]
    pub sender_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user_signing,
        associated_token::mint = token_contract,
        associated_token::authority = src_receiver,
    )]
    pub src_receiver_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user_signing,
        associated_token::mint = token_contract,
        associated_token::authority = user_signing,
    )]
    pub reward_token_account: Box<Account<'info, TokenAccount>>,

    system_program: Program<'info, System>,
    token_program: Program<'info, Token>,
    associated_token_program: Program<'info, AssociatedToken>,
    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(Id: [u8;32], htlc_bump: u8)]
pub struct Refund<'info> {
    #[account(mut)]
    user_signing: Signer<'info>,

    #[account(mut,
    seeds = [
        //b"htlc",
        Id.as_ref()
    ],
    bump = htlc_bump,
    has_one = sender @HTLCError::NotSender,
    has_one = token_contract @HTLCError::NoToken,
    constraint = htlc.claimed == 1 @ HTLCError::AlreadyClaimed,
    constraint = Clock::get().unwrap().unix_timestamp > htlc.timelock.try_into().unwrap() @ HTLCError::NotPastTimeLock,
    )]
    pub htlc: Box<Account<'info, HTLC>>,
    #[account(
        mut,
        seeds = [
            b"htlc_token_account".as_ref(),
            Id.as_ref()
        ],
        bump,
    )]
    pub htlc_token_account: Box<Account<'info, TokenAccount>>,

    ///CHECK: The sender
    #[account(mut)]
    sender: UncheckedAccount<'info>,
    token_contract: Account<'info, Mint>,

    #[account(
        mut,
        constraint=htlc.sender.key() == sender_token_account.owner @HTLCError::NotSender,
        constraint=sender_token_account.mint == token_contract.key() @HTLCError::NoToken,)]
    pub sender_token_account: Account<'info, TokenAccount>,

    system_program: Program<'info, System>,
    token_program: Program<'info, Token>,
    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(Id: [u8;32])]
pub struct AddLock<'info> {
    #[account(mut)]
    sender: Signer<'info>,
    #[account(mut,
    seeds = [
        Id.as_ref()
    ],
    bump,
    constraint = htlc.claimed == 1 @ HTLCError::AlreadyClaimed,
    constraint = htlc.sender == sender.key() @ HTLCError::UnauthorizedAccess,
    constraint = htlc.hashlock == [0u8;32] @ HTLCError::HashlockAlreadySet,
    )]
    pub htlc: Box<Account<'info, HTLC>>,

    system_program: Program<'info, System>,
    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(Id: [u8;32])]
pub struct AddLockSig<'info> {
    #[account(mut)]
    payer: Signer<'info>,
    #[account(mut,
    seeds = [
        Id.as_ref()
    ],
    bump,
    constraint = htlc.claimed == 1 @ HTLCError::AlreadyClaimed,
    constraint = htlc.hashlock == [0u8;32] @ HTLCError::HashlockAlreadySet,
    )]
    pub htlc: Box<Account<'info, HTLC>>,

    /// CHECK: The address check is needed because otherwise
    /// the supplied Sysvar could be anything else.
    /// The Instruction Sysvar has not been implemented
    /// in the Anchor framework yet, so this is the safe approach.
    #[account(address = IX_ID)]
    pub ix_sysvar: AccountInfo<'info>,
    system_program: Program<'info, System>,
    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(Id: [u8;32])]
pub struct GetDetails<'info> {
    #[account(
        seeds = [
            Id.as_ref()
        ],
        bump,
    )]
    pub htlc: Box<Account<'info, HTLC>>,
}
#[error_code]
pub enum HTLCError {
    #[msg("Invalid TimeLock.")]
    InvalidTimeLock,
    #[msg("Not Past TimeLock.")]
    NotPastTimeLock,
    #[msg("Invalid Reward TimeLock.")]
    InvalidRewardTimeLock,
    #[msg("Hashlock Is Not Set.")]
    HashlockNotSet,
    #[msg("Does Not Match the Hashlock.")]
    HashlockNoMatch,
    #[msg("Hashlock Already Set.")]
    HashlockAlreadySet,
    #[msg("Funds Are Alredy Claimed.")]
    AlreadyClaimed,
    #[msg("Funds Can Not Be Zero.")]
    FundsNotSent,
    #[msg("Unauthorized Access.")]
    UnauthorizedAccess,
    #[msg("Not The Owner.")]
    NotOwner,
    #[msg("Not The Sender.")]
    NotSender,
    #[msg("Not The Reciever.")]
    NotReciever,
    #[msg("Wrong Token.")]
    NoToken,
    #[msg("Signature verification failed.")]
    SigVerificationFailed,
    #[msg("Reward Already Exists.")]
    RewardAlreadyExists,
}
