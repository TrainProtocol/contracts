import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  PublicKey, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/refund-solver-sol.ts <hashlock_hex> <solver>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const solver = new PublicKey(requireArg(args, 1, "solver"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, solver);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const refundTo = lockData.refundTo as any;

  console.log("=== Refund Solver SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Solver:", solver.toBase58());
  console.log("Refund To:", refundTo.toBase58());

  const sig = await program.methods
    .refundSolverSol(toArray32(hashlock), solver)
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      refundTo: refundTo,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRefund complete!");
}

main().catch(console.error);
