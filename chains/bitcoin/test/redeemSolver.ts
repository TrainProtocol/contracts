import 'dotenv/config';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { BitcoinTrain } from '../src/BitcoinTrain';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const RECIPIENT_PATH = process.env.RECIPIENT_PATH || "m/84'/1'/0'/0/0";
// Fee is estimated dynamically from mempool.space API

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super('testnet4');
  }
}

function arg(name: string): string | undefined {
  const k = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(k)) return a.slice(k.length);
  }
  return undefined;
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC || process.env.MNEMONIC;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) {
    throw new Error('TESTNET3_MNEMONIC (or MNEMONIC) missing or invalid');
  }

  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);

  const recipientNode = root.derivePath(RECIPIENT_PATH);
  if (!recipientNode.privateKey) throw new Error('Recipient key derivation failed');
  const recipient = ECPair.fromPrivateKey(recipientNode.privateKey, { network: networks.testnet });

  const outDir = join(__dirname, '../metadata');

  // Load solver lock metadata
  const metaPath = join(outDir, 'solver_lock_meta.json');
  if (!existsSync(metaPath)) throw new Error('No solver_lock_meta.json found — run solverLock.ts first');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  // Load secret
  let secretHex = arg('secret') || process.env.PAYMENT_SECRET_HEX;
  if (!secretHex) {
    const secretPath = join(outDir, 'solver_payment_secret.hex');
    if (existsSync(secretPath)) secretHex = readFileSync(secretPath, 'utf8').trim();
  }
  if (!secretHex) throw new Error('Secret required: --secret=<hex>, PAYMENT_SECRET_HEX env, or metadata/solver_payment_secret.hex');

  const secret = Buffer.from(secretHex.replace(/^0x/i, ''), 'hex');
  if (secret.length !== 32) throw new Error('Secret must be 32 bytes');

  const hashlock = Buffer.from(meta.amountTapleafHashlock.scriptHex, 'hex');
  // Extract hashlock from metadata
  const hashlockBuf = Buffer.from(
    (meta as any).amountTapleafHashlock?.scriptHex ? meta.amountTapleafHashlock.scriptHex : '',
    'hex'
  );

  // Determine mode: amount only, reward only, or both
  const mode = arg('mode') || process.env.REDEEM_MODE || 'amount';
  const feeSat = Number(process.env.FEE_SAT) || await svc.estimateFee(200, 'halfHour');

  // Get fee UTXOs from recipient's P2WPKH
  const recipientAddr = payments.p2wpkh({ pubkey: recipient.publicKey, network: networks.testnet }).address!;
  const allUtxos = await svc.getUtxos(recipientAddr);
  if (!allUtxos.length) throw new Error(`No fee UTXOs for recipient at ${recipientAddr}`);
  const feeUtxos = allUtxos.slice(0, 2);

  const amountUtxo = {
    txid: meta.txid,
    contractVout: meta.amountContractVout,
    value: meta.amountValue,
    p2trScriptPubKeyHex: meta.amountP2trScriptPubKeyHex,
    tapleaf_hashlock: meta.amountTapleafHashlock,
  };

  const rewardUtxo = meta.rewardContractAddress ? {
    txid: meta.txid,
    contractVout: meta.rewardContractVout,
    value: meta.rewardValue,
    p2trScriptPubKeyHex: meta.rewardP2trScriptPubKeyHex,
    tapleaf: meta.rewardTapleafDelayed, // delayed leaf (after rewardTimelock)
    csvSequence: meta.rewardTimelock,
  } : null;

  console.log('Redeeming solver lock...');
  console.log('  mode:', mode);
  console.log('  recipient:', recipientAddr);

  let result;
  if (mode === 'amount') {
    // Redeem amount UTXO only (leave reward for rewardRecipient via priority leaf)
    result = await svc.redeemSolver(amountUtxo, null, {
      redeemer: recipient,
      secret,
      hashlock: Buffer.from(meta.amountTapleafHashlock.scriptHex, 'hex').subarray(2, 34), // extract hashlock from script
      index: meta.index,
      feeSat,
      feeUtxos,
    });
  } else if (mode === 'both') {
    // Redeem amount + reward (delayed leaf, after rewardTimelock)
    if (!rewardUtxo) throw new Error('No reward UTXO in metadata');
    result = await svc.redeemSolver(amountUtxo, rewardUtxo, {
      redeemer: recipient,
      secret,
      hashlock: Buffer.from(meta.amountTapleafHashlock.scriptHex, 'hex').subarray(2, 34),
      index: meta.index,
      feeSat,
      feeUtxos,
    });
  } else if (mode === 'reward') {
    // RewardRecipient claims reward only (priority leaf, before rewardTimelock)
    // Note: this requires rewardRecipient key, not recipient key
    const rewardRecipientPath = process.env.REWARD_RECIPIENT_PATH || "m/84'/1'/0'/0/2";
    const rewardRecipientNode = root.derivePath(rewardRecipientPath);
    if (!rewardRecipientNode.privateKey) throw new Error('RewardRecipient key derivation failed');
    const rewardRecipient = ECPair.fromPrivateKey(rewardRecipientNode.privateKey, { network: networks.testnet });

    if (!meta.rewardContractAddress) throw new Error('No reward UTXO in metadata');
    const priorityRewardUtxo = {
      txid: meta.txid,
      contractVout: meta.rewardContractVout,
      value: meta.rewardValue,
      p2trScriptPubKeyHex: meta.rewardP2trScriptPubKeyHex,
      tapleaf: meta.rewardTapleafPriority, // priority leaf (no CSV)
    };

    const rewardAddr = payments.p2wpkh({ pubkey: rewardRecipient.publicKey, network: networks.testnet }).address!;
    const rewardFeeUtxos = await svc.getUtxos(rewardAddr);
    if (!rewardFeeUtxos.length) throw new Error(`No fee UTXOs for rewardRecipient at ${rewardAddr}`);

    result = await svc.redeemSolver(null, priorityRewardUtxo, {
      redeemer: rewardRecipient,
      secret,
      hashlock: Buffer.from(meta.amountTapleafHashlock.scriptHex, 'hex').subarray(2, 34),
      index: meta.index,
      feeSat,
      feeUtxos: rewardFeeUtxos.slice(0, 2),
    });
  } else {
    throw new Error(`Unknown mode: ${mode}. Use: amount, both, or reward`);
  }

  console.log('\nredeemSolver TXID:', result.txid);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'redeem_solver_meta.json'), JSON.stringify({ ...result, mode }, null, 2));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
