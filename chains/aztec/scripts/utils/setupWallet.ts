import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TestWallet } from '@aztec/test-wallet/server';
import { getAztecNodeUrl, getEnv } from './config.js';

export async function setupWallet(): Promise<TestWallet> {
  const nodeUrl = getAztecNodeUrl();
  const node = createAztecNodeClient(nodeUrl);
  const env = getEnv();
  const proverEnabled = env !== 'local-network';
  const wallet = await TestWallet.create(node, { proverEnabled });
  return wallet;
}
