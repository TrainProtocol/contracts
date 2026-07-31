import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, deriveSolverGuardPDA,
  confirmTx, requireArg, parseHex, toArray32, solverLockParams,
  PublicKey, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/solver-lock-sol.ts <hashlock_hex> <amount_lamports> <reward_lamports> <timelock_delta> <reward_timelock_delta> <recipient> <reward_recipient> [refund_to]
// refund_to defaults to the wallet pubkey; refunds go there.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const amount = requireArg(args, 1, "amount_lamports");
  const reward = requireArg(args, 2, "reward_lamports");
  const timelockDelta = requireArg(args, 3, "timelock_delta_secs");
  const rewardTimelockDelta = requireArg(args, 4, "reward_timelock_delta");
  const recipient = new PublicKey(requireArg(args, 5, "recipient"));
  const rewardRecipient = new PublicKey(requireArg(args, 6, "reward_recipient"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();
  const refundTo = args[7] ? new PublicKey(args[7]) : wallet.publicKey;

  const [guardPDA] = deriveSolverGuardPDA(hashlock, wallet.publicKey);
  const [solverLockPDA] = deriveSolverLockPDA(hashlock, wallet.publicKey);

  console.log("=== Solver Lock SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Solver:", wallet.publicKey.toBase58());
  console.log("SolverLock PDA:", solverLockPDA.toBase58());
  console.log("Amount:", amount, "lamports");
  console.log("Reward:", reward, "lamports");
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
    .solverLockSol(
      params,
      Buffer.from([]), // data
    )
    .accounts({
      payer: wallet.publicKey,
      sender: wallet.publicKey,
      guard: guardPDA,
      solverLock: solverLockPDA,
      payoutCurveProgram: null,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nDone!");
}

main().catch(console.error);
