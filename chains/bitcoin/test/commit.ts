import 'dotenv/config';
import { initEccLib, networks, payments, script as bscript } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import { BitcoinTrain } from '../src/BitcoinTrain';
import * as bip39 from 'bip39';

// Factories
const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

// Path for 2nd wallet (testnet, BIP84)
const SECOND_WALLET_PATH = "m/84'/1'/0'/0/1";

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super(networks.testnet);
  }
}

(async () => {
  const svc = new TestnetBitcoin();

  // 1. Load mnemonic
  const MNEMONIC = process.env.TESTNET3_MNEMONIC!;
  if (!bip39.validateMnemonic(MNEMONIC)) {
    console.error('❌ Invalid mnemonic; set TESTNET3_MNEMONIC.');
    process.exit(1);
  }

  // 2. Derive key
  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);
  const child = root.derivePath(SECOND_WALLET_PATH);
  if (!child.privateKey) throw new Error('Failed to derive private key');
  const keyPair = ECPair.fromPrivateKey(child.privateKey, { network: networks.testnet });

  // 3. Get address and UTXOs
  const senderAddress = payments.p2wpkh({ pubkey: keyPair.publicKey, network: networks.testnet }).address!;
  console.log('🔑 Address:', senderAddress);

  const utxosRaw = (await svc.getUtxos(senderAddress)) as Array<{
    hash: string;
    index: number;
    value: number;
  }>;

  const utxos = utxosRaw.map((u) => ({
    txid: u.hash,
    vout: u.index,
    value: u.value,
  }));

  if (utxos.length === 0) {
    console.error('❌ No UTXOs; fund via a Testnet faucet.');
    process.exit(1);
  }
  console.log('🔎 UTXOs:', utxos);

  const total = utxos.reduce((sum, u) => sum + u.value, 0);
  const fee = 1_000;
  const lockAmount = total - fee;
  const timelock = Math.floor(Date.now() / 1000) + 3600; // +1h
  console.log(`🔒 Locking ${lockAmount} sats until ${timelock}`);

  // 4. Dummy inner script (replace with your real script hex)
  const innerHex = '51'; // OP_TRUE

  // 5. Commit to Taproot (script-path)
  const {
    txid,
    contractAddress,
    preHtlcScript,
    htlc_wshash,
    timelock: returnedTimelock,
  } = await svc.commit(keyPair, innerHex, lockAmount, timelock, { fee });

  console.log('✅ commit TXID:', txid);
  console.log('📫 P2TR address:', contractAddress);
  console.log('📜 script1 hex:', preHtlcScript);
  console.log('🖋 script1 ASM:', bscript.toASM(Buffer.from(preHtlcScript, 'hex')));
  console.log('🔑 wshash:', htlc_wshash);
  console.log('⏰ timelock:', returnedTimelock);

  process.exit(0);
})();
