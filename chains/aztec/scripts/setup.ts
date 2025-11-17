import dotenv from 'dotenv';
dotenv.config();

import { Fr, GrumpkinScalar } from '@aztec/foundation/fields';
import { TestWallet } from '@aztec/test-wallet/server';
import { AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { getPXEConfig } from '@aztec/pxe/config';
import { createStore } from '@aztec/kv-store/lmdb';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { getSponsoredPaymentMethod, updateData } from './utils.ts';

async function main(): Promise<void> {
  const url = process.env.PXE_URL ?? 'http://localhost:8080';
  const node: AztecNode = createAztecNodeClient(url);
  const l1Contracts = await node.getL1ContractAddresses();
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled: true };

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
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: payUser } })
    .wait();
  await (await solverAccount.getDeployMethod())
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: paySolver } })
    .wait();
  await (await deployerAccount.getDeployMethod())
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: payDeployer } })
    .wait();

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
    })
    .deployed();

  await walletDeployer.registerContract(token.instance, TokenContract.artifact);
  await walletUser.registerContract(token.instance, TokenContract.artifact);
  await walletSolver.registerContract(token.instance, TokenContract.artifact);
  await walletUser.registerSender(deployerAccount.address);
  await walletSolver.registerSender(deployerAccount.address);

  const amount = 2000n;
  const tokenForUser = await TokenContract.at(token.address, walletUser);
  const tokenForSolver = await TokenContract.at(token.address, walletSolver);
  const tokenForDeployer = await TokenContract.at(
    token.address,
    walletDeployer,
  );

  const mintTx = await tokenForDeployer.methods
    .mint_to_public(deployerAccount.address, amount)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: payDeployer },
    })
    .wait({ timeout: 1_200_000 });

  await tokenForDeployer.methods
    .transfer_to_private(userAccount.address, amount / 2n)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: payDeployer },
    })
    .wait({ timeout: 1_200_000 });

  await tokenForDeployer.methods
    .transfer_to_private(solverAccount.address, amount / 2n)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: payDeployer },
    })
    .wait({ timeout: 1_200_000 });

  const userPrivBal = await tokenForUser.methods
    .balance_of_private(userAccount.address)
    .simulate({ from: userAccount.address });

  const solverPrivBal = await tokenForSolver.methods
    .balance_of_private(solverAccount.address)
    .simulate({ from: solverAccount.address });

  console.log(`Token deployed at ${token.address.toString()}`);
  console.log(`Public mint tx block: ${mintTx.blockNumber}`);
  console.log(`User private balance: ${userPrivBal}`);
  console.log(`Solver private balance: ${solverPrivBal}`);

  updateData({
    userSecretKey: userSecretKey.toString(),
    userSalt: userSalt.toString(),
    userSigningKey: userSigningKey.toString(),
    userAddress: userAccount.address.toString(),

    solverSecretKey: solverSecretKey.toString(),
    solverSalt: solverSalt.toString(),
    solverSigningKey: solverSigningKey.toString(),
    solverAddress: solverAccount.address.toString(),

    deployerSecretKey: deployerSecretKey.toString(),
    deployerSalt: deployerSalt.toString(),
    deployerSigningKey: deployerSigningKey.toString(),
    deployerAddress: deployerAccount.address.toString(),

    tokenAddress: token.address.toString(),
  });
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
