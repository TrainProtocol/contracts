import 'dotenv/config';
import { initEccLib, networks, payments, script, opcodes, Transaction } from 'bitcoinjs-lib';
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

const RECEIVER_PATH = process.env.RECEIVER_PATH || "m/84'/1'/0'/0/0";
const SOLVER_PATH = process.env.SOLVER_PATH || "m/84'/1'/0'/0/1";
const DEFAULT_FEE_SAT = Number(process.env.REDEEM_FEE_SAT || '333') >>> 0;

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

function isHex(s: string) {
  return /^[0-9a-fA-F]+$/.test(s);
}
function parseHex32(s?: string | null) {
  if (!s) return undefined;
  const h = s.replace(/^0x/i, '');
  if (h.length !== 64) return undefined;
  return Buffer.from(h, 'hex');
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC || process.env.MNEMONIC;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC))
    throw new Error('TESTNET3_MNEMONIC (or MNEMONIC) missing/invalid');
  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);

  const receiverNode = root.derivePath(RECEIVER_PATH);
  const solverNode = root.derivePath(SOLVER_PATH);
  if (!receiverNode.privateKey) throw new Error('Receiver key derivation failed');
  if (!solverNode.privateKey) throw new Error('Solver key derivation failed');

  const receiver = ECPair.fromPrivateKey(receiverNode.privateKey, { network: networks.testnet });
  const solver = ECPair.fromPrivateKey(solverNode.privateKey, { network: networks.testnet });

  const receiverAddr = payments.p2wpkh({ pubkey: receiver.publicKey, network: networks.testnet }).address!;
  const solverP2TR = payments.p2tr({
    internalPubkey: svc['toXOnly'](solver.publicKey),
    network: networks.testnet,
  }).address!;
  console.log('Receiver P2WPKH:', receiverAddr);
  console.log('Solver   P2TR  :', solverP2TR);

  const secretHex = (process.env.PAYMENT_SECRET_HEX || '').replace(/^0x/i, '');
  if (secretHex.length !== 64) throw new Error('PAYMENT_SECRET_HEX (32 bytes hex) is required');
  const secret = Buffer.from(secretHex, 'hex');

  const metaPath = join(__dirname, '../metadata/lock_meta.json');
  if (!existsSync(metaPath)) throw new Error('metadata/lock_meta.json not found');
  const j = JSON.parse(readFileSync(metaPath, 'utf8'));

  const prev = {
    txid: String(j.txid),
    contractVout: Number(j.contractVout ?? 0),
    value: Number(j.contractValue),
    p2trScriptPubKeyHex: String(j.p2trScriptPubKeyHex),
    tapleaf_hashlock: {
      leafVersion: Number(j.tapleaf_hashlock.leafVersion),
      scriptHex: String(j.tapleaf_hashlock.scriptHex),
      controlBlockHex: String(j.tapleaf_hashlock.controlBlockHex),
    },
  };
  if (!/^[0-9a-fA-F]{64}$/.test(prev.txid)) throw new Error('prev.txid must be 32B hex');
  if (!Number.isInteger(prev.contractVout) || prev.contractVout < 0) throw new Error('prev.contractVout invalid');
  if (!Number.isInteger(prev.value) || prev.value <= 0) throw new Error('prev.value invalid');
  if (!isHex(prev.p2trScriptPubKeyHex) || prev.p2trScriptPubKeyHex.length % 2)
    throw new Error('p2trScriptPubKeyHex invalid');
  if (!isHex(prev.tapleaf_hashlock.scriptHex) || prev.tapleaf_hashlock.scriptHex.length % 2)
    throw new Error('tapleaf_hashlock.scriptHex invalid');
  if (!isHex(prev.tapleaf_hashlock.controlBlockHex) || prev.tapleaf_hashlock.controlBlockHex.length % 2)
    throw new Error('tapleaf_hashlock.controlBlockHex invalid');

  {
    const leafScript = Buffer.from(prev.tapleaf_hashlock.scriptHex, 'hex');
    const d = script.decompile(leafScript) || [];
    if (
      !(d.length === 5 && d[0] === opcodes.OP_SHA256 && d[2] === opcodes.OP_EQUALVERIFY && d[4] === opcodes.OP_CHECKSIG)
    ) {
      throw new Error('hashlock leaf shape mismatch');
    }
    const xRecvInLeaf = d[3] as Buffer;
    const xRecvFromKey = svc['toXOnly'](receiver.publicKey);
    if (!xRecvFromKey.equals(xRecvInLeaf)) {
      throw new Error(
        `Receiver mismatch in leaf. Expected xOnly=${xRecvInLeaf.toString('hex')}, got ${xRecvFromKey.toString('hex')}. ` +
          `Use the SAME mnemonic+RECEIVER_PATH as when you ran lock.ts`
      );
    }
  }

  const feeSat = DEFAULT_FEE_SAT;

  const commitId = parseHex32(j.lockIdHex);

  if (!commitId) throw new Error('LOCK_ID_HEX  (32B hex) required');

  if (process.env.PAYMENT_HASHLOCK_HEX!) {
    const want = Buffer.from(String(process.env.PAYMENT_HASHLOCK_HEX!).replace(/^0x/i, ''), 'hex');
    if (want.length === 32) {
      const got = createHash('sha256').update(secret).digest();
      if (!got.equals(want)) throw new Error('sha256(secret) does not match params.paymentHashlockHex');
    }
  }

  const psbt = await svc.userRedeemPrepare(
    {
      txid: prev.txid,
      contractVout: prev.contractVout,
      value: prev.value >>> 0,
      p2trScriptPubKeyHex: prev.p2trScriptPubKeyHex,
      tapleaf_hashlock: prev.tapleaf_hashlock,
    },
    { receiver, secret, commitId }
  );

  const outDir = join(__dirname, '../metadata');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'redeem_user_prepare_psbt.txt'), psbt, 'utf8');
  console.log('User PSBT (base64) saved to metadata/redeem_user_prepare_psbt.txt');

  const { txid, hex } = await svc.userRedeemComplete(psbt, solver, feeSat, secret);

  writeFileSync(
    join(outDir, 'redeem_user_complete_meta.json'),
    JSON.stringify(
      {
        redeem: { txid, hex },
        used: {
          feeSat,
          receiverAddr,
          solverP2TR,
          commitIdHex: '0x' + commitId.toString('hex'),
          secretHex: '0x' + secret.toString('hex'),
          source: 'lock',
        },
        createdAt: new Date().toISOString(),
        network: 'testnet',
      },
      null,
      2
    )
  );

  console.log('Broadcast TXID:', txid);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
