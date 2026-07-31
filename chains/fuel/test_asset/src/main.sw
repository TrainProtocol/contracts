// SPDX-License-Identifier: MIT
contract;

// Testnet-only fixture, not part of the Train protocol: a minimal native-asset minter used
// solely so the Sepolia e2e suite has a genuine second `AssetId` to exercise the different-asset
// solver reward flow (`Train::attach_solver_reward`) against, since Fuel Sepolia has no ambient
// second test token the way EVM testnets have spare ERC-20s. Permissionless and unbounded on
// purpose (mints no real value) -- do not reuse this pattern for anything with real value.

use std::asset::mint_to;

abi TestAsset {
    /// Mints `amount` of this contract's single fixed sub-asset directly to `recipient`.
    fn mint(recipient: Identity, amount: u64);

    /// The `AssetId` this contract mints (`AssetId::new(ContractId::this(), SubId::zero())`).
    fn asset_id() -> AssetId;
}

impl TestAsset for Contract {
    fn mint(recipient: Identity, amount: u64) {
        mint_to(recipient, SubId::zero(), amount);
    }

    fn asset_id() -> AssetId {
        AssetId::new(ContractId::this(), SubId::zero())
    }
}
