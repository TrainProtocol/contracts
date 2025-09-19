use crate::lib::{bytes_to_u128_limbs, u128_limbs_to_bytes};
use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{Packable, Serialize};

#[derive(Serialize)]
pub struct TokenCommitted {
    pub Id: Field,
    pub amount: u128,
    pub token: AztecAddress,
    pub timelock: u64,
    pub src_receiver: AztecAddress,
    pub src_asset: str<30>,
    pub dst_chain: str<30>,
    pub dst_asset: str<30>,
    pub dst_address: str<90>,
}

impl Packable for TokenCommitted {
    let N: u32 = 12;
    fn pack(self) -> [Field; Self::N] {
        let zero: Field = 0;
        let mut out = [zero; 12];
        out[0] = 0x7A3F2B1C;
        out[1] = self.Id;
        out[2] = self.amount as Field;
        out[3] = self.token.inner;
        out[4] = self.timelock as Field;
        out[5] = self.src_receiver.inner;

        let src_asset_byte_array = self.src_asset.as_bytes();
        let mut src_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..src_asset_byte_array.len() {
            src_asset_byte_array_filled[i] = src_asset_byte_array[i];
        }
        out[6] = Field::from_be_bytes::<30>(src_asset_byte_array_filled);

        let dst_chain_byte_array = self.dst_chain.as_bytes();
        let mut dst_chain_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_chain_byte_array.len() {
            dst_chain_byte_array_filled[i] = dst_chain_byte_array[i];
        }
        out[7] = Field::from_be_bytes::<30>(dst_chain_byte_array_filled);

        let dst_asset_byte_array = self.dst_asset.as_bytes();
        let mut dst_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_asset_byte_array.len() {
            dst_asset_byte_array_filled[i] = dst_asset_byte_array[i];
        }
        out[8] = Field::from_be_bytes::<30>(dst_asset_byte_array_filled);

        let dst_address_byte_array = self.dst_address.as_bytes();
        let mut dst_address_byte_array_filled_1 = [0 as u8; 30];
        let mut dst_address_byte_array_filled_2 = [0 as u8; 30];
        let mut dst_address_byte_array_filled_3 = [0 as u8; 30];

        for i in 0..30 {
            dst_address_byte_array_filled_1[i] = dst_address_byte_array[i];
            dst_address_byte_array_filled_2[i] = dst_address_byte_array[i + 30];
            dst_address_byte_array_filled_3[i] = dst_address_byte_array[i + 60];
        }

        out[9] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_1);
        out[10] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_2);
        out[11] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_3);
        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        assert(false, "unpack not implemented");
        TokenCommitted {
            Id: fields[1] as Field,
            amount: 0 as u128,
            token: AztecAddress::zero(),
            timelock: 0 as u64,
            src_receiver: AztecAddress::zero(),
            src_asset: "000000000000000000000000000000",
            dst_chain: "000000000000000000000000000000",
            dst_asset: "000000000000000000000000000000",
            dst_address: "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        }
    }
}

#[derive(Serialize)]
pub struct TokenLockAdded {
    pub Id: Field,
    pub hashlock: [u8; 32],
    pub timelock: u64,
}

impl Packable for TokenLockAdded {
    let N: u32 = 5;
    fn pack(self) -> [Field; Self::N] {
        let mut out = [0 as Field; 5];
        out[0] = 0xC1D4E792;
        out[1] = self.Id;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[2] = hashlock_high as Field;
        out[3] = hashlock_low as Field;
        out[4] = self.timelock as Field;
        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        let Id = fields[1];
        let hashlock = u128_limbs_to_bytes(fields[2] as u128, fields[3] as u128);
        let timelock = fields[4] as u64;
        TokenLockAdded { Id, hashlock, timelock }
    }
}

#[derive(Serialize)]
pub struct TokenRefunded {
    pub Id: Field,
}

