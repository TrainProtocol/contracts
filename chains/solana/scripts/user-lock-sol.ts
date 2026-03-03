import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA,
  generateHashlock, confirmTx, requireArg, toArray32,
  BN, PublicKey, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/user-lock-sol.ts <amount_lamports> <timelock_delta_secs> <recipient_pubkey>
// Example: npx ts-node scripts/user-lock-sol.ts 100000000 3600 <PUBKEY>
async function main() {
  const args = process.argv.slice(2);
  const amount = new BN(requireArg(args, 0, "amount_lamports"));
  const timelockDelta = new BN(requireArg(args, 1, "timelock_delta_secs"));
  const recipient = new PublicKey(requireArg(args, 2, "recipient_pubkey"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const { secret, hashlock } = generateHashlock();
  const [userLockPDA] = deriveUserLockPDA(hashlock);

  console.log("=== User Lock SOL ===");
  console.log("Secret (save this!):", secret.toString("hex"));
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("UserLock PDA:", userLockPDA.toBase58());
  console.log("Amount:", amount.toString(), "lamports");
  console.log("Timelock delta:", timelockDelta.toString(), "seconds");

  const now = Math.floor(Date.now() / 1000);
  const quoteExpiry = new BN(now + 600); // 10 min from now

  const sig = await program.methods
    .userLockSol(
      toArray32(hashlock),
      amount,
      timelockDelta,
      quoteExpiry,
      wallet.publicKey,   // sender
      recipient,           // recipient
      "Solana",            // src_chain
      "Ethereum",          // dst_chain
      "0x0000000000000000000000000000000000000000", // dst_address
      new BN(10),          // dst_amount
      "ETH",               // dst_token
      new BN(0),           // reward_amount
      "SOL",               // reward_token
      "",                  // reward_recipient
      new BN(0),           // reward_timelock_delta
      Buffer.from([]),     // user_data
      Buffer.from([]),     // solver_data
    )
    .accounts({
      signer: wallet.publicKey,
      userLock: userLockPDA,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nDone! Save the secret and hashlock for redeem/refund.");
}

main().catch(console.error);
