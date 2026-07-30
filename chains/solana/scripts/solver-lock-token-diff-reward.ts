import {
  getProgram, getProvider, loadWallet,
  deriveSolverLockPDA, deriveSolverGuardPDA, deriveSolverVaultPDA, deriveSolverRewardVaultPDA,
  confirmTx, requireArg, parseHex, toArray32, solverLockParams,
  PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/solver-lock-token-diff-reward.ts <hashlock_hex> <token_mint> <reward_token_mint> <amount> <reward> <timelock_delta> <reward_timelock_delta> <recipient> <reward_recipient> [refund_to]
// refund_to defaults to the wallet pubkey; refunds go there.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const tokenMint = new PublicKey(requireArg(args, 1, "token_mint"));
  const rewardTokenMint = new PublicKey(requireArg(args, 2, "reward_token_mint"));
  const amount = requireArg(args, 3, "amount");
  const reward = requireArg(args, 4, "reward");
  const timelockDelta = requireArg(args, 5, "timelock_delta_secs");
  const rewardTimelockDelta = requireArg(args, 6, "reward_timelock_delta");
  const recipient = new PublicKey(requireArg(args, 7, "recipient"));
  const rewardRecipient = new PublicKey(requireArg(args, 8, "reward_recipient"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();
  const refundTo = args[9] ? new PublicKey(args[9]) : wallet.publicKey;

  const [guardPDA] = deriveSolverGuardPDA(hashlock, wallet.publicKey);
  const [solverLockPDA] = deriveSolverLockPDA(hashlock, wallet.publicKey);
  const [vaultPDA] = deriveSolverVaultPDA(hashlock, wallet.publicKey);
  const [rewardVaultPDA] = deriveSolverRewardVaultPDA(hashlock, wallet.publicKey);
  const senderATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);
  const senderRewardATA = getAssociatedTokenAddressSync(rewardTokenMint, wallet.publicKey);

  console.log("=== Solver Lock Token (Diff Reward) ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Solver:", wallet.publicKey.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Reward Token Mint:", rewardTokenMint.toBase58());
  console.log("Refund to:", refundTo.toBase58());

  const params = solverLockParams({
    hashlock: toArray32(hashlock),
    amount,
    reward,
    timelockDelta,
    rewardTimelockDelta,
    recipient,
    rewardRecipient,
    refundTo,
  });

  const sig = await program.methods
    .solverLockTokenDiffReward(
      params,
      Buffer.from([]), // data
    )
    .accounts({
      payer: wallet.publicKey,
      sender: wallet.publicKey,
      guard: guardPDA,
      solverLock: solverLockPDA,
      tokenMint: tokenMint,
      rewardTokenMint: rewardTokenMint,
      senderTokenAccount: senderATA,
      senderRewardTokenAccount: senderRewardATA,
      vault: vaultPDA,
      rewardVault: rewardVaultPDA,
      payoutCurveProgram: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nDone!");
}

main().catch(console.error);
