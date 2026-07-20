use anchor_lang::prelude::*;

// `amount` / `reward` are the measured received amounts (fee-on-transfer safe),
// not the requested amounts.

#[event]
pub struct UserLocked {
    pub hashlock: [u8; 32],
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub refund_to: Pubkey,
    pub src_chain: String,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub timelock: u64,
    pub payout_curve: Pubkey,
    pub dst_chain: String,
    pub dst_address: String,
    pub dst_amount: u128,
    pub dst_token: String,
    pub reward_amount: u128,
    pub reward_token: String,
    pub reward_recipient: String,
    pub reward_timelock_delta: u64,
    pub quote_expiry: u64,
    pub user_data: Vec<u8>,
    pub solver_data: Vec<u8>,
}

#[event]
pub struct SolverLocked {
    pub hashlock: [u8; 32],
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub refund_to: Pubkey,
    pub index: u64,
    pub src_chain: String,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub reward: u64,
    pub reward_token_mint: Pubkey,
    pub reward_recipient: Pubkey,
    pub timelock: u64,
    pub reward_timelock: u64,
    pub payout_curve: Pubkey,
    pub dst_chain: String,
    pub dst_address: String,
    pub dst_amount: u128,
    pub dst_token: String,
    pub data: Vec<u8>,
}

#[event]
pub struct UserRefunded {
    pub hashlock: [u8; 32],
    pub refund_to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SolverRefunded {
    pub hashlock: [u8; 32],
    pub index: u64,
    pub refund_to: Pubkey,
    pub amount: u64,
    pub reward: u64,
}

#[event]
pub struct UserRedeemed {
    pub hashlock: [u8; 32],
    pub redeemer: Pubkey,
    pub secret: [u8; 32],
    pub payout: u64,
    pub excess: u64,
}

#[event]
pub struct SolverRedeemed {
    pub hashlock: [u8; 32],
    pub index: u64,
    pub redeemer: Pubkey,
    pub secret: [u8; 32],
    pub payout: u64,
    pub excess: u64,
    pub reward_to: Pubkey,
    pub reward: u64,
}

/// Emitted when a signed gasless intent is executed by a relayer.
#[event]
pub struct IntentConsumed {
    pub intent_hash: [u8; 32],
    pub user: Pubkey,
    pub relayer: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub deadline: u64,
}
