import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, deriveSolverVaultPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  BN, PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/refund-solver-token.ts <hashlock_hex> <index>
// token mint, refund_to and rent payer are read from the on-chain lock.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);
  const [vaultPDA] = deriveSolverVaultPDA(hashlock, index);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const rentPayer = lockData.rentPayer as any;
  const refundTo = lockData.refundTo as any;
  const tokenMint = (lockData.tokenMint as any) as PublicKey;
  const refundToATA = getAssociatedTokenAddressSync(tokenMint, refundTo);

  console.log("=== Refund Solver Token ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", index);
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Refund To:", refundTo.toBase58());

  const sig = await program.methods
    .refundSolverToken(toArray32(hashlock), new BN(index))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
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
