// SPDX-License-Identifier: MIT

use starknet::ContractAddress;

/// A user-signed, target-agnostic forwarding intent (see `docs/ARCHITECTURE.md` for the full
/// gasless-relay design).
///
/// A user signs this struct off-chain via their account's SNIP-12 signature; a relayer then
/// submits it (and pays gas) to [`ITrainRouter::forward_intent`], which pulls `amount` of `token`
/// from `user` (using a standing ERC20 approval to this router), approves `train` for exactly
/// `amount`, and forwards the call `(train, selector, calldata)` on the user's behalf.
///
/// A Starknet call is the triple `(contract, selector, calldata)`, so `train` and `selector` are
/// committed directly as struct fields, and `call_hash` additionally binds the `calldata` array
/// (see [`ITrainRouter::forward_intent`] step 4). This keeps the router itself agnostic to what
/// it forwards — it does not hardcode `user_lock_for` or any other entrypoint.
///
/// The explicit `router` field binds this intent to a specific `TrainRouter` deployment: SNIP-12's
/// `StarknetDomain` carries name/version/chain_id/revision but not the contract address, so
/// without this field the same signature would be valid for any same-chain contract reusing this
/// SNIP-12 domain + type hash. `forward_intent` asserts `intent.router == get_contract_address()`
/// (step 1).
#[derive(Copy, Drop, Hash, Serde)]
pub struct Intent {
    /// The user on whose behalf `token` is pulled and the call is forwarded. Also the signer
    /// the SNIP-12 signature is verified against.
    pub user: ContractAddress,
    /// The `TrainRouter` instance this intent is bound to. SNIP-12's `StarknetDomain` carries
    /// name/version/chain_id/revision but not the contract address, so without this field the
    /// same signed digest would validate against *any* contract that reuses this exact
    /// `SNIP12Metadata` name/version + `Intent` type hash on the same chain (e.g. a redeployed v2
    /// router) — letting a signature be replayed cross-contract wherever the user has a standing
    /// approval. `forward_intent` asserts `intent.router == get_contract_address()`, so this
    /// field ties the signature to this specific router instance.
    pub router: ContractAddress,
    /// The Train instance the call is forwarded to.
    pub train: ContractAddress,
    /// The ERC20 token pulled from `user` and approved to `train`.
    pub token: ContractAddress,
    /// The exact amount pulled from `user` and approved to `train` — never more, never less.
    pub amount: u256,
    /// The entrypoint selector on `train` to invoke (e.g. `selector!("user_lock_for")`).
    pub selector: felt252,
    /// `poseidon_hash_span(calldata.span())` — binds the exact forwarded calldata so a relayer
    /// cannot substitute different call arguments after the user signs.
    pub call_hash: felt252,
    /// User-chosen replay differentiator baked into the signed struct hash. This is an arbitrary
    /// value, not a sequential counter — the router only ever needs "has this exact struct been
    /// consumed before", not ordering.
    pub nonce: felt252,
    /// Unix timestamp after which this intent can no longer be forwarded.
    pub deadline: u64,
}

/// SNIP-12 type hash for `Intent`, built per SNIP-12 rev-1 encoding rules.
///
/// `u64` has no dedicated SNIP-12 basic type, so `deadline` is encoded as `"u128"` in the type
/// string (this only affects the type string used for hashing/wallet display; the Cairo field
/// itself stays `u64`) — the same convention OpenZeppelin's own `Permit`/`Message` SNIP-12 types
/// use for `u64` fields. `felt252` fields are encoded as `"felt"` per the SNIP-12 basic type set.
///
/// selector!(
///   "\"Intent\"(
///     \"user\":\"ContractAddress\",
///     \"router\":\"ContractAddress\",
///     \"train\":\"ContractAddress\",
///     \"token\":\"ContractAddress\",
///     \"amount\":\"u256\",
///     \"selector\":\"felt\",
///     \"call_hash\":\"felt\",
///     \"nonce\":\"felt\",
///     \"deadline\":\"u128\"
///   )\"u256\"(
///     \"low\":\"u128\",
///     \"high\":\"u128\"
///   )"
/// );
pub const INTENT_TYPE_HASH: felt252 = selector!(
    "\"Intent\"(\"user\":\"ContractAddress\",\"router\":\"ContractAddress\",\"train\":\"ContractAddress\",\"token\":\"ContractAddress\",\"amount\":\"u256\",\"selector\":\"felt\",\"call_hash\":\"felt\",\"nonce\":\"felt\",\"deadline\":\"u128\")\"u256\"(\"low\":\"u128\",\"high\":\"u128\")",
);

