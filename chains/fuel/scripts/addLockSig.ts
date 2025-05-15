import {
  Provider,
  Wallet,
  Contract,
  Address,
  DateTime,
  sha256,
  concat,
  BigNumberCoder,
  B256Coder,
  StringCoder,
  bn,
  arrayify,
  hashMessage,
  Signer,
  toUtf8Bytes,
  hexlify,
  BytesLike,
  HashableMessage,
} from 'fuels';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config();

interface FuelError extends Error {
  metadata?: {
    logs?: any[];
    receipts?: any[];
    panic?: boolean;
    revert?: boolean;
    reason?: string;
  };
  code?: string;
  rawError?: any;
}

async function addLockSig() {
  // ────────────────────────────────
  const provider = new Provider(process.env.PROVIDER!);

  const signer = Wallet.fromMnemonic(process.env.MNEMONIC!);
  signer.connect(provider);

  const sender = Wallet.fromMnemonic(process.env.MNEMONIC2!);
  sender.connect(provider);

  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, '../out/release/fuel-abi.json'), 'utf8'));
  const contract = new Contract(Address.fromB256(process.env.CONTRACT!), abi, sender);

  // ────────────────────────────────
  const Id = bn(process.env.ID1!);
  const hashlock = process.env.HASHLOCK!;
  const timelock = DateTime.fromUnixSeconds(Math.floor(Date.now() / 1000) + 1000).toTai64();

  const idBytes = new BigNumberCoder('u256').encode(Id);
  const hashlockBytes = new B256Coder().encode(hashlock);
  const timelockBytes = new BigNumberCoder('u64').encode(bn(timelock));

  // ─── 3) First SHA256: sha256(encode(Id)||encode(hashlock)||encode(timelock)) ─
  const rawData = concat([idBytes, hashlockBytes, timelockBytes]);
  const message = arrayify(sha256(rawData));

  // // ─── 4) Build the ABI-encoded prefix + message, then sign with signMessage ──
  const signature: string = await signer.signMessage({personalSign: message});

  const MESSAGE_PREFIX = '\x19Fuel Signed Message:\n';
  const payloadPrefixed = concat([toUtf8Bytes(MESSAGE_PREFIX), toUtf8Bytes(String(message.length)), message]);
  console.log(
    'toUtf8Bytes(MESSAGE_PREFIX), toUtf8Bytes(String(message.length)): ',
    concat([toUtf8Bytes(MESSAGE_PREFIX), toUtf8Bytes(String(message.length))])
  );
  console.log(
    'concat([toUtf8Bytes(MESSAGE_PREFIX), toUtf8Bytes(String(message.length)), message]): ',
    concat([toUtf8Bytes(MESSAGE_PREFIX), toUtf8Bytes(String(message.length)), message])
  );
  const signedPrefixedHashedMimic = hexlify(sha256(payloadPrefixed));
  const signedPrefixedHashed = hashMessage({personalSign: message});
  // console.log('signedPrefixedHashedMimic: ', signedPrefixedHashedMimic);
  console.log('signedPrefixedHashed: ', signedPrefixedHashed);
  const recoveredAddress: Address = Signer.recoverAddress(signedPrefixedHashed, signature);
  console.log('off chain signature is valid ? : ', recoveredAddress.toString() === signer.address.toString());

  // ─── 5) Call your contract function ────────────────────────────────────────
  try {
    const { transactionId, waitForResult } = await contract.functions
      .add_lock_sig(signature, Id, hashlock, bn(timelock))
      .call();

    console.log('TxId:', transactionId);
    const { logs } = await waitForResult();
    logs.forEach((l) => console.log('Log:', l));
  } catch (err) {
    const fuelError = err as FuelError;
    console.error('add_lock_sig failed:', fuelError.message || fuelError);

    if (fuelError.metadata?.logs) {
      console.log('Contract logs:');
      fuelError.metadata.logs.forEach((log, i) => console.log(`Log ${i}:`, log));
    }
  }
}

addLockSig().catch((err) => {
  console.error('Unhandled error:', err);
});
