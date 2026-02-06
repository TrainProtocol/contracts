use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::Serialize;

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

#[derive(Serialize)]
pub struct TokenRefunded {
    pub swap_id: Field,
    pub htlc_id: Field,
}

#[derive(Serialize)]
pub struct TokenRedeemed {
    pub swap_id: Field,
    pub htlc_id: Field,
    pub redeem_address: AztecAddress,
    pub secret: [u8; 32],
    pub hashlock: [u8; 32],
}
