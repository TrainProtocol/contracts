import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA,
  generateHashlock, confirmTx, requireArg, toArray32, userLockParams,
  PublicKey, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/user-lock-sol.ts <amount_lamports> <timelock_delta_secs> <recipient_pubkey> [refund_to_pubkey]
// Example: npx ts-node scripts/user-lock-sol.ts 100000000 3600 <PUBKEY>
// refund_to defaults to the wallet pubkey; refunds and redeem excess go there.
async function main() {
  const args = process.argv.slice(2);
  const amount = requireArg(args, 0, "amount_lamports");
  const timelockDelta = requireArg(args, 1, "timelock_delta_secs");
  const recipient = new PublicKey(requireArg(args, 2, "recipient_pubkey"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();
  const refundTo = args[3] ? new PublicKey(args[3]) : wallet.publicKey;

  const { secret, hashlock } = generateHashlock();
  const [userLockPDA] = deriveUserLockPDA(hashlock);

  console.log("=== User Lock SOL ===");
  console.log("Secret (save this!):", secret.toString("hex"));
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("UserLock PDA:", userLockPDA.toBase58());
  console.log("Amount:", amount, "lamports");
  console.log("Timelock delta:", timelockDelta, "seconds");
  console.log("Refund to:", refundTo.toBase58());

  const params = userLockParams({
    hashlock: toArray32(hashlock),
    amount,
    timelockDelta,
    recipient,
    refundTo,
  });

  const sig = await program.methods
    .userLockSol(
      params,
      Buffer.from([]), // user_data
      Buffer.from([]), // solver_data
    )
    .accounts({
      payer: wallet.publicKey,
      sender: wallet.publicKey,
      userLock: userLockPDA,
      payoutCurveProgram: null,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nDone! Save the secret and hashlock for redeem/refund.");
}

main().catch(console.error);
