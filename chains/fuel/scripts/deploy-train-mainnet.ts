#!/usr/bin/env -S node --require ts-node/register
/**
 * Train-ONLY deterministic deploy for Fuel mainnet. `ConstantPayoutCurve` is deliberately not
 * deployed (the contract accepts `payout_curve: Option::None` and pays the full amount), so
 * this script calls `deployDeterministic('train', ...)` directly instead of `deployAll` —
 * committed deploy tooling stays untouched.
 *
 * Mainnet-guarded: refuses to run unless FUEL_PROVIDER_URL points at Fuel mainnet (Ignition)
 * and FUEL_DEPLOY_PRIVATE_KEY is explicitly set. Idempotent: an existing contract at the
 * predicted ID is reused, no transaction sent.
 *
 * Writes `deployments/mainnet.json` (same shape as deploy.ts's record, with payoutCurve: null).
 *
 * Run: cd chains/fuel && npx ts-node scripts/deploy-train-mainnet.ts
 */
import 'dotenv/config';

import { trainArtifact } from './deploy/artifacts';
import { deployDeterministic } from './deploy/core';
import { connectProvider, networkFileName, networkKindFromUrl, redactProviderUrl, resolveProviderUrl } from './deploy/network';
import { deploySaltSeed, deterministicSalt } from './deploy/salt';
import { captureToolchainVersions } from './deploy/toolchain';
import { resolveWallet } from './lib/funding';

import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  if (!process.env.FUEL_PROVIDER_URL) throw new Error('FUEL_PROVIDER_URL is not set.');
  if (!process.env.FUEL_DEPLOY_PRIVATE_KEY) throw new Error('FUEL_DEPLOY_PRIVATE_KEY is not set.');

  const providerUrl = resolveProviderUrl();
  if (networkKindFromUrl(providerUrl) !== 'mainnet') {
    throw new Error('FUEL_PROVIDER_URL is not Fuel mainnet — this script is mainnet-only; use scripts/deploy.ts elsewhere.');
  }
  const provider = await connectProvider(providerUrl);
  const network = networkFileName(providerUrl);
  const saltSeed = deploySaltSeed();
  console.log(`[deploy-train] network=${network} url=${redactProviderUrl(providerUrl)} saltSeed="${saltSeed}"`);

  const deployer = resolveWallet('FUEL_DEPLOY_PRIVATE_KEY', 'deployer', provider);
  const baseAssetId = await provider.getBaseAssetId();
  const balance = await provider.getBalance(deployer.address, baseAssetId);
  console.log(`[deploy-train] deployer ${deployer.address.toB256()} balance: ${balance.toString()}`);

  const { abi, bytecode } = trainArtifact();
  const train = await deployDeterministic('train', bytecode, abi, deployer, provider, saltSeed);
  console.log(
    `[deploy-train] train: ${train.contractId} (${train.deployed ? `deployed, tx ${train.transactionId}` : 'already deployed, reused'})`,
  );

  const record = {
    network,
    providerUrl,
    saltSeed,
    salts: { train: deterministicSalt('train', saltSeed) },
    train,
    payoutCurve: null, // deliberately not deployed — locks use payout_curve: Option::None
    deployer: deployer.address.toB256(),
    deployedAt: new Date().toISOString(),
    toolchain: captureToolchainVersions(),
  };
  const outPath = path.join(__dirname, '..', 'deployments', `${network}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[deploy-train] wrote ${outPath}`);

  const remaining = await provider.getBalance(deployer.address, baseAssetId);
  console.log(`[deploy-train] deployer balance after: ${remaining.toString()} base units (spent ${balance.sub(remaining).toString()})`);
}

main().catch((err) => {
  console.error('[deploy-train] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
