import 'dotenv/config';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { BitcoinTrain } from '../src/BitcoinTrain';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = "m/84'/1'/0'/0/0";
const RECEIVER_PATH = "m/84'/1'/0'/0/1";

const MIN_DELAY_SEC = 900;
const CSV_TYPE_FLAG = 0x00400000; 
const CSV_UNIT_SEC = 512;

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC!;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) process.exit(1);

  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);
  const senderNode = root.derivePath(SENDER_PATH);
  const recvNode = root.derivePath(RECEIVER_PATH);
  if (!senderNode.privateKey || !recvNode.publicKey) throw new Error('Key derivation failed');

  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });
  const receiver = ECPair.fromPrivateKey(senderNode.privateKey ? senderNode.privateKey : randomBytes(32), {
    network: networks.testnet,
  });
  if (typeof (sender as any).signSchnorr !== 'function') throw new Error('sender.signSchnorr missing');

  const srcReceiverPubKey = recvNode.publicKey;
  const senderAddr = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;
  const receiverAddr = payments.p2wpkh({ pubkey: receiver.publicKey, network: networks.testnet }).address!;

  const metaPath = join(__dirname, '../metadata/commit_meta.json');
  if (!existsSync(metaPath)) throw new Error('missing commit_meta.json');
  const commitMeta = JSON.parse(readFileSync(metaPath, 'utf8'));

  const prev = {
    txid: commitMeta.txid as string,
    contractVout: commitMeta.contractVout as number,
    value: Number(commitMeta.value) as number,
    p2trScriptPubKeyHex: commitMeta.p2trScriptPubKeyHex as string,
    tapleaf_multisig: {
      leafVersion: commitMeta.tapleaf_multisig.leafVersion as number,
      scriptHex: commitMeta.tapleaf_multisig.scriptHex as string,
      controlBlockHex: commitMeta.tapleaf_multisig.controlBlockHex as string,
    },
  };

  const feeSat = Number(process.env.ADDLOCK_FEE_SAT || '341') >>> 0;

  const all = await svc.getUtxos(senderAddr);
  const feeUtxos: { hash: string; index: number; value: number }[] = [];
  let acc = 0;
  for (const u of all) {
    if (u.hash === prev.txid && u.index === prev.contractVout) continue;
    feeUtxos.push({ hash: u.hash, index: u.index, value: u.value });
    acc += u.value;
    if (acc >= feeSat) break;
  }
  if (acc < feeSat) throw new Error('insufficient fee inputs');

  const commitIdHexEnv = process.env.COMMIT_ID_HEX;
  const paymentHashlockHexEnv = process.env.PAYMENT_HASHLOCK_HEX;
  const paymentSecretHexEnv = process.env.PAYMENT_SECRET_HEX;

  let commitId: Buffer;
  if (commitIdHexEnv) {
    const h = commitIdHexEnv.replace(/^0x/i, '');
    if (h.length !== 64) throw new Error('COMMIT_ID_HEX must be 32 bytes hex');
    commitId = Buffer.from(h, 'hex');
  } else {
    const raw = commitMeta.commitId;
    if (typeof raw === 'string') {
      const h = raw.replace(/^0x/i, '');
      if (h.length !== 64) throw new Error('commit_meta.commitId must be 32 bytes hex string');
      commitId = Buffer.from(h, 'hex');
    } else if (raw && raw.type === 'Buffer' && Array.isArray(raw.data)) {
      const b = Buffer.from(raw.data);
      if (b.length !== 32) throw new Error('commit_meta.commitId buffer must be 32 bytes');
      commitId = b;
    } else {
      throw new Error('commitId not found in metadata and COMMIT_ID_HEX not provided');
    }
  }

  let paymentHashlockHex: string;
  if (paymentHashlockHexEnv) {
    const h = paymentHashlockHexEnv.replace(/^0x/i, '');
    if (h.length !== 64) throw new Error('PAYMENT_HASHLOCK_HEX must be 32 bytes hex');
    paymentHashlockHex = h;
  } else if (paymentSecretHexEnv) {
    const s = Buffer.from(paymentSecretHexEnv.replace(/^0x/i, ''), 'hex');
    if (s.length !== 32) throw new Error('PAYMENT_SECRET_HEX must be 32 bytes hex');
    paymentHashlockHex = createHash('sha256').update(s).digest('hex');
  } else {
    const secret = randomBytes(32);
    writeFileSync(join(__dirname, '../metadata/payment_secret.hex'), secret.toString('hex'));
    paymentHashlockHex = createHash('sha256').update(secret).digest('hex');
  }

  const requestedDelaySec = Math.max(Number(process.env.ADDLOCK_DELAY_SEC || '1200') >>> 0, MIN_DELAY_SEC);
  const csvUnits = Math.ceil(requestedDelaySec / CSV_UNIT_SEC);
  if (csvUnits > 0xffff) throw new Error(`csvUnits overflow (>65535). requestedDelaySec=${requestedDelaySec}`);
  const csvSequence = CSV_TYPE_FLAG | csvUnits;

  console.log(
    `addLock CSV (time-based): seconds=${requestedDelaySec}, units=${csvUnits}, sequence=0x${csvSequence.toString(16)}`
  );

  const init = await svc.addLockInit(prev, {
    sender,
    srcReceiverPubKey,
    commitId,
    paymentHashlockHex,
    delaySeconds: requestedDelaySec,
    feeSat,
    feeUtxos,
    refundTo: senderAddr,
  });

  const finalized = await svc.addLockFinalize(
    init.psbtBase64,
    ECPair.fromPrivateKey(recvNode.privateKey!, { network: networks.testnet })
  );

  const outDir = join(__dirname, '../metadata');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const out = {
    addLock: {
      txid: finalized.txid,
      hex: finalized.hex,
      memoHex: init.memoHex,
    },
    newContract: init.new,
    params: {
      senderAddr,
      receiverAddr,
      feeSat,
      delaySeconds: requestedDelaySec,
      csv: {
        mode: 'time',
        seconds: requestedDelaySec,
        units: csvUnits,
        sequence: csvSequence,
        unitSeconds: CSV_UNIT_SEC,
        typeFlagHex: '0x' + CSV_TYPE_FLAG.toString(16),
      },
      paymentHashlockHex,
      commitIdHex: commitId.toString('hex'),
    },
    createdAt: new Date().toISOString(),
    network: 'testnet',
  };

  writeFileSync(join(outDir, 'addlock_meta.json'), JSON.stringify(out, null, 2));
  process.stdout.write(`addLock TXID: ${finalized.txid}\n`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
