import dotenv from 'dotenv';
dotenv.config();

import { Fr, GrumpkinScalar } from '@aztec/foundation/fields';
import { TestWallet } from '@aztec/test-wallet/server';
import { AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { getPXEConfig } from '@aztec/pxe/config';
import { createStore } from '@aztec/kv-store/lmdb';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { TrainContract } from './Train.ts';
import {
  readData,
  publicLogs,
  generateSecretAndHashlock,
  updateData,
  getHTLCDetails,
  getSponsoredPaymentMethod,
} from './utils.ts';

async function main(): Promise<void> {
  const data = readData();

  const url = process.env.PXE_URL ?? 'http://localhost:8080';
  const node: AztecNode = createAztecNodeClient(url);
  const l1Contracts = await node.getL1ContractAddresses();
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled: true };

  const store = await createStore('userEnv', {
    dataDirectory: 'store',
    dataStoreMapSizeKb: 1e6,
  });
  const wallet = await TestWallet.create(node, fullConfig, { store });

  const trainAddress = AztecAddress.fromString(
    data.address ?? data.trainContractAddress,
  );
  const tokenAddress = AztecAddress.fromString(data.tokenAddress);

  const trainInstance = await node.getContract(trainAddress);
  await wallet.registerContract(trainInstance, TrainContract.artifact);
  const tokenInstance = await node.getContract(tokenAddress);
  await wallet.registerContract(tokenInstance, TokenContract.artifact);

  const secretKey = Fr.fromString(data.userSecretKey);
  const salt = Fr.fromString(data.userSalt);
  const signingPrivateKey =
    (GrumpkinScalar as any).fromString?.(data.userSigningKey) ??
    GrumpkinScalar.random();
  const account = await wallet.createSchnorrAccount(
    secretKey,
    salt,
    signingPrivateKey,
  );

  const paymentMethod = await getSponsoredPaymentMethod(wallet);

  const train = await TrainContract.at(trainAddress, wallet);
  const token = await TokenContract.at(tokenAddress, wallet);

  const [secretHigh, secretLow, hashlockHigh, hashlockLow] =
    generateSecretAndHashlock();
  const Id = Fr.fromString(data.commitId ?? data.Id ?? '0');
  const now = Math.floor(Date.now() / 1000);
  const timelock = now + 1000;

  const exists = await train.methods
    .is_contract_initialized(Id)
    .simulate({ from: account.address });
  if (!exists) throw new Error('HTLC Does Not Exsist');

  const tx = await train.methods
    .add_lock_private_user(Id, hashlockHigh, hashlockLow, timelock)
    .send({ from: account.address, fee: { paymentMethod } })
    .wait({ timeout: 120000 });

  console.log('Public logs: ', await publicLogs(node, { txHash: tx.txHash }));

  console.log(
    'Public balance of Train:',
    await token.methods
      .balance_of_public(trainAddress)
      .simulate({ from: account.address }),
  );

  updateData({
    secretHigh,
    secretLow,
    hashlockHigh,
    hashlockLow,
    addLockTxHash: tx.txHash?.toString?.() ?? String(tx),
  });

  await getHTLCDetails(account.address, train, Id);
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
