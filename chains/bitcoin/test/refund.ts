import 'dotenv/config';
import { initEccLib, networks, payments, Psbt } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import axios from 'axios';
import { BitcoinTrain } from '../src/BitcoinTrain';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = "m/84'/1'/0'/0/0";

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC!;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) process.exit(1);

  const metaPath = join(__dirname, '../metadata/commit_meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    txid: string;
    contractVout: number;
    value: number;
    p2trScriptPubKeyHex: string;
    timelock: number;
    tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    refundDestination: { address: string };
    requiredSequence: number;
  };

  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);
  const senderNode = root.derivePath(SENDER_PATH);
  if (!senderNode.privateKey) throw new Error('Key derivation failed');
  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });

  const destAddress =
    meta.refundDestination.address || payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;
  const fee = 150;
  const sendValue = meta.value - fee;
  if (sendValue <= 0) throw new Error('fee too high');

  const psbt = new Psbt({ network: networks.testnet });
  psbt.setLocktime(meta.timelock);
  psbt.addInput({
    hash: meta.txid,
    index: meta.contractVout,
    sequence: meta.requiredSequence ?? 0xfffffffe,
    witnessUtxo: { script: Buffer.from(meta.p2trScriptPubKeyHex, 'hex'), value: meta.value },
    tapLeafScript: [
      {
        leafVersion: meta.tapleaf_refund.leafVersion,
        script: Buffer.from(meta.tapleaf_refund.scriptHex, 'hex'),
        controlBlock: Buffer.from(meta.tapleaf_refund.controlBlockHex, 'hex'),
      },
    ],
  });
  psbt.addOutput({ address: destAddress, value: sendValue });

  psbt.signInput(0, sender);
  psbt.finalizeAllInputs();

  const hex = psbt.extractTransaction().toHex();
  const txid = (await axios.post(`${svc.baseUrl}/api/tx`, hex)).data;

  mkdirSync(join(__dirname, '../metadata'), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(__dirname, `../metadata/refund_result_${ts}.json`),
    JSON.stringify({ txid, hex, fee, sendValue, destAddress }, null, 2)
  );

  console.log('refund txid:', txid);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
