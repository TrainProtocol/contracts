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
  if (!senderNode.privateKey) throw new Error('Sender key derivation failed');
  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });
  const senderAddr = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;

  const outDir = join(__dirname, '../metadata');

  // Load lock metadata
  const metaPath = join(outDir, 'lock_meta.json');
  if (!existsSync(metaPath)) throw new Error('No lock_meta.json found — run userLock.ts first');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  // Extract hashlock from the hashlock leaf script (bytes 2..34 after OP_SHA256 push)
  const hashlockLeafBuf = Buffer.from(meta.tapleaf_hashlock.scriptHex, 'hex');
  const hashlock = hashlockLeafBuf.subarray(2, 34);
  if (hashlock.length !== 32) throw new Error('Could not extract hashlock from leaf script');

  const refundAddress = process.env.REFUND_ADDRESS || senderAddr;

  // Get fee UTXOs
  const allUtxos = await svc.getUtxos(senderAddr);
  const feeUtxos = allUtxos
    .filter((u) => !(u.hash === meta.txid && u.index === meta.contractVout))
    .slice(0, 2);
  if (!feeUtxos.length) throw new Error(`No fee UTXOs for sender at ${senderAddr}`);

  const feeSat = Number(process.env.FEE_SAT) || await svc.estimateFee(180, 'halfHour');

  console.log('Refunding user lock (CSV timelock must have expired)...');
  console.log('  lock txid:', meta.txid);
  console.log('  sender (refund to):', refundAddress);
  console.log('  fee:', feeSat, 'sats (estimated)');

  const result = await svc.refundUser(
    {
      txid: meta.txid,
      contractVout: meta.contractVout,
      value: meta.contractValue,
      p2trScriptPubKeyHex: meta.p2trScriptPubKeyHex,
      tapleaf_refund: meta.tapleaf_refund,
    },
    { sender, hashlock, feeSat, feeUtxos, refundAddress }
  );

  console.log('\nrefundUser TXID:', result.txid);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'refund_user_meta.json'),
    JSON.stringify({ ...result, refundAddress, createdAt: new Date().toISOString() }, null, 2)
  );

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
