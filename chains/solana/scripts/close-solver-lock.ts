import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA,
  confirmTx, requireArg, parseHex, toArray32,
  BN,
} from "./helpers";

// Usage: npx ts-node scripts/close-solver-lock.ts <hashlock_hex> <index>
// Reclaims rent from a terminal (redeemed/refunded) SolverLock account.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);

  console.log("=== Close Solver Lock ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", index);
  console.log("SolverLock PDA:", solverLockPDA.toBase58());

  const sig = await program.methods
    .closeSolverLock(toArray32(hashlock), new BN(index))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nAccount closed, rent reclaimed!");
}

main().catch(console.error);
