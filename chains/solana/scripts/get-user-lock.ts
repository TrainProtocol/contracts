import {
  getProgram, deriveUserLockPDA, fetchUserLock,
  requireArg, parseHex, PublicKey,
} from "./helpers";

// Usage: npx ts-node scripts/get-user-lock.ts <hashlock_hex>
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));

  const program = getProgram();
  const [userLockPDA] = deriveUserLockPDA(hashlock);

  const lock = await fetchUserLock(program, userLockPDA);

  const STATUS = ["PENDING", "REFUNDED", "REDEEMED"];
  const tokenMint = (lock.tokenMint as any) as PublicKey;
  const isSOL = tokenMint.equals(PublicKey.default);

  console.log("=== User Lock ===");
  console.log("PDA:        ", userLockPDA.toBase58());
  console.log("Status:     ", STATUS[(lock.status as number)] || lock.status);
  console.log("Amount:     ", (lock.amount as any).toString(), isSOL ? "lamports" : "tokens");
  console.log("Token Mint: ", isSOL ? "SOL (native)" : tokenMint.toBase58());
  console.log("Sender:     ", (lock.sender as any).toBase58());
  console.log("Recipient:  ", (lock.recipient as any).toBase58());
  console.log("Timelock:   ", new Date((lock.timelock as any).toNumber() * 1000).toISOString());

  const secret = Buffer.from(lock.secret as any);
  const isRevealed = !secret.every((b: number) => b === 0);
  if (isRevealed) {
    console.log("Secret:     ", secret.toString("hex"));
  }
}

main().catch(console.error);
