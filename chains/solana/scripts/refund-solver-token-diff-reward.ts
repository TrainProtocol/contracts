import {
  getProgram, getProvider, loadWallet,
  deriveSolverLockPDA, deriveSolverVaultPDA, deriveSolverRewardVaultPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  BN, PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/refund-solver-token-diff-reward.ts <hashlock_hex> <index>
// token mints, refund_to and rent payer are read from the on-chain lock.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);
  const [vaultPDA] = deriveSolverVaultPDA(hashlock, index);
  const [rewardVaultPDA] = deriveSolverRewardVaultPDA(hashlock, index);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const rentPayer = lockData.rentPayer as any;
  const refundTo = lockData.refundTo as any;
  const tokenMint = (lockData.tokenMint as any) as PublicKey;
  const rewardTokenMint = (lockData.rewardTokenMint as any) as PublicKey;
  const refundToATA = getAssociatedTokenAddressSync(tokenMint, refundTo);
  const refundToRewardATA = getAssociatedTokenAddressSync(rewardTokenMint, refundTo);

  console.log("=== Refund Solver Token (Diff Reward) ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", index);
  console.log("Refund To:", refundTo.toBase58());

  const sig = await program.methods
    .refundSolverTokenDiffReward(toArray32(hashlock), new BN(index))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      rentPayer: rentPayer,
      refundTo: refundTo,
      tokenMint: tokenMint,
      rewardTokenMint: rewardTokenMint,
      vault: vaultPDA,
      rewardVault: rewardVaultPDA,
      refundToTokenAccount: refundToATA,
      refundToRewardTokenAccount: refundToRewardATA,
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
