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
  getHTLCDetails,
  getSponsoredPaymentMethod,
} from './utils.ts';

type Role = 'user' | 'solver';

function parseRole(): Role {
  const role = (process.argv[2] || '').toLowerCase();
  if (role !== 'user' && role !== 'solver') {
    console.error('Usage: npx tsx refund.ts <user|solver>');
    process.exit(1);
  }
  return role as Role;
}

async function main(): Promise<void> {
  const role = parseRole();
  const data = readData();

  const url = process.env.PXE_URL ?? 'http://localhost:8080';
  const node: AztecNode = createAztecNodeClient(url);
  const l1Contracts = await node.getL1ContractAddresses();
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled: true };

  const store = await createStore(role === 'user' ? 'userEnv' : 'solverEnv', {
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
  await wallet.registerSender(trainAddress);

  const secretKeyHex =
    role === 'user' ? data.userSecretKey : data.solverSecretKey;
  const saltHex = role === 'user' ? data.userSalt : data.solverSalt;
  const signingKeyHex =
    role === 'user' ? data.userSigningKey : data.solverSigningKey;

  const secretKey = Fr.fromString(secretKeyHex);
  const salt = Fr.fromString(saltHex);
  const signingPrivateKey =
    (GrumpkinScalar as any).fromString?.(signingKeyHex) ??
    GrumpkinScalar.random();
  const account = await wallet.createSchnorrAccount(
    secretKey,
    salt,
    signingPrivateKey,
  );

  const paymentMethod = await getSponsoredPaymentMethod(wallet);

  const train = await TrainContract.at(trainAddress, wallet);
  const token = await TokenContract.at(tokenAddress, wallet);

  const id = Fr.fromString(role === 'user' ? data.commitId : data.lockId);

  console.log(
    `[${role}] private balance (before):`,
    await token.methods
      .balance_of_private(account.address)
      .simulate({ from: account.address }),
  );
  console.log(
    `[${role}] train public balance (before):`,
    await token.methods
      .balance_of_public(trainAddress)
      .simulate({ from: account.address }),
  );

  const exists = await train.methods
    .is_contract_initialized(id)
    .simulate({ from: account.address });
  if (!exists) throw new Error('HTLC Does Not Exist');

  const tx = await train.methods
    .refund_private(id)
    .send({ from: account.address, fee: { paymentMethod } })
    .wait({ timeout: 120000 });

  console.log(`[${role}] refund tx:`, tx);

  console.log(
    `[${role}] private balance (after):`,
    await token.methods
      .balance_of_private(account.address)
      .simulate({ from: account.address }),
  );
  console.log(
    `[${role}] train public balance (after):`,
    await token.methods
      .balance_of_public(trainAddress)
      .simulate({ from: account.address }),
  );

  console.log('Public logs:', await publicLogs(node, { txHash: tx.txHash }));
  await getHTLCDetails(account.address, train, id);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
