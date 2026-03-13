import dotenv from 'dotenv';
dotenv.config();

import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';

import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { AccountManager } from '@aztec/aztec.js/wallet';
import { TokenContract } from '@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js';
import { updateEnvFile } from './utils/utils.ts';
import { getAztecNodeUrl, getEnv, getTimeouts } from './utils/config.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
import { deployAccount } from './utils/deployAccount.ts';

async function createWallet(proverEnabled: boolean): Promise<EmbeddedWallet> {
  return EmbeddedWallet.create(createAztecNodeClient(getAztecNodeUrl()), {
    ephemeral: true,
    pxeConfig: { proverEnabled },
  });
}

interface AccountKeys {
  secret: Fr;
  salt: Fr;
  signingKey: typeof GrumpkinScalar extends abstract new (...args: any) => infer T ? T : never;
}

function hasTestnetKeys(): boolean {
  return !!(
    process.env.USER_SECRET &&
    process.env.USER_SALT &&
    process.env.USER_SIGNING_KEY &&
    process.env.SOLVER_SECRET &&
    process.env.SOLVER_SALT &&
    process.env.SOLVER_SIGNING_KEY &&
    process.env.DEPLOYER_SECRET &&
    process.env.DEPLOYER_SALT &&
    process.env.DEPLOYER_SIGNING_KEY
  );
}

function loadKeys(prefix: string): AccountKeys {
  const secret = Fr.fromString(process.env[`${prefix}_SECRET`]!);
  const salt = Fr.fromString(process.env[`${prefix}_SALT`]!);
  const signingKey =
    (GrumpkinScalar as any).fromString?.(process.env[`${prefix}_SIGNING_KEY`]!) ||
    GrumpkinScalar.random();
  return { secret, salt, signingKey };
}