use core::hash::{HashStateExTrait, HashStateTrait};
use core::poseidon::PoseidonTrait;

impl IntentStructHash of openzeppelin_utils::cryptography::snip12::StructHash<Intent> {
    fn hash_struct(self: @Intent) -> felt252 {
        PoseidonTrait::new().update_with(INTENT_TYPE_HASH).update_with(*self).finalize()
    }
}

#[starknet::interface]
pub trait ITrainRouter<TContractState> {
    /// Forward a user-signed `Intent` to `intent.train`, gaslessly for `intent.user`.
    ///
    /// The relayer (caller) pays gas; funds move from `intent.user` (via a standing approval to
    /// this router) through the router to `intent.train` and never rest at the router beyond the
    /// span of this call. Signature verification is done via SNIP-6/SNIP-12 (see
    /// `docs/ARCHITECTURE.md` for the full design).
    ///
    /// Security checks performed, in order (CEI):
    /// 1. **Router binding** — `intent.router == get_contract_address()`. SNIP-12's
    ///    `StarknetDomain` carries `chain_id` and the `SNIP12Metadata` name/version into the
    ///    signed digest, but not the contract address, so the digest alone does not bind this
    ///    specific router instance — a redeployed router could trivially reuse the same domain.
    ///    This explicit field + assert is what actually prevents a signature from being replayed
    ///    against a different `TrainRouter` deployment.
    /// 2. **Deadline** — `get_block_timestamp() <= intent.deadline`, checked before any state
    ///    change or interaction, so an expired intent reverts with `IntentExpired`.
    /// 3. **Replay** — the SNIP-12 message hash is marked consumed *before* any external call;
    ///    a second forward of the same signed `Intent`, by any caller, reverts with
    ///    `IntentConsumed`.
    /// 4. **Call binding** — `poseidon_hash_span(calldata)` must equal `intent.call_hash`, so a
    ///    relayer cannot swap in different calldata for the same signed `(train, selector)`.
    /// 5. **Signature** — `intent.user`'s SRC-6 account must validate the SNIP-12 digest (which
    ///    itself binds `chain_id` via the SNIP-12 domain and this router's address via the
    ///    `router` field above), so only the user who signed the intent can authorize the pull.
    /// 6. **Conservation** — this router's `token` balance after the forward must equal its
    ///    balance before it (`ResidualBalance`): a misbehaving `train`/target can consume at
    ///    most, and exactly, `intent.amount`.
    fn forward_intent(
        ref self: TContractState,
        intent: Intent,
        calldata: Array<felt252>,
        signature: Array<felt252>,
    );

    /// Compute the exact SNIP-12 digest `intent.user` must sign off-chain for this `intent`.
    /// Lets off-chain tooling / relayers construct signable payloads without duplicating the
    /// domain-binding logic.
    fn get_intent_hash(self: @TContractState, intent: Intent) -> felt252;

    /// Whether `intent_hash` (a digest previously returned by `get_intent_hash`) has already been
    /// consumed by a successful `forward_intent`.
    fn is_consumed(self: @TContractState, intent_hash: felt252) -> bool;
}

/// @title Train Protocol - Gasless Intent Router
/// @notice Target-agnostic forwarder for SNIP-12-signed `Intent`s: pulls a user's tokens via a
/// standing approval, approves the target `train` for exactly the signed amount, forwards the
/// user-authorized call, and asserts conservation. See `docs/ARCHITECTURE.md` for the full
/// gasless-relay design.
/// @dev No owner, no caller allowlist: security is entirely signature-based.
#[starknet::contract]
mod TrainRouter {
    use core::poseidon::poseidon_hash_span;
    use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use openzeppelin_security::ReentrancyGuardComponent;
    use openzeppelin_utils::cryptography::snip12::{OffchainMessageHash, SNIP12Metadata};
    use openzeppelin_utils::execution::assert_valid_signature;
    use starknet::storage::Map;
    use starknet::{
        ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use super::Intent;

    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    /// SNIP-12 domain metadata for this router: binds `name`/`version` into the signed digest
    /// alongside `chain_id` (from `get_tx_info`). SNIP-12's `StarknetDomain` carries
    /// name/version/chain_id/revision but not the contract address, so this domain does NOT bind
    /// this router's own address — that binding is instead done explicitly via the
    /// `Intent.router` field (see `forward_intent` step 1).
    pub impl SNIP12MetadataImpl of SNIP12Metadata {
        fn name() -> felt252 {
            'TrainRouter'
        }
        fn version() -> felt252 {
            1
        }
    }

    #[storage]
    struct Storage {
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
        /// SNIP-12 intent message hash => whether it has already been forwarded (single-use
        /// replay guard).
        consumed_intent: Map<felt252, bool>,
    }

    // ───────────────────────────── Events ─────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        IntentForwarded: IntentForwarded,
    }

