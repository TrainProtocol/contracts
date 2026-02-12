import { TrainContract } from './Train.ts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { setupWallet } from './utils/setupWallet.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { deploySchnorrAccount } from './utils/deployAccount.ts';
import { getTimeouts } from './utils/config.ts';
import { updateEnvFile } from './utils/utils.ts';

async function main() {
  const timeouts = getTimeouts();

  // Setup wallet
  const wallet = await setupWallet();

  // Setup sponsored FPC
  const sponsoredFPC = await getSponsoredFPCInstance();

  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(
    sponsoredFPC.address,
  );

  // Deploy account
  let accountManager = await deploySchnorrAccount(wallet);
  const address = accountManager.address;

  // Deploy Train contract
  const receipt = await TrainContract.deploy(wallet).send({
    from: address,
    fee: { paymentMethod: sponsoredPaymentMethod },
    skipInitialization: false,
    wait: {
      timeout: timeouts.deployTimeout,
      returnReceipt: true,
      dontThrowOnRevert: true,
    },
  });

  const deployedAddress =
    (receipt as any)?.contract?.address?.toString?.() ??
    (receipt as any)?.instance?.address?.toString?.() ??
    (receipt as any)?.address?.toString?.();
  if (deployedAddress) {
    console.log(`Train deployed at: ${deployedAddress}`);
    updateEnvFile('.env', { TRAIN_ADDRESS: deployedAddress });
  } else {
    console.log('Deployment finished, but address not found on receipt.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Deployment failed: ${error.message}`);
    console.error(`Error details: ${error.stack}`);
    process.exit(1);
  });
