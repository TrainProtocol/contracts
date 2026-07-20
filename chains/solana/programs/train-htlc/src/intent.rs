use anchor_lang::prelude::*;
#[allow(deprecated)]
use anchor_lang::solana_program::sysvar::instructions::{
    get_instruction_relative, load_current_index_checked,
};
use solana_sdk_ids::ed25519_program;
use solana_sha256_hasher::hashv;

use crate::errors::TrainError;
use crate::state::UserLockParams;

/// Versioned domain tag for signed lock intents. The full domain separator is
/// tag || program_id || per-deployment salt (the IntentDomain PDA). It binds a
/// signed intent to this program and this cluster so a signature cannot be replayed
/// against another program or another deployment.
pub const INTENT_DOMAIN_TAG: &[u8; 16] = b"TRAIN_INTENT_V1\0";

/// Layout constants of a single-signature ed25519-program instruction as built by
/// solana-sdk's new_ed25519_instruction / web3.js Ed25519Program:
/// [num_sigs u8][pad u8][offsets 14 bytes][pubkey 32 @16][sig 64 @48][message @112]
const PUBKEY_OFFSET: usize = 16;
const SIGNATURE_OFFSET: usize = 48;
const MESSAGE_OFFSET: usize = 112;

/// call_hash binds the intent to the exact lock parameters the relayer must submit,
/// so a relayer cannot alter any field the user signed. Borsh length prefixes make
/// the concatenation unambiguous.
pub fn call_hash(
    params: &UserLockParams,
    user_data: &[u8],
    solver_data: &[u8],
) -> Result<[u8; 32]> {
    let params_bytes = params.try_to_vec()?;
    let user_data_bytes = user_data.to_vec().try_to_vec()?;
    let solver_data_bytes = solver_data.to_vec().try_to_vec()?;
    Ok(hashv(&[&params_bytes, &user_data_bytes, &solver_data_bytes]).to_bytes())
}

/// Canonical intent message the user signs off-chain:
/// tag || program_id || domain_salt || user || mint || amount || call_hash || nonce || deadline
#[allow(clippy::too_many_arguments)]
pub fn build_intent_message(
    domain_salt: &[u8; 32],
    user: &Pubkey,
    mint: &Pubkey,
    amount: u64,
    call_hash: &[u8; 32],
    nonce: u64,
    deadline: u64,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(16 + 32 + 32 + 32 + 32 + 8 + 32 + 8 + 8);
    message.extend_from_slice(INTENT_DOMAIN_TAG);
    message.extend_from_slice(crate::ID.as_ref());
    message.extend_from_slice(domain_salt);
    message.extend_from_slice(user.as_ref());
    message.extend_from_slice(mint.as_ref());
    message.extend_from_slice(&amount.to_le_bytes());
    message.extend_from_slice(call_hash);
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(&deadline.to_le_bytes());
    message
}

/// What the user actually signs: the sha256 digest of the canonical message.
/// Signing the fixed-size digest (rather than the full message) keeps the relayer's
/// transaction under the 1232-byte packet limit.
pub fn intent_digest(message: &[u8]) -> [u8; 32] {
    hashv(&[message]).to_bytes()
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

/// Verify that the instruction immediately preceding the current one is an
/// ed25519-program instruction proving `expected_user` signed `expected_message`.
///
/// INVARIANT: every byte range this function trusts (pubkey, message) must be the
/// exact range the ed25519 precompile verified. That holds because:
/// - the instruction is loaded through the address-checked instructions sysvar;
/// - it must be owned by the ed25519 program with exactly one signature entry;
/// - all three offset instruction indices must reference the ed25519 instruction
///   itself (u16::MAX sentinel or its literal index), so the verified bytes live in
///   the same instruction we inspect;
/// - the offsets must equal the canonical single-signature layout, and the message
///   length must match, leaving no unverified trailing bytes.
pub fn verify_ed25519_intent(
    instructions_sysvar: &AccountInfo,
    expected_user: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(TrainError::InvalidIntentSignature))?;
    require!(current_index > 0, TrainError::InvalidIntentSignature);
    let ed25519_index = current_index - 1;

    let ix = get_instruction_relative(-1, instructions_sysvar)
        .map_err(|_| error!(TrainError::InvalidIntentSignature))?;
    require_keys_eq!(
        ix.program_id,
        ed25519_program::ID,
        TrainError::InvalidIntentSignature
    );
    require!(ix.accounts.is_empty(), TrainError::InvalidIntentSignature);

    let data = &ix.data;
    require!(
        data.len() == MESSAGE_OFFSET + expected_message.len(),
        TrainError::InvalidIntentSignature
    );
    // Header: exactly one signature.
    require!(data[0] == 1 && data[1] == 0, TrainError::InvalidIntentSignature);

    // Offsets struct (14 bytes at offset 2): all fields must describe the canonical
    // single-signature layout within this same instruction.
    let signature_offset = read_u16(data, 2);
    let signature_ix_index = read_u16(data, 4);
    let pubkey_offset = read_u16(data, 6);
    let pubkey_ix_index = read_u16(data, 8);
    let message_offset = read_u16(data, 10);
    let message_size = read_u16(data, 12);
    let message_ix_index = read_u16(data, 14);

    let self_referencing =
        |index: u16| -> bool { index == u16::MAX || index == ed25519_index };
    require!(
        signature_offset as usize == SIGNATURE_OFFSET
            && pubkey_offset as usize == PUBKEY_OFFSET
            && message_offset as usize == MESSAGE_OFFSET
            && message_size as usize == expected_message.len()
            && self_referencing(signature_ix_index)
            && self_referencing(pubkey_ix_index)
            && self_referencing(message_ix_index),
        TrainError::InvalidIntentSignature
    );

    require!(
        &data[PUBKEY_OFFSET..PUBKEY_OFFSET + 32] == expected_user.as_ref(),
        TrainError::InvalidIntentSignature
    );
    require!(
        &data[MESSAGE_OFFSET..] == expected_message,
        TrainError::InvalidIntentSignature
    );
    Ok(())
}
