import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA,
  confirmTx, requireArg, parseHex, toArray32,
} from "./helpers";

// Usage: npx ts-node scripts/close-user-lock.ts <hashlock_hex>
// Reclaims rent from a terminal (redeemed/refunded) UserLock account.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [userLockPDA] = deriveUserLockPDA(hashlock);

  console.log("=== Close User Lock ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("UserLock PDA:", userLockPDA.toBase58());

  const sig = await program.methods
    .closeUserLock(toArray32(hashlock))
    .accounts({
      caller: wallet.publicKey,
      userLock: userLockPDA,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nAccount closed, rent reclaimed!");
}

main().catch(console.error);
