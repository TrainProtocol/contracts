import dotenv from 'dotenv';
dotenv.config();

import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { TokenContract } from '@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { updateEnvFile } from './utils/utils.ts';
import { getAztecNodeUrl, getEnv } from './utils/config.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';

async function getSponsoredPaymentMethod(walletUser: EmbeddedWallet) {
  const sponsoredFPC = await getSponsoredFPCInstance();
  await walletUser.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  return new SponsoredFeePaymentMethod(sponsoredFPC.address);
}

async function createWallet(proverEnabled: boolean): Promise<EmbeddedWallet> {
  return EmbeddedWallet.create(createAztecNodeClient(getAztecNodeUrl()), {
    ephemeral: true,
    pxeConfig: { proverEnabled },
  });
}

async function main(): Promise<void> {
  const proverEnabled = getEnv() !== 'local-network';
  const walletUser = await createWallet(proverEnabled);
  const walletSolver = await createWallet(proverEnabled);
  const walletDeployer = await createWallet(proverEnabled);

  const payUser = await getSponsoredPaymentMethod(walletUser);
  const paySolver = await getSponsoredPaymentMethod(walletSolver);
  const payDeployer = await getSponsoredPaymentMethod(walletDeployer);

  const userSecretKey = Fr.random();
  const userSalt = Fr.random();
  const userSigningKey = GrumpkinScalar.random();
  const userAccount = await walletUser.createSchnorrAccount(
    userSecretKey,
    userSalt,
    userSigningKey,
  );

  const solverSecretKey = Fr.random();
  const solverSalt = Fr.random();
  const solverSigningKey = GrumpkinScalar.random();
  const solverAccount = await walletSolver.createSchnorrAccount(
    solverSecretKey,
    solverSalt,
    solverSigningKey,
  );

  const deployerSecretKey = Fr.random();
  const deployerSalt = Fr.random();
  const deployerSigningKey = GrumpkinScalar.random();
  const deployerAccount = await walletDeployer.createSchnorrAccount(
    deployerSecretKey,
    deployerSalt,
    deployerSigningKey,
  );

  await (
    await userAccount.getDeployMethod()
  ).send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod: payUser },
    skipClassPublication: false,
    skipInstancePublication: false,
    skipInitialization: false,
    skipRegistration: false,
    wait: { timeout: 120000 },
  });
  await (
    await solverAccount.getDeployMethod()
  ).send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod: paySolver },
    skipClassPublication: false,
    skipInstancePublication: false,
    skipInitialization: false,
    skipRegistration: false,
    wait: { timeout: 120000 },
  });
  await (
    await deployerAccount.getDeployMethod()
  ).send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod: payDeployer },
    skipClassPublication: false,
    skipInstancePublication: false,
    skipInitialization: false,
    skipRegistration: false,
    wait: { timeout: 120000 },
  });

  const token = await TokenContract.deployWithOpts(
    {
      wallet: walletDeployer,
      method: 'constructor_with_minter',
    },
    'ETH',
    'ETH',
    18,
    deployerAccount.address,
    deployerAccount.address,
  ).send({
    from: deployerAccount.address,
    fee: { paymentMethod: payDeployer },
    wait: { timeout: 1_200_000 },
  });

  await walletUser.registerSender(deployerAccount.address, 'faucet');
  await walletSolver.registerSender(deployerAccount.address, 'faucet');

  const amount = 100000000000n;
  const tokenForUser = TokenContract.at(token.address, walletUser);
  const tokenForSolver = TokenContract.at(token.address, walletSolver);
  const tokenForDeployer = TokenContract.at(token.address, walletDeployer);

  const mintTx = await tokenForDeployer.methods
    .mint_to_public(deployerAccount.address, amount)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: payDeployer },
      wait: { timeout: 1_200_000 },
    });

  await tokenForDeployer.methods
    .transfer_public_to_public(
      deployerAccount.address,
      userAccount.address,
      amount / 2n,
      0,
    )
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: payDeployer },
      wait: { timeout: 1_200_000 },
    });

  await tokenForDeployer.methods
    .transfer_public_to_public(
      deployerAccount.address,
      solverAccount.address,
      amount / 2n,
      0,
    )
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: payDeployer },
      wait: { timeout: 1_200_000 },
    });

  const userPubBal = await tokenForUser.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });

  const solverPubBal = await tokenForSolver.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });

  const tokenAddress = token.address.toString();
  console.log(`Token deployed at ${tokenAddress}`);
  console.log(`Public mint tx block: ${mintTx.blockNumber}`);
  console.log(`User public balance: ${userPubBal}`);
  console.log(`Solver public balance: ${solverPubBal}`);

  const userSecretKeyStr = userSecretKey.toString();
  const userSaltStr = userSalt.toString();
  const userSigningKeyStr = userSigningKey.toString();
  const solverSecretKeyStr = solverSecretKey.toString();
  const solverSaltStr = solverSalt.toString();
  const solverSigningKeyStr = solverSigningKey.toString();
  const deployerSecretKeyStr = deployerSecretKey.toString();
  const deployerSaltStr = deployerSalt.toString();
  const deployerSigningKeyStr = deployerSigningKey.toString();

  updateEnvFile('.env', {
    TOKEN_ADDRESS: tokenAddress,
    USER_SECRET: userSecretKeyStr,
    USER_SALT: userSaltStr,
    USER_SIGNING_KEY: userSigningKeyStr,
    USER_ADDRESS: userAccount.address.toString(),
    SOLVER_SECRET: solverSecretKeyStr,
    SOLVER_SALT: solverSaltStr,
    SOLVER_SIGNING_KEY: solverSigningKeyStr,
    SOLVER_ADDRESS: solverAccount.address.toString(),
    DEPLOYER_SECRET: deployerSecretKeyStr,
    DEPLOYER_SALT: deployerSaltStr,
    DEPLOYER_SIGNING_KEY: deployerSigningKeyStr,
    DEPLOYER_ADDRESS: deployerAccount.address.toString(),
  });
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
