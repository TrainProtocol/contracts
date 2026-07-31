#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use starknet::ContractAddress;
use core::num::traits::Zero;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address};
use train_protocol::Train::{ITrainDispatcher, ITrainDispatcherTrait};
use train_protocol::Train::{
    UserLockParams, SolverLockParams, DestinationInfo,
};
use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};

// ──────────────────────── Mock ERC20 interface ────────────────────────

#[starknet::interface]
pub trait IMockERC20Mint<TContractState> {
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
}

// ──────────────────────── Constants ────────────────────────

#[feature("deprecated-starknet-consts")]
pub fn SENDER() -> ContractAddress {
    contract_address_const::<'SENDER'>()
}

#[feature("deprecated-starknet-consts")]
pub fn RECIPIENT() -> ContractAddress {
    contract_address_const::<'RECIPIENT'>()
}

#[feature("deprecated-starknet-consts")]
pub fn REWARD_RECIPIENT() -> ContractAddress {
    contract_address_const::<'REWARD_RECIPIENT'>()
}

#[feature("deprecated-starknet-consts")]
pub fn ANYONE() -> ContractAddress {
    contract_address_const::<'ANYONE'>()
}

// Secret = 1, Hashlock = sha256(1) as u256
pub const SECRET: u256 = 1;
pub const HASHLOCK: u256 =
    0xec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5;

pub const SECRET_2: u256 = 2;
pub const HASHLOCK_2: u256 =
    0x9267d3dbed802941483f1afa2a6bc68de5f653128aca9bf1461c5d0a3ad36ed2;

pub const SECRET_3: u256 = 3;
pub const HASHLOCK_3: u256 =
    0x7b2ab94bb7a1e68cd55e5a1b4c2bbd8191b101bcc41abd86b12748d7e2a99aa8;

pub const MINT_AMOUNT: u256 = 1_000_000_000_000_000_000_000; // 1000e18
pub const LOCK_AMOUNT: u256 = 100_000_000_000_000_000_000; // 100e18
pub const REWARD_AMOUNT: u256 = 10_000_000_000_000_000_000; // 10e18
pub const TIMELOCK_DELTA: u64 = 3600; // 1 hour
pub const REWARD_TIMELOCK_DELTA: u64 = 1800; // 30 min
pub const QUOTE_EXPIRY: u64 = 999_999_999;
pub const BASE_TIMESTAMP: u64 = 1000;

// ──────────────────────── Deploy Helpers ────────────────────────

