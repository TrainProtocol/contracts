import 'dotenv/config';
import { initEccLib, networks, payments, script as bscript } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { join } from 'path';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { BitcoinTrain } from '../src/BitcoinTrain';
import { CommitLog } from '../src';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = "m/84'/1'/0'/0/0";
const RECEIVER_PATH = "m/84'/1'/0'/0/1";

const CSV_TYPE_FLAG = 0x00400000; 
const MIN_DELAY_SEC = 900;
const CSV_UNIT_SEC = 512;

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC!;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) {
    console.error('TESTNET3_MNEMONIC missing/invalid');
    process.exit(1);
  }

  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);

  const senderNode = root.derivePath(SENDER_PATH);
  const recvNode = root.derivePath(RECEIVER_PATH);
  if (!senderNode.privateKey || !recvNode.publicKey) throw new Error('Key derivation failed');

  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });
  const srcReceiverPubKey = recvNode.publicKey;

  const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;
  console.log('Sender:', senderAddress);

  const utxosRaw = await svc.getUtxos(senderAddress);
  if (!utxosRaw.length) {
    console.error('No UTXOs found for sender');
    process.exit(1);
  }
  console.log('UTXOs:', utxosRaw);

  const amount = 1000;
  const fee = 311;

  const requestedDelaySec = Math.max(Number(process.env.COMMIT_DELAY_SEC || '1200'), MIN_DELAY_SEC);
  const csvUnits = Math.ceil(requestedDelaySec / CSV_UNIT_SEC); 
  if (csvUnits > 0xffff) {
    throw new Error(`csvUnits overflow (>65535). requestedDelaySec=${requestedDelaySec}`);
  }
  const csvSequence = CSV_TYPE_FLAG | csvUnits;

  console.log(`Locking ${amount} sats (fee: ${fee})`);
  console.log(
    `CSV (time-based): seconds=${requestedDelaySec}, units=${csvUnits}, sequence=0x${csvSequence.toString(16)}`
  );

  const approxNotBefore = Math.floor(Date.now() / 1000) + csvUnits * CSV_UNIT_SEC;

  const commitIdHex = (process.env.COMMIT_ID_HEX || '').replace(/^0x/i, '');
  if (!commitIdHex || commitIdHex.length !== 64) {
    console.error('COMMIT_ID_HEX must be provided as 32 bytes hex');
    process.exit(1);
  }

  const log: CommitLog = {
    commitId: Buffer.from(commitIdHex, 'hex'),
    timelock: approxNotBefore,
    dstChain: 'ETH',
    dstAddress: 'F6517026847B4c166AAA176fe0C5baD1A245778D',
    dstAsset: 'USDC',
    srcReceiver: 'tb1q7rwthr668lmdgv7v6ty9q47w86ruzesmtq7wkx',
  };

  const {
    txid,
    contractAddress,
    leaf_multisig_hex,
    leaf_refund_hex,
    timelock,
    internalPubkeyHex,
    p2trScriptPubKeyHex,
    contractVout,
    ctrlblock_multisig_hex,
    ctrlblock_refund_hex,
  } = await svc.commit(sender, srcReceiverPubKey, amount, requestedDelaySec, { fee, memo: log });

  console.log('commit TXID:', txid);
  console.log('P2TR address:', contractAddress);
  console.log('leaf (2-of-2) ASM:', bscript.toASM(Buffer.from(leaf_multisig_hex, 'hex')));
  console.log('leaf (refund CSV) ASM:', bscript.toASM(Buffer.from(leaf_refund_hex, 'hex')));
  console.log('timelock (approx):', timelock, '(unix)');
  console.log(`CSV stored: seconds=${requestedDelaySec}, units=${csvUnits}, sequence=0x${csvSequence.toString(16)}`);

  const meta = {
    commitIdHex: '0x' + commitIdHex,
    txid,
    contractVout,
    value: amount,
    contractAddress,
    p2trScriptPubKeyHex,
    tapleaf_refund: {
      leafVersion: 0xc0,
      scriptHex: leaf_refund_hex,
      controlBlockHex: ctrlblock_refund_hex,
    },
    tapleaf_multisig: {
      leafVersion: 0xc0,
      scriptHex: leaf_multisig_hex,
      controlBlockHex: ctrlblock_multisig_hex,
    },

    csv: {
      mode: 'time',
      seconds: requestedDelaySec,
      units: csvUnits,
      sequence: csvSequence,
      unitSeconds: CSV_UNIT_SEC,
      typeFlagHex: '0x' + CSV_TYPE_FLAG.toString(16),
    },

    timelockApproxUnix: timelock, 
    requiredSequence: csvSequence, 
    sighashType: 'DEFAULT',

    refundSignerPubkeyHex: Buffer.from(sender.publicKey).toString('hex'),
    refundDestination: {
      type: 'p2wpkh',
      address: senderAddress,
      network: 'testnet',
    },
    internalPubkeyHex,
    createdAt: new Date().toISOString(),
    network: 'testnet',
  };

  const outDir = join(__dirname, '../metadata');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const outFile = join(outDir, 'commit_meta.json');
  writeFileSync(outFile, JSON.stringify(meta, null, 2));
  console.log('wrote commit_meta.json');

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
