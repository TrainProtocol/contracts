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
  timelock?: number;
  tapleaf_hashlock: { leafVersion: number; scriptHex: string; controlBlockHex: string };
};

type AddLockMetaShape = {
  addLock: { txid: string; hex: string; memoHex?: string };
  newContract: PrevHashlockShape;
  params?: { commitIdHex?: string; paymentHashlockHex?: string };
};

type GenericMetaShape = {
  txid?: string;
  new?: PrevHashlockShape;
  prev?: PrevHashlockShape;
  commitIdHex?: string;
  expectedPaymentHashlockHex?: string;
};

function pickStateFile(): string {
  const try1 = join(__dirname, '../metadata/addlock_meta.json');
  const try2 = join(__dirname, '../metadata/contract_meta.json');
  if (existsSync(try1)) return try1;
  if (existsSync(try2)) return try2;
  throw new Error('No metadata file found (metadata/addlock_meta.json or metadata/contract_meta.json)');
}

function readPrevFromMeta(meta: any): {
  latestTxid: string;
  prev: PrevHashlockShape;
  commitIdHex?: string;
  expectedPaymentHashlockHex?: string;
} {
  if (meta && meta.addLock && meta.newContract && meta.newContract.tapleaf_hashlock) {
    const latestTxid = String(meta.addLock.txid);
    const prev: PrevHashlockShape = meta.newContract as PrevHashlockShape;
    const commitIdHex: string | undefined = meta.params?.commitIdHex || meta.commitIdHex;
    const expectedPaymentHashlockHex: string | undefined =
      meta.params?.paymentHashlockHex || meta.expectedPaymentHashlockHex;
    return { latestTxid, prev, commitIdHex, expectedPaymentHashlockHex };
  }

  const candidate: PrevHashlockShape | undefined = meta?.new?.tapleaf_hashlock
    ? meta.new
    : meta?.prev?.tapleaf_hashlock
      ? meta.prev
      : undefined;

  if (candidate) {
    const latestTxid = String(meta.txid || candidate.txid);
    const commitIdHex: string | undefined = meta.commitIdHex;
    const expectedPaymentHashlockHex: string | undefined = meta.expectedPaymentHashlockHex;
    return { latestTxid, prev: candidate, commitIdHex, expectedPaymentHashlockHex };
  }

  throw new Error('Unrecognized metadata shape: cannot find a tapleaf_hashlock to redeem.');
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC || process.env.MNEMONIC;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) {
    throw new Error('TESTNET3_MNEMONIC (or MNEMONIC) missing or invalid');
  }
  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);

  const receiverNode = root.derivePath(RECEIVER_PATH);
  if (!receiverNode.privateKey) throw new Error('Receiver key derivation failed');
  const receiver = ECPair.fromPrivateKey(receiverNode.privateKey, { network: networks.testnet });

  const metaPath = pickStateFile();
  const metaRaw = readFileSync(metaPath, 'utf8');
  const metaJson = JSON.parse(metaRaw) as AddLockMetaShape | GenericMetaShape;

  const { latestTxid, prev, commitIdHex, expectedPaymentHashlockHex } = readPrevFromMeta(metaJson);

  const commitIdHexEnv = (process.env.COMMIT_ID_HEX || '').replace(/^0x/i, '');
  const commitHex = commitIdHexEnv || commitIdHex || '';
  if (!commitHex || commitHex.length !== 64) {
    throw new Error('Provide 32-byte COMMIT_ID_HEX env or commitIdHex in metadata');
  }
  const commitId = Buffer.from(commitHex, 'hex');

  const secretHexEnv = (process.env.PAYMENT_SECRET_HEX || '').replace(/^0x/i, '');
  if (!secretHexEnv || secretHexEnv.length !== 64) {
    throw new Error('PAYMENT_SECRET_HEX (32 bytes hex) is required');
  }
  const secret = Buffer.from(secretHexEnv, 'hex');

  if (expectedPaymentHashlockHex) {
    const want = Buffer.from(expectedPaymentHashlockHex.replace(/^0x/i, ''), 'hex');
    if (want.length === 32) {
      const got = createHash('sha256').update(secret).digest();
      if (!got.equals(want)) {
        throw new Error('sha256(secret) != expectedPaymentHashlockHex from metadata');
      }
    }
  }

  const receiverAddr = payments.p2wpkh({ pubkey: receiver.publicKey, network: networks.testnet }).address!;
  const allUtxos = await svc.getUtxos(receiverAddr);

  const feeSat = DEFAULT_FEE_SAT;
  const feeUtxos: { hash: string; index: number; value: number }[] = [];
  let acc = 0;
  for (const u of allUtxos) {
    if (u.hash === latestTxid && u.index === prev.contractVout) continue;
    feeUtxos.push({ hash: u.hash, index: u.index, value: u.value });
    acc += u.value;
    if (acc >= feeSat) break;
  }
  if (acc < feeSat) {
    throw new Error(`insufficient fee inputs from ${receiverAddr}: have ${acc}, need ${feeSat}`);
  }

  const result = await svc.redeem(
    {
      txid: latestTxid,
      contractVout: prev.contractVout,
      value: prev.value,
      p2trScriptPubKeyHex: prev.p2trScriptPubKeyHex,
      tapleaf_hashlock: prev.tapleaf_hashlock,
    },
    {
      receiver,
      secret,
      commitId,
      feeSat,
      feeUtxos,
    }
  );

  const outDir = join(__dirname, '../metadata');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = {
    redeem: { txid: result.txid, hex: result.hex },
    used: {
      feeSat,
      feeInputs: feeUtxos,
      receiverAddr,
      commitIdHex: '0x' + commitId.toString('hex'),
      secretHex: '0x' + secret.toString('hex'),
    },
    path: 'hashlock',
    createdAt: new Date().toISOString(),
    network: 'testnet',
  };
  writeFileSync(join(outDir, 'redeem_meta.json'), JSON.stringify(out, null, 2));

  process.stdout.write(`redeem TXID: ${result.txid}\n`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
