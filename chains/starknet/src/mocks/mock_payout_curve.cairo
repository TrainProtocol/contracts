/// Test-only payout curve that returns a fixed fraction of `amount` (`amount * num / den`),
/// ignoring `start_time`, `current_time`, and `config` entirely — the fraction is fixed at
/// construction time via `num`/`den`. Used to exercise the excess/refund_to split path of
/// `Train::redeem_user`/`redeem_solver` with a curve that actually decays (unlike the identity
/// `ConstantPayoutCurve`).
#[cfg(test)]
#[starknet::contract]
pub mod MockDecayCurve {
    use openzeppelin_introspection::src5::SRC5Component;
    use crate::payout_curve::{IPAYOUT_CURVE_ID, IPayoutCurve};

    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;
    impl SRC5InternalImpl = SRC5Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        num: u256,
        den: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, num: u256, den: u256) {
        assert(den != 0, 'ZeroDenominator');
        self.src5.register_interface(openzeppelin_interfaces::introspection::ISRC5_ID);
        self.src5.register_interface(IPAYOUT_CURVE_ID);
        self.num.write(num);
        self.den.write(den);
    }

    #[abi(embed_v0)]
    impl MockDecayCurveImpl of IPayoutCurve<ContractState> {
        fn compute_payout(
            self: @ContractState,
            amount: u256,
            start_time: u64,
            current_time: u64,
            config: ByteArray,
        ) -> u256 {
            let _ = start_time;
            let _ = current_time;
            let _ = config;
            amount * self.num.read() / self.den.read()
        }
    }
}

/// Test-only contract that implements SRC5 (so calling `supports_interface` succeeds at the
/// syscall level, unlike a contract with no `supports_interface` entrypoint at all) but never
/// registers `IPAYOUT_CURVE_ID` and does not implement `IPayoutCurve`. Used to exercise Train's
/// own `assert(supported, 'InvalidPayoutCurve')` in isolation from the syscall-level
/// `ENTRYPOINT_NOT_FOUND` failure a non-SRC5 contract (e.g. a plain ERC20) would raise instead.
#[cfg(test)]
#[starknet::contract]
pub mod MockSrc5Only {
    use openzeppelin_introspection::src5::SRC5Component;

    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        SRC5Event: SRC5Component::Event,
    }
}
