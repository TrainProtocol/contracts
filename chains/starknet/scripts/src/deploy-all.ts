import { getAccount, optionalEnv, declareAndDeployDeterministic } from "./config.js";

export interface DeployedAddresses {
  constantCurve: string;
  train: string;
  trainRouter: string;
}

/**
 * Declares (if needed) and deploys (if not already present) `ConstantPayoutCurve` -> `Train` ->
 * `TrainRouter`, in that order, all with zero constructor args. No token is ever deployed here —
 * the e2e suite runs against the canonical Sepolia STRK/ETH contracts (see `config.ts`'s
 * `resolveTokenAddresses`), using the pre-funded balances of whatever accounts are configured.
 *
 * Idempotent & deterministic:
 * - If `CONSTANT_CURVE` / `TRAIN` / `TRAIN_ROUTER` env vars are set, that address is reused as-is
 *   (no declare/deploy at all) — this is how `sepolia-e2e.ts` picks up already-deployed Sepolia
 *   contracts.
 * - Otherwise each contract is deployed via the UDC with `unique: false` and a salt derived from
 *   `DEPLOY_SALT` (default `train-protocol-e2e-v1`), so the target address is a pure function of
 *   (class hash, salt) — independent of the deployer account. Re-running against the same network
 *   with the same salt detects the existing deployment and reuses it instead of redeploying.
 */
export async function deployAll(): Promise<DeployedAddresses> {
  const { account, provider } = getAccount();

  console.log("Deployer:", account.address);
  console.log("Network chain id:", await provider.getChainId());

  async function resolve(
    envVar: string,
    name: "ConstantPayoutCurve" | "Train" | "TrainRouter",
  ): Promise<string> {
    const fromEnv = optionalEnv(envVar);
    if (fromEnv) {
      console.log(`\n${name}: reusing ${envVar}=${fromEnv} (no declare/deploy)`);
      return fromEnv;
    }

    console.log(`\n${name}: declaring + deploying (deterministic)...`);
    const result = await declareAndDeployDeterministic(account, provider, name);
    if (result.declareTx) console.log(`  Declare tx: ${result.declareTx}`);
    console.log(`  Class hash: ${result.classHash}`);
    if (result.deployed) {
      console.log(`  Deploy tx: ${result.deployTx}`);
      console.log(`  Address (freshly deployed): ${result.address}`);
    } else {
      console.log(`  Address (already deployed, reused): ${result.address}`);
    }
    return result.address;
  }

  const constantCurve = await resolve("CONSTANT_CURVE", "ConstantPayoutCurve");
  const train = await resolve("TRAIN", "Train");
  const trainRouter = await resolve("TRAIN_ROUTER", "TrainRouter");

  return { constantCurve, train, trainRouter };
}

async function main() {
  const addresses = await deployAll();

  console.log("\n========================================");
  console.log("Add to your .env:");
  console.log(`CONSTANT_CURVE=${addresses.constantCurve}`);
  console.log(`TRAIN=${addresses.train}`);
  console.log(`TRAIN_ROUTER=${addresses.trainRouter}`);
  console.log("========================================");
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("deploy-all failed:", err);
    process.exit(1);
  });
}
