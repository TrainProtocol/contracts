import 'dotenv/config';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { BitcoinTrain } from '../src/BitcoinTrain';

initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);
const SENDER_PATH = "m/84'/1'/0'/0/1";

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
  if (!senderNode.privateKey) throw new Error('Key derivation failed');
  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });

  const xOnly = Buffer.from(sender.publicKey).subarray(1, 33);
  const p2trAddr = payments.p2tr({ internalPubkey: xOnly, network: networks.testnet }).address!;
  console.log('P2TR address (source):', p2trAddr);

  const p2trUtxos = await svc.getUtxos(p2trAddr);
  if (!p2trUtxos.length) {
    console.error('No P2TR UTXOs found. Fund/convert first and retry.');
    process.exit(1);
  }
  console.log('Available P2TR UTXOs:', p2trUtxos);

  const fee = Number(process.env.CONVERT_BACK_FEE || '311');

  try {
    const res = await svc.convertP2TRtoP2WPKH(sender, { fee });
    console.log('Conversion successful');
    console.log('TXID:', res.txid);
    console.log('Dest P2WPKH:', res.toAddress);
    console.log('Value (sats):', res.value);
    console.log('Vout:', res.vout);
  } catch (e) {
    console.error('Conversion failed:', e);
    process.exit(1);
  }

  process.exit(0);
})();