async function main(): Promise<void> {
  const env = getEnv();
  const timeouts = getTimeouts();
  const isTestnet = env === 'testnet';
  const proverEnabled = env !== 'local-network';

  if (isTestnet && !hasTestnetKeys()) {
    // First run on testnet: generate all keys, save to .env, instruct to bridge
    console.log('Generating account keys for testnet...');
    const wallet = await createWallet(proverEnabled);

    const gen = async () => {
      const secret = Fr.random();
      const salt = Fr.random();
      const signingKey = GrumpkinScalar.random();
      const account = await wallet.createSchnorrAccount(secret, salt, signingKey);
      return { secret, salt, signingKey, address: account.address };
    };

    const user = await gen();
    const solver = await gen();
    const deployer = await gen();

    updateEnvFile('.env', {
      USER_SECRET: user.secret.toString(),
      USER_SALT: user.salt.toString(),
      USER_SIGNING_KEY: user.signingKey.toString(),
      USER_ADDRESS: user.address.toString(),
      SOLVER_SECRET: solver.secret.toString(),
      SOLVER_SALT: solver.salt.toString(),
      SOLVER_SIGNING_KEY: solver.signingKey.toString(),
      SOLVER_ADDRESS: solver.address.toString(),
      DEPLOYER_SECRET: deployer.secret.toString(),
      DEPLOYER_SALT: deployer.salt.toString(),
      DEPLOYER_SIGNING_KEY: deployer.signingKey.toString(),
      DEPLOYER_ADDRESS: deployer.address.toString(),
    });

    console.log('\nAccount keys saved to .env:');
    console.log(`  USER_ADDRESS:     ${user.address.toString()}`);
    console.log(`  SOLVER_ADDRESS:   ${solver.address.toString()}`);
    console.log(`  DEPLOYER_ADDRESS: ${deployer.address.toString()}`);
    console.log('\nNext steps:');
    console.log('  1. Run: AZTEC_ENV=testnet npx tsx bridgeFeeJuice.ts');
    console.log('  2. Re-run: AZTEC_ENV=testnet npx tsx setup.ts');
    return;
  }

  // Create wallets
  const walletUser = await createWallet(proverEnabled);
  const walletSolver = await createWallet(proverEnabled);
  const walletDeployer = await createWallet(proverEnabled);

  let userAccount: AccountManager;
  let solverAccount: AccountManager;
  let deployerAccount: AccountManager;

  if (isTestnet) {
    // Second run on testnet: recreate accounts from saved keys
    console.log('Recreating accounts from .env keys...');
    const userKeys = loadKeys('USER');
    const solverKeys = loadKeys('SOLVER');
    const deployerKeys = loadKeys('DEPLOYER');

    userAccount = await walletUser.createSchnorrAccount(userKeys.secret, userKeys.salt, userKeys.signingKey);
    solverAccount = await walletSolver.createSchnorrAccount(solverKeys.secret, solverKeys.salt, solverKeys.signingKey);
    deployerAccount = await walletDeployer.createSchnorrAccount(deployerKeys.secret, deployerKeys.salt, deployerKeys.signingKey);

    console.log(`  User:     ${userAccount.address.toString()}`);
    console.log(`  Solver:   ${solverAccount.address.toString()}`);
    console.log(`  Deployer: ${deployerAccount.address.toString()}`);
  } else {
    // Local/devnet: generate fresh keys each time
    const userSecretKey = Fr.random();
    const userSalt = Fr.random();
    const userSigningKey = GrumpkinScalar.random();
    userAccount = await walletUser.createSchnorrAccount(userSecretKey, userSalt, userSigningKey);

    const solverSecretKey = Fr.random();
    const solverSalt = Fr.random();
    const solverSigningKey = GrumpkinScalar.random();
    solverAccount = await walletSolver.createSchnorrAccount(solverSecretKey, solverSalt, solverSigningKey);

    const deployerSecretKey = Fr.random();
    const deployerSalt = Fr.random();
    const deployerSigningKey = GrumpkinScalar.random();
    deployerAccount = await walletDeployer.createSchnorrAccount(deployerSecretKey, deployerSalt, deployerSigningKey);

    // Save keys for local/devnet too
    updateEnvFile('.env', {
      USER_SECRET: userSecretKey.toString(),
      USER_SALT: userSalt.toString(),
      USER_SIGNING_KEY: userSigningKey.toString(),
      USER_ADDRESS: userAccount.address.toString(),
      SOLVER_SECRET: solverSecretKey.toString(),
      SOLVER_SALT: solverSalt.toString(),
      SOLVER_SIGNING_KEY: solverSigningKey.toString(),
      SOLVER_ADDRESS: solverAccount.address.toString(),
      DEPLOYER_SECRET: deployerSecretKey.toString(),
      DEPLOYER_SALT: deployerSalt.toString(),
      DEPLOYER_SIGNING_KEY: deployerSigningKey.toString(),
      DEPLOYER_ADDRESS: deployerAccount.address.toString(),
    });
  }

  // Deploy accounts (claim-based payment for first tx per account on testnet)
  const accounts: [AccountManager, EmbeddedWallet, string][] = [
    [userAccount, walletUser, 'user'],
    [solverAccount, walletSolver, 'solver'],
    [deployerAccount, walletDeployer, 'deployer'],
  ];

  for (const [account, wallet, label] of accounts) {
    if (isTestnet) {
      const metadata = await wallet.getContractMetadata(account.address);
      if (metadata.isContractInitialized) {
        console.log(`${label} account already deployed, skipping.`);
        continue;
      }
    }
    console.log(`Deploying ${label} account...`);
    const pay = await getPaymentMethod(wallet, account.address);
    if (!pay) {
      throw new Error(
        `Cannot deploy ${label} account: no claim data found. Run bridgeFeeJuice.ts first.`,
      );
    }
    await deployAccount(account, wallet, pay, timeouts.deployTimeout);
  }

  // Get payment method for deployer — may be a claim (first tx) or undefined (existing balance)
  const payDeployer = await getPaymentMethod(walletDeployer, deployerAccount.address);

  // Deploy Token contract (consumes claim if present)
  console.log('Deploying Token contract...');
  const tokenDeploy = TokenContract.deployWithOpts(
    {
      wallet: walletDeployer,
      method: 'constructor_with_minter',
    },
    'ETH',
    'ETH',
    18,
    deployerAccount.address,
  );
  await tokenDeploy.send({
    from: deployerAccount.address,
    fee: { paymentMethod: payDeployer },
    wait: { timeout: timeouts.deployTimeout },
  });
  const tokenAddress = tokenDeploy.address!;

  // Register deployer as sender on other wallets
  await walletUser.registerSender(deployerAccount.address, 'faucet');
  await walletSolver.registerSender(deployerAccount.address, 'faucet');

  // After Token deployment, deployer has Fee Juice balance — no payment method needed
  // (SDK uses PREEXISTING_FEE_JUICE mode automatically)
  const amount = 100000000000n;
  const tokenForDeployer = TokenContract.at(tokenAddress, walletDeployer);
  const tokenForUser = TokenContract.at(tokenAddress, walletUser);
  const tokenForSolver = TokenContract.at(tokenAddress, walletSolver);

  console.log('Minting tokens...');
  const mintTx = await tokenForDeployer.methods
    .mint_to_public(deployerAccount.address, amount)
    .send({
      from: deployerAccount.address,
      wait: { timeout: timeouts.txTimeout },
    });

  console.log('Transferring tokens to user...');
  await tokenForDeployer.methods
    .transfer_public_to_public(
      deployerAccount.address,
      userAccount.address,
      amount / 2n,
      0,
    )
    .send({
      from: deployerAccount.address,
      wait: { timeout: timeouts.txTimeout },
    });

  console.log('Transferring tokens to solver...');
  await tokenForDeployer.methods
    .transfer_public_to_public(
      deployerAccount.address,
      solverAccount.address,
      amount / 2n,
      0,
    )
    .send({
      from: deployerAccount.address,
      wait: { timeout: timeouts.txTimeout },
    });

  const { result: userPubBal } = await tokenForUser.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });

  const { result: solverPubBal } = await tokenForSolver.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });

  const tokenAddressStr = tokenAddress.toString();
  updateEnvFile('.env', { TOKEN_ADDRESS: tokenAddressStr });

  console.log(`\nToken deployed at ${tokenAddressStr}`);
  console.log(`Public mint tx block: ${mintTx.receipt.blockNumber}`);
  console.log(`User public balance: ${userPubBal}`);
  console.log(`Solver public balance: ${solverPubBal}`);
  console.log('\nSetup complete!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Error: ${err}`);
    console.error(err.stack);
    process.exit(1);
  });
