import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, deriveSolverCountPDA, fetchSolverLockCounter,
  confirmTx, requireArg, parseHex, toArray32,
  BN, PublicKey, anchor,
} from "./helpers";

// Usage: npx ts-node scripts/solver-lock-sol.ts <hashlock_hex> <amount_lamports> <reward_lamports> <timelock_delta> <reward_timelock_delta> <recipient> <reward_recipient>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const amount = new BN(requireArg(args, 1, "amount_lamports"));
  const reward = new BN(requireArg(args, 2, "reward_lamports"));
  const timelockDelta = new BN(requireArg(args, 3, "timelock_delta_secs"));
  const rewardTimelockDelta = new BN(requireArg(args, 4, "reward_timelock_delta"));
  const recipient = new PublicKey(requireArg(args, 5, "recipient"));
  const rewardRecipient = new PublicKey(requireArg(args, 6, "reward_recipient"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  // Get current counter to determine next index
  const [counterPDA] = deriveSolverCountPDA(hashlock);
  let nextIndex = 1;
  try {
    const counter = await fetchSolverLockCounter(program, counterPDA);
    nextIndex = (counter.count as any).toNumber() + 1;
  } catch {
    // Counter doesn't exist yet, first lock = index 1
  }

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, nextIndex);

  console.log("=== Solver Lock SOL ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Index:", nextIndex);
  console.log("SolverLock PDA:", solverLockPDA.toBase58());
  console.log("Amount:", amount.toString(), "lamports");
  console.log("Reward:", reward.toString(), "lamports");

  const sig = await program.methods
    .solverLockSol(
      toArray32(hashlock),
      new BN(nextIndex),
      amount,
      reward,
      timelockDelta,
      rewardTimelockDelta,
      wallet.publicKey,   // sender
      recipient,
      rewardRecipient,
      "Ethereum",         // src_chain
      "Solana",           // dst_chain
      "",                 // dst_address
      new BN(0),          // dst_amount
      "SOL",              // dst_token
      Buffer.from([]),    // data
    )
    .accounts({
      signer: wallet.publicKey,
      counter: counterPDA,
      solverLock: solverLockPDA,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nDone! Index:", nextIndex);
}

main().catch(console.error);
