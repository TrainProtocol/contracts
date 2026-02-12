import dotenv from 'dotenv';
dotenv.config();

import { rmSync } from 'node:fs';
import path from 'node:path';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TestWallet } from '@aztec/test-wallet/server';
import { AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { getPXEConfig } from '@aztec/pxe/config';
import { createStore } from '@aztec/kv-store/lmdb';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { updateEnvFile } from './utils/utils.ts';
import { getAztecNodeUrl, getEnv } from './utils/config.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';

async function getSponsoredPaymentMethod(walletUser: TestWallet) {
  const sponsoredFPC = await getSponsoredFPCInstance();
  await walletUser.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  return new SponsoredFeePaymentMethod(sponsoredFPC.address);
}

function resetLocalPxeStores() {
  const baseDir = path.resolve(process.cwd(), 'store');
  for (const name of ['userEnv', 'solverEnv', 'deployerEnv']) {
    rmSync(path.join(baseDir, name), { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  // Avoid stale PXE state when local-network restarts or reorgs.
  resetLocalPxeStores();

  const url = getAztecNodeUrl();
  const node: AztecNode = createAztecNodeClient(url);
  const l1Contracts = await node.getL1ContractAddresses();
  const proverEnabled = getEnv() !== 'local-network';
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled };

  const storeUser = await createStore('userEnv', {
    dataDirectory: 'store',
    dataStoreMapSizeKb: 1e6,
  });
  const storeSolver = await createStore('solverEnv', {
    dataDirectory: 'store',
    dataStoreMapSizeKb: 1e6,
  });
  const storeDeployer = await createStore('deployerEnv', {
    dataDirectory: 'store',
    dataStoreMapSizeKb: 1e6,
  });

  const walletUser = await TestWallet.create(node, fullConfig, {
    store: storeUser,
  });
  const walletSolver = await TestWallet.create(node, fullConfig, {
    store: storeSolver,
  });
  const walletDeployer = await TestWallet.create(node, fullConfig, {
    store: storeDeployer,
  });

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

  await (await userAccount.getDeployMethod())
    .send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: payUser },
      wait: { timeout: 120000 },
    });
  await (await solverAccount.getDeployMethod())
    .send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: paySolver },
      wait: { timeout: 120000 },
    });
  await (await deployerAccount.getDeployMethod())
    .send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: payDeployer },
      wait: { timeout: 120000 },
    });

  const token = await TokenContract.deploy(
    walletDeployer,
    deployerAccount.address,
    'TRAIN',
    'TRN',
    18,
  )
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: payDeployer },
      wait: { timeout: 1_200_000 },
    });

  await walletUser.registerSender(deployerAccount.address);
  await walletSolver.registerSender(deployerAccount.address);

  const amount = 2000n;
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
    .transfer_in_public(
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
    .transfer_in_public(
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
