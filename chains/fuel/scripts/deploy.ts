#!/usr/bin/env -S npx tsx
/**
 * Deterministic, idempotent deployment CLI for the Fuel/Sway "Train" HTLC port.
 *
 * Deploys `train` + `payout_curve` with a fixed, documented salt (see `deploy/salt.ts`). Safe to
 * re-run against the same network any number of times -- an already-deployed `train`/`payout_curve`
 * (same bytecode + salt + empty initial storage) is detected via `Provider.getContract` and
 * reused rather than redeployed.
 *
 * The SAME script targets Fuel Sepolia or a local `fuel-core` node purely via `FUEL_PROVIDER_URL`
 * -- see `deploy/network.ts`.
 *
 * Usage:
 *   cd chains/fuel && npx tsx scripts/deploy.ts
 *
 * Env:
 *   FUEL_PROVIDER_URL        GraphQL endpoint (default: Fuel Sepolia).
 *   FUEL_DEPLOY_PRIVATE_KEY  Deployer's private key. If unset, a fresh wallet is generated and
 *                            printed -- only needed if `train`/`payout_curve` are not already
 *                            deployed on the target network (a fully-idempotent re-run against
 *                            an already-deployed network needs no funds at all).
 *   FUEL_DEPLOY_SALT_SEED    Overrides the deterministic-deploy salt seed (default: see
 *                            `deploy/salt.ts`'s `DEFAULT_DEPLOY_SALT_SEED`).
 *
 * Writes `chains/fuel/deployments/<network>.json` (gitignored -- a per-run scratch artifact; the
 * hand-maintained `chains/fuel/DEPLOYMENTS.md` is sourced from this file, keeping the raw
 * machine-written record separate from the curated, hand-written one).
 */
import 'dotenv/config';

import { deployAll } from './deploy/core';
import { requireFunded, resolveWallet } from './lib/funding';
import { connectProvider, networkFileName, redactProviderUrl, resolveProviderUrl } from './deploy/network';
import { saveDeployment, type DeploymentRecord } from './deploy/persist';
import { deploySaltSeed, deterministicSalt } from './deploy/salt';
import { captureToolchainVersions } from './deploy/toolchain';

/** Generous flat minimum for deploying two small contracts (`train` + `payout_curve`) -- well
 * above realistic gas cost, deliberately not fine-tuned, since this only gates a clear
 * "go fund this address" error rather than gas estimation itself (the SDK's own
 * `ContractFactory.deploy` does the real gas estimation). */
const MIN_DEPLOYER_BALANCE = 5_000_000;

export async function main(): Promise<DeploymentRecord> {
  const providerUrl = resolveProviderUrl();
  const provider = await connectProvider(providerUrl);
  const network = networkFileName(providerUrl);
  const saltSeed = deploySaltSeed();

  console.log(`[deploy] network=${network} url=${redactProviderUrl(providerUrl)} saltSeed="${saltSeed}"`);

  const deployer = resolveWallet('FUEL_DEPLOY_PRIVATE_KEY', 'deployer', provider);

  // Idempotency means a fully-already-deployed re-run needs no funds -- so this check happens
  // AFTER attempting resolution but the actual funds requirement is only enforced by
  // `deployAll` failing naturally if it truly needs to send a transaction with an unfunded
  // account. We still proactively check here to fail with a clear, actionable message instead
  // of a raw SDK "not enough coins" error -- but only warn, not hard-block, since we cannot know
  // ahead of time whether `deployAll` will actually need to write anything.
  const baseAssetId = await provider.getBaseAssetId();
  const balance = await provider.getBalance(deployer.address, baseAssetId);
  console.log(`[deploy] deployer ${deployer.address.toB256()} balance: ${balance.toString()}`);

  const result = await deployAll(deployer, provider, saltSeed).catch(async (err) => {
    // If it failed AND the deployer was underfunded, surface the instructive funding error
    // instead of the raw SDK error -- this is the actionable diagnosis, not a mask of the
    // original failure (still logged below).
    if (balance.lt(MIN_DEPLOYER_BALANCE)) {
      console.error('[deploy] underlying error:', err);
      await requireFunded({
        provider,
        wallet: deployer,
        assetId: baseAssetId,
        minAmount: MIN_DEPLOYER_BALANCE,
        role: 'deployer',
        envVar: 'FUEL_DEPLOY_PRIVATE_KEY',
      });
    }
    throw err;
  });

  console.log(
    `[deploy] train: ${result.train.contractId} (${result.train.deployed ? `deployed, tx ${result.train.transactionId}` : 'already deployed, reused'})`,
  );
  console.log(
    `[deploy] payout_curve: ${result.payoutCurve.contractId} (${result.payoutCurve.deployed ? `deployed, tx ${result.payoutCurve.transactionId}` : 'already deployed, reused'})`,
  );

  const record: DeploymentRecord = {
    network,
    providerUrl,
    saltSeed,
    salts: {
      train: deterministicSalt('train', saltSeed),
      payoutCurve: deterministicSalt('payout_curve', saltSeed),
    },
    train: result.train,
    payoutCurve: result.payoutCurve,
    deployer: deployer.address.toB256(),
    deployedAt: new Date().toISOString(),
    toolchain: captureToolchainVersions(),
  };

  const path = saveDeployment(network, record);
  console.log(`[deploy] wrote ${path}`);

  return record;
}

// CommonJS-style direct-execution check (this package is `"type": "commonjs"`, matching every
// other script in `chains/fuel/scripts/`) -- NOT `import.meta.url`, which is an ESM-only
// construct and would fail to compile/run under this repo's pinned CJS `tsconfig.json`.
if (require.main === module) {
  main().catch((err) => {
    console.error('[deploy] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
