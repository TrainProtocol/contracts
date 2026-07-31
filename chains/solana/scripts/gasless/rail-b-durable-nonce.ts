import {
  getProgram, getProvider, loadWallet, loadWalletFromEnv,
  deriveUserLockPDA, generateHashlock, userLockParams,
  confirmTx, requireArg, toArray32,
  PublicKey, Keypair, anchor,
} from "../helpers";
import {
  Transaction, SystemProgram, NonceAccount, NONCE_ACCOUNT_LENGTH,
} from "@solana/web3.js";

// Usage: npx ts-node scripts/gasless/rail-b-durable-nonce.ts <amount_lamports> <timelock_delta_secs> <recipient_pubkey> [refund_to_pubkey]
//
// Rail B — durable nonce (offline/deferred signing):
//   1. A durable nonce account (authorized to the relayer) replaces the recent
//      blockhash, so the signed transaction never expires.
//      Set NONCE_ACCOUNT in .env to reuse an existing nonce account; otherwise
//      one is created (rent paid by the relayer).
//   2. The transaction starts with a nonceAdvance instruction and uses the
//      stored nonce as its blockhash.
//   3. The USER (USER_KEY) signs offline; any time later the RELAYER (default
//      wallet) countersigns and submits. The nonce advances on execution, so
//      the identical transaction can never run twice.
async function main() {
  const args = process.argv.slice(2);
  const amount = requireArg(args, 0, "amount_lamports");
  const timelockDelta = requireArg(args, 1, "timelock_delta_secs");
  const recipient = new PublicKey(requireArg(args, 2, "recipient_pubkey"));

  const program = getProgram();
  const provider = getProvider();
  const connection = provider.connection;
  const relayer = loadWallet(); // fee payer / nonce authority
  const user = loadWalletFromEnv("USER_KEY"); // funds authority
  const refundTo = args[3] ? new PublicKey(args[3]) : user.publicKey;

  // Create or reuse the durable nonce account.
  let noncePubkey: PublicKey;
  if (process.env.NONCE_ACCOUNT) {
    noncePubkey = new PublicKey(process.env.NONCE_ACCOUNT);
    console.log("Reusing nonce account:", noncePubkey.toBase58());
  } else {
    const nonceKeypair = Keypair.generate();
    noncePubkey = nonceKeypair.publicKey;
    const rent = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
    const createTx = new Transaction().add(
      ...SystemProgram.createNonceAccount({
        fromPubkey: relayer.publicKey,
        noncePubkey,
        authorizedPubkey: relayer.publicKey,
        lamports: rent,
      }).instructions
    );
    createTx.feePayer = relayer.publicKey;
    createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    createTx.sign(relayer, nonceKeypair);
    const createSig = await connection.sendRawTransaction(createTx.serialize());
    await connection.confirmTransaction(createSig, "confirmed");
    console.log("Created nonce account:", noncePubkey.toBase58());
    console.log("(set NONCE_ACCOUNT in .env to reuse it)");
  }

  const nonceInfo = await connection.getAccountInfo(noncePubkey);
  if (!nonceInfo) {
    console.error("Nonce account not found:", noncePubkey.toBase58());
    process.exit(1);
  }
  const nonceAccount = NonceAccount.fromAccountData(nonceInfo.data);

  const { secret, hashlock } = generateHashlock();
  const [userLockPDA] = deriveUserLockPDA(hashlock);

  console.log("=== Rail B: Durable-Nonce Sponsored User Lock SOL ===");
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

  const lockIx = await program.methods
    .userLockSol(params, Buffer.from([]), Buffer.from([]))
    .accounts({
      payer: relayer.publicKey,
      sender: user.publicKey,
      userLock: userLockPDA,
      payoutCurveProgram: null,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .instruction();

  const tx = new Transaction();
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey,
      authorizedPubkey: relayer.publicKey,
    })
  );
  tx.add(lockIx);
  tx.feePayer = relayer.publicKey;
  tx.recentBlockhash = nonceAccount.nonce; // durable nonce, no expiry window

  tx.partialSign(user); // "offline" signature
  console.log("User signed offline; waiting before relayer submission...");
  await new Promise((resolve) => setTimeout(resolve, 2000)); // simulate deferred submission
  tx.partialSign(relayer);
  const sig = await connection.sendRawTransaction(tx.serialize());

  await confirmTx(provider, sig);
  console.log("\nDone! The nonce advanced, so this transaction can never replay.");
}

main().catch(console.error);
