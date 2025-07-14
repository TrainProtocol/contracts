use crate::lib::{bytes_to_u128_limbs, u128_limbs_to_bytes};
use dep::aztec::prelude::AztecAddress;
use dep::aztec::protocol_types::traits::{Packable, Serialize};

#[derive(Serialize)]
pub struct TokenCommitted {
    pub Id: Field,
    pub amount: u128,
    pub token: AztecAddress,
    pub timelock: u64,
    pub dst_chain: str<8>,
    pub dst_asset: str<8>,
    pub dst_address: str<48>,
    pub src_receiver: AztecAddress,
}

impl Packable<10> for TokenCommitted {
    fn pack(self) -> [Field; 10] {
        let zero: Field = 0;
        let mut out = [zero; 10];
        out[0] = 0x7A3F2B1C;
        out[1] = self.Id;
        out[2] = self.amount as Field;
        out[3] = self.token.inner;
        out[4] = self.timelock as Field;

        let dst_chain_byte_array = self.dst_chain.as_bytes();
        let mut dst_chain_byte_array_filled = [0 as u8; 31];
        for i in 0..dst_chain_byte_array.len() {
            dst_chain_byte_array_filled[i] = dst_chain_byte_array[i];
        }

        out[5] = Field::from_be_bytes::<31>(dst_chain_byte_array_filled);

        let dst_asset_byte_array = self.dst_asset.as_bytes();
        let mut dst_asset_byte_array_filled = [0 as u8; 31];
        for i in 0..dst_asset_byte_array.len() {
            dst_asset_byte_array_filled[i] = dst_asset_byte_array[i];
        }

        out[6] = Field::from_be_bytes::<31>(dst_asset_byte_array_filled);

        let dst_address_byte_array = self.dst_address.as_bytes();
        let mut dst_address_byte_array_filled_1 = [0 as u8; 31];
        let mut dst_address_byte_array_filled_2 = [0 as u8; 31];

        for i in 0..31 {
            dst_address_byte_array_filled_1[i] = dst_address_byte_array[i];
        }

        for i in 31..48 {
            dst_address_byte_array_filled_2[i - 31] = dst_address_byte_array[i];
        }

        out[7] = Field::from_be_bytes::<31>(dst_address_byte_array_filled_1);
        out[8] = Field::from_be_bytes::<31>(dst_address_byte_array_filled_2);

        out[9] = self.src_receiver.inner;
        out
    }

    fn unpack(fields: [Field; 10]) -> Self {
        assert(false, "unpack not implemented");
        TokenCommitted {
            Id: fields[1] as Field,
            amount: 0 as u128,
            token: AztecAddress::zero(),
            timelock: 0 as u64,
            dst_chain: "00000000",
            dst_asset: "00000000",
            dst_address: "000000000000000000000000000000000000000000000000",
            src_receiver: AztecAddress::zero(),
        }
    }
}

#[derive(Serialize)]
pub struct TokenLockAdded {
    pub Id: Field,
    pub hashlock: [u8; 32],
    pub timelock: u64,
}

impl Packable<5> for TokenLockAdded {
    fn pack(self) -> [Field; 5] {
        let mut out = [0 as Field; 5];
        out[0] = 0xC1D4E792;
        out[1] = self.Id;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[2] = hashlock_high as Field;
        out[3] = hashlock_low as Field;
        out[4] = self.timelock as Field;
        out
    }

    fn unpack(fields: [Field; 5]) -> Self {
        let Id = fields[1];
        let hashlock = u128_limbs_to_bytes(fields[1] as u128, fields[2] as u128);
        let timelock = fields[4] as u64;
        TokenLockAdded { Id, hashlock, timelock }
    }
}

#[derive(Serialize)]
pub struct TokenRefunded {
    pub Id: Field,
}

impl Packable<2> for TokenRefunded {
    fn pack(self) -> [Field; 2] {
        let mut out = [0 as Field; 2];
        out[0] = 0x2D17C6B8;
        out[1] = self.Id;
        out
    }

    fn unpack(fields: [Field; 2]) -> Self {
        let Id = fields[1];
        TokenRefunded { Id }
    }
}

