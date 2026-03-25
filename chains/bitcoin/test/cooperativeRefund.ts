import 'dotenv/config';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BitcoinTrain } from '../src/BitcoinTrain';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = process.env.SENDER_PATH || "m/84'/1'/0'/0/1";
const RECEIVER_PATH = process.env.RECEIVER_PATH || "m/84'/1'/0'/0/0";
// Fee is estimated dynamically from mempool.space API

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super('testnet4');
  }
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC || process.env.MNEMONIC;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) {
    throw new Error('TESTNET3_MNEMONIC (or MNEMONIC) missing or invalid');
  }

  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);

  const senderNode = root.derivePath(SENDER_PATH);
  const recipientNode = root.derivePath(RECEIVER_PATH);
  if (!senderNode.privateKey || !recipientNode.privateKey) throw new Error('Key derivation failed');

  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });
  const recipient = ECPair.fromPrivateKey(recipientNode.privateKey, { network: networks.testnet });

  const outDir = join(__dirname, '../metadata');

  // Load lock metadata
  const metaPath = join(outDir, 'lock_meta.json');
  if (!existsSync(metaPath)) throw new Error('No lock_meta.json found — run lock.ts first');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  if (!meta.tapleaf_coop_refund) throw new Error('lock_meta.json missing tapleaf_coop_refund — was this a 3-leaf userLock?');

  // Derive hashlock from the hashlock leaf script (bytes 2..34)
  const hashlockLeafBuf = Buffer.from(meta.tapleaf_hashlock.scriptHex, 'hex');
  const hashlock = hashlockLeafBuf.subarray(2, 34);
  if (hashlock.length !== 32) throw new Error('Could not extract hashlock from leaf script');

  const senderAddr = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;

  console.log('Cooperative refund (recipient-initiated, no timelock required)');
  console.log('  sender (refund to):', senderAddr);

  // Phase 1: Recipient signs
  console.log('\nPhase 1: Recipient signing...');
  const psbtBase64 = await svc.refundUserCooperativeInit(
    {
      txid: meta.txid,
      contractVout: meta.contractVout,
      value: meta.contractValue,
      p2trScriptPubKeyHex: meta.p2trScriptPubKeyHex,
      tapleaf_coop_refund: meta.tapleaf_coop_refund,
    },
    {
      recipient,
      hashlock,
      refundAddress: senderAddr,
    }
  );
  console.log('  Recipient signed PSBT (length:', psbtBase64.length, 'chars)');

  // Phase 2: Sender adds fee inputs and broadcasts
  console.log('\nPhase 2: Sender finalizing...');
  const feeSat = Number(process.env.FEE_SAT) || await svc.estimateFee(180, 'halfHour');
  const feeUtxos = await svc.getUtxos(senderAddr);
  if (!feeUtxos.length) throw new Error(`No fee UTXOs for sender at ${senderAddr}`);

  const result = await svc.refundUserCooperativeFinalize(
    psbtBase64,
    sender,
    feeSat,
    feeUtxos.slice(0, 2)
  );

  console.log('\nCooperative refund TXID:', result.txid);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'coop_refund_meta.json'), JSON.stringify(result, null, 2));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
