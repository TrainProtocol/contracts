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
  generateSecretAndHashlock,
} from './utils.ts';
import {
  ContractFunctionInteractionCallIntent,
  lookupValidity,
} from '@aztec/aztec.js/authorization';

async function main(): Promise<void> {
  const data = readData();
  const trainAddress = AztecAddress.fromString(data.address);
  const tokenAddress = AztecAddress.fromString(data.tokenAddress);
  const url = process.env.PXE_URL ?? 'http://localhost:8080';
  const node: AztecNode = createAztecNodeClient(url);
  const l1Contracts = await node.getL1ContractAddresses();
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled: true };

  const store = await createStore('solverEnv', {
    dataDirectory: 'store',
    dataStoreMapSizeKb: 1e6,
  });
  const wallet = await TestWallet.create(node, fullConfig, { store });

  const trainInstance = await node.getContract(trainAddress);
  await wallet.registerContract(trainInstance, TrainContract.artifact);
  const tokenInstance = await node.getContract(tokenAddress);
  await wallet.registerContract(tokenInstance, TokenContract.artifact);

  const secretKey = Fr.fromString(data.solverSecretKey);
  const salt = Fr.fromString(data.solverSalt);
  const signingPrivateKey =
    (GrumpkinScalar as any).fromString?.(data.solverSigningKey) ??
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
  const now = BigInt(Math.floor(Date.now() / 1000));
  const timelock = now + 1900n;
  const amount = 7n;
  const src_asset = 'USDC.e'.padStart(30, ' ');
  const dst_chain = 'USDC.e'.padStart(30, ' ');
  const dst_asset = 'PROOFOFPLAYAPEX_MAINNET'.padStart(30, ' ');
  const dst_address =
    '0x01ba575951852339bfe8123463503081ea0da04448b2efc58798705c27cdb3fb'.padStart(
      90,
      ' ',
    );
  const randomness = Fr.random();

  const [secretHigh2, secretLow2, hashlockHigh2, hashlockLow2] =
    generateSecretAndHashlock();
  const [
    ownershipKeyHigh,
    ownershipKeyLow,
    ownershipHashHigh,
    ownershipHashLow,
  ] = generateSecretAndHashlock();

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
    .lock_private_solver(
      id,
      hashlockHigh2,
      hashlockLow2,
      amount,
      ownershipHashHigh,
      ownershipHashLow,
      Number(timelock),
      tokenAddress,
      randomness,
      src_asset,
      dst_chain,
      dst_asset,
      dst_address,
    )
    .send({
      from: account.address,
      authWitnesses: [witness],
      fee: { paymentMethod },
    })
    .wait({ timeout: 120000 });

  console.log(
    'solver private balance: ',
    await token.methods
      .balance_of_private(account.address)
      .simulate({ from: account.address }),
  );
  console.log(
    'train public balance: ',
    await token.methods
      .balance_of_public(trainAddress)
      .simulate({ from: account.address }),
  );

  console.log('Public logs: ', await publicLogs(node, { txHash: tx.txHash }));

  updateData({
    lockId: id.toString(),
    lockTx: tx.txHash,
    secretHigh2: secretHigh2,
    secretLow2: secretLow2,
    hashlockHigh2: hashlockHigh2,
    hashlockLow2: hashlockLow2,
    ownershipKeyHigh: ownershipKeyHigh,
    ownershipKeyLow: ownershipKeyLow,
    ownershipHashHigh: ownershipHashHigh,
    ownershipHashLow: ownershipHashLow,
  });

  await getHTLCDetails(account.address, train, id);
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
