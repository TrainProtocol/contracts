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
  getSponsoredPaymentMethod,
  updateData,
  readData,
  getHTLCDetails,
  publicLogs,
} from './utils.ts';
import {
  ContractFunctionInteractionCallIntent,
  lookupValidity,
} from '@aztec/aztec.js/authorization';

async function main(): Promise<void> {
  const data = readData();
  const trainAddress = AztecAddress.fromString(data.address);
  const tokenAddress = AztecAddress.fromString(data.tokenAddress);
  const solverAddress = AztecAddress.fromString(data.solverAddress);
  const url = process.env.PXE_URL ?? 'http://localhost:8080';
  const node: AztecNode = createAztecNodeClient(url);
  const l1Contracts = await node.getL1ContractAddresses();
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled: true };

  const store = await createStore('userEnv', {
    dataDirectory: 'store',
    dataStoreMapSizeKb: 1e6,
  });
  const wallet = await TestWallet.create(node, fullConfig, { store });
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

  const token = await TokenContract.at(tokenAddress, wallet);
  const train = await TrainContract.at(trainAddress, wallet);

  const id = Fr.random();
  const now = Math.floor(Date.now() / 1000);
  const timelock = now + 1100;
  const amount = 23n;
  const src_asset = 'USDC.e'.padStart(30, ' ');
  const dst_chain = 'USDC.e'.padStart(30, ' ');
  const dst_asset = 'PROOFOFPLAYAPEX_MAINNET'.padStart(30, ' ');
  const dst_address =
    '0x01ba575951852339bfe8787463503081ea0da04448b2efc58798705c27cdb3fb'.padStart(
      90,
      ' ',
    );
  const randomness = Fr.random();

  const transfer = token.methods.transfer_to_public(
    account.address,
    trainAddress,
    amount,
    randomness,
  );
  const intent: ContractFunctionInteractionCallIntent = {
    caller: trainAddress,
    action: transfer,
  };

  const witness = await wallet.createAuthWit(account.address, intent);

  console.log(
    'check validity of witness: ',
    await lookupValidity(wallet, account.address, intent, witness),
  );

  const exists = await train.methods
    .is_contract_initialized(id)
    .simulate({ from: account.address });
  if (exists) throw new Error('HTLC Exists');

  const tx = await train.methods
    .commit_private_user(
      id,
      solverAddress,
      timelock,
      tokenAddress,
      amount,
      src_asset,
      dst_chain,
      dst_asset,
      dst_address,
      randomness,
    )
    .send({
      from: account.address,
      authWitnesses: [witness],
      fee: { paymentMethod },
    })
    .wait({ timeout: 120000 });

  await getHTLCDetails(account.address, train, id);
  console.log('Public logs: ', await publicLogs(node, { txHash: tx.txHash }));

  updateData({
    commitId: id.toString(),
    commitTxHash: tx.txHash?.toString?.() ?? String(tx),
  });
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
