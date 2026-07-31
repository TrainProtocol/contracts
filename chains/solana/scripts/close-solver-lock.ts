import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  PublicKey,
} from "./helpers";

// Usage: npx ts-node scripts/close-solver-lock.ts <hashlock_hex> <solver>
// Reclaims rent from a terminal (redeemed/refunded) SolverLock account.
// Rent goes back to the stored rent payer.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const solver = new PublicKey(requireArg(args, 1, "solver"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, solver);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const rentPayer = lockData.rentPayer as any;

  console.log("=== Close Solver Lock ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Solver:", solver.toBase58());
  console.log("SolverLock PDA:", solverLockPDA.toBase58());
  console.log("Rent Payer (rent to):", rentPayer.toBase58());

  const sig = await program.methods
    .closeSolverLock(toArray32(hashlock), solver)
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      rentPayer: rentPayer,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nAccount closed, rent reclaimed!");
}

main().catch(console.error);
