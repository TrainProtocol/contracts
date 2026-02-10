import { TrainContract } from './Train.ts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { setupWallet } from './utils/setupWallet.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { deploySchnorrAccount } from './utils/deployAccount.ts';
import { getTimeouts } from './utils/config.ts';

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

  const { contract: trainContract, instance } = await TrainContract.deploy(
    wallet,
  ).send({
    from: address,
    fee: { paymentMethod: sponsoredPaymentMethod },
    wait: { timeout: timeouts.deployTimeout, returnReceipt: true },
  });
  void instance;
  void trainContract;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Deployment failed: ${error.message}`);
    console.error(`Error details: ${error.stack}`);
    process.exit(1);
  });
