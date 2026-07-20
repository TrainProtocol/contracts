use anchor_lang::prelude::*;

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
    #[msg("Recipient and refund_to must be non-default addresses.")]
    ZeroAddress,
    #[msg("Wrong refund_to address.")]
    WrongRefundTo,
    #[msg("Wrong rent payer address.")]
    WrongRentPayer,
    #[msg("Payout curve account missing, mismatched, or not executable.")]
    InvalidPayoutCurve,
    #[msg("Payout curve returned an invalid payout (must satisfy 0 < payout <= amount).")]
    InvalidPayout,
    #[msg("Payout curve config data exceeds the maximum length.")]
    CurveDataTooLarge,
    #[msg("Mint has an unsupported Token-2022 extension (permanent delegate or transfer hook).")]
    UnsupportedMintExtension,
    #[msg("Escrow received zero tokens (transfer fee consumed the full amount?).")]
    NothingReceived,
    #[msg("Intent deadline has passed.")]
    IntentExpired,
    #[msg("Intent deadline has not passed yet.")]
    IntentNotExpired,
    #[msg("Missing or invalid ed25519 signature verification instruction for the intent.")]
    InvalidIntentSignature,
    #[msg("Token account is not delegated to the program delegate for the required amount.")]
    InvalidDelegation,
    #[msg("Only the program upgrade authority may perform this action.")]
    Unauthorized,
}