#[derive(Serialize)]
pub struct TokenRedeemed {
    pub Id: Field,
    pub hashlock: [u8; 32],
    pub secret: [u8; 32],
}

impl Packable<6> for TokenRedeemed {
    fn pack(self) -> [Field; 6] {
        let mut out = [0 as Field; 6];
        out[0] = 0x4F8B9A3E;
        out[1] = self.Id;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[2] = hashlock_high as Field;
        out[3] = hashlock_low as Field;

        let (secret_high, secret_low) = bytes_to_u128_limbs(self.secret);
        out[4] = secret_high as Field;
        out[5] = secret_low as Field;

        out
    }

    fn unpack(fields: [Field; 6]) -> Self {
        let Id = fields[1];
        let hashlock = u128_limbs_to_bytes(fields[2] as u128, fields[3] as u128);
        let secret = u128_limbs_to_bytes(fields[4] as u128, fields[5] as u128);

        TokenRedeemed { Id, hashlock, secret }
    }
}

#[derive(Serialize)]
pub struct TokenLocked {
    pub Id: Field,
    pub hashlock: [u8; 32],
    pub ownership_hash: [u8; 32],
    pub amount: u128,
    pub timelock: u64,
    pub src_receiver: AztecAddress,
    pub token: AztecAddress,
    pub dst_chain: str<8>,
    pub dst_asset: str<8>,
    pub dst_address: str<48>,
}

impl Packable<13> for TokenLocked {
    fn pack(self) -> [Field; 13] {
        let mut out = [0 as Field; 13];
        out[0] = 0x9E5A4F03;
        out[1] = self.Id;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[2] = hashlock_high as Field;
        out[3] = hashlock_low as Field;

        let (ownership_hash_high, ownership_hash_low) = bytes_to_u128_limbs(self.ownership_hash);
        out[4] = ownership_hash_high as Field;
        out[5] = ownership_hash_low as Field;

        let amount_field = self.amount as Field;
        let timelock_field = self.timelock as Field;
        // Multiply timelock by 2^128 to shift it left by 128 bits
        let shift_multiplier = 0x100000000000000000000000000000000;
        out[6] = (timelock_field * shift_multiplier + amount_field) as Field;

        out[7] = self.src_receiver.inner as Field;
        out[8] = self.token.inner;

        let dst_chain_byte_array = self.dst_chain.as_bytes();
        let mut dst_chain_byte_array_filled = [0 as u8; 31];
        for i in 0..dst_chain_byte_array.len() {
            dst_chain_byte_array_filled[i] = dst_chain_byte_array[i];
        }
        out[9] = Field::from_be_bytes::<31>(dst_chain_byte_array_filled);

        let dst_asset_byte_array = self.dst_asset.as_bytes();
        let mut dst_asset_byte_array_filled = [0 as u8; 31];
        for i in 0..dst_asset_byte_array.len() {
            dst_asset_byte_array_filled[i] = dst_asset_byte_array[i];
        }
        out[10] = Field::from_be_bytes::<31>(dst_asset_byte_array_filled);

        let addr = self.dst_address.as_bytes();
        let mut dst_address_byte_array_filled_1 = [0 as u8; 31];
        let mut dst_address_byte_array_filled_2 = [0 as u8; 31];
        for i in 0..31 {
            dst_address_byte_array_filled_1[i] = addr[i];
        }
        for i in 31..48 {
            dst_address_byte_array_filled_2[i - 31] = addr[i];
        }
        out[11] = Field::from_be_bytes::<31>(dst_address_byte_array_filled_1);
        out[12] = Field::from_be_bytes::<31>(dst_address_byte_array_filled_2);

        out
    }

    fn unpack(fields: [Field; 13]) -> Self {
        assert(false, "unpack not implemented");
        TokenLocked {
            Id: fields[1] as Field,
            hashlock: [0 as u8; 32],
            ownership_hash: [0 as u8; 32],
            amount: 0 as u128,
            src_receiver: AztecAddress::zero(),
            token: AztecAddress::zero(),
            timelock: 0 as u64,
            dst_chain: "00000000",
            dst_asset: "00000000",
            dst_address: "000000000000000000000000000000000000000000000000",
        }
    }
}
