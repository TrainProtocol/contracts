import {
  getProgram, getProvider, loadWallet,
  deriveConsumedIntentPDA, fetchConsumedIntent,
  confirmTx, requireArg, PublicKey,
} from "../helpers";

// Usage: npx ts-node scripts/gasless/close-consumed-intent.ts <user_pubkey> <nonce>
// Closes an expired ConsumedIntent account (deadline passed); the rent is
// returned to the stored rent payer (the relayer that executed the intent).
async function main() {
  const args = process.argv.slice(2);
  const user = new PublicKey(requireArg(args, 0, "user_pubkey"));
  const nonce = Number(requireArg(args, 1, "nonce"));

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const [consumedIntentPDA] = deriveConsumedIntentPDA(user, nonce);

  const intent = await fetchConsumedIntent(program, consumedIntentPDA);
  const rentPayer = intent.rentPayer as any;

  console.log("=== Close Consumed Intent ===");
  console.log("User / nonce:", user.toBase58(), nonce);
  console.log("ConsumedIntent PDA:", consumedIntentPDA.toBase58());
  console.log("Deadline:", new Date((intent.deadline as any).toNumber() * 1000).toISOString());
  console.log("Rent Payer (rent to):", rentPayer.toBase58());

  const sig = await program.methods
    .closeConsumedIntent()
    .accounts({
      caller: wallet.publicKey,
      consumedIntent: consumedIntentPDA,
      rentPayer: rentPayer,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nConsumed intent closed, rent reclaimed!");
}

main().catch(console.error);
