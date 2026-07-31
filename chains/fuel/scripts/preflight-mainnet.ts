#!/usr/bin/env -S node --require ts-node/register
/**
 * Read-only mainnet preflight for the Train-only Fuel deploy. Submits nothing.
 *
 *  - asserts FUEL_PROVIDER_URL is set and the connected chain is Ignition (mainnet) —
 *    guards the silent-Sepolia-fallback and wrong-network foot-guns
 *  - asserts FUEL_DEPLOY_PRIVATE_KEY is set (resolveWallet would otherwise silently
 *    generate a throwaway wallet) and prints the deployer address + base-asset balance
 *  - recomputes the deterministic Train contract ID from the local out/debug build and
 *    checks it equals the e2e-verified testnet ID (reproducible-build proof)
 *  - reports whether that ID is already live on mainnet (idempotency probe)
 *
 * Run: cd chains/fuel && npx ts-node scripts/preflight-mainnet.ts
 */
import 'dotenv/config';

import { trainArtifact } from './deploy/artifacts';
import { predictContractId } from './deploy/core';
import { connectProvider, networkKindFromUrl, redactProviderUrl, resolveProviderUrl } from './deploy/network';
import { deploySaltSeed, deterministicSalt } from './deploy/salt';
import { resolveWallet } from './lib/funding';

/** The Train contract ID proven on Fuel Sepolia by the 2026-07-24 e2e run (103 rows, 0
 * failures). Same bytecode + same salt + empty state root MUST predict this exact ID. */
const EXPECTED_TRAIN_ID = '0x445464bf4d8f2ad1cdffefa8345438f6769c44fc4aedf0eb9c2e34f5756f5750';

const MIN_DEPLOYER_BALANCE = 5_000_000; // base units (Fuel ETH, 9 decimals) = 0.005 ETH

async function main(): Promise<void> {
  if (!process.env.FUEL_PROVIDER_URL) {
    throw new Error('FUEL_PROVIDER_URL is not set — refusing (deploy tooling would silently fall back to Sepolia).');
  }
  const providerUrl = resolveProviderUrl();
  const kind = networkKindFromUrl(providerUrl);
  console.log(`[preflight] url=${redactProviderUrl(providerUrl)} kind=${kind}`);
  if (kind !== 'mainnet') throw new Error(`FUEL_PROVIDER_URL is not Fuel mainnet (classified: ${kind}).`);

  const provider = await connectProvider(providerUrl);
  const chain = await provider.getChain();
  console.log(`[preflight] chain name: ${chain.name}`);
  if (!/ignition|mainnet/i.test(chain.name)) throw new Error(`Connected chain "${chain.name}" is not Ignition.`);

  // ── Reproducible-build proof ──
  const saltSeed = deploySaltSeed();
  const salt = deterministicSalt('train', saltSeed);
  const { bytecode } = trainArtifact();
  const predicted = predictContractId(bytecode, salt);
  console.log(`[preflight] salt seed: "${saltSeed}"`);
  console.log(`[preflight] predicted Train ID: ${predicted}`);
  if (predicted.toLowerCase() !== EXPECTED_TRAIN_ID) {
    throw new Error(
      `Predicted ID does not match the e2e-verified testnet ID ${EXPECTED_TRAIN_ID} — ` +
        'local bytecode has drifted from the audited build; do NOT deploy.',
    );
  }
  console.log('[preflight] ✓ matches the e2e-verified testnet ID (bytecode identical to audited build)');

  const existing = await provider.getContract(predicted);
  console.log(`[preflight] already deployed on mainnet: ${existing ? 'yes (deploy would no-op)' : 'no'}`);

  // ── Deployer ──
  if (!process.env.FUEL_DEPLOY_PRIVATE_KEY) {
    throw new Error('FUEL_DEPLOY_PRIVATE_KEY is not set — refusing (deploy tooling would generate a throwaway wallet).');
  }
  const deployer = resolveWallet('FUEL_DEPLOY_PRIVATE_KEY', 'deployer', provider);
  const baseAssetId = await provider.getBaseAssetId();
  const balance = await provider.getBalance(deployer.address, baseAssetId);
  const eth = Number(balance.toString()) / 1e9;
  console.log(`[preflight] deployer: ${deployer.address.toB256()}`);
  console.log(`[preflight] balance:  ${balance.toString()} base units = ${eth} ETH`);
  if (balance.lt(MIN_DEPLOYER_BALANCE)) {
    console.log(`[preflight] ✗ below the 0.005 ETH floor — fund ${(MIN_DEPLOYER_BALANCE - Number(balance)) / 1e9} ETH more`);
    process.exitCode = 1;
  } else {
    console.log('[preflight] ✓ funded above the 0.005 ETH floor — ready to deploy');
  }
}

main().catch((err) => {
  console.error('[preflight] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
