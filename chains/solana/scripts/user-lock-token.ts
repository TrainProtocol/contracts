import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA, deriveUserVaultPDA,
  generateHashlock, confirmTx, requireArg, toArray32, userLockParams,
  PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/user-lock-token.ts <token_mint> <amount> <timelock_delta> <recipient> [refund_to]
// amount is in token base units (e.g. for 6 decimals: 1000000 = 1 token)
// refund_to defaults to the wallet pubkey; refunds and redeem excess go there.
async function main() {
  const args = process.argv.slice(2);
  const tokenMint = new PublicKey(requireArg(args, 0, "token_mint"));
  const amount = requireArg(args, 1, "amount");
  const timelockDelta = requireArg(args, 2, "timelock_delta_secs");
  const recipient = new PublicKey(requireArg(args, 3, "recipient_pubkey"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();
  const refundTo = args[4] ? new PublicKey(args[4]) : wallet.publicKey;

  const { secret, hashlock } = generateHashlock();
  const [userLockPDA] = deriveUserLockPDA(hashlock);
  const [vaultPDA] = deriveUserVaultPDA(hashlock);
  const senderATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);

  console.log("=== User Lock Token ===");
  console.log("Secret (save this!):", secret.toString("hex"));
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Amount:", amount);
  console.log("Refund to:", refundTo.toBase58());

  const params = userLockParams({
    hashlock: toArray32(hashlock),
    amount,
    timelockDelta,
    recipient,
    refundTo,
  });

  const sig = await program.methods
    .userLockToken(
      params,
      Buffer.from([]), // user_data
      Buffer.from([]), // solver_data
    )
    .accounts({
      payer: wallet.publicKey,
      sender: wallet.publicKey,
      userLock: userLockPDA,
      tokenMint: tokenMint,
      senderTokenAccount: senderATA,
      vault: vaultPDA,
      payoutCurveProgram: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nDone! Save the secret and hashlock for redeem/refund.");
}

main().catch(console.error);
