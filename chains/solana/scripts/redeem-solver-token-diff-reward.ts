import {
  getProgram, getProvider, loadWallet,
  deriveSolverLockPDA, deriveSolverVaultPDA, deriveSolverRewardVaultPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  BN, PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/redeem-solver-token-diff-reward.ts <hashlock_hex> <index> <secret_hex> <token_mint> <reward_token_mint>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));
  const secret = parseHex(requireArg(args, 2, "secret_hex"));
  const tokenMint = new PublicKey(requireArg(args, 3, "token_mint"));
  const rewardTokenMint = new PublicKey(requireArg(args, 4, "reward_token_mint"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);
  const [vaultPDA] = deriveSolverVaultPDA(hashlock, index);
  const [rewardVaultPDA] = deriveSolverRewardVaultPDA(hashlock, index);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const recipient = lockData.recipient as any;
  const rewardRecipient = lockData.rewardRecipient as any;

  const recipientATA = getAssociatedTokenAddressSync(tokenMint, recipient);
  const rewardRecipientATA = getAssociatedTokenAddressSync(rewardTokenMint, rewardRecipient);
  const callerRewardATA = getAssociatedTokenAddressSync(rewardTokenMint, wallet.publicKey);

  console.log("=== Redeem Solver Token (Diff Reward) ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", index);

  const sig = await program.methods
    .redeemSolverTokenDiffReward(toArray32(hashlock), new BN(index), toArray32(secret))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      recipient: recipient,
      rewardRecipient: rewardRecipient,
      tokenMint: tokenMint,
      rewardTokenMint: rewardTokenMint,
      vault: vaultPDA,
      rewardVault: rewardVaultPDA,
      recipientTokenAccount: recipientATA,
      rewardRecipientTokenAccount: rewardRecipientATA,
      callerRewardTokenAccount: callerRewardATA,
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
