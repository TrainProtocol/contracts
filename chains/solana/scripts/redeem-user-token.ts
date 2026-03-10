import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA, deriveUserVaultPDA, fetchUserLock,
  confirmTx, requireArg, parseHex, toArray32,
  PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/redeem-user-token.ts <hashlock_hex> <secret_hex> <token_mint>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const secret = parseHex(requireArg(args, 1, "secret_hex"));
  const tokenMint = new PublicKey(requireArg(args, 2, "token_mint"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [userLockPDA] = deriveUserLockPDA(hashlock);
  const [vaultPDA] = deriveUserVaultPDA(hashlock);

  const lockData = await fetchUserLock(program, userLockPDA);
  const sender = lockData.sender as any;
  const recipient = lockData.recipient as any;
  const recipientATA = getAssociatedTokenAddressSync(tokenMint, recipient);

  console.log("=== Redeem User Token ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Sender (rent to):", sender.toBase58());
  console.log("Recipient:", recipient.toBase58());

  const sig = await program.methods
    .redeemUserToken(toArray32(hashlock), toArray32(secret))
    .accounts({
      caller: wallet.publicKey,
      userLock: userLockPDA,
      sender: sender,
      recipient: recipient,
      tokenMint: tokenMint,
      vault: vaultPDA,
      recipientTokenAccount: recipientATA,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRedeem complete!");
}

main().catch(console.error);
