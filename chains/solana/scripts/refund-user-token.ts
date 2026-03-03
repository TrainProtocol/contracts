import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA, deriveUserVaultPDA, fetchUserLock,
  confirmTx, requireArg, parseHex, toArray32,
  PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/refund-user-token.ts <hashlock_hex> <token_mint>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const tokenMint = new PublicKey(requireArg(args, 1, "token_mint"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [userLockPDA] = deriveUserLockPDA(hashlock);
  const [vaultPDA] = deriveUserVaultPDA(hashlock);

  const lockData = await fetchUserLock(program, userLockPDA);
  const sender = lockData.sender as any;
  const senderATA = getAssociatedTokenAddressSync(tokenMint, sender);

  console.log("=== Refund User Token ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Sender:", sender.toBase58());

  const sig = await program.methods
    .refundUserToken(toArray32(hashlock))
    .accounts({
      caller: wallet.publicKey,
      userLock: userLockPDA,
      sender: sender,
      tokenMint: tokenMint,
      vault: vaultPDA,
      senderTokenAccount: senderATA,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRefund complete!");
}

main().catch(console.error);
