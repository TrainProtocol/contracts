import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  BN, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/refund-solver-sol.ts <hashlock_hex> <index>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const sender = lockData.sender as any;

  console.log("=== Refund Solver SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", index);
  console.log("Sender (refund to):", sender.toBase58());

  const sig = await program.methods
    .refundSolverSol(toArray32(hashlock), new BN(index))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      sender: sender,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRefund complete!");
}

main().catch(console.error);
