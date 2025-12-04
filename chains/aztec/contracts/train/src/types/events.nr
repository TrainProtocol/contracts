use crate::lib::{bytes_to_u128_limbs, u128_limbs_to_bytes};
use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{FromField, Packable, Serialize};

#[derive(Serialize)]
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

impl Packable for SrcLocked {
    let N: u32 = 13;
    fn pack(self) -> [Field; Self::N] {
        let zero: Field = 0;
        let mut out = [zero; 13];
        out[0] = 0x1A2B3C4D; // Event signature
        out[1] = self.swap_id;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[2] = hashlock_high as Field;
        out[3] = hashlock_low as Field;

        out[4] = self.sender.inner;
        out[5] = self.src_receiver.inner;
        out[6] = self.amount as Field;
        out[7] = self.timelock as Field;

        let src_asset_byte_array = self.src_asset.as_bytes();
        let mut src_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..src_asset_byte_array.len() {
            src_asset_byte_array_filled[i] = src_asset_byte_array[i];
        }
        out[8] = Field::from_be_bytes::<30>(src_asset_byte_array_filled);

        let dst_chain_byte_array = self.dst_chain.as_bytes();
        let mut dst_chain_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_chain_byte_array.len() {
            dst_chain_byte_array_filled[i] = dst_chain_byte_array[i];
        }
        out[9] = Field::from_be_bytes::<30>(dst_chain_byte_array_filled);

        let dst_asset_byte_array = self.dst_asset.as_bytes();
        let mut dst_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_asset_byte_array.len() {
            dst_asset_byte_array_filled[i] = dst_asset_byte_array[i];
        }
        out[10] = Field::from_be_bytes::<30>(dst_asset_byte_array_filled);

        let dst_address_byte_array = self.dst_address.as_bytes();
        let mut dst_address_byte_array_filled_1 = [0 as u8; 30];
        let mut dst_address_byte_array_filled_2 = [0 as u8; 30];
        let mut dst_address_byte_array_filled_3 = [0 as u8; 30];

        for i in 0..30 {
            dst_address_byte_array_filled_1[i] = dst_address_byte_array[i];
            dst_address_byte_array_filled_2[i] = dst_address_byte_array[i + 30];
            dst_address_byte_array_filled_3[i] = dst_address_byte_array[i + 60];
        }

        out[11] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_2);
        out[12] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_3);
        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        assert(false, "unpack not implemented");
        SrcLocked {
            swap_id: fields[1],
            hashlock: [0 as u8; 32],
            dst_chain: "000000000000000000000000000000",
            dst_address: "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            dst_asset: "000000000000000000000000000000",
            sender: AztecAddress::zero(),
            src_receiver: AztecAddress::zero(),
            src_asset: "000000000000000000000000000000",
            amount: 0 as u128,
            timelock: 0 as u64,
        }
    }
}

#[derive(Serialize)]
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

impl Packable for DstLocked {
    let N: u32 = 15;
    fn pack(self) -> [Field; Self::N] {
        let zero: Field = 0;
        let mut out = [zero; 15];
        out[0] = 0x2B3C4D5E; // Event signature
        out[1] = self.swap_id;
        out[2] = self.htlc_id;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[3] = hashlock_high as Field;
        out[4] = hashlock_low as Field;

        out[5] = self.sender.inner;
        out[6] = self.src_receiver.inner;
        out[7] = self.amount as Field;
        out[8] = self.reward as Field;
        out[9] = self.reward_timelock as Field;
        out[10] = self.timelock as Field;

        let src_asset_byte_array = self.src_asset.as_bytes();
        let mut src_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..src_asset_byte_array.len() {
            src_asset_byte_array_filled[i] = src_asset_byte_array[i];
        }
        out[11] = Field::from_be_bytes::<30>(src_asset_byte_array_filled);

        let dst_chain_byte_array = self.dst_chain.as_bytes();
        let mut dst_chain_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_chain_byte_array.len() {
            dst_chain_byte_array_filled[i] = dst_chain_byte_array[i];
        }
        out[12] = Field::from_be_bytes::<30>(dst_chain_byte_array_filled);

        let dst_asset_byte_array = self.dst_asset.as_bytes();
        let mut dst_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_asset_byte_array.len() {
            dst_asset_byte_array_filled[i] = dst_asset_byte_array[i];
        }
        out[13] = Field::from_be_bytes::<30>(dst_asset_byte_array_filled);

        // Note: dst_address omitted for brevity in this packed format
        out[14] = 0;
        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        assert(false, "unpack not implemented");
        DstLocked {
            swap_id: fields[1],
            htlc_id: fields[2],
            hashlock: [0 as u8; 32],
            dst_chain: "000000000000000000000000000000",
            dst_address: "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            dst_asset: "000000000000000000000000000000",
            sender: AztecAddress::zero(),
            src_receiver: AztecAddress::zero(),
            src_asset: "000000000000000000000000000000",
            amount: 0 as u128,
            reward: 0 as u128,
            reward_timelock: 0 as u64,
            timelock: 0 as u64,
        }
    }
}

#[derive(Serialize)]
pub struct TokenRefunded {
    pub swap_id: Field,
    pub htlc_id: Field,
}

impl Packable for TokenRefunded {
    let N: u32 = 3;
    fn pack(self) -> [Field; Self::N] {
        let mut out = [0 as Field; 3];
        out[0] = 0x2D17C6B8;
        out[1] = self.swap_id;
        out[2] = self.htlc_id;
        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        TokenRefunded { swap_id: fields[1], htlc_id: fields[2] }
    }
}

#[derive(Serialize)]
pub struct TokenRedeemed {
    pub swap_id: Field,
    pub htlc_id: Field,
    pub redeem_address: AztecAddress,
    pub secret_high: u128,
    pub secret_low: u128,
    pub hashlock: [u8; 32],
}

impl Packable for TokenRedeemed {
    let N: u32 = 8;
    fn pack(self) -> [Field; Self::N] {
        let mut out = [0 as Field; 8];
        out[0] = 0x4F8B9A3E;
        out[1] = self.swap_id;
        out[2] = self.htlc_id;
        out[3] = self.redeem_address.inner;

        out[4] = self.secret_high as Field;
        out[5] = self.secret_low as Field;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[6] = hashlock_high as Field;
        out[7] = hashlock_low as Field;

        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        let swap_id = fields[1];
        let htlc_id = fields[2];
        let redeem_address = AztecAddress::from_field(fields[3]);
        let secret_high = fields[4] as u128;
        let secret_low = fields[5] as u128;
        let hashlock = u128_limbs_to_bytes(fields[6] as u128, fields[7] as u128);

        TokenRedeemed { swap_id, htlc_id, redeem_address, secret_high, secret_low, hashlock }
    }
}
