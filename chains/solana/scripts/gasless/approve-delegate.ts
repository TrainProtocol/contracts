import {
  getProvider, loadWallet, deriveDelegatePDA,
  confirmTx, requireArg,
  BN, PublicKey,
} from "../helpers";
import { getAssociatedTokenAddressSync, createApproveInstruction } from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";

// Usage: npx ts-node scripts/gasless/approve-delegate.ts <token_mint> <amount>
// One-time SPL approve of the program's delegate PDA over the wallet's ATA
// (Permit2-allowance analog). Required before signed intents (rail C) can
// pull tokens on the wallet's behalf. amount is in token base units.
async function main() {
  const args = process.argv.slice(2);
  const tokenMint = new PublicKey(requireArg(args, 0, "token_mint"));
  const amount = new BN(requireArg(args, 1, "amount"));

  const provider = getProvider();
  const wallet = loadWallet();

  const [delegatePDA] = deriveDelegatePDA();
  const ata = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);

  console.log("=== Approve Delegate ===");
  console.log("Token Mint:  ", tokenMint.toBase58());
  console.log("Owner ATA:   ", ata.toBase58());
  console.log("Delegate PDA:", delegatePDA.toBase58());
  console.log("Amount:      ", amount.toString());

  const tx = new Transaction().add(
    createApproveInstruction(ata, delegatePDA, wallet.publicKey, BigInt(amount.toString()))
  );
  const sig = await provider.sendAndConfirm(tx, [wallet]);

  await confirmTx(provider, sig);
  console.log("\nDelegate approved!");
}

main().catch(console.error);
