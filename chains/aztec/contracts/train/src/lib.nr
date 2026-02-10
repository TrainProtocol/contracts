use aztec::protocol::traits::ToField;

pub fn bytes_to_u128_limbs(bytes: [u8; 32]) -> (u128, u128) {
    let mut high: u128 = 0;
    let mut low: u128 = 0;
    for i in 0..16 {
        high = (high << 8) + (bytes[i] as u128);
    }
    for i in 16..32 {
        low = (low << 8) + (bytes[i] as u128);
    }
    (high, low)
}

pub fn u128_limbs_to_bytes(high: u128, low: u128) -> [u8; 32] {
    let mut bytes: [u8; 32] = [0; 32];

    let mut temp = high;
    for i in 0..16 {
        bytes[15 - i] = (temp & 0xff) as u8;
        temp >>= 8;
    }

    temp = low;
    for i in 0..16 {
        bytes[31 - i] = (temp & 0xff) as u8;
        temp >>= 8;
    }

    bytes
}

pub fn hashlock_to_fields(hashlock: [u8; 32]) -> (Field, Field) {
    let (high, low) = bytes_to_u128_limbs(hashlock);
    (high.to_field(), low.to_field())
}

pub fn fields_to_hashlock(high: Field, low: Field) -> [u8; 32] {
    u128_limbs_to_bytes(high as u128, low as u128)
}
