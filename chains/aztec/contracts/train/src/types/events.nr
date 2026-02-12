use aztec::protocol::address::AztecAddress;
use aztec::protocol::traits::Serialize;

#[derive(Serialize)]
pub struct UserLocked {
    pub hashlock: [u8; 32],
    pub sender: AztecAddress,
    pub recipient: AztecAddress,
    pub src_chain: [u8; 30],
    pub token: AztecAddress,
    pub amount: u128,
    pub timelock: u64,
    pub dst_chain: [u8; 30],
    pub dst_address: [u8; 90],
    pub dst_amount: u128,
    pub dst_token: [u8; 90],
    pub reward_amount: u128,
    pub reward_token: AztecAddress,
    pub reward_recipient: [u8; 90],
    pub reward_timelock_delta: u64,
    pub userData: [u8; 256],
    pub solverData: [u8; 256],
}

#[derive(Serialize)]
pub struct SolverLocked {
    pub hashlock: [u8; 32],
    pub sender: AztecAddress,
    pub recipient: AztecAddress,
    pub index: Field,
    pub src_chain: [u8; 30],
    pub token: AztecAddress,
    pub amount: u128,
    pub reward: u128,
    pub reward_token: AztecAddress,
    pub reward_recipient: AztecAddress,
    pub timelock: u64,
    pub reward_timelock: u64,
    pub dst_chain: [u8; 30],
    pub dst_address: [u8; 90],
    pub dst_amount: u128,
    pub dst_token: [u8; 90],
    pub data: [u8; 256],
}

#[derive(Serialize)]
pub struct UserRedeemed {
    pub hashlock: [u8; 32],
    pub redeemer: AztecAddress,
    pub secret: [u8; 32],
}

#[derive(Serialize)]
pub struct SolverRedeemed {
    pub hashlock: [u8; 32],
    pub index: Field,
    pub redeemer: AztecAddress,
    pub secret: [u8; 32],
}

#[derive(Serialize)]
pub struct UserRefunded {
    pub hashlock: [u8; 32],
}

#[derive(Serialize)]
pub struct SolverRefunded {
    pub hashlock: [u8; 32],
    pub index: Field,
}
