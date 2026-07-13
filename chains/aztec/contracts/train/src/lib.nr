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

/// Packs 128 bytes into 5 fields (31-byte big-endian chunks + a 4-byte tail).
/// Used by the manual Packable impls to keep public storage writes low: the
/// derived impl would store one field per byte.
pub fn bytes128_to_fields(bytes: [u8; 128]) -> [Field; 5] {
    let mut out = [0; 5];
    for i in 0..4 {
        let mut acc: Field = 0;
        for j in 0..31 {
            acc = acc * 256 + (bytes[i * 31 + j] as Field);
        }
        out[i] = acc;
    }
    let mut acc: Field = 0;
    for j in 0..4 {
        acc = acc * 256 + (bytes[124 + j] as Field);
    }
    out[4] = acc;
    out
}

pub fn fields_to_bytes128(fields: [Field; 5]) -> [u8; 128] {
    let mut out = [0u8; 128];
    for i in 0..4 {
        let chunk: [u8; 31] = fields[i].to_be_bytes();
        for j in 0..31 {
            out[i * 31 + j] = chunk[j];
        }
    }
    let tail: [u8; 4] = fields[4].to_be_bytes();
    for j in 0..4 {
        out[124 + j] = tail[j];
    }
    out
}
