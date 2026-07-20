import {
  getProgram, getProvider, loadWallet, loadWalletFromEnv,
  deriveUserLockPDA, generateHashlock, userLockParams,
  confirmTx, requireArg, toArray32,
  PublicKey, anchor,
} from "../helpers";
import { Transaction } from "@solana/web3.js";

// Usage: npx ts-node scripts/gasless/rail-a-sponsored-lock.ts <amount_lamports> <timelock_delta_secs> <recipient_pubkey> [refund_to_pubkey]
//
// Rail A — fee-payer sponsorship:
//   1. The USER (USER_KEY in .env) is the funds authority (`sender`) — they pay
//      only the locked amount.
//   2. The RELAYER (the default wallet) is `payer` and the transaction fee
//      payer — it fronts the tx fee and the lock's rent.
//   3. The user partial-signs first (offline is fine), the relayer countersigns
//      and broadcasts the raw transaction. Neither signature is valid if the
//      other party mutates the transaction afterwards.
async function main() {
  const args = process.argv.slice(2);
  const amount = requireArg(args, 0, "amount_lamports");
  const timelockDelta = requireArg(args, 1, "timelock_delta_secs");
  const recipient = new PublicKey(requireArg(args, 2, "recipient_pubkey"));

  const program = getProgram();
  const provider = getProvider();
  const relayer = loadWallet(); // fee payer / rent payer
  const user = loadWalletFromEnv("USER_KEY"); // funds authority
  const refundTo = args[3] ? new PublicKey(args[3]) : user.publicKey;

  const { secret, hashlock } = generateHashlock();
  const [userLockPDA] = deriveUserLockPDA(hashlock);

  console.log("=== Rail A: Sponsored User Lock SOL ===");
  console.log("Secret (save this!):", secret.toString("hex"));
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("User (sender):", user.publicKey.toBase58());
  console.log("Relayer (payer):", relayer.publicKey.toBase58());
  console.log("UserLock PDA:", userLockPDA.toBase58());

  const params = userLockParams({
    hashlock: toArray32(hashlock),
    amount,
    timelockDelta,
    recipient,
    refundTo,
  });

  const ix = await program.methods
    .userLockSol(params, Buffer.from([]), Buffer.from([]))
    .accounts({
      payer: relayer.publicKey,
      sender: user.publicKey,
      userLock: userLockPDA,
      payoutCurveProgram: null,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = relayer.publicKey;
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;

  // user signs first (offline), relayer countersigns and broadcasts
  tx.partialSign(user);
  tx.partialSign(relayer);
  const sig = await provider.connection.sendRawTransaction(tx.serialize());

  await confirmTx(provider, sig);
  console.log("\nDone! Relayer paid fees+rent; user paid only the locked amount.");
}

main().catch(console.error);
