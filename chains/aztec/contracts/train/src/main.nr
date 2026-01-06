//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

mod lib;
use dep::aztec::macros::aztec;

#[aztec]
pub contract Train {
    use std::meta::derive;

    use aztec::macros::{
        events::event,
        functions::{external, initializer, view},
        storage::storage,
    };

    use dep::aztec::{
        protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
        state_vars::{PublicMutable, map::Map},
    };
    use dep::sha256;
    use dep::token::Token;

    use crate::lib::{bytes_to_u128_limbs, u128_limbs_to_bytes};

    // Events
    #[event]
    pub struct SrcLocked {
        pub swap_id: Field,
        pub hashlock: [u8; 32],
        pub dst_chain: str<30>,
        pub dst_address: str<90>,
        pub dst_asset: str<30>,
        pub sender: AztecAddress,
        pub src_receiver: AztecAddress,
        pub src_asset: str<30>,
        pub amount: u128,
        pub timelock: u64,
    }

    #[event]
    pub struct DstLocked {
        pub swap_id: Field,
        pub htlc_id: Field,
        pub hashlock: [u8; 32],
        pub dst_chain: str<30>,
        pub dst_address: str<90>,
        pub dst_asset: str<30>,
        pub sender: AztecAddress,
        pub src_receiver: AztecAddress,
        pub src_asset: str<30>,
        pub amount: u128,
        pub reward: u128,
        pub reward_timelock: u64,
        pub timelock: u64,
    }

    #[event]
    pub struct TokenRefunded {
        pub swap_id: Field,
        pub htlc_id: Field,
    }

    #[event]
    pub struct TokenRedeemed {
        pub swap_id: Field,
        pub htlc_id: Field,
        pub redeem_address: AztecAddress,
        pub secret_high: u128,
        pub secret_low: u128,
        pub hashlock: [u8; 32],
    }

    #[derive(Eq, Packable, Serialize, Deserialize)]
    pub struct HTLC_Public {
        amount: u128,
        token: AztecAddress,
        hashlock_high: u128,
        hashlock_low: u128,
        secret_high: u128,
        secret_low: u128,
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
        hashlock_high: u128,
        hashlock_low: u128,
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

        let hashlock_tuple = (hashlock_high, hashlock_low);
        let sender = self.msg_sender().expect(f"Sender must not be none!");
        let htlc_public = HTLC_Public {
            amount: amount,
            token: token,
            hashlock_high: hashlock_tuple.0,
            hashlock_low: hashlock_tuple.1,
            secret_high: 0 as u128,
            secret_low: 0 as u128,
            sender: sender,
            src_receiver: src_receiver,
            timelock: timelock,
            claimed: 1 as u8,
            reward: 0 as u128,
            reward_timelock: 0 as u64,
        };
        self.storage.contracts.at(swap_id).at(0).write(htlc_public);

        // Transfer tokens from sender to contract
        self.call(Token::at(token).transfer_in_public(sender, self.address, amount, 0));

        // Track this swap for the user
        let current_count = self.storage.user_swaps_count.at(sender).read();
        self.storage.user_swaps.at(sender).at(current_count).write(swap_id);
        self.storage.user_swaps_count.at(sender).write(current_count + 1);

        let hashlock = u128_limbs_to_bytes(hashlock_high, hashlock_low);
        let log_msg = SrcLocked {
            swap_id: swap_id,
            hashlock: hashlock,
            dst_chain: dst_chain,
            dst_address: dst_address,
            dst_asset: dst_asset,
            sender: sender,
            src_receiver: src_receiver,
            src_asset: src_asset,
            amount: amount,
            timelock: timelock,
        };

        self.emit(log_msg);
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

        // Transfer tokens back to sender
        self.call(Token::at(htlc_public.token).transfer_in_public(
            self.address,
            htlc_public.sender,
            refund_amount,
            0
        ));

        let modified_htlc_public = HTLC_Public {
            amount: htlc_public.amount,
            token: htlc_public.token,
            hashlock_high: htlc_public.hashlock_high,
            hashlock_low: htlc_public.hashlock_low,
            secret_high: htlc_public.secret_high,
            secret_low: htlc_public.secret_low,
            sender: htlc_public.sender,
            src_receiver: htlc_public.src_receiver,
            timelock: htlc_public.timelock,
            claimed: 2 as u8,
            reward: htlc_public.reward,
            reward_timelock: htlc_public.reward_timelock,
        };

        self.storage.contracts.at(swap_id).at(htlc_id).write(modified_htlc_public);
        let log_msg = TokenRefunded { swap_id, htlc_id };
        self.emit(log_msg);
    }

    #[external("public")]
    fn lock_dst(
        swap_id: Field,
        htlc_id: Field,
        hashlock_high: u128,
        hashlock_low: u128,
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
        // Enforce reward >= 10% of amount: reward * 10 >= amount
        assert(reward * 10 >= amount, "InvalidRewardAmount");

        let htlc_public_current = self.storage.contracts.at(swap_id).at(htlc_id).read();
        assert(htlc_public_current.sender == AztecAddress::zero(), "HTLCAlreadyExists");
        assert(self.context.timestamp() + 900 < timelock, "InvalidTimelock");
        assert(reward_timelock <= timelock, "InvalidRewardTimelock");
        assert(reward_timelock > self.context.timestamp(), "InvalidRewardTimelock");

        let hashlock_tuple = (hashlock_high, hashlock_low);
        let sender = self.msg_sender().expect(f"Sender must not be none!");
        let htlc_public = HTLC_Public {
            amount: amount,
            token: token,
            hashlock_high: hashlock_tuple.0,
            hashlock_low: hashlock_tuple.1,
            secret_high: 0 as u128,
            secret_low: 0 as u128,
            sender: sender,
            src_receiver: src_receiver,
            timelock: timelock,
            claimed: 1 as u8,
            reward: reward,
            reward_timelock: reward_timelock,
        };
        self.storage.contracts.at(swap_id).at(htlc_id).write(htlc_public);

        // Transfer tokens from sender to contract
        self.call(Token::at(token).transfer_in_public(sender, self.address, total_amount, 0));

        let hashlock = u128_limbs_to_bytes(hashlock_high, hashlock_low);
        let log_msg = DstLocked {
            swap_id: swap_id,
            htlc_id: htlc_id,
            hashlock: hashlock,
            dst_chain: dst_chain,
            dst_address: dst_address,
            dst_asset: dst_asset,
            sender: sender,
            src_receiver: src_receiver,
            src_asset: src_asset,
            amount: amount,
            reward: reward,
            reward_timelock: reward_timelock,
            timelock: timelock,
        };

        self.emit(log_msg);
    }

    #[external("public")]
    fn redeem(swap_id: Field, htlc_id: Field, secret_high: u128, secret_low: u128) {
        let secret = u128_limbs_to_bytes(secret_high, secret_low);
        let caller = self.msg_sender().expect(f"Sender must not be none!");

        let htlc_public = self.storage.contracts.at(swap_id).at(htlc_id).read();
        assert(htlc_public.amount > 0, "HTLCNotExists");
        let hashed_secret = sha256::sha256_var(secret, secret.len() as u64);
        let hashed_secret_tuple = bytes_to_u128_limbs(hashed_secret);
        assert(htlc_public.hashlock_high == hashed_secret_tuple.0, "HashlockNotMatch");
        assert(htlc_public.hashlock_low == hashed_secret_tuple.1, "HashlockNotMatch");
        assert(htlc_public.claimed == 1, "AlreadyClaimed");

        let secret_limbs = bytes_to_u128_limbs(secret);

        let modified_htlc_public = HTLC_Public {
            amount: htlc_public.amount,
            token: htlc_public.token,
            hashlock_high: htlc_public.hashlock_high,
            hashlock_low: htlc_public.hashlock_low,
            secret_high: secret_limbs.0,
            secret_low: secret_limbs.1,
            sender: htlc_public.sender,
            src_receiver: htlc_public.src_receiver,
            timelock: htlc_public.timelock,
            claimed: 3 as u8,
            reward: htlc_public.reward,
            reward_timelock: htlc_public.reward_timelock,
        };

        self.storage.contracts.at(swap_id).at(htlc_id).write(modified_htlc_public);

        // Handle token transfers based on reward logic
        if htlc_public.reward == 0 {
            // No reward: transfer amount to src_receiver
            self.call(Token::at(htlc_public.token).transfer_in_public(
                self.address,
                htlc_public.src_receiver,
                htlc_public.amount,
                0
            ));
        } else if htlc_public.reward_timelock > self.context.timestamp() {
            // Before reward timelock: amount to src_receiver, reward back to sender
            self.call(Token::at(htlc_public.token).transfer_in_public(
                self.address,
                htlc_public.src_receiver,
                htlc_public.amount,
                0
            ));
            self.call(Token::at(htlc_public.token).transfer_in_public(
                self.address,
                htlc_public.sender,
                htlc_public.reward,
                0
            ));
        } else {
            // After reward timelock
            if caller == htlc_public.src_receiver {
                // src_receiver gets amount + reward
                self.call(Token::at(htlc_public.token).transfer_in_public(
                    self.address,
                    htlc_public.src_receiver,
                    htlc_public.amount + htlc_public.reward,
                    0
                ));
            } else {
                // amount to src_receiver, reward to caller
                self.call(Token::at(htlc_public.token).transfer_in_public(
                    self.address,
                    htlc_public.src_receiver,
                    htlc_public.amount,
                    0
                ));
                self.call(Token::at(htlc_public.token).transfer_in_public(
                    self.address,
                    caller,
                    htlc_public.reward,
                    0
                ));
            }
        }

        let log_msg = TokenRedeemed {
            swap_id: swap_id,
            htlc_id: htlc_id,
            redeem_address: caller,
            secret_high: secret_limbs.0,
            secret_low: secret_limbs.1,
            hashlock: u128_limbs_to_bytes(htlc_public.hashlock_high, htlc_public.hashlock_low),
        };

        self.emit(log_msg);
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
}
