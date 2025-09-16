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

const SENDER_PATH = "m/84'/1'/0'/0/0";
const DEFAULT_FEE_SAT = Number(process.env.REFUND_FEE_SAT || '311') >>> 0;

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

type PrevCommitShape = {
  txid: string;
  contractVout: number;
  value: number;
  p2trScriptPubKeyHex: string;
  tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
  csvDelayBlocks?: number;
};

type AddLockMetaShape = {
  addLock: { txid: string; hex: string; memoHex?: string };
  newContract: PrevCommitShape;
  params?: { commitIdHex?: string; csvDelayBlocks?: number };
};

type CommitMetaShape = PrevCommitShape & {
  commitIdHex?: string;
};

function pickStateFile(): string {
  const try1 = join(__dirname, '../metadata/commit_meta.json');
  const try2 = join(__dirname, '../metadata/addlock_meta.json');
  if (existsSync(try1)) return try1;
  if (existsSync(try2)) return try2;
  throw new Error('No metadata state file found (metadata/addlock_meta.json or metadata/commit_meta.json)');
}

function readPrevFromMeta(meta: any): { txid: string; prev: PrevCommitShape; commitIdHex?: string } {
  if (meta && meta.addLock && meta.newContract && meta.newContract.tapleaf_refund) {
    const txid = String(meta.addLock.txid);
    const prev: PrevCommitShape = meta.newContract as PrevCommitShape;
    const commitIdHex: string | undefined = meta.params?.commitIdHex || meta.commitIdHex;
    return { txid, prev, commitIdHex };
  }

  if (meta && meta.txid && meta.tapleaf_refund) {
    const txid = String(meta.txid);
    const prev: PrevCommitShape = {
      txid: meta.txid,
      contractVout: Number(meta.contractVout),
      value: Number(meta.value),
      p2trScriptPubKeyHex: String(meta.p2trScriptPubKeyHex),
      tapleaf_refund: {
        leafVersion: Number(meta.tapleaf_refund.leafVersion),
        scriptHex: String(meta.tapleaf_refund.scriptHex),
        controlBlockHex: String(meta.tapleaf_refund.controlBlockHex),
      },
      csvDelayBlocks: meta.csvDelayBlocks ? Number(meta.csvDelayBlocks) : undefined,
    };
    const commitIdHex: string | undefined = meta.commitIdHex;
    return { txid, prev, commitIdHex };
  }

  throw new Error('Unrecognized metadata shape: cannot find refund leaf');
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC!;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) {
    throw new Error('TESTNET3_MNEMONIC missing or invalid');
  }
  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);
  const senderNode = root.derivePath(SENDER_PATH);
  if (!senderNode.privateKey) throw new Error('Key derivation failed');
  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });

  const metaPath = pickStateFile();
  const metaRaw = readFileSync(metaPath, 'utf8');
  const metaJson = JSON.parse(metaRaw) as AddLockMetaShape | CommitMetaShape | any;
  const { txid: latestTxid, prev, commitIdHex } = readPrevFromMeta(metaJson);

  let commitId: Buffer;
  if (commitIdHex) {
    const h = commitIdHex.replace(/^0x/i, '');
    if (h.length !== 64) throw new Error('commitIdHex in metadata must be 32 bytes hex');
    commitId = Buffer.from(h, 'hex');
  } else {
    throw new Error('commitIdHex missing in metadata (needed for OP_RETURN)');
  }

  const senderAddr = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;
  const allUtxos = await svc.getUtxos(senderAddr);

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
    throw new Error(`insufficient fee inputs from ${senderAddr}: have ${acc}, need ${feeSat}`);
  }

  const result = await svc.refund(
    {
      txid: latestTxid,
      contractVout: prev.contractVout,
      value: prev.value,
      p2trScriptPubKeyHex: prev.p2trScriptPubKeyHex,
      tapleaf_refund: prev.tapleaf_refund,
    },
    {
      sender,
      commitId,
      feeSat,
      feeUtxos,
    }
  );

  const outDir = join(__dirname, '../metadata');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = {
    refund: { txid: result.txid, hex: result.hex },
    used: {
      feeSat,
      feeInputs: feeUtxos,
      commitIdHex: '0x' + commitId.toString('hex'),
      refundTo: senderAddr,
    },
    path: 'refund_csv',
    csvDelayBlocks: prev.csvDelayBlocks ?? null,
    createdAt: new Date().toISOString(),
    network: 'testnet',
  };
  writeFileSync(join(outDir, 'refund_meta.json'), JSON.stringify(out, null, 2));

  process.stdout.write(`refund TXID: ${result.txid}\n`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
