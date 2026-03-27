import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { deployAccount, deploySchnorrAccount } from './utils/deployAccount.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
import { getTimeouts, getEnv } from './utils/config.ts';
import { updateEnvFile } from './utils/utils.ts';

async function main() {
  const timeouts = getTimeouts();
  const env = getEnv();
  const wallet = await setupWallet();

  let address: any;
  let paymentMethod: any;

  if (env === 'testnet') {
    // Testnet: reuse account from .env (pre-funded via bridgeFeeJuice.ts)
    const deployerSecret = process.env.DEPLOYER_SECRET;
    const deployerSalt = process.env.DEPLOYER_SALT;
    const deployerSigningKey = process.env.DEPLOYER_SIGNING_KEY;

    if (!deployerSecret || !deployerSalt || !deployerSigningKey) {
      // First run: create keys, save them, and instruct user to bridge
      const secret = Fr.random();
      const salt = Fr.random();
      const signing = GrumpkinScalar.random();
      const account = await wallet.createSchnorrAccount(secret, salt, signing);
      address = account.address;
      updateEnvFile('.env', {
        DEPLOYER_SECRET: secret.toString(),
        DEPLOYER_SALT: salt.toString(),
        DEPLOYER_SIGNING_KEY: signing.toString(),
        DEPLOYER_ADDRESS: address.toString(),
      });
      console.log(`\nAccount keys saved to .env. DEPLOYER_ADDRESS: ${address.toString()}`);
      console.log('Now run: AZTEC_ENV=testnet npx tsx bridgeFeeJuice.ts');
      console.log('Then re-run this script to deploy.');
      return;
    }

    // Recreate account from saved keys
    const account = await wallet.createSchnorrAccount(
      Fr.fromString(deployerSecret),
      Fr.fromString(deployerSalt),
      (GrumpkinScalar as any).fromString?.(deployerSigningKey) || GrumpkinScalar.random(),
    );
    address = account.address;
    console.log(`Using existing account: ${address.toString()}`);

    // Check if account is already deployed
    const metadata = await wallet.getContractMetadata(address);
    if (metadata.initializationStatus !== 'INITIALIZED') {
      console.log('Account not yet deployed, deploying...');
      // First tx: uses FeeJuicePaymentMethodWithClaim to claim bridged Fee Juice
      const claimPayment = await getPaymentMethod(wallet, address);
      if (!claimPayment) {
        throw new Error(
          'Account not deployed and no claim data found. Run bridgeFeeJuice.ts first to fund the account.',
        );
      }
      await deployAccount(account, wallet, claimPayment, timeouts.deployTimeout);
    } else {
      console.log('Account already deployed.');
    }

    // After account deployment, Fee Juice is in balance — use regular payment
    paymentMethod = await getPaymentMethod(wallet, address);
  } else {
    // Local/devnet: use SponsoredFPC (creates fresh account each time)
    const accountManager = await deploySchnorrAccount(wallet);
    address = accountManager.address;
    paymentMethod = await getPaymentMethod(wallet, address);
  }

  // Deploy Train contract
  const deployMethod = TrainContract.deploy(wallet);
  const result = await deployMethod.send({
    from: address,
    fee: { paymentMethod },
    skipClassPublication: false,
    skipInstancePublication: false,
    skipInitialization: false,
    skipRegistration: false,
    wait: {
      timeout: timeouts.deployTimeout,
      returnReceipt: true,
      dontThrowOnRevert: true,
    },
  });

  const r = result as any;
  const deployedAddress =
    r?.receipt?.contractAddress?.toString?.() ??
    r?.contract?.address?.toString?.() ??
    (deployMethod as any)?.instance?.address?.toString?.() ??
    (deployMethod as any)?.address?.toString?.();

  if (deployedAddress) {
    console.log(`Train deployed at: ${deployedAddress}`);
    updateEnvFile('.env', { TRAIN_ADDRESS: deployedAddress });
  } else {
    console.log('Deployment tx completed. Check logs above for Train contract address.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Deployment failed: ${error.message}`);
    console.error(`Error details: ${error.stack}`);
    process.exit(1);
  });
