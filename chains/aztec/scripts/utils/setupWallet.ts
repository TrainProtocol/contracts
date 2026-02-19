import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getAztecNodeUrl, getEnv } from './config.js';

export async function setupWallet(): Promise<EmbeddedWallet> {
  const nodeUrl = getAztecNodeUrl();
  const env = getEnv();
  const proverEnabled = env !== 'local-network';

  const wallet = await EmbeddedWallet.create(createAztecNodeClient(nodeUrl), {
    ephemeral: true,
    pxeConfig: { proverEnabled },
  });

  return wallet;
}