    /// Emitted after a successful forward, with `user`, `train`, and `call_hash` indexed for
    /// off-chain filtering.
    #[derive(Drop, starknet::Event)]
    struct IntentForwarded {
        #[key]
        user: ContractAddress,
        #[key]
        train: ContractAddress,
        #[key]
        call_hash: felt252,
        relayer: ContractAddress,
        token: ContractAddress,
        amount: u256,
    }

    // ───────────────────────── Implementation ─────────────────────────

    #[abi(embed_v0)]
    impl TrainRouterImpl of super::ITrainRouter<ContractState> {
        fn forward_intent(
            ref self: ContractState,
            intent: Intent,
            calldata: Array<felt252>,
            signature: Array<felt252>,
        ) {
            self.reentrancy_guard.start();

            // 1. Router binding — the SNIP-12 domain carries name/version/chain_id/revision but
            // not the contract address, so the explicit `router` field is what ties this signed
            // intent to THIS router instance; without it, the same signature would validate
            // against any contract reusing this `SNIP12Metadata` name/version + `Intent` type
            // hash on the same chain (e.g. a redeployed v2 router the user has also approved).
            assert(intent.router == get_contract_address(), 'RouterMismatch');

            // Target must not be the token itself: forwarding a `transfer`/`transfer_from` back to
            // `token` could move the pulled funds while still passing the conservation check
            // (net-zero at the router). All fields are signed, so this only guards a user against
            // signing a self-defeating intent, but the check is cheap belt-and-suspenders.
            assert(intent.train != intent.token, 'TrainIsToken');

            // 2. Deadline — checked before any state change or interaction.
            assert(get_block_timestamp() <= intent.deadline, 'IntentExpired');

            // SNIP-12 digest: binds the full `Intent` struct (including `router`, so the
            // signature itself is scoped to this router instance) plus this router's `chain_id`
            // via the SNIP-12 domain, and `intent.user` as the signer.
            let message_hash = intent.get_message_hash(intent.user);

            // 3. Replay guard — consumed *before* any external interaction (CEI). A second
            // forward of the same signed intent, by any caller, reverts here.
            assert(!self.consumed_intent.read(message_hash), 'IntentConsumed');
            self.consumed_intent.write(message_hash, true);

            // 4. Call binding — the relayer-supplied `calldata` must match what `intent.user`
            // actually signed for; this prevents a relayer from redirecting the call's
            // arguments while keeping `(train, selector)` unchanged.
            assert(poseidon_hash_span(calldata.span()) == intent.call_hash, 'CallHashMismatch');

            // 5. Signature — `intent.user`'s SRC-6 account must validate `message_hash`.
            assert_valid_signature(intent.user, message_hash, signature.span(), 'InvalidSignature');

            // 6. Conservation setup — snapshot this router's balance before pulling funds.
            let token = IERC20Dispatcher { contract_address: intent.token };
            let this = get_contract_address();
            let bal0 = token.balance_of(this);

            // Pull `amount` from the user via their standing approval to this router.
            let pulled = token.transfer_from(intent.user, this, intent.amount);
            assert(pulled, 'TransferFailed');

            // Approve `train` for exactly `amount`, forward the user-authorized call, then reset
            // the approval — the router never carries a standing allowance to `train`.
            let approved = token.approve(intent.train, intent.amount);
            assert(approved, 'ApproveFailed');

            starknet::syscalls::call_contract_syscall(intent.train, intent.selector, calldata.span())
                .unwrap_syscall();

            let reset = token.approve(intent.train, 0);
            assert(reset, 'ApproveFailed');

            // 6. Conservation — the router must hold exactly what it held before the forward;
            // a misbehaving `train`/target can consume at most (and exactly) `intent.amount`.
            assert(token.balance_of(this) == bal0, 'ResidualBalance');

            self
                .emit(
                    IntentForwarded {
                        user: intent.user,
                        train: intent.train,
                        call_hash: intent.call_hash,
                        relayer: get_caller_address(),
                        token: intent.token,
                        amount: intent.amount,
                    },
                );

            self.reentrancy_guard.end();
        }

        fn get_intent_hash(self: @ContractState, intent: Intent) -> felt252 {
            intent.get_message_hash(intent.user)
        }

        fn is_consumed(self: @ContractState, intent_hash: felt252) -> bool {
            self.consumed_intent.read(intent_hash)
        }
    }
}
