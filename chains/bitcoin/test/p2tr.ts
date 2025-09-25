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

  const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: networks.testnet }).address!;
  console.log('Sender address:', senderAddress);

  const utxos = await svc.getUtxos(senderAddress);
  if (!utxos.length) {
    console.error('No UTXOs found for sender. Fund the address and retry.');
    process.exit(1);
  }
  console.log('Available UTXOs:', utxos);

  const amount = Number(process.env.CONVERT_AMOUNT || '1500');

  try {
    const result = await svc.convertP2WPKHtoP2TR(sender, amount, { fee: 440 });
    console.log('Conversion successful!');
    console.log('TXID:', result.txid);
    console.log('P2TR address:', result.contractAddress);
    console.log('Value (sats):', result.value);
    console.log('Internal pubkey hex:', result.internalPubkeyHex);
    console.log('P2TR scriptPubKey hex:', result.p2trScriptPubKeyHex);
  } catch (e) {
    console.error('Conversion failed:', e);
    process.exit(1);
  }

  process.exit(0);
})();
