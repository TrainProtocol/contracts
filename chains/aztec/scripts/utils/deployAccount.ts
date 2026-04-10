import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import type { FeePaymentMethod } from '@aztec/aztec.js/fee';
import { getSponsoredFPCInstance } from './sponsoredFpc.ts';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { NO_FROM } from '@aztec/aztec.js/account';
import { Fr } from '@aztec/aztec.js/fields';
import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';
import { createLogger } from '@aztec/aztec.js/log';
import { setupWallet, toWallet } from './setupWallet.ts';

import { AccountManager } from '@aztec/aztec.js/wallet';
import { EmbeddedWallet } from '@aztec/wallets/embedded';

/**
 * Creates a Schnorr account without deploying it.
 * Returns the account manager so the caller can get the address and deploy later.
 */
export async function createSchnorrAccount(
  wallet?: EmbeddedWallet,
): Promise<{ account: AccountManager; wallet: EmbeddedWallet }> {
  const logger = createLogger('aztec:aztec-starter');
  logger.info('Creating Schnorr account...');

  const secretKey = Fr.random();
  const signingKey = GrumpkinScalar.random();
  const salt = Fr.random();
  logger.info(`Save the following SECRET and SALT in .env for future use.`);
  logger.info(`Secret key generated: ${secretKey.toString()}`);
  logger.info(`Signing key generated: ${signingKey.toString()}`);
  logger.info(`Salt generated: ${salt.toString()}`);

  const activeWallet = wallet ?? (await setupWallet());
  const account = await activeWallet.createSchnorrAccount(
    secretKey,
    salt,
    signingKey,
  );
  logger.info(`Account address will be: ${account.address}`);

  return { account, wallet: activeWallet };
}

/**
 * Deploys a Schnorr account with the given fee payment method.
 */
export async function deployAccount(
  account: AccountManager,
  wallet: EmbeddedWallet,
  paymentMethod: FeePaymentMethod,
  timeout: number = 120000,
): Promise<AccountManager> {
  const logger = createLogger('aztec:aztec-starter');

  const deployMethod = await account.getDeployMethod();

  logger.info('Deploying account...');
  await deployMethod.send({
    from: NO_FROM,
    fee: { paymentMethod },
    additionalScopes: [],
    skipClassPublication: false,
    skipInstancePublication: false,
    skipInitialization: false,
    skipRegistration: false,
    wait: { timeout, returnReceipt: true, dontThrowOnRevert: true },
  });

  const metadata = await toWallet(wallet).getContractMetadata(account.address);
  console.log(`Deployment transaction for account ${account.address.toString()} completed. Checking deployment status...`);
  logger.info(
    `Account deployment metadata: initializationStatus=${metadata.initializationStatus}, published=${metadata.isContractPublished}`,
  );
  if (metadata.initializationStatus !== 'INITIALIZED' || !metadata.isContractPublished) {
    throw new Error(
      `Account deployment incomplete for ${account.address.toString()} (initializationStatus=${metadata.initializationStatus}, published=${metadata.isContractPublished}).`,
    );
  }

  logger.info(`Account deployment transaction successful and published.`);
  return account;
}

/**
 * Original convenience function: creates and deploys using SponsoredFPC.
 * Works for local-network and devnet.
 */
export async function deploySchnorrAccount(
  wallet?: EmbeddedWallet,
): Promise<AccountManager> {
  const logger = createLogger('aztec:aztec-starter');
  const { account, wallet: activeWallet } = await createSchnorrAccount(wallet);

  // Setup sponsored FPC
  logger.info('Setting up sponsored fee payment for account deployment...');
  const sponsoredFPC = await getSponsoredFPCInstance();
  logger.info(`Sponsored FPC instance obtained at: ${sponsoredFPC.address}`);

  logger.info('Registering sponsored FPC contract with PXE...');
  await toWallet(activeWallet).registerContract(
    sponsoredFPC,
    SponsoredFPCContractArtifact,
  );
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(
    sponsoredFPC.address,
  );
  logger.info('Sponsored fee payment method configured for account deployment');

  return deployAccount(account, activeWallet, sponsoredPaymentMethod);
}
