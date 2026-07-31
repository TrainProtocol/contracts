import type { FeePaymentMethod } from '@aztec/aztec.js/fee';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { FeeJuicePaymentMethodWithClaim } from '@aztec/aztec.js/fee';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import type { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getSponsoredFPCInstance } from './sponsoredFpc.ts';
import { toWallet } from './setupWallet.ts';
import { getEnv } from './config.ts';
import { updateEnvFile } from './utils.ts';

/**
 * Checks .env for unclaimed bridge data for the given role prefix.
 * Returns claim info if found, or null if no claim data exists.
 */
function getClaimData(prefix: string): { claimSecret: Fr; claimAmount: bigint; messageLeafIndex: bigint } | null {
  const secret = process.env[`${prefix}_CLAIM_SECRET`];
  const amount = process.env[`${prefix}_CLAIM_AMOUNT`];
  const leafIndex = process.env[`${prefix}_CLAIM_LEAF_INDEX`];

  if (!secret || !amount || !leafIndex) return null;

  return {
    claimSecret: Fr.fromString(secret),
    claimAmount: BigInt(amount),
    messageLeafIndex: BigInt(leafIndex),
  };
}

/**
 * Clears claim data from .env after it has been used.
 */
function clearClaimData(prefix: string) {
  const keys = [`${prefix}_CLAIM_SECRET`, `${prefix}_CLAIM_AMOUNT`, `${prefix}_CLAIM_LEAF_INDEX`];
  const updates: Record<string, string> = {};
  for (const key of keys) {
    updates[key] = '';
  }
  updateEnvFile('.env', updates);
  // Also clear from process.env so subsequent calls in the same process don't reuse
  for (const key of keys) {
    delete process.env[key];
  }
}

/**
 * Resolves the env prefix (DEPLOYER, USER, SOLVER) for the given sender address.
 */
function resolvePrefix(sender: AztecAddress): string | null {
  const senderStr = sender.toString();
  for (const prefix of ['DEPLOYER', 'USER', 'SOLVER']) {
    if (process.env[`${prefix}_ADDRESS`] === senderStr) {
      return prefix;
    }
  }
  return null;
}

/**
 * Returns the appropriate fee payment method based on the environment.
 *
 * - testnet with unclaimed bridge data: FeeJuicePaymentMethodWithClaim (claims bridged Fee Juice)
 * - testnet with existing balance: undefined (the SDK's PREEXISTING_FEE_JUICE mode handles it —
 *   the account contract calls set_as_fee_payer() + end_setup() automatically)
 * - local/devnet: SponsoredFeePaymentMethod (uses SponsoredFPC)
 *
 * For testnet, run `bridgeFeeJuice.ts` once beforehand to fund accounts.
 */
export async function getPaymentMethod(
  wallet: EmbeddedWallet,
  sender: AztecAddress,
): Promise<FeePaymentMethod | undefined> {
  const env = getEnv();

  if (env === 'testnet') {
    const prefix = resolvePrefix(sender);
    if (prefix) {
      const claim = getClaimData(prefix);
      if (claim) {
        console.log(`Using FeeJuicePaymentMethodWithClaim for ${prefix} (first tx claims bridged Fee Juice)`);
        clearClaimData(prefix);
        return new FeeJuicePaymentMethodWithClaim(sender, claim);
      }
    }
    // No claim data — account already has Fee Juice balance.
    // Return undefined so the SDK uses PREEXISTING_FEE_JUICE mode,
    // where the account contract's entrypoint handles set_as_fee_payer() + end_setup().
    console.log(`Using existing Fee Juice balance for ${prefix ?? 'unknown'}`);
    return undefined;
  }

  // Local/devnet: use SponsoredFPC
  const sponsoredFPC = await getSponsoredFPCInstance();
  await toWallet(wallet).registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  return new SponsoredFeePaymentMethod(sponsoredFPC.address);
}
