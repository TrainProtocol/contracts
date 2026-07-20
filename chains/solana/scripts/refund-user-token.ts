import {
  getProgram, getProvider, loadWallet, deriveUserLockPDA, deriveUserVaultPDA, fetchUserLock,
  confirmTx, requireArg, parseHex, toArray32,
  PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/refund-user-token.ts <hashlock_hex>
// token mint, refund_to and rent payer are read from the on-chain lock.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [userLockPDA] = deriveUserLockPDA(hashlock);
  const [vaultPDA] = deriveUserVaultPDA(hashlock);

  const lockData = await fetchUserLock(program, userLockPDA);
  const rentPayer = lockData.rentPayer as any;
  const refundTo = lockData.refundTo as any;
  const tokenMint = (lockData.tokenMint as any) as PublicKey;
  const refundToATA = getAssociatedTokenAddressSync(tokenMint, refundTo);

  console.log("=== Refund User Token ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Rent Payer (rent to):", rentPayer.toBase58());
  console.log("Refund To:", refundTo.toBase58());

  const sig = await program.methods
    .refundUserToken(toArray32(hashlock))
    .accounts({
      caller: wallet.publicKey,
      userLock: userLockPDA,
      rentPayer: rentPayer,
      refundTo: refundTo,
      tokenMint: tokenMint,
      vault: vaultPDA,
      refundToTokenAccount: refundToATA,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRefund complete!");
}

main().catch(console.error);
