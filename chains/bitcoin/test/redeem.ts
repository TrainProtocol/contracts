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

const RECEIVER_PATH = process.env.RECEIVER_PATH || "m/84'/1'/0'/0/1";
const DEFAULT_FEE_SAT = Number(process.env.REDEEM_FEE_SAT || '333') >>> 0;

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

type PrevHashlockShape = {
  txid: string;
  contractVout: number;
  value: number;
  p2trScriptPubKeyHex: string;
  tapleaf_hashlock: { leafVersion: number; scriptHex: string; controlBlockHex: string };
};

type LockMeta = {
  addLock: { txid: string; csvDelaySeconds: number };
  newContract: {
    address: string;
    value: number;
    contractVout: number;
    p2trScriptPubKeyHex: string;
    internalPubkeyHex: string;
    tapleaf_hashlock: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
  };
  params?: { lockIdHex?: string; paymentHashlockHex?: string };
};

function parseHex32(s?: string | null) {
  if (!s) return undefined;
  const h = s.replace(/^0x/i, '');
  if (h.length !== 64) return undefined;
  return Buffer.from(h, 'hex');
}
function isHex(str: string) {
  return /^[0-9a-fA-F]+$/.test(str);
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC || process.env.MNEMONIC;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC))
    throw new Error('TESTNET3_MNEMONIC (or MNEMONIC) missing/invalid');
  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = BIP32Factory(ecc).fromSeed(seed, networks.testnet);

  const receiverNode = root.derivePath(RECEIVER_PATH);
  if (!receiverNode.privateKey) throw new Error('Receiver key derivation failed');
  const receiver = ECPair.fromPrivateKey(receiverNode.privateKey, { network: networks.testnet });
  const receiverAddr = payments.p2wpkh({ pubkey: receiver.publicKey, network: networks.testnet }).address!;

  const secretHex = (process.env.PAYMENT_SECRET_HEX || '').replace(/^0x/i, '');
  if (secretHex.length !== 64) throw new Error('PAYMENT_SECRET_HEX (32 bytes hex) is required');
  const secret = Buffer.from(secretHex, 'hex');

  const lockPath = join(__dirname, '../metadata/addlock_meta.json');
  if (!existsSync(lockPath)) throw new Error('addlock_meta.json not found');

  const j = JSON.parse(readFileSync(lockPath, 'utf8')) as LockMeta;

  if (
    !j?.addLock?.txid ||
    !j?.newContract?.p2trScriptPubKeyHex ||
    !j?.newContract?.tapleaf_hashlock?.scriptHex ||
    !j?.newContract?.tapleaf_hashlock?.controlBlockHex
  ) {
    throw new Error('addlock_meta.json missing required fields');
  }

  const prev: PrevHashlockShape = {
    txid: String(j.addLock.txid),
    contractVout: Number(j.newContract.contractVout),
    value: Number(j.newContract.value),
    p2trScriptPubKeyHex: String(j.newContract.p2trScriptPubKeyHex),
    tapleaf_hashlock: {
      leafVersion: Number(j.newContract.tapleaf_hashlock.leafVersion),
      scriptHex: String(j.newContract.tapleaf_hashlock.scriptHex),
      controlBlockHex: String(j.newContract.tapleaf_hashlock.controlBlockHex),
    },
  };

  if (!/^[0-9a-fA-F]{64}$/.test(prev.txid)) throw new Error('prev.txid must be 32-byte hex');
  if (!Number.isInteger(prev.contractVout) || prev.contractVout < 0) throw new Error('prev.contractVout invalid');
  if (!Number.isInteger(prev.value) || prev.value <= 0) throw new Error('prev.value invalid');
  if (!isHex(prev.p2trScriptPubKeyHex) || prev.p2trScriptPubKeyHex.length % 2)
    throw new Error('p2trScriptPubKeyHex invalid');
  if (!isHex(prev.tapleaf_hashlock.scriptHex) || prev.tapleaf_hashlock.scriptHex.length % 2)
    throw new Error('tapleaf_hashlock.scriptHex invalid');
  if (!isHex(prev.tapleaf_hashlock.controlBlockHex) || prev.tapleaf_hashlock.controlBlockHex.length % 2)
    throw new Error('tapleaf_hashlock.controlBlockHex invalid');

  const feeSat = DEFAULT_FEE_SAT;
  const commitIdEnv = parseHex32(process.env.LOCK_ID_HEX || process.env.COMMIT_ID_HEX || j.params?.lockIdHex || null);
  if (!commitIdEnv) throw new Error('LOCK_ID_HEX (or COMMIT_ID_HEX) required (32B hex)');

  const wantHash = j.params?.paymentHashlockHex
    ? Buffer.from(j.params.paymentHashlockHex.replace(/^0x/i, ''), 'hex')
    : undefined;
  if (wantHash && wantHash.length === 32) {
    const got = createHash('sha256').update(secret).digest();
    if (!got.equals(wantHash)) throw new Error('sha256(secret) != expected paymentHashlockHex in addlock_meta.json');
  }

  const allUtxosRaw = await svc.getUtxos(receiverAddr);
  const allUtxos = allUtxosRaw.filter(
    (u: any) =>
      typeof u?.hash === 'string' &&
      /^[0-9a-fA-F]{64}$/.test(u.hash) &&
      Number.isInteger(u?.index) &&
      Number.isFinite(u?.value)
  );

  const feeUtxos: { hash: string; index: number; value: number }[] = [];
  let acc = 0;
  for (const u of allUtxos) {
    if (u.hash === prev.txid && u.index === prev.contractVout) continue;
    feeUtxos.push({ hash: u.hash, index: u.index, value: u.value >>> 0 });
    acc += u.value >>> 0;
    if (acc >= feeSat) break;
  }
  if (acc < feeSat) throw new Error(`insufficient fee inputs from ${receiverAddr}: have ${acc}, need ${feeSat}`);

  const { txid, hex } = await svc.redeemSolver(
    {
      txid: prev.txid,
      contractVout: prev.contractVout,
      value: prev.value >>> 0,
      p2trScriptPubKeyHex: prev.p2trScriptPubKeyHex,
      tapleaf_hashlock: prev.tapleaf_hashlock,
    },
    { receiver, secret, commitId: commitIdEnv, feeSat, feeUtxos }
  );

  const outDir = join(__dirname, '../metadata');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = {
    redeem: { txid, hex },
    used: {
      feeSat,
      receiverAddr,
      commitIdHex: '0x' + commitIdEnv.toString('hex'),
      secretHex: '0x' + secret.toString('hex'),
      source: 'lock',
    },
    createdAt: new Date().toISOString(),
    network: 'testnet',
  };
  writeFileSync(join(outDir, 'redeem_meta.json'), JSON.stringify(out, null, 2));
  process.stdout.write(`redeem TXID: ${txid}\n`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