impl Packable for TokenRefunded {
    let N: u32 = 2;
    fn pack(self) -> [Field; Self::N] {
        let mut out = [0 as Field; 2];
        out[0] = 0x2D17C6B8;
        out[1] = self.Id;
        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
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

impl Packable for TokenRedeemed {
    let N: u32 = 6;
    fn pack(self) -> [Field; Self::N] {
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

    fn unpack(fields: [Field; Self::N]) -> Self {
        let Id = fields[1];
        let hashlock = u128_limbs_to_bytes(fields[2] as u128, fields[3] as u128);
        let secret = u128_limbs_to_bytes(fields[4] as u128, fields[5] as u128);

        TokenRedeemed { Id, hashlock, secret }
    }
}

#[derive(Serialize)]
pub struct TokenLockedFirst {
    pub Id: Field,
    pub amount: u128,
    pub token: AztecAddress,
    pub timelock: u64,
    pub src_receiver: AztecAddress,
    pub src_asset: str<30>,
    pub dst_chain: str<30>,
    pub dst_asset: str<30>,
    pub dst_address: str<90>,
}

impl Packable for TokenLockedFirst {
    let N: u32 = 12;
    fn pack(self) -> [Field; Self::N] {
        let zero: Field = 0;
        let mut out = [zero; 12];
        out[0] = 0x9E5A4F03;
        out[1] = self.Id;
        out[2] = self.amount as Field;
        out[3] = self.token.inner;
        out[4] = self.timelock as Field;
        out[5] = self.src_receiver.inner;

        let src_asset_byte_array = self.src_asset.as_bytes();
        let mut src_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..src_asset_byte_array.len() {
            src_asset_byte_array_filled[i] = src_asset_byte_array[i];
        }
        out[6] = Field::from_be_bytes::<30>(src_asset_byte_array_filled);

        let dst_chain_byte_array = self.dst_chain.as_bytes();
        let mut dst_chain_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_chain_byte_array.len() {
            dst_chain_byte_array_filled[i] = dst_chain_byte_array[i];
        }
        out[7] = Field::from_be_bytes::<30>(dst_chain_byte_array_filled);

        let dst_asset_byte_array = self.dst_asset.as_bytes();
        let mut dst_asset_byte_array_filled = [0 as u8; 30];
        for i in 0..dst_asset_byte_array.len() {
            dst_asset_byte_array_filled[i] = dst_asset_byte_array[i];
        }
        out[8] = Field::from_be_bytes::<30>(dst_asset_byte_array_filled);

        let dst_address_byte_array = self.dst_address.as_bytes();
        let mut dst_address_byte_array_filled_1 = [0 as u8; 30];
        let mut dst_address_byte_array_filled_2 = [0 as u8; 30];
        let mut dst_address_byte_array_filled_3 = [0 as u8; 30];

        for i in 0..30 {
            dst_address_byte_array_filled_1[i] = dst_address_byte_array[i];
            dst_address_byte_array_filled_2[i] = dst_address_byte_array[i + 30];
            dst_address_byte_array_filled_3[i] = dst_address_byte_array[i + 60];
        }

        out[9] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_1);
        out[10] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_2);
        out[11] = Field::from_be_bytes::<30>(dst_address_byte_array_filled_3);
        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        assert(false, "unpack not implemented");
        TokenLockedFirst {
            Id: fields[1] as Field,
            amount: 0 as u128,
            token: AztecAddress::zero(),
            timelock: 0 as u64,
            src_receiver: AztecAddress::zero(),
            src_asset: "000000000000000000000000000000",
            dst_chain: "000000000000000000000000000000",
            dst_asset: "000000000000000000000000000000",
            dst_address: "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        }
    }
}

#[derive(Serialize)]
pub struct TokenLockedSecond {
    pub Id: Field,
    pub hashlock: [u8; 32],
    pub ownership_hash: [u8; 32],
}

impl Packable for TokenLockedSecond {
    let N: u32 = 6;
    fn pack(self) -> [Field; Self::N] {
        let mut out = [0 as Field; 6];
        out[0] = 0x9E5A4F03;
        out[1] = self.Id;

        let (hashlock_high, hashlock_low) = bytes_to_u128_limbs(self.hashlock);
        out[2] = hashlock_high as Field;
        out[3] = hashlock_low as Field;

        let (ownership_hash_high, ownership_hash_low) = bytes_to_u128_limbs(self.ownership_hash);
        out[4] = ownership_hash_high as Field;
        out[5] = ownership_hash_low as Field;

        out
    }

    fn unpack(fields: [Field; Self::N]) -> Self {
        assert(false, "unpack not implemented");
        TokenLockedSecond {
            Id: fields[1] as Field,
            hashlock: [0 as u8; 32],
            ownership_hash: [0 as u8; 32],
        }
    }
}
