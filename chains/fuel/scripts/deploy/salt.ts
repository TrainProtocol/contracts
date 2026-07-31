/**
 * Deterministic-deployment salt derivation for the Fuel port.
 *
 * Fuel's contract ID is natively deterministic from `(bytecode root, salt, state root)` --
 * `ContractId = sha256(0x4655454C ++ salt ++ bytecodeRoot ++ stateRoot)` (confirmed against
 * `@fuel-ts/contract`'s `getContractId`, re-exported from `fuels`). This gives Fuel a
 * CREATE2-like property with **no factory contract needed** -- deploying the same bytecode with
 * the same salt (and the same initial storage state, which for `train`/`payout_curve` is empty:
 * both packages' `out/debug/*-storage_slots.json` are `[]`) on any two networks yields the
 * identical contract ID.
 *
 * SALT CONVENTION: per-contract salt = `sha256('${seed}:${contractName}')`, `seed` defaulting to
 * `'train.protocol.v2.fuel'`.
 *   - `sha256`, not `keccak256`, because every other hash in this port (the hashlock, ...)
 *     already standardizes on `std::hash::sha256`/`std::crypto`'s sha256, and Fuel's own
 *     `getContractId` derivation is itself sha256-based; there is no reason to reach for
 *     keccak256 on a chain that doesn't use it anywhere else.
 *   - The literal seed string intentionally carries the SAME `train.protocol.v2` root the
 *     protocol uses for its deterministic-deploy salts on the other chains (documenting "same
 *     protocol generation/release" across chains), with a `.fuel` suffix so a byte-level salt
 *     collision with another chain's salt is impossible even though the chains' address spaces
 *     never overlap anyway.
 *   - Per-contract (not one shared salt for both `train` and `payout_curve`) purely as a
 *     convention; it is not load-bearing for uniqueness, since `train` and `payout_curve` have
 *     different bytecode and would get different contract IDs from the very same salt regardless.
 *
 * Override the seed via `FUEL_DEPLOY_SALT_SEED` (e.g. for a throwaway e2e run that must not
 * collide with a canonical deployment's address on the SAME network -- the testnet e2e script
 * does exactly this, see `scripts/testnet-e2e.ts`).
 */
import { sha256 } from 'fuels';

export const DEFAULT_DEPLOY_SALT_SEED = 'train.protocol.v2.fuel';

export function deploySaltSeed(): string {
  return process.env.FUEL_DEPLOY_SALT_SEED ?? DEFAULT_DEPLOY_SALT_SEED;
}

/** The exact 32-byte (`b256`) salt passed as `DeployContractOptions.salt` for `componentName`
 * (e.g. `'train'`, `'payout_curve'`). Pure function of the seed + component name -- no network
 * call, no randomness. */
export function deterministicSalt(componentName: string, seed: string = deploySaltSeed()): string {
  return sha256(Buffer.from(`${seed}:${componentName}`, 'utf-8'));
}
