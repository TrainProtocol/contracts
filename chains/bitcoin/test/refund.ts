import 'dotenv/config';
import { initEccLib, networks, payments, address } from 'bitcoinjs-lib';
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

const SENDER_PATH = "m/84'/1'/0'/0/1";
const DEFAULT_FEE_SAT = Number(process.env.REFUND_FEE_SAT || '350') >>> 0;

function arg(name: string): string | undefined {
  const k = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(k)) return a.slice(k.length);
    if (a === `--${name}`) return '1';
  }
  return undefined;
}

type PrevCommitShape = {
  txid: string;
  contractVout: number;
  value: number;
  p2trScriptPubKeyHex: string;
  tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
};

function pickStateFile(mode: 'auto' | 'addlock' | 'commit' | 'lock'): string {
  const a = join(__dirname, '../metadata/addlock_meta.json');
  const c = join(__dirname, '../metadata/commit_meta.json');
  const l = join(__dirname, '../metadata/lock_meta.json');
  if (mode === 'addlock' && existsSync(a)) return a;
  if (mode === 'commit' && existsSync(c)) return c;
  if (mode === 'lock' && existsSync(l)) return l;
  if (existsSync(a)) return a;
  if (existsSync(c)) return c;
  if (existsSync(l)) return l;
  throw new Error('no metadata file found');
}

function extractPrev(meta: any): { latestTxid: string; prev: PrevCommitShape } {
  if (meta.addLock && meta.newContract) return { latestTxid: String(meta.addLock.txid), prev: meta.newContract };
  if (meta.txid && meta.tapleaf_refund) {
    return {
      latestTxid: String(meta.txid),
      prev: {
        txid: String(meta.txid),
        contractVout: Number(meta.contractVout),
        value: Number(meta.value ?? meta.contractValue),
        p2trScriptPubKeyHex: String(meta.p2trScriptPubKeyHex),
        tapleaf_refund: {
          leafVersion: Number(meta.tapleaf_refund.leafVersion),
          scriptHex: String(meta.tapleaf_refund.scriptHex),
          controlBlockHex: String(meta.tapleaf_refund.controlBlockHex),
        },
      },
    };
  }
  throw new Error('bad metadata');
}

function extractCommitIdHex(meta: any): string | undefined {
  return arg('commitIdHex') || process.env.COMMIT_ID_HEX || meta.params?.commitIdHex || meta.commitIdHex;
}

function extractDefaultRefundAddress(meta: any): string | undefined {
  return arg('refundAddress') || process.env.REFUND_ADDRESS || meta.refundDestination?.address;
}

(async () => {
  const svc = new (class extends BitcoinTrain {
    constructor() {
      super(networks.testnet);
    }
  })();
  const seed = await bip39.mnemonicToSeed(process.env.TESTNET3_MNEMONIC!);
  const root = bip32.fromSeed(seed, networks.testnet);
  const senderNode = root.derivePath(SENDER_PATH);
  const sender = ECPair.fromPrivateKey(senderNode.privateKey!, { network: networks.testnet });

  const metaMode = (arg('meta') || process.env.META_SOURCE || 'auto').toLowerCase() as any;
  const metaPath = pickStateFile(metaMode);
  const metaJson = JSON.parse(readFileSync(metaPath, 'utf8'));
  const { latestTxid, prev } = extractPrev(metaJson);

  const commitIdHex = extractCommitIdHex(metaJson);
  if (!commitIdHex) throw new Error('missing commitIdHex');
  const commitId = Buffer.from(commitIdHex.replace(/^0x/i, ''), 'hex');

  const refundAddress = extractDefaultRefundAddress(metaJson);
  const refundScriptHex = arg('refundScriptHex') || process.env.REFUND_SCRIPT_HEX;
  const senderP2WPKH = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet });
  const senderAddr = senderP2WPKH.address!;
  const senderOut = senderP2WPKH.output!;
  const refundScript = refundScriptHex
    ? Buffer.from(refundScriptHex, 'hex')
    : refundAddress
      ? address.toOutputScript(refundAddress, networks.testnet)
      : senderOut;

  const allUtxos = await svc.getUtxos(senderAddr);
  const feeSat = DEFAULT_FEE_SAT;
  const feeUtxos: { hash: string; index: number; value: number }[] = [];
  let acc = 0;
  for (const u of allUtxos) {
    if ((u as any).confirmations !== undefined && (u as any).confirmations < 1) continue;
    if (u.hash === latestTxid && u.index === prev.contractVout) continue;
    feeUtxos.push({ hash: u.hash, index: u.index, value: u.value >>> 0 });
    acc += u.value >>> 0;
    if (acc >= feeSat) break;
  }
  if (acc < feeSat) throw new Error('not enough fee inputs');

  if (typeof (svc as any).getTxOut === 'function') {
    const ct = await (svc as any).getTxOut(latestTxid, prev.contractVout);
    if (!ct) throw new Error(`contract utxo missing: ${latestTxid}:${prev.contractVout}`);
    for (const u of feeUtxos) {
      const txo = await (svc as any).getTxOut(u.hash, u.index);
      if (!txo) throw new Error(`fee utxo missing: ${u.hash}:${u.index}`);
    }
  }

  console.log('contract:', { hash: latestTxid, index: prev.contractVout, value: prev.value });
  console.log('fees:', feeUtxos);

  const result = await svc.refund(
    {
      txid: latestTxid,
      contractVout: prev.contractVout,
      value: prev.value,
      p2trScriptPubKeyHex: prev.p2trScriptPubKeyHex,
      tapleaf_refund: prev.tapleaf_refund,
    },
    { sender, commitId, feeSat, feeUtxos, refundAddress, refundScriptHex }
  );

  const outDir = join(__dirname, '../metadata');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = {
    refund: { txid: result.txid, hex: result.hex },
    used: {
      feeSat,
      feeInputs: feeUtxos,
      commitIdHex,
      refundTo: refundScriptHex ? `script:${refundScriptHex}` : refundAddress || senderAddr,
      metaFile: metaPath,
    },
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
