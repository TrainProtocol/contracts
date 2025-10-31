import dotenv from 'dotenv';
dotenv.config();
import { Fr, GrumpkinScalar } from '@aztec/foundation/fields';
import { TestWallet } from '@aztec/test-wallet/server';
import { AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { getPXEConfig } from '@aztec/pxe/config';
import { createStore } from '@aztec/kv-store/lmdb';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getSponsoredPaymentMethod, updateData } from './utils.ts';
import { TrainContract } from './Train.ts';

async function main(): Promise<void> {
  const url = process.env.PXE_URL ?? 'http://localhost:8080';
  const node: AztecNode = createAztecNodeClient(url);

  const l1Contracts = await node.getL1ContractAddresses();
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled: true };

  const options = {
    dataDirectory: 'store',
    dataStoreMapSizeKb: 1e6,
  };
  const store = await createStore('deploymentEnv', options);

  const wallet = await TestWallet.create(node, fullConfig, { store: store });
  const sponsoredPaymentMethod = await getSponsoredPaymentMethod(wallet);

  const secretKey = Fr.random();
  const salt = new Fr(0);
  const signingPrivateKey = GrumpkinScalar.random();

  const deployerAccount = await wallet.createSchnorrAccount(
    secretKey,
    salt,
    signingPrivateKey,
  );

  const deployMethod = await deployerAccount.getDeployMethod();
  const deployerDeployment = await deployMethod
    .send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: sponsoredPaymentMethod },
    })
    .wait();

  const contract = await TrainContract.deploy(wallet)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
    })
    .deployed();

  console.log('yeaaa', contract.instance);

  updateData({
    instance: JSON.parse(
      JSON.stringify(contract.instance, (_, v) => v?.toString?.() ?? v),
    ),
  });
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
