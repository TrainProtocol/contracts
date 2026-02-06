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

  const token = TokenContract.at(tokenAddress, wallet);
  const train = TrainContract.at(trainAddress, wallet);

  const swap_id = Fr.random();
  const htlc_id = 0; // Source chain lock uses htlc_id = 0 (user)
  const now = Math.floor(Date.now() / 1000);
  const timelock = now + 1900;
  const amount = 20n;
  const src_asset = 'USDC.e'.padStart(30, ' ');
  const dst_chain = 'PROOFOFPLAYAPEX_MAINNET'.padStart(30, ' ');
  const dst_asset = 'USDC.e'.padStart(30, ' ');
  const dst_address =
    '0x01ba575951852339bfe8787463503081ea0da04448b2efc58798705c27cdb3fb'.padStart(
      90,
      ' ',
    );

  const [secret, hashlock] = generateSecretAndHashlock();

  const exists = await train.methods
    .has_htlc(swap_id, htlc_id)
    .simulate({ from: account.address });
  if (exists) throw new Error('HTLC Exists');

  const tx = await train.methods
    .lock_src(
      swap_id,
      hashlock,
      timelock,
      solverAddress, // src_receiver (solver receives on source chain)
      tokenAddress,
      amount,
      src_asset,
      dst_chain,
      dst_asset,
      dst_address,
    )
    .send({
      from: account.address,
      fee: { paymentMethod },
    })
    .wait({ timeout: 120000 });

  console.log('Public logs: ', await publicLogs(node, { txHash: tx.txHash }));

  console.log(
    'Public balance of Train:',
    await token.methods
      .balance_of_public(trainAddress)
      .simulate({ from: account.address }),
  );

  // Test getters
  console.log('\n=== Testing Getters ===');
  const htlcExists = await train.methods
    .has_htlc(swap_id, htlc_id)
    .simulate({ from: account.address });
  console.log(
    `HTLC exists (swap_id=${swap_id}, htlc_id=${htlc_id}):`,
    htlcExists,
  );

  if (htlcExists) {
    const htlcDetails = await train.methods
      .get_htlc(swap_id, htlc_id)
      .simulate({ from: account.address });
    console.log('HTLC Details:', htlcDetails);
  }

  const userSwapsCount = await train.methods
    .get_user_swaps_count(account.address)
    .simulate({ from: account.address });
  console.log(`User swaps count for ${account.address}:`, userSwapsCount);

  updateData({
    userSwapId: swap_id.toString(),
    userHtlcId: htlc_id.toString(),
    userTx: tx.txHash?.toString?.() ?? String(tx),
    userSecret: secret,
    userHashlock: hashlock,
  });

  await getHTLCDetails(account.address, train, swap_id);
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
