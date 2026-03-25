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

const SOLVER_PATH = process.env.SOLVER_PATH || "m/84'/1'/0'/0/2";
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

  const solverNode = root.derivePath(SOLVER_PATH);
  if (!solverNode.privateKey) throw new Error('Solver key derivation failed');
  const solver = ECPair.fromPrivateKey(solverNode.privateKey, { network: networks.testnet });

  const outDir = join(__dirname, '../metadata');

  // Load solver lock metadata
  const metaPath = join(outDir, 'solver_lock_meta.json');
  if (!existsSync(metaPath)) throw new Error('No solver_lock_meta.json found — run solverLock.ts first');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  // Extract hashlock from amount hashlock leaf script (bytes 2..34)
  const hashlockLeafBuf = Buffer.from(meta.amountTapleafHashlock.scriptHex, 'hex');
  const hashlock = hashlockLeafBuf.subarray(2, 34);
  if (hashlock.length !== 32) throw new Error('Could not extract hashlock from leaf script');

  const solverAddr = payments.p2wpkh({ pubkey: solver.publicKey, network: networks.testnet }).address!;
  const feeSat = Number(process.env.FEE_SAT) || await svc.estimateFee(250, 'halfHour');
  const feeUtxos = await svc.getUtxos(solverAddr);
  if (!feeUtxos.length) throw new Error(`No fee UTXOs for solver at ${solverAddr}`);

  const amountUtxo = {
    txid: meta.txid,
    contractVout: meta.amountContractVout,
    value: meta.amountValue,
    p2trScriptPubKeyHex: meta.amountP2trScriptPubKeyHex,
    tapleaf_refund: meta.amountTapleafRefund,
  };

  const rewardUtxo = meta.rewardContractAddress ? {
    txid: meta.txid,
    contractVout: meta.rewardContractVout,
    value: meta.rewardValue,
    p2trScriptPubKeyHex: meta.rewardP2trScriptPubKeyHex,
    tapleaf_refund: meta.rewardTapleafRefund,
  } : null;

  console.log('Refunding solver lock (requires CSV timelock to have expired)...');
  console.log('  solver (refund to):', solverAddr);
  console.log('  amount UTXO:', amountUtxo.value, 'sats');
  if (rewardUtxo) console.log('  reward UTXO:', rewardUtxo.value, 'sats');

  const result = await svc.refundSolver(amountUtxo, rewardUtxo, {
    sender: solver,
    hashlock,
    index: meta.index,
    feeSat,
    feeUtxos: feeUtxos.slice(0, 2),
  });

  console.log('\nrefundSolver TXID:', result.txid);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'solver_refund_meta.json'), JSON.stringify(result, null, 2));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
