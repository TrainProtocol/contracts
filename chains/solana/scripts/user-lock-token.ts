import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA, deriveUserVaultPDA,
  generateHashlock, confirmTx, requireArg, toArray32,
  BN, PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/user-lock-token.ts <token_mint> <amount> <timelock_delta> <recipient>
// amount is in token base units (e.g. for 6 decimals: 1000000 = 1 token)
async function main() {
  const args = process.argv.slice(2);
  const tokenMint = new PublicKey(requireArg(args, 0, "token_mint"));
  const amount = new BN(requireArg(args, 1, "amount"));
  const timelockDelta = new BN(requireArg(args, 2, "timelock_delta_secs"));
  const recipient = new PublicKey(requireArg(args, 3, "recipient_pubkey"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const { secret, hashlock } = generateHashlock();
  const [userLockPDA] = deriveUserLockPDA(hashlock);
  const [vaultPDA] = deriveUserVaultPDA(hashlock);
  const senderATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);

  console.log("=== User Lock Token ===");
  console.log("Secret (save this!):", secret.toString("hex"));
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Amount:", amount.toString());

  const now = Math.floor(Date.now() / 1000);
  const quoteExpiry = new BN(now + 600);

  const sig = await program.methods
    .userLockToken(
      toArray32(hashlock),
      amount,
      timelockDelta,
      quoteExpiry,
      wallet.publicKey,
      recipient,
      "Solana",
      "Ethereum",
      "0x0000000000000000000000000000000000000000",
      new BN(0),
      "ETH",
      new BN(0),
      "SOL",
      "",
      new BN(0),
      Buffer.from([]),
      Buffer.from([]),
    )
    .accounts({
      signer: wallet.publicKey,
      userLock: userLockPDA,
      tokenMint: tokenMint,
      senderTokenAccount: senderATA,
      vault: vaultPDA,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nDone! Save the secret and hashlock for redeem/refund.");
}

main().catch(console.error);
