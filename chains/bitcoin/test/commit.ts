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
import { randomBytes } from 'crypto';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = "m/84'/1'/0'/0/0";
const RECEIVER_PATH = "m/84'/1'/0'/0/1";

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC!;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) {
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
    process.exit(1);
  }
  console.log('UTXOs:', utxosRaw);

  const amount = 1000;
  const fee = 244; //"min relay fee
  console.log(`Locking ${amount} sats (fee: ${fee})`);

  const log: CommitLog = {
    commitId: randomBytes(32),
    timelock: Math.floor(Date.now() / 1000) + 901,
    dstChain: 'ETH',
    dstAddress: 'F6517026847B4c166AAA176fe0C5baD1A245778D',
    dstAsset: 'USDC',
    srcReceiver: 'tb1q7rwthr668lmdgv7v6ty9q47w86ruzesmtq7wkx',
  };

  const memo = svc.encodeCommitLog(log);
  console.log(`OP_RETURN (${memo.length} bytes): ${memo.toString('hex')}`);

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
  } = await svc.commit(sender, srcReceiverPubKey, amount, 901, { fee, data: memo });

  console.log('commit TXID:', txid);
  console.log('P2TR address:', contractAddress);
  console.log('leaf (2-of-2) ASM:', bscript.toASM(Buffer.from(leaf_multisig_hex, 'hex')));
  console.log('leaf (refund) ASM:', bscript.toASM(Buffer.from(leaf_refund_hex, 'hex')));
  console.log('timelock:', timelock, '(unix time)');

  const meta = {
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
    timelock,
    requiredSequence: 0xfffffffe,
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
