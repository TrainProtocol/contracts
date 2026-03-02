import dotenv from 'dotenv';
dotenv.config();

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TxHash } from '@aztec/aztec.js/tx';
import { getAztecNodeUrl } from './utils/config.ts';

function getInputTxHash(): string {
  const txHashFromArg = process.argv[2];
  if (txHashFromArg) {
    return txHashFromArg;
  }

  const txHashFromEnv = process.env.TX_HASH;
  if (txHashFromEnv) {
    return txHashFromEnv;
  }

  throw new Error(
    'Missing tx hash. Pass it as first arg or set TX_HASH in .env',
  );
}

async function main(): Promise<void> {
  const nodeUrl = getAztecNodeUrl();
  const node = createAztecNodeClient(nodeUrl);
  const txHashInput = getInputTxHash();
  const txHash = TxHash.fromString(txHashInput);

  const receipt = await node.getTxReceipt(txHash);
  const effect = await node.getTxEffect(txHash);

  console.log(`Node URL: ${nodeUrl}`);
  console.log(`Tx hash: ${receipt.txHash.toString()}`);
  console.log(`Status: ${receipt.status}`);
  console.log(`Execution result: ${receipt.executionResult ?? 'unknown'}`);
  console.log(`Error: ${receipt.error ?? 'none'}`);
  console.log(
    `Block number: ${
      receipt.blockNumber !== undefined ? String(receipt.blockNumber) : 'n/a'
    }`,
  );
  console.log(`Mined: ${receipt.isMined()}`);
  console.log(`Pending: ${receipt.isPending()}`);
  console.log(`Dropped: ${receipt.isDropped()}`);
  console.log(`Has tx effect: ${effect ? 'yes' : 'no'}`);
}

main().catch((err) => {
  const message = String(err?.message ?? err);
  if (message.includes('ECONNREFUSED')) {
    console.error('Cannot connect to Aztec node.');
    console.error(
      'Current config is using local-network (http://localhost:8080).',
    );
    console.error(
      'Either start your local Aztec node, or run with AZTEC_ENV=devnet.',
    );
    console.error(
      'Example: AZTEC_ENV=devnet TX_HASH=0x... npm run tx-status',
    );
  }
  console.error(`Error: ${err}`);
  process.exit(1);
});
