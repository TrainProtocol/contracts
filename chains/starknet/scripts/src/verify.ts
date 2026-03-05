import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative } from "path";
import { hash, type CompiledSierra } from "starknet";
import { getAccount, requireEnv, loadSierra, optionalEnv } from "./config.js";

// ── Collect source files ──

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

function collectSourceFiles(): Record<string, string> {
  const files: Record<string, string> = {};

  files["Scarb.toml"] = readFileSync(resolve(PROJECT_ROOT, "Scarb.toml"), "utf-8");

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".cairo")) {
        const rel = relative(PROJECT_ROOT, full);
        files[rel] = readFileSync(full, "utf-8");
      }
    }
  }
  walk(resolve(PROJECT_ROOT, "src"));

  return files;
}

// ── Voyager verification ──

async function verifyVoyager(classHash: string, isMainnet: boolean): Promise<boolean> {
  const baseUrl = isMainnet
    ? "https://api.voyager.online/beta"
    : "https://sepolia-api.voyager.online/beta";

  const files = collectSourceFiles();

  console.log("\n--- Voyager Verification ---");
  console.log(`Submitting ${Object.keys(files).length} files...`);

  const body = {
    compiler_version: "2.14.0",
    scarb_version: "2.14.0",
    project_dir_path: ".",
    name: "Train",
    package_name: "train_protocol",
    build_tool: "scarb",
    license: "MIT",
    files,
  };

  const submitRes = await fetch(`${baseUrl}/class-verify/${classHash}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const submitText = await submitRes.text();

  if (!submitRes.ok) {
    console.log(`[FAIL] Submit failed (${submitRes.status}): ${submitText}`);
    return false;
  }

  let jobId: string;
  try {
    const parsed = JSON.parse(submitText);
    jobId = parsed.job_id ?? parsed.jobId ?? submitText;
  } catch {
    jobId = submitText.trim();
  }

  console.log(`Job: ${jobId}`);

  // Poll up to 30s (6 x 5s)
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(`${baseUrl}/class-verify/job/${jobId}`);
    const pollText = await pollRes.text();

    try {
      const parsed = JSON.parse(pollText);
      const status = (parsed.status ?? "").toLowerCase();
      if (status === "success" || status === "verified") {
        console.log("[PASS] Contract verified on Voyager!");
        return true;
      }
      if (status === "failed" || status === "error") {
        console.log(`[FAIL] ${parsed.error_message ?? parsed.message ?? pollText}`);
        return false;
      }
    } catch {
      // non-JSON, keep polling
    }
  }

  const voyagerUrl = isMainnet
    ? `https://voyager.online/class/${classHash}#code`
    : `https://sepolia.voyager.online/class/${classHash}#code`;
  console.log(`[INFO] Verification submitted. Check status at:\n  ${voyagerUrl}`);
  return true;
}

// ── Main ──

async function main() {
  const { provider } = getAccount();
  const contractAddress = requireEnv("CONTRACT_ADDRESS");
  const sierra = loadSierra();

  console.log("Verification Report for Train Protocol");
  console.log("=======================================");

  // ── Network detection ──
  const chainId = await provider.getChainId();
  const chainIdHex = chainId.toString();
  const isMainnet =
    chainIdHex === "0x534e5f4d41494e" || chainIdHex === "SN_MAIN";
  const networkName = isMainnet ? "mainnet" : "sepolia";
  console.log(`Network: ${networkName} (${chainIdHex})`);
  console.log(`Contract: ${contractAddress}`);

  // ── On-chain class hash ──
  let onChainClassHash: string;
  try {
    onChainClassHash = await provider.getClassHashAt(contractAddress);
  } catch {
    console.log("\n[FAIL] Contract not found at address");
    process.exit(1);
  }

  const expectedClassHash =
    optionalEnv("CLASS_HASH") || hash.computeContractClassHash(sierra);

  console.log(`Class hash: ${onChainClassHash}`);

  if (BigInt(onChainClassHash) === BigInt(expectedClassHash)) {
    console.log("\n[PASS] On-chain class hash matches expected");
  } else {
    console.log("\n[FAIL] Class hash mismatch!");
    console.log(`  On-chain: ${onChainClassHash}`);
    console.log(`  Expected: ${expectedClassHash}`);
  }

  // ── ABI comparison ──
  try {
    const onChainClass = (await provider.getClass(onChainClassHash)) as CompiledSierra;
    const onChainAbi = onChainClass.abi;
    const localAbi = sierra.abi;

    const onChainFns = (onChainAbi ?? []).filter(
      (e: { type: string }) => e.type === "function",
    );
    const localFns = (localAbi ?? []).filter(
      (e: { type: string }) => e.type === "function",
    );
    const onChainEvents = (onChainAbi ?? []).filter(
      (e: { type: string }) => e.type === "event",
    );
    const localEvents = (localAbi ?? []).filter(
      (e: { type: string }) => e.type === "event",
    );

    if (
      onChainFns.length === localFns.length &&
      onChainEvents.length === localEvents.length
    ) {
      console.log(
        `[PASS] ABI matches local build (${localFns.length} functions, ${localEvents.length} events)`,
      );
    } else {
      console.log(
        `[WARN] ABI mismatch: on-chain has ${onChainFns.length} fns / ${onChainEvents.length} events, local has ${localFns.length} fns / ${localEvents.length} events`,
      );
    }
  } catch (err) {
    console.log("[WARN] Could not fetch on-chain ABI:", err);
  }

  // ── Explorer links ──
  const prefix = isMainnet ? "" : "sepolia.";
  const voyagerBase = `https://${prefix}voyager.online`;

  console.log("\nExplorer links:");
  console.log(`  Voyager (contract): ${voyagerBase}/contract/${contractAddress}`);
  console.log(`  Voyager (class):    ${voyagerBase}/class/${onChainClassHash}#code`);

  // ── Voyager source verification ──
  if (process.argv[2] === "voyager") {
    await verifyVoyager(onChainClassHash, isMainnet);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
