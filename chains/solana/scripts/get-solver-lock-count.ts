import {
  getProgram, deriveSolverCountPDA, fetchSolverLockCounter,
  requireArg, parseHex,
} from "./helpers";

// Usage: npx ts-node scripts/get-solver-lock-count.ts <hashlock_hex>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));

  const program = getProgram();
  const [counterPDA] = deriveSolverCountPDA(hashlock);

  try {
    const counter = await fetchSolverLockCounter(program, counterPDA);
    console.log("=== Solver Lock Count ===");
    console.log("Hashlock:  ", hashlock.toString("hex"));
    console.log("Count:     ", (counter.count as any).toString());
    console.log("Next Index:", (counter.count as any).toNumber() + 1);
  } catch {
    console.log("No solver locks exist for this hashlock (counter not initialized).");
    console.log("Next Index: 1");
  }
}

main().catch(console.error);
