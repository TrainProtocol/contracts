import {
  getProgram, deriveSolverLockPDA, fetchSolverLock,
  requireArg, parseHex, PublicKey,
} from "./helpers";

// Usage: npx ts-node scripts/get-solver-lock.ts <hashlock_hex> <index>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const index = parseInt(requireArg(args, 1, "index"));

  const program = getProgram();
  const [solverLockPDA] = deriveSolverLockPDA(hashlock, index);

  const lock = await fetchSolverLock(program, solverLockPDA);

  const STATUS = ["PENDING", "REFUNDED", "REDEEMED"];
  const tokenMint = (lock.tokenMint as any) as PublicKey;
  const rewardTokenMint = (lock.rewardTokenMint as any) as PublicKey;
  const isSOL = tokenMint.equals(PublicKey.default);

  console.log("=== Solver Lock ===");
  console.log("PDA:              ", solverLockPDA.toBase58());
  console.log("Index:            ", index);
  console.log("Status:           ", STATUS[(lock.status as number)] || lock.status);
  console.log("Amount:           ", (lock.amount as any).toString(), isSOL ? "lamports" : "tokens");
  console.log("Reward:           ", (lock.reward as any).toString());
  console.log("Token Mint:       ", isSOL ? "SOL (native)" : tokenMint.toBase58());
  console.log("Reward Token Mint:", rewardTokenMint.equals(PublicKey.default) ? "same as token" : rewardTokenMint.toBase58());
  console.log("Sender:           ", (lock.sender as any).toBase58());
  console.log("Recipient:        ", (lock.recipient as any).toBase58());
  console.log("Reward Recipient: ", (lock.rewardRecipient as any).toBase58());
  console.log("Timelock:         ", new Date((lock.timelock as any).toNumber() * 1000).toISOString());
  console.log("Reward Timelock:  ", new Date((lock.rewardTimelock as any).toNumber() * 1000).toISOString());

  const secret = Buffer.from(lock.secret as any);
  const isRevealed = !secret.every((b: number) => b === 0);
  if (isRevealed) {
    console.log("Secret:           ", secret.toString("hex"));
  }
}

main().catch(console.error);
