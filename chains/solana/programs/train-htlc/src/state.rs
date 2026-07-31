use anchor_lang::prelude::*;

// Lock status values
pub const STATUS_EMPTY: u8 = 0;
pub const STATUS_PENDING: u8 = 1;
pub const STATUS_REFUNDED: u8 = 2;
pub const STATUS_REDEEMED: u8 = 3;

/// Upper bound on caller-supplied payout curve config bytes stored in a lock.
pub const MAX_CURVE_DATA: usize = 256;

/// INVARIANT (status machine): Empty -> Pending -> {Refunded | Redeemed}; terminal
/// states are final. Every settlement path requires status == Pending, so a lock
/// settles exactly once while its account exists.
///
/// Settled user locks are closed and their rent recovered, so a settled hashlock PDA
/// can be re-initialized. Hashlock uniqueness is therefore a client convention, not
/// chain-enforced; replay protection never depends on it (native transaction
/// signature dedup for co-signed flows, the ConsumedIntent PDA for intent flows).
#[account]
#[derive(Default, InitSpace)]
pub struct UserLock {
    pub secret: [u8; 32],
    /// Measured amount actually received by the escrow (fee-on-transfer safe).
    pub amount: u64,
    /// The funds authority: the `sender` signer, or the intent signer on the
    /// gasless intent path. Never taken from instruction args.
    pub sender: Pubkey,
    pub timelock: u64,
    pub start_time: u64,
    pub status: u8,
    pub recipient: Pubkey,
    /// Sink for refunds and redeem excess (amount - payout). Independent of sender.
    pub refund_to: Pubkey,
    /// Pubkey::default() == native SOL
    pub token_mint: Pubkey,
    /// Who paid rent for this lock (and its vault); rent returns here on close.
    /// In sponsored flows this is the relayer, not the sender.
    pub rent_payer: Pubkey,
    /// Payout curve program id; Pubkey::default() == no curve (payout = amount).
    pub payout_curve: Pubkey,
    #[max_len(MAX_CURVE_DATA)]
    pub payout_curve_data: Vec<u8>,
}

#[account]
#[derive(Default, InitSpace)]
pub struct SolverLock {
    pub secret: [u8; 32],
    /// Measured principal received (fee-on-transfer safe).
    pub amount: u64,
    /// Measured reward received. Never decayed by the payout curve.
    pub reward: u64,
    pub sender: Pubkey,
    pub timelock: u64,
    /// Computed forward from lock creation: start_time + reward_timelock_delta.
    /// Before it, redeem routes the reward to reward_recipient; at/after it, to the
    /// redeem caller (relayer bounty).
    pub reward_timelock: u64,
    pub start_time: u64,
    pub recipient: Pubkey,
    pub status: u8,
    pub reward_recipient: Pubkey,
    pub refund_to: Pubkey,
    pub token_mint: Pubkey,
    pub reward_token_mint: Pubkey,
    pub rent_payer: Pubkey,
    pub payout_curve: Pubkey,
    #[max_len(MAX_CURVE_DATA)]
    pub payout_curve_data: Vec<u8>,
}

/// Permanent single-use marker for a `(hashlock, solver)` pair. The full solver lock
/// may be closed after settlement to recover rent, but this compact guard is never
/// closed, so a blind retry can never escrow funds twice.
#[account]
#[derive(Default, InitSpace)]
pub struct SolverLockGuard {
    pub used: bool,
    pub solver: Pubkey,
    pub hashlock: [u8; 32],
}

/// Single-use replay guard for the gasless intent path. Keyed by PDA seeds
/// ["intent", user, nonce_le] (the nonce is bound into the user's signed message, so
/// a given (user, nonce) authorizes exactly one lock); `init` makes a second
/// consumption impossible while the account exists, and the deadline check makes it
/// impossible after the account is closed for rent recovery.
#[account]
#[derive(Default, InitSpace)]
pub struct ConsumedIntent {
    pub intent_hash: [u8; 32],
    pub user: Pubkey,
    pub deadline: u64,
    pub rent_payer: Pubkey,
}

/// Per-deployment domain separator for signed intents. The salt is mixed into every
/// signed intent message to give cross-cluster replay protection (a value a Solana
/// program cannot derive on-chain), so it must differ across clusters. Initialized
/// once by the program upgrade authority.
#[account]
#[derive(Default, InitSpace)]
pub struct IntentDomain {
    pub salt: [u8; 32],
}

// ─── Instruction params ────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UserLockParams {
    pub hashlock: [u8; 32],
    pub amount: u64,
    pub timelock_delta: u64,
    pub quote_expiry: u64,
    pub recipient: Pubkey,
    pub refund_to: Pubkey,
    /// Pubkey::default() == no curve.
    pub payout_curve: Pubkey,
    pub payout_curve_data: Vec<u8>,
    pub src_chain: String,
    // Destination info (logged only)
    pub dst_chain: String,
    pub dst_address: String,
    pub dst_amount: u128,
    pub dst_token: String,
    // Destination-side reward metadata (logged only; a user lock escrows no reward)
    pub reward_amount: u128,
    pub reward_token: String,
    pub reward_recipient: String,
    pub reward_timelock_delta: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SolverLockParams {
    pub hashlock: [u8; 32],
    pub amount: u64,
    pub reward: u64,
    pub timelock_delta: u64,
    pub reward_timelock_delta: u64,
    pub recipient: Pubkey,
    pub reward_recipient: Pubkey,
    pub refund_to: Pubkey,
    /// Pubkey::default() == no curve.
    pub payout_curve: Pubkey,
    pub payout_curve_data: Vec<u8>,
    pub src_chain: String,
    // Destination info (logged only)
    pub dst_chain: String,
    pub dst_address: String,
    pub dst_amount: u128,
    pub dst_token: String,
}

// ─── View return data ───────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UserLockData {
    pub secret: [u8; 32],
    pub amount: u64,
    pub sender: Pubkey,
    pub timelock: u64,
    pub start_time: u64,
    pub status: u8,
    pub recipient: Pubkey,
    pub refund_to: Pubkey,
    pub token_mint: Pubkey,
    pub rent_payer: Pubkey,
    pub payout_curve: Pubkey,
    pub payout_curve_data: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SolverLockData {
    pub secret: [u8; 32],
    pub amount: u64,
    pub reward: u64,
    pub sender: Pubkey,
    pub timelock: u64,
    pub reward_timelock: u64,
    pub start_time: u64,
    pub recipient: Pubkey,
    pub status: u8,
    pub reward_recipient: Pubkey,
    pub refund_to: Pubkey,
    pub token_mint: Pubkey,
    pub reward_token_mint: Pubkey,
    pub rent_payer: Pubkey,
    pub payout_curve: Pubkey,
    pub payout_curve_data: Vec<u8>,
}
