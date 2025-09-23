import 'dotenv/config';
import { initEccLib, networks, payments, script as bscript, Psbt, Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { BitcoinTrain } from '../src/BitcoinTrain';

initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = "m/84'/1'/0'/0/0";
const RECEIVER_PATH = "m/84'/1'/0'/0/1";

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super('testnet4');
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

  const keypair = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });
  const senderAddress = payments.p2wpkh({ pubkey: keypair.publicKey, network: networks.testnet }).address!;
  const receiveAddress = payments.p2wpkh({ pubkey: recvNode.publicKey, network: networks.testnet }).address!;

  const utxos = await svc.getUtxos(senderAddress);
  if (!utxos?.length) {
    console.error('No UTXOs found for sender');
    process.exit(1);
  }

  const FIXED_FEE = 350; 
  const SEND_TO_SELF = 1000; 

  let totalIn = 0;
  const selected: typeof utxos = [];
  for (const u of utxos.sort((a: any, b: any) => b.value - a.value)) {
    selected.push(u);
    totalIn += u.value;
    if (totalIn >= SEND_TO_SELF + FIXED_FEE) break;
  }

  if (totalIn < SEND_TO_SELF + FIXED_FEE) {
    console.error(`Insufficient funds: need at least ${SEND_TO_SELF + FIXED_FEE} sats`);
    process.exit(1);
  }

  const opretDatas = [
    Buffer.from(process.env.OPRET1 || 'deadbeefcafebabe', 'hex'),
    Buffer.from(process.env.OPRET2 || 'a1a2a3a4a5a6a7a8', 'hex'),
    Buffer.from(process.env.OPRET3 || 'ffffffff00000000', 'hex'),
  ];

  const buildTx = (changeValue: number) => {
    const psbt = new Psbt({ network: networks.testnet });

    for (const u of selected) {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        witnessUtxo: {
          script: payments.p2wpkh({ pubkey: keypair.publicKey, network: networks.testnet }).output!,
          value: u.value,
        },
      });
    }

    psbt.addOutput({ address: receiveAddress, value: SEND_TO_SELF });

    for (const d of opretDatas) {
      const embed = payments.embed({ data: [d] }).output!;
      psbt.addOutput({ script: embed, value: 0 });
    }

    if (changeValue > 0) {
      psbt.addOutput({ address: senderAddress, value: changeValue });
    }

    psbt.signAllInputs(keypair);
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction() as Transaction;
    return { psbt, tx };
  };

  const change = totalIn - SEND_TO_SELF - FIXED_FEE;
  if (change < 0) {
    console.error('Negative change after fee/subtract — aborting');
    process.exit(1);
  }

  const { tx } = buildTx(change);
  const rawHex = tx.toHex();
  const txid = tx.getId();

  try {
    const res =
      (await (svc as any).broadcast?.(rawHex)) ??
      (await (svc as any).broadcastTx?.(rawHex)) ??
      (await (svc as any).sendRawTransaction?.(rawHex));
    console.log('Broadcast result:', res ?? 'sent');
  } catch (e) {
    console.warn('Broadcast failed (continuing):', (e as any).message || e);
  }

  console.log('TXID:', txid);
  console.log('Raw TX:', rawHex);
  console.log('Sent to (p2wpkh):', receiveAddress, 'sats:', SEND_TO_SELF);
  console.log('Fixed fee (sats):', FIXED_FEE);
  console.log('Change back to sender (sats):', change);
  console.log('OP_RETURN 1:', opretDatas[0].toString('hex'));
  console.log('OP_RETURN 2:', opretDatas[1].toString('hex'));
  console.log('OP_RETURN 3:', opretDatas[2].toString('hex'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
