import {
  getProgram, getProvider, loadWallet, loadWalletFromEnv,
  deriveUserLockPDA, deriveUserVaultPDA, deriveIntentDomainPDA, deriveDelegatePDA,
  deriveConsumedIntentPDA, fetchIntentDomain,
  generateHashlock, userLockParams, computeCallHash, buildIntentMessage,
  sha256, ed25519VerifyIx,
  confirmTx, requireArg, toArray32,
  BN, PublicKey, anchor,
} from "../helpers";
import {
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Transaction, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";

// Usage: npx ts-node scripts/gasless/rail-c-intent-lock.ts <token_mint> <amount> <timelock_delta_secs> <recipient_pubkey> <nonce> [deadline_offset_secs]
//
// Rail C — ed25519 signed intent (user never signs a transaction):
//   1. The USER (USER_KEY) must have previously approved the delegate PDA
//      (scripts/gasless/approve-delegate.ts) for at least <amount>.
//   2. The intent message (domain salt + user + mint + amount + call hash +
//      nonce + deadline) is signed off-chain with tweetnacl — this is a plain
//      message signature, NOT a transaction signature.
//   3. The RELAYER (default wallet) submits a transaction containing the
//      Ed25519 verification instruction followed by userLockTokenWithIntent;
//      the program verifies the signature byte-for-byte via the instructions
//      sysvar and pulls the tokens through the delegate.
async function main() {
  const args = process.argv.slice(2);
  const tokenMint = new PublicKey(requireArg(args, 0, "token_mint"));
  const amount = requireArg(args, 1, "amount");
  const timelockDelta = requireArg(args, 2, "timelock_delta_secs");
  const recipient = new PublicKey(requireArg(args, 3, "recipient_pubkey"));
  const nonce = parseInt(requireArg(args, 4, "nonce"));
  const deadlineOffset = args[5] ? parseInt(args[5]) : 600;
  const deadline = Math.floor(Date.now() / 1000) + deadlineOffset;

  const program = getProgram();
  const provider = getProvider();
  const connection = provider.connection;
  const relayer = loadWallet(); // submits and pays for the transaction
  const user = loadWalletFromEnv("USER_KEY"); // signs only the intent message

  const [intentDomainPDA] = deriveIntentDomainPDA();
  const [delegatePDA] = deriveDelegatePDA();
  const domain = await fetchIntentDomain(program, intentDomainPDA);
  const domainSalt = Buffer.from(domain.salt);

  const { secret, hashlock } = generateHashlock();
  const [userLockPDA] = deriveUserLockPDA(hashlock);
  const [vaultPDA] = deriveUserVaultPDA(hashlock);
  const userATA = getAssociatedTokenAddressSync(tokenMint, user.publicKey);

  const params = userLockParams({
    hashlock: toArray32(hashlock),
    amount,
    timelockDelta,
    recipient,
    refundTo: user.publicKey,
  });
  const userData = Buffer.from([]);
  const solverData = Buffer.from([]);

  const callHash = computeCallHash(program, params, userData, solverData);
  const message = buildIntentMessage({
    domainSalt,
    user: user.publicKey,
    mint: tokenMint,
    amount: BigInt(amount),
    callHash,
    nonce,
    deadline,
  });
  const intentHash = sha256(message); // == the digest the user signs
  const [consumedIntentPDA] = deriveConsumedIntentPDA(user.publicKey, nonce);

  console.log("=== Rail C: Signed-Intent User Lock Token ===");
  console.log("Secret (save this!):", secret.toString("hex"));
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("User:", user.publicKey.toBase58());
  console.log("Relayer:", relayer.publicKey.toBase58());
  console.log("Intent Hash:", intentHash.toString("hex"));
  console.log("ConsumedIntent PDA:", consumedIntentPDA.toBase58());
  console.log("Deadline:", new Date(deadline * 1000).toISOString());

  // The user signs the sha256 DIGEST of the message with tweetnacl (inside
  // ed25519VerifyIx) — never the transaction itself.
  const verifyIx = ed25519VerifyIx(user, message);
  const lockIx = await program.methods
    .userLockTokenWithIntent(
      params,
      userData,
      solverData,
      new BN(nonce),
      new BN(deadline)
    )
    .accounts({
      payer: relayer.publicKey,
      user: user.publicKey,
      intentDomain: intentDomainPDA,
      consumedIntent: consumedIntentPDA,
      delegate: delegatePDA,
      userLock: userLockPDA,
      tokenMint: tokenMint,
      userTokenAccount: userATA,
      vault: vaultPDA,
      payoutCurveProgram: null,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .instruction();

  const tx = new Transaction().add(verifyIx, lockIx);
  tx.feePayer = relayer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(relayer); // ONLY the relayer signs the transaction
  const sig = await connection.sendRawTransaction(tx.serialize());

  await confirmTx(provider, sig);
  console.log("\nDone! Intent consumed. After the deadline, reclaim the");
  console.log(
    `ConsumedIntent rent with: npx ts-node scripts/gasless/close-consumed-intent.ts ${user.publicKey.toBase58()} ${nonce}`
  );
}

main().catch(console.error);