pub fn deploy_token() -> ContractAddress {
    let contract = declare("MockERC20").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

pub fn deploy_train() -> ContractAddress {
    let contract = declare("Train").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

/// Declares + deploys the reference `ConstantPayoutCurve` (identity curve: payout == amount).
pub fn deploy_constant_curve() -> ContractAddress {
    let contract = declare("ConstantPayoutCurve").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

/// Declares + deploys the test-only `MockDecayCurve(num, den)`: `compute_payout` always returns
/// `amount * num / den`, regardless of timestamps/config.
pub fn deploy_mock_decay_curve(num: u256, den: u256) -> ContractAddress {
    let contract = declare("MockDecayCurve").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    num.serialize(ref calldata);
    den.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    addr
}

/// Declares + deploys `MockSrc5Only`: implements SRC5 but never registers `IPAYOUT_CURVE_ID` and
/// has no `compute_payout`. Used to hit Train's own `'InvalidPayoutCurve'` assert (as opposed to
/// a syscall-level `ENTRYPOINT_NOT_FOUND` from a contract with no `supports_interface` at all).
pub fn deploy_mock_src5_only() -> ContractAddress {
    let contract = declare("MockSrc5Only").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

pub fn mint_and_approve(
    token_addr: ContractAddress,
    owner: ContractAddress,
    spender: ContractAddress,
    mint_amount: u256,
    approve_amount: u256,
) {
    let token = IMockERC20MintDispatcher { contract_address: token_addr };
    token.mint(owner, mint_amount);

    start_cheat_caller_address(token_addr, owner);
    let erc20 = IERC20Dispatcher { contract_address: token_addr };
    erc20.approve(spender, approve_amount);
    stop_cheat_caller_address(token_addr);
}

/// Full setup: deploy Train + 2 tokens, mint & approve for SENDER
pub fn setup() -> (ContractAddress, ContractAddress, ContractAddress) {
    let train_addr = deploy_train();
    let token_addr = deploy_token();
    let reward_token_addr = deploy_token();

    mint_and_approve(token_addr, SENDER(), train_addr, MINT_AMOUNT, MINT_AMOUNT);
    mint_and_approve(reward_token_addr, SENDER(), train_addr, MINT_AMOUNT, MINT_AMOUNT);

    (train_addr, token_addr, reward_token_addr)
}

// ──────────────────────── Param Builders ────────────────────────

/// `refund_to` defaults to `SENDER()` — the same address old tests cheated as `sender`/caller,
/// so refund-goes-back-to-locker assertions written against the old (pre-`refund_to`) contract
/// keep holding without every call site having to set it explicitly.
pub fn make_user_lock_params(
    hashlock: u256, token: ContractAddress, amount: u256,
) -> UserLockParams {
    UserLockParams {
        hashlock,
        amount,
        reward_amount: REWARD_AMOUNT,
        timelock_delta: TIMELOCK_DELTA,
        reward_timelock_delta: REWARD_TIMELOCK_DELTA,
        quote_expiry: QUOTE_EXPIRY,
        recipient: RECIPIENT(),
        token,
        reward_token: "reward_token_addr",
        reward_recipient: "reward_recipient_addr",
        src_chain: "starknet",
        refund_to: SENDER(),
        payout_curve: Zero::zero(),
        payout_curve_data: "",
    }
}

pub fn make_solver_lock_params(
    hashlock: u256,
    token: ContractAddress,
    reward_token: ContractAddress,
    amount: u256,
    reward: u256,
) -> SolverLockParams {
    SolverLockParams {
        hashlock,
        amount,
        reward,
        timelock_delta: TIMELOCK_DELTA,
        reward_timelock_delta: REWARD_TIMELOCK_DELTA,
        recipient: RECIPIENT(),
        reward_recipient: REWARD_RECIPIENT(),
        token,
        reward_token,
        src_chain: "starknet",
        refund_to: SENDER(),
        payout_curve: Zero::zero(),
        payout_curve_data: "",
    }
}

pub fn make_dst() -> DestinationInfo {
    DestinationInfo {
        dst_chain: "ethereum",
        dst_address: "0xRecipient",
        dst_amount: LOCK_AMOUNT,
        dst_token: "ETH",
    }
}

/// Helper to create a user lock with standard params. Cheats caller to SENDER (the attributed
/// lock owner, since `sender` was removed from `UserLockParams` in favor of the caller).
pub fn do_user_lock(
    train_addr: ContractAddress, token_addr: ContractAddress, hashlock: u256,
) {
    let train = ITrainDispatcher { contract_address: train_addr };
    let params = make_user_lock_params(hashlock, token_addr, LOCK_AMOUNT);
    let dst = make_dst();
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock(params, dst, "", "");
    stop_cheat_caller_address(train_addr);
}

/// Helper to create a user lock via `user_lock_for`, attributing it to `user` while funds are
/// still pulled from the caller (cheated to SENDER, which holds the approvals from `setup()`).
pub fn do_user_lock_for(
    train_addr: ContractAddress, token_addr: ContractAddress, user: ContractAddress, hashlock: u256,
) {
    let train = ITrainDispatcher { contract_address: train_addr };
    let params = make_user_lock_params(hashlock, token_addr, LOCK_AMOUNT);
    let dst = make_dst();
    start_cheat_caller_address(train_addr, SENDER());
    train.user_lock_for(user, params, dst, "", "");
    stop_cheat_caller_address(train_addr);
}

/// Helper to create a solver lock with standard params. Cheats caller to SENDER, so the lock is
/// keyed as `(hashlock, SENDER())` — use `do_solver_lock_as` to lock from a different solver.
pub fn do_solver_lock(
    train_addr: ContractAddress,
    token_addr: ContractAddress,
    reward_token_addr: ContractAddress,
    hashlock: u256,
    reward: u256,
) {
    do_solver_lock_as(train_addr, token_addr, reward_token_addr, hashlock, reward, SENDER());
}

/// Helper to create a solver lock with standard params, cheating caller to `solver`. Lets tests
/// exercise the per-(hashlock, solver) uniqueness guard with distinct solver addresses.
pub fn do_solver_lock_as(
    train_addr: ContractAddress,
    token_addr: ContractAddress,
    reward_token_addr: ContractAddress,
    hashlock: u256,
    reward: u256,
    solver: ContractAddress,
) {
    let train = ITrainDispatcher { contract_address: train_addr };
    let params = make_solver_lock_params(hashlock, token_addr, reward_token_addr, LOCK_AMOUNT, reward);
    let dst = make_dst();
    start_cheat_caller_address(train_addr, solver);
    train.solver_lock(params, dst, "");
    stop_cheat_caller_address(train_addr);
}
