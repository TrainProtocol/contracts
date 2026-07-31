/**
 * Publishes the canonical (standard) AuthRegistry contract on a fresh Aztec chain.
 *
 * In v5 the AuthRegistry was demoted from a protocol contract to a standard
 * contract. EmbeddedWallet preloads it locally by default, but on a newly-reset
 * rollup its class + standard instance must still be published on-chain before
 * public execution — otherwise every public authwit
 * (set_authorized) call fails with "Contract 0x... is not deployed" until
 * someone does. This script seeds it (idempotent: exits early if published).
 *
 * Usage: AZTEC_ENV=testnet npx tsx publishAuthRegistry.ts
 * Requires DEPLOYER_* keys in .env with a Fee Juice balance.
 */
import dotenv from 'dotenv';
dotenv.config();
import { publishContractClass, publishInstance } from '@aztec/aztec.js/deployment';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { getStandardAuthRegistry } from '@aztec/standard-contracts/auth-registry';
import { setupWallet, toWallet } from './utils/setupWallet.ts';
import { getAztecNodeUrl, getTimeouts } from './utils/config.ts';

const node = createAztecNodeClient(getAztecNodeUrl());
const timeouts = getTimeouts();
// This is the documented standard deployment: salt 1, zero deployer (universal),
// with an address derived from the v5.0.1 AuthRegistry artifact.
const sc = await getStandardAuthRegistry();
const existing = await node.getContract(sc.instance.address);
if (existing) {
  console.log('AuthRegistry already published at', sc.instance.address.toString());
  process.exit(0);
}
const wallet = await setupWallet();
const account = await wallet.createSchnorrAccount(
  Fr.fromString(process.env.DEPLOYER_SECRET!),
  Fr.fromString(process.env.DEPLOYER_SALT!),
  (GrumpkinScalar as any).fromString(process.env.DEPLOYER_SIGNING_KEY!),
);
const existingClass = await node.getContractClass(sc.contractClass.id);
if (existingClass) {
  console.log('AuthRegistry class already published:', sc.contractClass.id.toString());
} else {
  console.log('Publishing AuthRegistry class from deployer', account.address.toString());
  const classTx = await (await publishContractClass(toWallet(wallet), sc.artifact)).send({
    from: account.address,
    wait: { timeout: timeouts.deployTimeout },
  });
  console.log('class published, tx:', classTx.receipt.txHash.toString(), 'block:', Number(classTx.receipt.blockNumber));
}
const instTx = await publishInstance(toWallet(wallet), sc.instance).send({
  from: account.address,
  wait: { timeout: timeouts.deployTimeout },
});
console.log('instance published, tx:', instTx.receipt.txHash.toString(), 'block:', Number(instTx.receipt.blockNumber));
const check = await node.getContract(sc.instance.address);
console.log('on-chain now:', !!check, sc.instance.address.toString());
