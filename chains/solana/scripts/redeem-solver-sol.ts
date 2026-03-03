import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  BN, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/redeem-solver-sol.ts <hashlock_hex> <index> <secret_hex>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));
  const secret = parseHex(requireArg(args, 2, "secret_hex"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const recipient = lockData.recipient as any;
  const rewardRecipient = lockData.rewardRecipient as any;

  console.log("=== Redeem Solver SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", index);
  console.log("Recipient:", recipient.toBase58());
  console.log("Reward Recipient:", rewardRecipient.toBase58());

  const sig = await program.methods
    .redeemSolverSol(toArray32(hashlock), new BN(index), toArray32(secret))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      recipient: recipient,
      rewardRecipient: rewardRecipient,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRedeem complete!");
}

main().catch(console.error);
