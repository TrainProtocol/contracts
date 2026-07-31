use crate::Train;
use aztec::{
    protocol::address::AztecAddress,
    test::helpers::{authwit as authwit_cheatcodes, test_environment::TestEnvironment},
};
use sha256;
use token::Token;

pub global MINT_AMOUNT: u128 = 1_000_000 as u128;
pub global LOCK_AMOUNT: u128 = 1_000 as u128;
pub global REWARD_AMOUNT: u128 = 100 as u128;
pub global TIMELOCK_DELTA: u64 = 3600;
pub global REWARD_TIMELOCK_DELTA: u64 = 1800;

pub struct TrainSetup {
    pub env: TestEnvironment,
    pub train: AztecAddress,
    pub token: AztecAddress,
    pub user: AztecAddress,
    pub solver: AztecAddress,
    pub recipient: AztecAddress,
    pub minter: AztecAddress,
}

/// Deploys token + train, mints public balances to user and solver.
/// user/solver are contract accounts (needed for public authwits), the rest light accounts.
pub unconstrained fn setup() -> TrainSetup {
    let mut env = TestEnvironment::new();
    let minter = env.create_light_account();
    let user = env.create_contract_account();
    let solver = env.create_contract_account();
    let recipient = env.create_light_account();

    let token = deploy_token(&mut env, minter);
    env.call_public(minter, Token::at(token).mint_to_public(user, MINT_AMOUNT));
    env.call_public(minter, Token::at(token).mint_to_public(solver, MINT_AMOUNT));

    let train =
        env.deploy("Train").with_public_initializer(minter, Train::interface().constructor());

    TrainSetup { env, train, token, user, solver, recipient, minter }
}

pub unconstrained fn deploy_token(env: &mut TestEnvironment, minter: AztecAddress) -> AztecAddress {
    env.deploy("@token_contract/Token").with_public_initializer(
        minter,
        Token::interface().constructor_with_minter(
            "TestToken0000000000000000000000",
            "TT00000000000000000000000000000",
            18,
            minter,
            AztecAddress::zero(),
        ),
    )
}

/// A deterministic 32-byte secret derived from `seed`.
pub unconstrained fn test_secret(seed: u8) -> [u8; 32] {
    let mut s = [0u8; 32];
    s[31] = seed;
    s[0] = 0x77;
    s
}

pub unconstrained fn hashlock_of(secret: [u8; 32]) -> [u8; 32] {
    sha256::sha256_var(secret, secret.len() as u32)
}

pub unconstrained fn quote_expiry(env: TestEnvironment) -> u64 {
    env.last_block_timestamp() + 1_000_000
}

/// Registers a public authwit letting the Train contract pull `amount` tokens from `from`.
pub unconstrained fn add_transfer_authwit(
    env: TestEnvironment,
    token: AztecAddress,
    from: AztecAddress,
    train: AztecAddress,
    amount: u128,
    nonce: Field,
) {
    let transfer = Token::at(token).transfer_public_to_public(from, train, amount, nonce);
    authwit_cheatcodes::add_public_authwit_from_call(env, from, train, transfer);
}

/// Creates a user lock with default params (amount = LOCK_AMOUNT, refund_to = user,
/// no reward metadata). `nonce` must be unique per token pull within a test.
pub unconstrained fn do_user_lock(
    s: TrainSetup,
    hashlock: [u8; 32],
    nonce: Field,
    payout_curve: AztecAddress,
) {
    add_transfer_authwit(s.env, s.token, s.user, s.train, LOCK_AMOUNT, nonce);
    s.env.call_public(
        s.user,
        Train::at(s.train).user_lock(
            hashlock,
            LOCK_AMOUNT,
            nonce,
            0 as u128,
            TIMELOCK_DELTA,
            0,
            quote_expiry(s.env),
            s.user,
            s.recipient,
            s.token,
            payout_curve,
            [0; 128],
            [0; 90],
            [0; 90],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
            [0; 256],
        ),
    );
}

/// Creates a solver lock with default params (amount = LOCK_AMOUNT, refund_to = solver).
/// `reward_token` may equal `token` (single combined pull, nonce) or differ
/// (two pulls: nonce and reward_nonce).
pub unconstrained fn do_solver_lock(
    s: TrainSetup,
    hashlock: [u8; 32],
    nonce: Field,
    reward: u128,
    reward_nonce: Field,
    reward_token: AztecAddress,
    reward_recipient: AztecAddress,
) {
    do_solver_lock_as(
        s,
        s.solver,
        hashlock,
        nonce,
        reward,
        reward_nonce,
        reward_token,
        reward_recipient,
    );
}

/// Creates a solver lock for an explicit solver address. This is used to prove
/// that lock uniqueness is scoped to (hashlock, solver), not hashlock alone.
pub unconstrained fn do_solver_lock_as(
    s: TrainSetup,
    solver: AztecAddress,
    hashlock: [u8; 32],
    nonce: Field,
    reward: u128,
    reward_nonce: Field,
    reward_token: AztecAddress,
    reward_recipient: AztecAddress,
) {
    if reward > 0 {
        if reward_token == s.token {
            add_transfer_authwit(s.env, s.token, solver, s.train, LOCK_AMOUNT + reward, nonce);
        } else {
            add_transfer_authwit(s.env, s.token, solver, s.train, LOCK_AMOUNT, nonce);
            add_transfer_authwit(s.env, reward_token, solver, s.train, reward, reward_nonce);
        }
    } else {
        add_transfer_authwit(s.env, s.token, solver, s.train, LOCK_AMOUNT, nonce);
    }
    s.env.call_public(
        solver,
        Train::at(s.train).solver_lock(
            hashlock,
            LOCK_AMOUNT,
            nonce,
            reward,
            reward_nonce,
            TIMELOCK_DELTA,
            REWARD_TIMELOCK_DELTA,
            solver,
            s.recipient,
            reward_recipient,
            s.token,
            reward_token,
            AztecAddress::zero(),
            [0; 128],
            [0; 30],
            [0; 30],
            [0; 90],
            0 as u128,
            [0; 90],
            [0; 256],
        ),
    );
}

pub unconstrained fn balance_of(
    env: TestEnvironment,
    token: AztecAddress,
    owner: AztecAddress,
) -> u128 {
    env.view_public(Token::at(token).balance_of_public(owner))
}

pub unconstrained fn check_balance(
    env: TestEnvironment,
    token: AztecAddress,
    owner: AztecAddress,
    expected: u128,
) {
    let actual = balance_of(env, token, owner);
    assert(actual == expected, "unexpected public balance");
}
