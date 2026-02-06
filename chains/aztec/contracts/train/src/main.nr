//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

mod types;
use dep::aztec::macros::aztec;

#[aztec]
pub contract Train {
    use std::meta::derive;

    use aztec::macros::{functions::{external, initializer, view}, storage::storage};

    use dep::aztec::{
        protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
        state_vars::{map::Map, PublicMutable},
    };
    use dep::sha256;
    use dep::token::Token;
    use std::collections::bounded_vec::BoundedVec;

    use crate::types::events::{DstLocked, SrcLocked, TokenRedeemed, TokenRefunded};

    #[derive(Eq, Packable, Serialize, Deserialize)]
    pub struct HTLC_Public {
        amount: u128,
        token: AztecAddress,
        hashlock: [u8; 32],
        secret: [u8; 32],
        sender: AztecAddress,
        src_receiver: AztecAddress,
        timelock: u64,
        claimed: u8,
        reward: u128,
        reward_timelock: u64,
    }

    #[external("public")]
    #[initializer]
    fn constructor() {}

    #[storage]
    struct Storage<Context> {
        contracts: Map<Field, Map<Field, PublicMutable<HTLC_Public, Context>, Context>, Context>,
        user_swaps_count: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        user_swaps: Map<AztecAddress, Map<Field, PublicMutable<Field, Context>, Context>, Context>,
    }

    #[external("public")]
    fn lock_src(
        swap_id: Field,
        hashlock: [u8; 32],
        timelock: u64,
        src_receiver: AztecAddress,
        token: AztecAddress,
        amount: u128,
        src_asset: str<30>,
        dst_chain: str<30>,
        dst_asset: str<30>,
        dst_address: str<90>,
    ) {
        assert(amount > 0, "FundsNotSent");

        let htlc_public_current = self.storage.contracts.at(swap_id).at(0).read();
        assert(htlc_public_current.sender == AztecAddress::zero(), "SwapAlreadyInitialized");
        assert(self.context.timestamp() + 1800 < timelock, "InvalidTimelock");

        let sender = self.msg_sender().expect(f"Sender must not be none!");
        let htlc_public = HTLC_Public {
            amount: amount,
            token: token,
            hashlock: hashlock,
            secret: [0u8; 32],
            sender: sender,
            src_receiver: src_receiver,
            timelock: timelock,
            claimed: 1 as u8,
            reward: 0 as u128,
            reward_timelock: 0 as u64,
        };
        self.storage.contracts.at(swap_id).at(0).write(htlc_public);

        self.call(Token::at(token).transfer_in_public(sender, self.address, amount, 0));

        let sender = self.msg_sender().expect(f"Sender must not be none!");
        let current_count = self.storage.user_swaps_count.at(sender).read();
        self.storage.user_swaps.at(sender).at(current_count).write(swap_id);
        self.storage.user_swaps_count.at(sender).write(current_count + 1);

        // Emit SrcLocked log
        self.context.emit_public_log(
            SrcLocked {
                swap_id,
                hashlock,
                dst_chain,
                dst_address,
                dst_asset,
                sender,
                src_receiver,
                src_asset,
                amount,
                timelock,
            },
        );
    }

    #[external("public")]
    fn refund(swap_id: Field, htlc_id: Field) {
        let htlc_public = self.storage.contracts.at(swap_id).at(htlc_id).read();
        assert(htlc_public.claimed == 1, "AlreadyClaimed");
        assert(htlc_public.timelock < self.context.timestamp(), "NotPassedTimelock");

        let refund_amount = if htlc_public.reward != 0 {
            htlc_public.amount + htlc_public.reward
        } else {
            htlc_public.amount
        };

        self.call(Token::at(htlc_public.token).transfer_in_public(
            self.address,
            htlc_public.sender,
            refund_amount,
            0,
        ));

        let modified_htlc_public = HTLC_Public {
            amount: htlc_public.amount,
            token: htlc_public.token,
            hashlock: htlc_public.hashlock,
            secret: htlc_public.secret,
            sender: htlc_public.sender,
            src_receiver: htlc_public.src_receiver,
            timelock: htlc_public.timelock,
            claimed: 2 as u8,
            reward: htlc_public.reward,
            reward_timelock: htlc_public.reward_timelock,
        };

        self.storage.contracts.at(swap_id).at(htlc_id).write(modified_htlc_public);

        // Emit TokenRefunded log
        self.context.emit_public_log(TokenRefunded { swap_id, htlc_id });
    }

    #[external("public")]
    fn lock_dst(
        swap_id: Field,
        hashlock: [u8; 32],
        reward: u128,
        reward_timelock: u64,
        timelock: u64,
        src_receiver: AztecAddress,
        token: AztecAddress,
        total_amount: u128,
        src_asset: str<30>,
        dst_chain: str<30>,
        dst_asset: str<30>,
        dst_address: str<90>,
    ) {
        assert(total_amount > 0, "FundsNotSent");
        assert(reward > 0, "InvalidRewardAmount");

        let amount = total_amount - reward;
        assert(amount > 0, "InvalidRewardAmount");
        assert(reward * 10 >= amount, "InvalidRewardAmount");

        assert(self.context.timestamp() + 900 < timelock, "InvalidTimelock");
        assert(reward_timelock <= timelock, "InvalidRewardTimelock");
        assert(reward_timelock > self.context.timestamp(), "InvalidRewardTimelock");

        // Determine htlc_id automatically based on swap state
        // If slot 0 is empty, solver is first to open the swap (htlc_id=0)
        // Otherwise, find the next free slot starting from 1
        let htlc_id: Field = if self.storage.contracts.at(swap_id).at(0).read().sender
            == AztecAddress::zero() {
            0 // Solver is first, occupies slot 0
        } else {
            // Find next free slot for additional solver HTLCs
            // Start from 1 and increment until we find an empty slot
            let mut slot: Field = 1;
            let mut found = false;
            while !found {
                if self.storage.contracts.at(swap_id).at(slot).read().sender == AztecAddress::zero()
                     {
                        found = true;
                    } else {
                        slot = slot + 1;
                    }
            }
            slot
        };

        let sender = self.msg_sender().expect(f"Sender must not be none!");
        let htlc_public = HTLC_Public {
            amount: amount,
            token: token,
            hashlock: hashlock,
            secret: [0u8; 32],
            sender: sender,
            src_receiver: src_receiver,
            timelock: timelock,
            claimed: 1 as u8,
            reward: reward,
            reward_timelock: reward_timelock,
        };
        self.storage.contracts.at(swap_id).at(htlc_id).write(htlc_public);

        self.call(Token::at(token).transfer_in_public(sender, self.address, total_amount, 0));

        // Emit DstLocked log
        self.context.emit_public_log(
            DstLocked {
                swap_id,
                htlc_id,
                hashlock,
                dst_chain,
                dst_address,
                dst_asset,
                sender,
                src_receiver,
                src_asset,
                amount: amount,
                reward,
                reward_timelock,
                timelock,
            },
        );
    }

    #[external("public")]
    fn redeem(swap_id: Field, htlc_id: Field, secret: [u8; 32]) {
        let caller = self.msg_sender().expect(f"Sender must not be none!");

        let mut htlc_public = self.storage.contracts.at(swap_id).at(htlc_id).read();
        assert(htlc_public.amount > 0, "HTLCNotExists");
        let hashed_secret = sha256::sha256_var(secret, secret.len() as u64);
        assert(htlc_public.hashlock == hashed_secret, "HashlockNotMatch");
        assert(htlc_public.claimed == 1, "AlreadyClaimed");

        let modified_htlc_public = HTLC_Public {
            amount: htlc_public.amount,
            token: htlc_public.token,
            hashlock: htlc_public.hashlock,
            secret: secret,
            sender: htlc_public.sender,
            src_receiver: htlc_public.src_receiver,
            timelock: htlc_public.timelock,
            claimed: 3 as u8,
            reward: htlc_public.reward,
            reward_timelock: htlc_public.reward_timelock,
        };

        self.storage.contracts.at(swap_id).at(htlc_id).write(modified_htlc_public);

        // Emit TokenRedeemed log
        self.context.emit_public_log(
            TokenRedeemed {
                swap_id,
                htlc_id,
                redeem_address: caller,
                secret,
                hashlock: htlc_public.hashlock,
            },
        );

        if htlc_public.reward == 0 {
            self.call(Token::at(htlc_public.token).transfer_in_public(
                self.address,
                htlc_public.src_receiver,
                htlc_public.amount,
                0,
            ));
        } else if htlc_public.reward_timelock > self.context.timestamp() {
            self.call(Token::at(htlc_public.token).transfer_in_public(
                self.address,
                htlc_public.src_receiver,
                htlc_public.amount,
                0,
            ));
            self.call(Token::at(htlc_public.token).transfer_in_public(
                self.address,
                htlc_public.sender,
                htlc_public.reward,
                0,
            ));
        } else {
            if caller == htlc_public.src_receiver {
                self.call(Token::at(htlc_public.token).transfer_in_public(
                    self.address,
                    htlc_public.src_receiver,
                    htlc_public.amount + htlc_public.reward,
                    0,
                ));
            } else {
                self.call(Token::at(htlc_public.token).transfer_in_public(
                    self.address,
                    htlc_public.src_receiver,
                    htlc_public.amount,
                    0,
                ));
                self.call(Token::at(htlc_public.token).transfer_in_public(
                    self.address,
                    caller,
                    htlc_public.reward,
                    0,
                ));
            }
        }
    }

    #[external("public")]
    #[view]
    fn has_htlc(swap_id: Field, htlc_id: Field) -> pub bool {
        let htlc = self.storage.contracts.at(swap_id).at(htlc_id).read();
        htlc.sender != AztecAddress::zero()
    }

    #[external("public")]
    #[view]
    fn get_htlc(swap_id: Field, htlc_id: Field) -> pub HTLC_Public {
        self.storage.contracts.at(swap_id).at(htlc_id).read()
    }

    #[external("public")]
    #[view]
    fn get_user_swaps_count(user: AztecAddress) -> pub Field {
        self.storage.user_swaps_count.at(user).read()
    }

    #[external("public")]
    #[view]
    fn get_user_swaps(user: AztecAddress) -> pub BoundedVec<Field, 100> {
        let count = self.storage.user_swaps_count.at(user).read();
        let mut swaps = BoundedVec::new();
        let count_u32 = count as u32;
        for i in 0..100 {
            if i < count_u32 {
                let swap_id = self.storage.user_swaps.at(user).at(i as Field).read();
                swaps.push(swap_id);
            }
        }
        swaps
    }
}
