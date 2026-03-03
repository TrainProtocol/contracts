import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, deriveSolverVaultPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  BN, PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/refund-solver-token.ts <hashlock_hex> <index> <token_mint>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));
  const tokenMint = new PublicKey(requireArg(args, 2, "token_mint"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);
  const [vaultPDA] = deriveSolverVaultPDA(hashlock, index);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const sender = lockData.sender as any;
  const senderATA = getAssociatedTokenAddressSync(tokenMint, sender);

  console.log("=== Refund Solver Token ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", index);
  console.log("Token Mint:", tokenMint.toBase58());

  const sig = await program.methods
    .refundSolverToken(toArray32(hashlock), new BN(index))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
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
