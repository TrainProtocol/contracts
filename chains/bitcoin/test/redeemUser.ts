import 'dotenv/config';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { BitcoinTrain } from '../src/BitcoinTrain';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const RECIPIENT_PATH = process.env.RECEIVER_PATH || "m/84'/1'/0'/0/0";

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

  const recipientNode = root.derivePath(RECIPIENT_PATH);
  if (!recipientNode.privateKey) throw new Error('Recipient key derivation failed');
  const recipient = ECPair.fromPrivateKey(recipientNode.privateKey, { network: networks.testnet });
  const recipientAddr = payments.p2wpkh({ pubkey: recipient.publicKey, network: networks.testnet }).address!;

  const outDir = join(__dirname, '../metadata');

  // Load lock metadata
  const metaPath = join(outDir, 'lock_meta.json');
  if (!existsSync(metaPath)) throw new Error('No lock_meta.json found — run userLock.ts first');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  // Load secret
  let secretHex = process.env.PAYMENT_SECRET_HEX;
  if (!secretHex) {
    const secretPath = join(outDir, 'payment_secret.hex');
    if (existsSync(secretPath)) secretHex = readFileSync(secretPath, 'utf8').trim();
  }
  if (!secretHex) throw new Error('Secret required: PAYMENT_SECRET_HEX env or metadata/payment_secret.hex');

  const secret = Buffer.from(secretHex.replace(/^0x/i, ''), 'hex');
  if (secret.length !== 32) throw new Error('Secret must be 32 bytes');

  const hashlock = createHash('sha256').update(secret).digest();

  // Get fee UTXOs from recipient's P2WPKH
  const allUtxos = await svc.getUtxos(recipientAddr);
  const feeUtxos = allUtxos
    .filter((u) => !(u.hash === meta.txid && u.index === meta.contractVout))
    .slice(0, 2);
  if (!feeUtxos.length) throw new Error(`No fee UTXOs for recipient at ${recipientAddr}`);

  const feeSat = Number(process.env.FEE_SAT) || await svc.estimateFee(180, 'fastest');

  console.log('Redeeming user lock...');
  console.log('  lock txid:', meta.txid);
  console.log('  recipient:', recipientAddr);
  console.log('  fee:', feeSat, 'sats (estimated)');

  const result = await svc.redeemUser(
    {
      txid: meta.txid,
      contractVout: meta.contractVout,
      value: meta.contractValue,
      p2trScriptPubKeyHex: meta.p2trScriptPubKeyHex,
      tapleaf_hashlock: meta.tapleaf_hashlock,
    },
    { recipient, secret, hashlock, feeSat, feeUtxos }
  );

  console.log('\nredeemUser TXID:', result.txid);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'redeem_user_meta.json'),
    JSON.stringify({
      ...result,
      secretHex: secret.toString('hex'),
      hashlockHex: hashlock.toString('hex'),
      recipientAddr,
      createdAt: new Date().toISOString(),
    }, null, 2)
  );

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
