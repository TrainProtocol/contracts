import {
  getProgram, getProvider, loadWallet, deriveSolverLockPDA, deriveSolverVaultPDA, fetchSolverLock,
  confirmTx, requireArg, parseHex, toArray32,
  PublicKey, anchor,
} from "./helpers";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Usage: npx ts-node scripts/redeem-solver-token.ts <hashlock_hex> <solver> <secret_hex>
// token mint, recipients, refund_to and rent payer are read from the on-chain lock.
async function main() {
  const args = process.argv.slice(2);
  const hashlock = parseHex(requireArg(args, 0, "hashlock_hex"));
  const solver = new PublicKey(requireArg(args, 1, "solver"));
  const secret = parseHex(requireArg(args, 2, "secret_hex"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [solverLockPDA] = deriveSolverLockPDA(hashlock, solver);
  const [vaultPDA] = deriveSolverVaultPDA(hashlock, solver);

  const lockData = await fetchSolverLock(program, solverLockPDA);
  const rentPayer = lockData.rentPayer as any;
  const recipient = lockData.recipient as any;
  const rewardRecipient = lockData.rewardRecipient as any;
  const refundTo = lockData.refundTo as any;
  const tokenMint = (lockData.tokenMint as any) as PublicKey;

  const recipientATA = getAssociatedTokenAddressSync(tokenMint, recipient);
  const rewardRecipientATA = getAssociatedTokenAddressSync(tokenMint, rewardRecipient);
  const callerATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);

  console.log("=== Redeem Solver Token ===");
  console.log("Hashlock:", hashlock.toString("hex"));
  console.log("Solver:", solver.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());

  const sig = await program.methods
    .redeemSolverToken(toArray32(hashlock), solver, toArray32(secret))
    .accounts({
      caller: wallet.publicKey,
      solverLock: solverLockPDA,
      rentPayer: rentPayer,
      recipient: recipient,
      rewardRecipient: rewardRecipient,
      refundTo: refundTo,
      tokenMint: tokenMint,
      vault: vaultPDA,
      recipientTokenAccount: recipientATA,
      rewardRecipientTokenAccount: rewardRecipientATA,
      callerTokenAccount: callerATA,
      refundToTokenAccount: null,
      payoutCurveProgram: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nRedeem complete!");
}

main().catch(console.error);
