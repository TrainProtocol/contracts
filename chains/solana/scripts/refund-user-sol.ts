import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA, fetchUserLock,
  confirmTx, requireArg, parseHex, toArray32,
  anchor,
} from "./helpers";

// Usage: npx ts-node scripts/refund-user-sol.ts <hashlock_hex>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [userLockPDA] = deriveUserLockPDA(hashlock);

  // Fetch to get rent payer and refund destination
  const lockData = await fetchUserLock(program, userLockPDA);
  const rentPayer = lockData.rentPayer as any;
  const refundTo = lockData.refundTo as any;

  console.log("=== Refund User SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Rent Payer (rent to):", rentPayer.toBase58());
  console.log("Refund To:", refundTo.toBase58());

  const sig = await program.methods
    .refundUserSol(toArray32(hashlock))
    .accounts({
      caller: wallet.publicKey,
      userLock: userLockPDA,
      rentPayer: rentPayer,
      refundTo: refundTo,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRefund complete!");
}

main().catch(console.error);
