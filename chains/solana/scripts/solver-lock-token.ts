import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, deriveSolverCountPDA, deriveSolverVaultPDA, fetchSolverLockCounter,
  confirmTx, requireArg, parseHex, toArray32, solverLockParams,
  PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/solver-lock-token.ts <hashlock_hex> <token_mint> <amount> <reward> <timelock_delta> <reward_timelock_delta> <recipient> <reward_recipient> [refund_to]
// refund_to defaults to the wallet pubkey; refunds go there.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const tokenMint = new PublicKey(requireArg(args, 1, "token_mint"));
  const amount = requireArg(args, 2, "amount");
  const reward = requireArg(args, 3, "reward");
  const timelockDelta = requireArg(args, 4, "timelock_delta_secs");
  const rewardTimelockDelta = requireArg(args, 5, "reward_timelock_delta");
  const recipient = new PublicKey(requireArg(args, 6, "recipient"));
  const rewardRecipient = new PublicKey(requireArg(args, 7, "reward_recipient"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();
  const refundTo = args[8] ? new PublicKey(args[8]) : wallet.publicKey;

  const [counterPDA] = deriveSolverCountPDA(hashlock);
  let nextIndex = 1;
  try {
    const counter = await fetchSolverLockCounter(program, counterPDA);
    nextIndex = (counter.count as any).toNumber() + 1;
  } catch {
    // first lock
  }

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, nextIndex);
  const [vaultPDA] = deriveSolverVaultPDA(hashlock, nextIndex);
  const senderATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);

  console.log("=== Solver Lock Token ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", nextIndex);
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Refund to:", refundTo.toBase58());

  const params = solverLockParams({
    hashlock: toArray32(hashlock),
    index: nextIndex,
    amount,
    reward,
    timelockDelta,
    rewardTimelockDelta,
    recipient,
    rewardRecipient,
    refundTo,
  });

  const sig = await program.methods
    .solverLockToken(
      params,
      Buffer.from([]), // data
    )
    .accounts({
      payer: wallet.publicKey,
      sender: wallet.publicKey,
      counter: counterPDA,
      solverLock: solverLockPDA,
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
  console.log("\nDone! Index:", nextIndex);
}

main().catch(console.error);
