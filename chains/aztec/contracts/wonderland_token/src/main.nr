use aztec::macros::aztec;

#[aztec]
pub contract Token {
    use std::ops::{Add, Sub};

    use aztec::{
        macros::{
            functions::{authorize_once, external, initializer, view},
            storage::storage,
        },
        protocol::address::AztecAddress,
        state_vars::{Map, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        minters: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        total_supply: PublicMutable<u128, Context>,
        public_balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        assert(!admin.is_zero(), "invalid admin");
        self.storage.admin.write(admin);
        self.storage.minters.at(admin).write(true);
    }

    #[external("public")]
    fn set_admin(new_admin: AztecAddress) {
        assert(self.storage.admin.read().eq(self.msg_sender()), "caller is not admin");
        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    #[view]
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    #[view]
    fn is_minter(minter: AztecAddress) -> bool {
        self.storage.minters.at(minter).read()
    }

    #[external("public")]
    #[view]
    fn total_supply() -> u128 {
        self.storage.total_supply.read()
    }

    #[external("public")]
    #[view]
    fn balance_of_public(owner: AztecAddress) -> u128 {
        self.storage.public_balances.at(owner).read()
    }

    #[external("public")]
    fn set_minter(minter: AztecAddress, approve: bool) {
        assert(self.storage.admin.read().eq(self.msg_sender()), "caller is not admin");
        self.storage.minters.at(minter).write(approve);
    }

    #[external("public")]
    fn mint_to_public(to: AztecAddress, amount: u128) {
        assert(self.storage.minters.at(self.msg_sender()).read(), "caller is not minter");
        let new_balance = self.storage.public_balances.at(to).read().add(amount);
        let supply = self.storage.total_supply.read().add(amount);
        self.storage.public_balances.at(to).write(new_balance);
        self.storage.total_supply.write(supply);
    }

    #[authorize_once("from", "authwit_nonce")]
    #[external("public")]
    fn transfer_in_public(
        from: AztecAddress,
        to: AztecAddress,
        amount: u128,
        authwit_nonce: Field,
    ) {
        let from_balance = self.storage.public_balances.at(from).read().sub(amount);
        self.storage.public_balances.at(from).write(from_balance);
        let to_balance = self.storage.public_balances.at(to).read().add(amount);
        self.storage.public_balances.at(to).write(to_balance);
    }

    #[authorize_once("from", "nonce")]
    #[external("public")]
    fn transfer_public_to_public(
        from: AztecAddress,
        to: AztecAddress,
        amount: u128,
        nonce: Field,
    ) {
        let from_balance = self.storage.public_balances.at(from).read().sub(amount);
        self.storage.public_balances.at(from).write(from_balance);
        let to_balance = self.storage.public_balances.at(to).read().add(amount);
        self.storage.public_balances.at(to).write(to_balance);
    }
}
