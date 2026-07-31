/**
 * Read-only mainnet preflight for the Train deploy:
 *  - confirms the RPC is SN_MAIN and prints current gas prices
 *  - computes the local Train class hash + the deterministic UDC address for DEPLOY_SALT
 *  - checks whether the class / address already exist on-chain
 *  - estimates the declare fee (uses ACCOUNT_ADDRESS if set; otherwise borrows a recent
 *    active account as sender — estimation skips validation, so no key is needed)
 *  - if ACCOUNT_ADDRESS is set: verifies the account is deployed and prints its STRK balance
 *
 * Submits nothing. Run: npx tsx src/preflight-mainnet.ts
 */
import { Account, hash, num } from "starknet";
import {
  getProvider,
  loadArtifacts,
  optionalEnv,
  deterministicSalt,
  predictAddress,
  getErc20Contract,
  DEFAULT_STRK_ADDRESS,
} from "./config.js";

const FRI = 10n ** 18n;

function fmtStrk(fri: bigint): string {
  return `${Number((fri * 10000n) / FRI) / 10000} STRK`;
}

async function main() {
  const provider = getProvider();

  // ── Network ──
  const chainId = (await provider.getChainId()).toString();
  const isMainnet = chainId === "0x534e5f4d41494e" || chainId === "SN_MAIN";
  console.log(`Chain id: ${chainId} (${isMainnet ? "MAINNET" : "NOT mainnet!"})`);
  if (!isMainnet) {
    console.log("[FAIL] RPC_URL is not Starknet mainnet — aborting.");
    process.exit(1);
  }

  const block = await provider.getBlockWithTxHashes("latest");
  const b = block as unknown as {
    block_number: number;
    starknet_version: string;
    l2_gas_price?: { price_in_fri: string };
    l1_data_gas_price?: { price_in_fri: string };
  };
  console.log(`Block: ${b.block_number} | starknet ${b.starknet_version}`);
  if (b.l2_gas_price) {
    console.log(`l2 gas price:      ${BigInt(b.l2_gas_price.price_in_fri)} fri`);
  }
  if (b.l1_data_gas_price) {
    console.log(`l1 data gas price: ${BigInt(b.l1_data_gas_price.price_in_fri)} fri`);
  }

  // ── Local artifacts ──
  const { sierra, casm } = loadArtifacts("Train");
  const classHash = hash.computeContractClassHash(sierra);
  const salt = deterministicSalt("Train");
  const predicted = predictAddress(classHash, salt);
  console.log(`\nTrain class hash (local build): ${classHash}`);
  console.log(`DEPLOY_SALT: ${optionalEnv("DEPLOY_SALT") ?? "train-protocol-e2e-v1 (default!)"}`);
  console.log(`Predicted UDC address:          ${predicted}`);

  let alreadyDeclared = false;
  try {
    await provider.getClass(classHash, "latest");
    alreadyDeclared = true;
  } catch {
    /* not declared */
  }
  console.log(`Class already declared on mainnet: ${alreadyDeclared}`);

  let alreadyDeployed = false;
  try {
    const onChain = await provider.getClassHashAt(predicted);
    alreadyDeployed = BigInt(onChain) === BigInt(classHash);
    console.log(`Predicted address already deployed: ${alreadyDeployed} (class ${onChain})`);
  } catch {
    console.log("Predicted address already deployed: false");
  }

  // ── Deployer account (optional at this stage) ──
  const configured = optionalEnv("ACCOUNT_ADDRESS");
  const accountSet = configured && configured !== "FILL_ME";
  let sender: string | undefined;

  if (accountSet) {
    sender = configured;
    try {
      const accClass = await provider.getClassHashAt(configured);
      console.log(`\nDeployer ${configured}`);
      console.log(`  account class: ${accClass} [deployed ✓]`);
    } catch {
      console.log(`\n[FAIL] Deployer account ${configured} is NOT deployed on mainnet.`);
      process.exit(1);
    }
    const strk = getErc20Contract(DEFAULT_STRK_ADDRESS, provider);
    const bal = (await strk.call("balance_of", [configured])) as bigint;
    console.log(`  STRK balance: ${fmtStrk(bal)} (${bal} fri)`);
  } else {
    // Borrow the sender of a recent INVOKE tx purely for fee estimation.
    console.log("\nACCOUNT_ADDRESS not set — borrowing a recent active account for estimation only.");
    outer: for (let i = 0; i < 5; i++) {
      const blk = (await provider.getBlockWithTxs(b.block_number - i)) as unknown as {
        transactions: Array<{ type: string; sender_address?: string }>;
      };
      for (const tx of blk.transactions) {
        if (tx.type === "INVOKE" && tx.sender_address) {
          sender = tx.sender_address;
          break outer;
        }
      }
    }
    if (!sender) {
      console.log("[WARN] No recent INVOKE sender found; skipping declare estimate.");
      return;
    }
    console.log(`  borrowed sender: ${sender}`);
  }

  // ── Declare fee estimate (skipValidate → no signature needed) ──
  if (alreadyDeclared) {
    console.log("\nDeclare estimate skipped — class is already declared (deploy-only cost left, ~0.01-0.1 STRK).");
    return;
  }
  const acct = new Account({ provider, address: sender!, signer: "0x1" });
  try {
    const est = await acct.estimateDeclareFee(
      { contract: sierra, casm },
      { skipValidate: true, tip: 0n },
    );
    // starknet.js v9 reports overall_fee as the resource-bounds product, i.e. it already
    // includes the 1.5x amount x 1.5x price margins (2.25x). Expected actual charge is
    // therefore ~overall/2.25, but the account balance must cover the full bounds.
    const maxFee = num.toBigInt(est.overall_fee);
    const expected = (maxFee * 4n) / 9n;
    console.log(`\nDeclare max fee (resource bounds, balance must cover this): ${fmtStrk(maxFee)}`);
    console.log(`Declare expected actual charge:                              ~${fmtStrk(expected)}`);
    console.log(`\n>>> Recommended deployer funding: max bounds + 10% gas-price drift + 1 STRK deploy headroom`);
    console.log(`>>> = ${fmtStrk((maxFee * 11n) / 10n + FRI)}`);
  } catch (err) {
    console.log("\n[WARN] Declare estimation failed:", (err as Error).message?.slice(0, 400));
    console.log("Fallback guidance: fund ~10 STRK; actual declare for a class this size is typically 1-5 STRK.");
  }
}

main().catch((err) => {
  console.error("preflight failed:", err);
  process.exit(1);
});
