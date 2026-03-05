import { hash } from "starknet";
import {
  getAccount,
  loadSierra,
  loadCasm,
  optionalEnv,
  getTrainContract,
} from "./config.js";

async function main() {
  const { account, provider } = getAccount();
  const sierra = loadSierra();
  const casm = loadCasm();

  console.log("Account:", account.address);
  console.log("Network:", await provider.getChainId());

  // ── Declare ──
  let classHash = optionalEnv("CLASS_HASH");

  if (classHash) {
    console.log(`\nUsing existing CLASS_HASH: ${classHash}`);
  } else {
    console.log("\nDeclaring contract...");
    try {
      const declareResult = await account.declareIfNot({
        contract: sierra,
        casm,
      });

      if (declareResult.transaction_hash) {
        console.log("Declare tx:", declareResult.transaction_hash);
        await provider.waitForTransaction(declareResult.transaction_hash);
        console.log("Declare confirmed.");
      } else {
        console.log("Class already declared.");
      }

      classHash = declareResult.class_hash;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // StarkNet error code 51 = class already declared
      if (msg.includes("51") || msg.includes("already declared")) {
        classHash = hash.computeContractClassHash(sierra);
        console.log("Class already declared (caught). Hash:", classHash);
      } else {
        throw err;
      }
    }

    console.log("Class hash:", classHash);
  }

  // ── Deploy ──
  console.log("\nDeploying contract...");
  const deployResult = await account.deploy({
    classHash: classHash!,
    constructorCalldata: [],
  });

  console.log("Deploy tx:", deployResult.transaction_hash);
  await provider.waitForTransaction(deployResult.transaction_hash);

  const contractAddress =
    deployResult.contract_address?.[0] ?? deployResult.contract_address;
  console.log("Contract address:", contractAddress);

  // ── Verify deployment ──
  console.log("\nVerifying deployment...");
  const contract = getTrainContract(contractAddress as string, provider);
  const count = await contract.get_solver_lock_count(0n);
  console.log("get_solver_lock_count(0) =", count.toString(), "(expected 0)");

  // ── Print .env snippet ──
  console.log("\n========================================");
  console.log("Add to your .env:");
  console.log(`CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`CLASS_HASH=${classHash}`);
  console.log("========================================");
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
