/**
 * Standalone script: bridges Fee Juice from L1 (Sepolia) to L2 (Aztec testnet).
 * Run this ONCE to fund ALL accounts with enough Fee Juice for future transactions.
 *
 * Usage: AZTEC_ENV=testnet npx tsx bridgeFeeJuice.ts [amount]
 *   - Bridges to ALL account addresses found in .env (DEPLOYER, USER, SOLVER)
 *   - amount: optional per-account amount, defaults to the portal's mint amount (~1000 FJ)
 *   - Requires L1_PRIVATE_KEY in .env with a Sepolia-funded account
 */
import dotenv from 'dotenv';
dotenv.config();

import { L1FeeJuicePortalManager } from '@aztec/aztec.js/ethereum';
import { waitForL1ToL2MessageReady } from '@aztec/aztec.js/messaging';
import { Fr } from '@aztec/aztec.js/fields';
import { createExtendedL1Client } from '@aztec/ethereum/client';
import { createEthereumChain } from '@aztec/ethereum/chain';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createLogger } from '@aztec/aztec.js/log';
import { getAztecNodeUrl, getL1RpcUrl } from './utils/config.ts';
import { requireEnv, updateEnvFile } from './utils/utils.ts';

const logger = createLogger('aztec:bridge-fee-juice');

interface ClaimData {
  claimSecret: string;
  claimAmount: string;
  messageLeafIndex: string;
}

async function bridgeToAddress(
  portal: any,
  node: any,
  recipient: AztecAddress,
  amount: bigint,
  label: string,
): Promise<ClaimData> {
  logger.info(`Bridging ${amount} Fee Juice to ${label} (${recipient.toString()})...`);
  const claim = await portal.bridgeTokensPublic(recipient, amount, true);
  logger.info(`Bridge tx submitted for ${label}. Message hash: ${claim.messageHash}`);

  logger.info(`Waiting for L1->L2 message for ${label}...`);
  await waitForL1ToL2MessageReady(node, Fr.fromHexString(claim.messageHash), {
    timeoutSeconds: 600,
  });
  logger.info(`${label} bridge complete!`);

  return {
    claimSecret: claim.claimSecret.toString(),
    claimAmount: claim.claimAmount.toString(),
    messageLeafIndex: claim.messageLeafIndex.toString(),
  };
}

async function main() {
  const l1RpcUrl = getL1RpcUrl();
  if (!l1RpcUrl) {
    throw new Error('L1_RPC_URL is not configured. Set it in testnet.json or .env');
  }

  const l1PrivateKey = requireEnv('L1_PRIVATE_KEY');

  // Collect all unique addresses to bridge to
  const addressEntries: { label: string; address: string }[] = [];
  const seen = new Set<string>();

  for (const [envKey, label] of [
    ['DEPLOYER_ADDRESS', 'deployer'],
    ['USER_ADDRESS', 'user'],
    ['SOLVER_ADDRESS', 'solver'],
  ] as const) {
    const addr = process.env[envKey];
    if (addr && !seen.has(addr)) {
      seen.add(addr);
      addressEntries.push({ label, address: addr });
    }
  }

  if (addressEntries.length === 0) {
    throw new Error(
      'No addresses found in .env. Set DEPLOYER_ADDRESS, USER_ADDRESS, or SOLVER_ADDRESS.\n' +
      'Tip: run "AZTEC_ENV=testnet npx tsx setup.ts" once to generate keys.',
    );
  }

  const customAmount = process.argv[2] ? BigInt(process.argv[2]) : undefined;

  const chain = createEthereumChain([l1RpcUrl], 11155111);
  const l1Client = createExtendedL1Client(chain.rpcUrls, l1PrivateKey, chain.chainInfo);
  const node = createAztecNodeClient(getAztecNodeUrl());
  const portal = await L1FeeJuicePortalManager.new(node, l1Client, logger);
  const bridgeAmount = customAmount ?? await portal.getTokenManager().getMintAmount();

  console.log(`\nBridging Fee Juice to ${addressEntries.length} address(es), ${bridgeAmount} each:\n`);

  const envUpdates: Record<string, string> = {};

  for (const { label, address } of addressEntries) {
    const claimData = await bridgeToAddress(portal, node, AztecAddress.fromString(address), bridgeAmount, label);
    const prefix = label.toUpperCase();
    envUpdates[`${prefix}_CLAIM_SECRET`] = claimData.claimSecret;
    envUpdates[`${prefix}_CLAIM_AMOUNT`] = claimData.claimAmount;
    envUpdates[`${prefix}_CLAIM_LEAF_INDEX`] = claimData.messageLeafIndex;
  }

  updateEnvFile('.env', envUpdates);
  console.log('\nAll bridges complete! Claim data saved to .env.');
  console.log('The first transaction for each account will automatically claim the Fee Juice.');
}

main()
  .then(() => process.exit(0))
  .catch((error: any) => {
    console.error(`Bridge failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
