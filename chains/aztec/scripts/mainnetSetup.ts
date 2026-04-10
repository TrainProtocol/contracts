/**
 * Standalone one-time script: bridge Fee Juice from L1 and deploy a Schnorr account on Aztec Mainnet.
 *
 * Fresh run:
 *   npx tsx mainnetSetup.ts
 *
 * Resume (skip bridge, use saved claim data from a previous failed run):
 *   RESUME=1 \
 *   SECRET_KEY=0x... SALT=0x... SIGNING_KEY=0x... \
 *   CLAIM_SECRET=0x... CLAIM_AMOUNT=1000000000000000000 MESSAGE_LEAF_INDEX=1167360 MESSAGE_HASH=0x... \
 *   npx tsx mainnetSetup.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { L1FeeJuicePortalManager } from '@aztec/aztec.js/ethereum';
import { FeeJuicePaymentMethodWithClaim } from '@aztec/aztec.js/fee';
import { NO_FROM } from '@aztec/aztec.js/account';
import { createExtendedL1Client } from '@aztec/ethereum/client';
import { createEthereumChain } from '@aztec/ethereum/chain';
import { createLogger } from '@aztec/aztec.js/log';

// ── Config from env ──────────────────────────────────────────────────
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'https://aztec-mainnet.drpc.org';
const L1_CHAIN_ID = Number(process.env.L1_CHAIN_ID || '1');
const L1_PRIVATE_KEY = process.env.L1_PRIVATE_KEY!;
const L1_RPC_URL = process.env.L1_RPC_URL!;

if (!L1_PRIVATE_KEY) {
  throw new Error('Missing required env var: L1_PRIVATE_KEY');
}
if (!L1_RPC_URL) {
  throw new Error('Missing required env var: L1_RPC_URL');
}

const RESUME = !!process.env.RESUME;

const logger = createLogger('aztec:mainnet-setup');

async function main() {
  console.log('=== Aztec Mainnet: Bridge Fee Juice + Deploy Account ===\n');
  console.log(`Aztec node:  ${AZTEC_NODE_URL}`);
  console.log(`Mode:        ${RESUME ? 'RESUME (skip bridge)' : 'FRESH'}\n`);

  // ── 1. Connect to Aztec node ────────────────────────────────────────
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  const nodeInfo = await node.getNodeInfo();
  console.log(`Connected to Aztec node. L1 chain ID from node: ${nodeInfo.l1ChainId}`);

  // ── 2. Create embedded wallet + account ─────────────────────────────
  console.log('\nCreating embedded wallet...');
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { proverEnabled: true },
  });

  let secretKey: Fr;
  let salt: Fr;
  let signingKey: typeof GrumpkinScalar extends abstract new (...args: any) => infer T ? T : never;

  if (RESUME || (process.env.SECRET_KEY && process.env.SALT && process.env.SIGNING_KEY)) {
    // Restore keys from env
    secretKey = Fr.fromString(process.env.SECRET_KEY!);
    salt = Fr.fromString(process.env.SALT!);
    signingKey = (GrumpkinScalar as any).fromString(process.env.SIGNING_KEY!);
    console.log('Restored account keys from env.');
  } else {
    secretKey = Fr.random();
    salt = Fr.random();
    signingKey = GrumpkinScalar.random();
  }

  const account = await wallet.createSchnorrAccount(secretKey, salt, signingKey);

  console.log('\n--- ACCOUNT KEYS (save immediately) ---');
  console.log(`  ADDRESS:     ${account.address.toString()}`);
  console.log(`  SECRET_KEY:  ${secretKey.toString()}`);
  console.log(`  SALT:        ${salt.toString()}`);
  console.log(`  SIGNING_KEY: ${signingKey.toString()}`);
  console.log('----------------------------------------\n');

  // ── 3. Bridge or resume claim data ──────────────────────────────────
  let claimSecret: Fr;
  let claimAmount: bigint;
  let messageLeafIndex: bigint;
  let messageHash: string;
  let bridgeAmount: bigint;

  if (RESUME) {
    // Restore claim data from env
    claimSecret = Fr.fromString(process.env.CLAIM_SECRET!);
    claimAmount = BigInt(process.env.CLAIM_AMOUNT!);
    messageLeafIndex = BigInt(process.env.MESSAGE_LEAF_INDEX!);
    messageHash = process.env.MESSAGE_HASH!;
    bridgeAmount = claimAmount;
    console.log(`Resumed claim data. Message hash: ${messageHash}`);
  } else {
    // Fresh bridge
    console.log('Connecting to L1...');
    const chain = createEthereumChain([L1_RPC_URL], L1_CHAIN_ID);
    const l1Client = createExtendedL1Client(chain.rpcUrls, L1_PRIVATE_KEY, chain.chainInfo);
    console.log(`L1 wallet: ${l1Client.account.address}`);

    const portal = await L1FeeJuicePortalManager.new(node, l1Client, logger);

    let useMint = false;
    try {
      bridgeAmount = await portal.getTokenManager().getMintAmount();
      useMint = true;
      console.log(`\nFaucet available. Minting + bridging ${bridgeAmount} Fee Juice...`);
    } catch {
      bridgeAmount = 5_000_000_000_000_000_000n; // 5 FJ
      console.log(`\nNo faucet. Bridging ${bridgeAmount} Fee Juice from existing L1 balance...`);

      const l1Balance = await portal.getTokenManager().getL1TokenBalance(l1Client.account.address);
      console.log(`L1 fee juice balance: ${l1Balance}`);
      if (l1Balance < bridgeAmount) {
        console.error(`Insufficient L1 fee juice token balance (${l1Balance} < ${bridgeAmount}).`);
        process.exit(1);
      }
    }

    const claim = await portal.bridgeTokensPublic(account.address, bridgeAmount, useMint);
    claimSecret = claim.claimSecret;
    claimAmount = claim.claimAmount;
    messageLeafIndex = claim.messageLeafIndex;
    messageHash = claim.messageHash;

    // Print claim data immediately so it survives a crash
    console.log('\n--- CLAIM DATA (save in case script fails) ---');
    console.log(`  CLAIM_SECRET:       ${claimSecret.toString()}`);
    console.log(`  CLAIM_AMOUNT:       ${claimAmount.toString()}`);
    console.log(`  MESSAGE_LEAF_INDEX: ${messageLeafIndex.toString()}`);
    console.log(`  MESSAGE_HASH:       ${messageHash}`);
    console.log('');
    console.log('  To resume if this script fails from here, run:');
    console.log(`  RESUME=1 SECRET_KEY=${secretKey.toString()} SALT=${salt.toString()} SIGNING_KEY=${signingKey.toString()} CLAIM_SECRET=${claimSecret.toString()} CLAIM_AMOUNT=${claimAmount.toString()} MESSAGE_LEAF_INDEX=${messageLeafIndex.toString()} MESSAGE_HASH=${messageHash} npx tsx mainnetSetup.ts`);
    console.log('-----------------------------------------------\n');
  }

  // ── 4. Wait for L1->L2 message (compatible with node v4.1.x) ────────
  // The mainnet node (v4.1.2) doesn't support getL1ToL2MessageCheckpoint
  // used by the SDK's waitForL1ToL2MessageReady. Use isL1ToL2MessageSynced instead.
  console.log('Waiting for L1->L2 message to be ready (this may take several minutes)...');
  const deadline = Date.now() + 1200_000; // 20 min
  let ready = false;
  let attempts = 0;
  while (!ready && Date.now() < deadline) {
    attempts++;
    try {
      const resp = await fetch(AZTEC_NODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'node_isL1ToL2MessageSynced',
          params: [messageHash],
        }),
      });
      const json = await resp.json() as any;
      ready = json.result === true;
      if (!ready) {
        if (attempts % 10 === 0) console.log(`  Still waiting... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err: any) {
      console.log(`  RPC error (attempt ${attempts}, retrying in 10s): ${err.message?.slice(0, 80) ?? err}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  if (!ready) {
    console.error('Timed out waiting for L1->L2 message. Use the RESUME command above to retry.');
    process.exit(1);
  }
  console.log('L1->L2 message synced! Waiting for it to become consumable...');

  // ── 5. Deploy account (claims fee juice as first tx) ────────────────
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(account.address, {
    claimSecret,
    claimAmount,
    messageLeafIndex,
  });

  const deployMethod = await account.getDeployMethod();

  // Simulate before sending — retry until the message is actually consumable
  const simDeadline = Date.now() + 600_000; // 10 min
  let simOk = false;
  while (!simOk && Date.now() < simDeadline) {
    try {
      await deployMethod.simulate({
        from: NO_FROM,
        fee: { paymentMethod },
        additionalScopes: [],
        skipClassPublication: false,
        skipInstancePublication: false,
        skipInitialization: false,
        skipRegistration: false,
      });
      simOk = true;
    } catch (err: any) {
      const msg = err.message ?? String(err);
      if (msg.includes('No L1 to L2 message found')) {
        console.log('  Message not yet consumable, waiting 30s...');
        await new Promise(r => setTimeout(r, 30_000));
      } else if (msg.includes('Temporary internal error') || msg.includes('Cannot read properties of undefined')) {
        console.log(`  Transient RPC error, retrying in 15s: ${msg.slice(0, 80)}`);
        await new Promise(r => setTimeout(r, 15_000));
      } else {
        throw err;
      }
    }
  }
  if (!simOk) {
    console.error('Timed out waiting for message to become consumable. Use RESUME to retry.');
    process.exit(1);
  }

  console.log('Message consumable! Deploying account on Aztec mainnet...');
  let tx: any;
  for (let sendAttempt = 1; sendAttempt <= 5; sendAttempt++) {
    try {
      tx = await deployMethod.send({
        from: NO_FROM,
        fee: { paymentMethod },
        additionalScopes: [],
        skipClassPublication: false,
        skipInstancePublication: false,
        skipInitialization: false,
        skipRegistration: false,
        wait: { timeout: 1200_000, returnReceipt: true, dontThrowOnRevert: true },
      });
      break;
    } catch (err: any) {
      const msg = err.message ?? String(err);
      if ((msg.includes('Temporary internal error') || msg.includes('Cannot read properties of undefined')) && sendAttempt < 5) {
        console.log(`  Deploy send attempt ${sendAttempt} failed (transient), retrying in 15s...`);
        await new Promise(r => setTimeout(r, 15_000));
      } else {
        throw err;
      }
    }
  }

  if (tx.receipt.hasExecutionReverted()) {
    console.error(`Account deployment reverted: ${tx.receipt.error ?? 'unknown'}`);
    process.exit(1);
  }

  const metadata = await (wallet as unknown as Wallet).getContractMetadata(account.address);
  if (metadata.initializationStatus !== 'INITIALIZED') {
    console.error(`Account deployment incomplete: status=${metadata.initializationStatus}`);
    process.exit(1);
  }

  // ── 6. Done ─────────────────────────────────────────────────────────
  console.log('\n============================================');
  console.log('  ACCOUNT DEPLOYED SUCCESSFULLY ON MAINNET');
  console.log('============================================\n');
  console.log('# Aztec Mainnet Account — save this entire block');
  console.log(`AZTEC_NODE_URL=${AZTEC_NODE_URL}`);
  console.log(`ADDRESS=${account.address.toString()}`);
  console.log(`SECRET_KEY=${secretKey.toString()}`);
  console.log(`SALT=${salt.toString()}`);
  console.log(`SIGNING_KEY=${signingKey.toString()}`);
  console.log(`DEPLOY_TX_HASH=${tx.receipt.txHash?.toString() ?? 'unknown'}`);
  console.log(`DEPLOY_BLOCK=${tx.receipt.blockNumber ?? 'unknown'}`);
  console.log(`L1_CHAIN_ID=${L1_CHAIN_ID}`);
  console.log(`FEE_JUICE_BRIDGED=${bridgeAmount.toString()}`);
  console.log('');
  console.log('To recover this account in scripts, use:');
  console.log('  wallet.createSchnorrAccount(SECRET_KEY, SALT, SIGNING_KEY)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nFatal error: ${err.message ?? err}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
