import { createAztecNodeClient } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getAztecNodeUrl, getEnv } from './config.ts';

export async function setupWallet(): Promise<EmbeddedWallet> {
  const nodeUrl = getAztecNodeUrl();
  const env = getEnv();
  const proverEnabled = env !== 'local-network';

  const wallet = await EmbeddedWallet.create(createAztecNodeClient(nodeUrl), {
    ephemeral: true,
    // EmbeddedWallet's default provider preloads MultiCallEntrypoint and AuthRegistry.
    pxe: { proverEnabled },
  });

  return wallet;
}

/**
 * Bridges the type gap between `EmbeddedWallet` and the `Wallet` interface
 * expected by generated contract bindings (`Contract.at()`, `Contract.deploy()`).
 *
 * At runtime `EmbeddedWallet extends BaseWallet implements Wallet`; keep the
 * cast localized at the generated-binding boundary.
 */
export function toWallet(w: EmbeddedWallet): Wallet {
  return w as unknown as Wallet;
}
