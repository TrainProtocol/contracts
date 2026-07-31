import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  PublicKey, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/redeem-solver-sol.ts <hashlock_hex> <solver> <secret_hex>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const solver = new PublicKey(requireArg(args, 1, "solver"));
  const secret = parseHex(requireArg(args, 2, "secret_hex"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, solver);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const recipient = lockData.recipient as any;
  const rewardRecipient = lockData.rewardRecipient as any;
  const refundTo = lockData.refundTo as any;

  console.log("=== Redeem Solver SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Solver:", solver.toBase58());
  console.log("Recipient:", recipient.toBase58());
  console.log("Reward Recipient:", rewardRecipient.toBase58());
  console.log("Refund To (excess to):", refundTo.toBase58());

  const sig = await program.methods
    .redeemSolverSol(toArray32(hashlock), solver, toArray32(secret))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      recipient: recipient,
      rewardRecipient: rewardRecipient,
      refundTo: refundTo,
      payoutCurveProgram: null,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRedeem complete!");
}

main().catch(console.error);
