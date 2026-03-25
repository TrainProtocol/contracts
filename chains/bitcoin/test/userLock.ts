import 'dotenv/config';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes, createHash } from 'crypto';
import { BitcoinTrain } from '../src/BitcoinTrain';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = process.env.SENDER_PATH || "m/84'/1'/0'/0/1";
const RECEIVER_PATH = process.env.RECEIVER_PATH || "m/84'/1'/0'/0/0";

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super('testnet4');
  }
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
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
  const recvNode = root.derivePath(RECEIVER_PATH);
  if (!senderNode.privateKey || !recvNode.publicKey) throw new Error('Key derivation failed');

  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });
  const recipientPubKey = recvNode.publicKey;

  const outDir = join(__dirname, '../metadata');
  ensureDir(outDir);

  const senderAddr = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;
  const receiverAddr = payments.p2wpkh({ pubkey: recvNode.publicKey, network: networks.testnet }).address!;
  const utxos = await svc.getUtxos(senderAddr);
  if (!utxos.length) throw new Error(`No UTXOs for ${senderAddr}`);

  const amount = Number(process.env.LOCK_AMOUNT_SAT || '817') >>> 0;
  const fee = Number(process.env.LOCK_FEE_SAT || '350') >>> 0;
  const timelockDelta = Number(process.env.LOCK_DELAY_SEC || '1800') >>> 0;

  let hashlock: Buffer | undefined;
  let secretHexForRecord: string | undefined;

  const envHash = process.env.PAYMENT_HASHLOCK_HEX;
  const envSecret = process.env.PAYMENT_SECRET_HEX;

  if (envHash) {
    const h = envHash.replace(/^0x/i, '');
    if (h.length !== 64) throw new Error('PAYMENT_HASHLOCK_HEX must be 32 bytes hex');
    hashlock = Buffer.from(h, 'hex');
  } else if (envSecret) {
    const s = envSecret.replace(/^0x/i, '');
    if (s.length !== 64) throw new Error('PAYMENT_SECRET_HEX must be 32 bytes hex');
    secretHexForRecord = s;
    hashlock = createHash('sha256').update(Buffer.from(s, 'hex')).digest();
  } else {
    const secret = randomBytes(32);
    secretHexForRecord = secret.toString('hex');
    writeFileSync(join(outDir, 'payment_secret.hex'), secretHexForRecord);
    hashlock = createHash('sha256').update(secret).digest();
  }

  const dstChain = (process.env.DST_CHAIN || 'ETH').slice(0, 4);
  const dstAsset = (process.env.DST_ASSET || 'USDC').slice(0, 4);
  const dstAddress = Buffer.alloc(20); // placeholder destination address
  const dstAmount = BigInt(process.env.DST_AMOUNT || '0');

  const res = await svc.userLock(sender, recipientPubKey, {
    hashlock: hashlock!,
    amount,
    timelockDelta,
    fee,
  }, {
    dstChain,
    dstAddress,
    dstAmount,
    dstToken: dstAsset,
  });

  writeFileSync(join(outDir, 'lock_meta.json'), JSON.stringify(res, null, 2));
  process.stdout.write(`lock TXID: ${res.txid}\n`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
