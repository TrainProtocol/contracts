#![allow(unexpected_cfgs, deprecated)]

// Constant payout curve: payout == amount, no decay. The Train HTLC invokes
// `compute_payout` via a CPI with no accounts and reads the result from return
// data; Anchor's `Result<u64>` return sets that return data automatically.

use anchor_lang::prelude::*;

declare_id!("Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF");

#[program]
pub mod constant_payout_curve {
    use super::*;

    pub fn compute_payout(
        _ctx: Context<ComputePayout>,
        amount: u64,
        _start_time: u64,
        _current_time: u64,
        _config: Vec<u8>,
    ) -> Result<u64> {
        Ok(amount)
    }
}

#[derive(Accounts)]
pub struct ComputePayout {}
