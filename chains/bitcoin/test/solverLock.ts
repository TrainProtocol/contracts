import 'dotenv/config';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes, createHash } from 'crypto';
import { BitcoinTrain } from '../src/BitcoinTrain';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SENDER_PATH = process.env.SOLVER_PATH || "m/84'/1'/0'/0/2";
const RECIPIENT_PATH = process.env.RECIPIENT_PATH || "m/84'/1'/0'/0/0";
const REWARD_RECIPIENT_PATH = process.env.REWARD_RECIPIENT_PATH || "m/84'/1'/0'/0/2";

class TestnetBitcoin extends BitcoinTrain {
  constructor() {
    super('testnet4');
  }
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

(async () => {
  const svc = new TestnetBitcoin();

  const MNEMONIC = process.env.TESTNET3_MNEMONIC || process.env.MNEMONIC;
  if (!MNEMONIC || !bip39.validateMnemonic(MNEMONIC)) {
    throw new Error('TESTNET3_MNEMONIC (or MNEMONIC) missing or invalid');
  }

  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const root = bip32.fromSeed(seed, networks.testnet);

  const senderNode = root.derivePath(SENDER_PATH);
  const recipientNode = root.derivePath(RECIPIENT_PATH);
  const rewardRecipientNode = root.derivePath(REWARD_RECIPIENT_PATH);
  if (!senderNode.privateKey) throw new Error('Sender key derivation failed');

  const sender = ECPair.fromPrivateKey(senderNode.privateKey, { network: networks.testnet });
  const recipientPubKey = recipientNode.publicKey;
  const rewardRecipientPubKey = rewardRecipientNode.publicKey;

  const outDir = join(__dirname, '../metadata');
  ensureDir(outDir);

  const senderP2tr = payments.p2tr({
    internalPubkey: Buffer.from(sender.publicKey.subarray(1, 33)),
    network: networks.testnet,
  });
  console.log('Solver P2TR address:', senderP2tr.address);

  const amount = Number(process.env.SOLVER_AMOUNT_SAT || '600') >>> 0;
  const reward = Number(process.env.SOLVER_REWARD_SAT || '200') >>> 0;
  const fee = Number(process.env.SOLVER_FEE_SAT || '400') >>> 0;
  const timelockDelta = Number(process.env.SOLVER_TIMELOCK_SEC || '1800') >>> 0;
  const rewardTimelockDelta = Number(process.env.SOLVER_REWARD_TIMELOCK_SEC || '900') >>> 0;
  const index = Number(process.env.SOLVER_INDEX || '1') >>> 0;

  let hashlock: Buffer;
  let secretHexForRecord: string | undefined;

  const envHash = process.env.PAYMENT_HASHLOCK_HEX;
  const envSecret = process.env.PAYMENT_SECRET_HEX;

  if (envHash) {
    const h = envHash.replace(/^0x/i, '');
    if (h.length !== 64) throw new Error('PAYMENT_HASHLOCK_HEX must be 32 bytes hex');
    hashlock = Buffer.from(h, 'hex');
  } else if (envSecret) {
    const s = envSecret.replace(/^0x/i, '');
    if (s.length !== 64) throw new Error('PAYMENT_SECRET_HEX must be 32 bytes hex');
    secretHexForRecord = s;
    hashlock = createHash('sha256').update(Buffer.from(s, 'hex')).digest();
  } else {
    const secret = randomBytes(32);
    secretHexForRecord = secret.toString('hex');
    writeFileSync(join(outDir, 'solver_payment_secret.hex'), secretHexForRecord);
    hashlock = createHash('sha256').update(secret).digest();
  }

  const dstChain = process.env.DST_CHAIN || 'ETH';
  const dstToken = process.env.DST_TOKEN || 'USDC';
  const dstAddress = Buffer.alloc(20);
  const dstAmount = BigInt(process.env.DST_AMOUNT || '0');

  console.log('Creating solver lock...');
  console.log('  amount:', amount, 'sats');
  console.log('  reward:', reward, 'sats');
  console.log('  timelockDelta:', timelockDelta, 'sec');
  console.log('  rewardTimelockDelta:', rewardTimelockDelta, 'sec');
  console.log('  hashlock:', hashlock.toString('hex'));

  const res = await svc.solverLock(sender, recipientPubKey, rewardRecipientPubKey, {
    hashlock,
    amount,
    reward,
    timelockDelta,
    rewardTimelockDelta,
    index,
    fee,
  }, {
    dstChain,
    dstAddress,
    dstAmount,
    dstToken,
  });

  console.log('\nsolverLock TXID:', res.txid);
  console.log('Amount UTXO:', res.amountContractAddress, 'vout:', res.amountContractVout, 'value:', res.amountValue);
  if (res.rewardContractAddress) {
    console.log('Reward UTXO:', res.rewardContractAddress, 'vout:', res.rewardContractVout, 'value:', res.rewardValue);
  }

  writeFileSync(join(outDir, 'solver_lock_meta.json'), JSON.stringify(res, null, 2));
  if (secretHexForRecord) {
    console.log('Secret saved to metadata/solver_payment_secret.hex');
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
