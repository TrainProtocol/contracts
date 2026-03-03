import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA, fetchUserLock,
  confirmTx, requireArg, parseHex, toArray32,
  anchor,
} from "./helpers";

// Usage: npx ts-node scripts/redeem-user-sol.ts <hashlock_hex> <secret_hex>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const secret = parseHex(requireArg(args, 1, "secret_hex"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [userLockPDA] = deriveUserLockPDA(hashlock);

  const lockData = await fetchUserLock(program, userLockPDA);
  const recipient = lockData.recipient as any;

  console.log("=== Redeem User SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Recipient:", recipient.toBase58());

  const sig = await program.methods
    .redeemUserSol(toArray32(hashlock), toArray32(secret))
    .accounts({
      caller: wallet.publicKey,
      userLock: userLockPDA,
      recipient: recipient,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRedeem complete!");
}

main().catch(console.error);
