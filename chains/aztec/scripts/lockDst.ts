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

// Helper function to compare byte arrays
function arraysEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

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

  const token = TokenContract.at(tokenAddress, wallet);
  const train = TrainContract.at(trainAddress, wallet);

  const swap_id = Fr.random();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const timelock = now + 1900n;
  const reward_timelock = now + 1000n;
  const amount = 7n;
  const reward = 1n; // Reward must be at least 10% of amount
  const total_amount = amount + reward;
  const src_asset = 'USDC.e'.padStart(30, ' ');
  const dst_chain = 'AZTEC'.padStart(30, ' ');
  const dst_asset = 'USDC.e'.padStart(30, ' ');
  const dst_address =
    '0x01ba575951852339bfe8123463503081ea0da04448b2efc58798705c27cdb3fb'.padStart(
      90,
      ' ',
    );

  const [secret, hashlock] = generateSecretAndHashlock();

  const tx = await train.methods
    .lock_dst(
      swap_id,
      hashlock,
      reward,
      Number(reward_timelock),
      Number(timelock),
      account.address, // src_receiver (solver receives on source chain)
      tokenAddress,
      total_amount,
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

  console.log(
    'solver public balance: ',
    await token.methods
      .balance_of_public(account.address)
      .simulate({ from: account.address }),
  );
  console.log(
    'train public balance: ',
    await token.methods
      .balance_of_public(trainAddress)
      .simulate({ from: account.address }),
  );

  console.log('Public logs: ', await publicLogs(node, { txHash: tx.txHash }));

  // Query the contract to find which htlc_id was assigned
  // Start from slot 0 and check until we find our newly created HTLC
  let htlc_id = 0;
  let found = false;
  for (let i = 0; i < 100 && !found; i++) {
    const exists = await train.methods
      .has_htlc(swap_id, i)
      .simulate({ from: account.address });
    if (exists) {
      const htlc = await train.methods
        .get_htlc(swap_id, i)
        .simulate({ from: account.address });
      // Check if this is the HTLC we just created (by sender address and hashlock)
      if (
        htlc.sender.toString() === account.address.toString() &&
        arraysEqual(htlc.hashlock, hashlock)
      ) {
        htlc_id = i;
        found = true;
        console.log(`Our HTLC was assigned htlc_id: ${htlc_id}`);
      }
    }
  } // Test getters
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
    console.log('  - Amount:', htlcDetails.amount);
    console.log('  - Reward:', htlcDetails.reward);
    console.log('  - Sender:', htlcDetails.sender);
    console.log('  - Receiver:', htlcDetails.src_receiver);
    console.log('  - Timelock:', htlcDetails.timelock);
    console.log('  - Reward Timelock:', htlcDetails.reward_timelock);
    console.log('  - Claimed:', htlcDetails.claimed);
  }

  updateData({
    solverSwapId: swap_id.toString(),
    solverHtlcId: htlc_id.toString(),
    solverTx: tx.txHash,
    solverSecret: secret,
    solverHashlock: hashlock,
  });

  await getHTLCDetails(account.address, train, swap_id);
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
