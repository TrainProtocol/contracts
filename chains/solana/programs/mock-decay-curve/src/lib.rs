#![allow(unexpected_cfgs, deprecated)]

// TEST-ONLY payout curve for exercising the Train HTLC's curve plumbing:
// - empty config           -> payout = amount / 2 (excess path)
// - 2-byte LE u16 config   -> payout = amount * bps / 10_000
//   (bps = 0 tests the InvalidPayout zero-payout rejection;
//    bps > 10_000 tests the payout > amount rejection)

use anchor_lang::prelude::*;

declare_id!("wmgDCMVreZ5xKv8NTg8rmkGPpb7bs5FHiToxqjc5yMr");

#[program]
pub mod mock_decay_curve {
    use super::*;

    pub fn compute_payout(
        _ctx: Context<ComputePayout>,
        amount: u64,
        _start_time: u64,
        _current_time: u64,
        config: Vec<u8>,
    ) -> Result<u64> {
        let payout = if config.len() == 2 {
            let bps = u16::from_le_bytes([config[0], config[1]]) as u128;
            ((amount as u128).saturating_mul(bps) / 10_000) as u64
        } else {
            amount / 2
        };
        Ok(payout)
    }
}

#[derive(Accounts)]
pub struct ComputePayout {}
