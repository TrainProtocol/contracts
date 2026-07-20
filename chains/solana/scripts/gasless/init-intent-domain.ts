import {
  getProgram, getProvider, loadWallet,
  deriveIntentDomainPDA, deriveProgramDataPDA, PROGRAM_ID,
  confirmTx, sha256,
  anchor,
} from "../helpers";

// Usage: npx ts-node scripts/gasless/init-intent-domain.ts [salt_seed]
// One-time initialization of the intent domain (upgrade authority only).
// The 32-byte domain salt is sha256 of the INTENT_DOMAIN_SALT env var, or of
// the salt_seed CLI argument if no env var is set.
//
// WARNING: the salt MUST be different on every cluster (localnet/devnet/
// mainnet) the program is deployed to — otherwise a signed intent for one
// cluster can be replayed on another.
async function main() {
  const args = process.argv.slice(2);
  const saltSeed = process.env.INTENT_DOMAIN_SALT || args[0];
  if (!saltSeed) {
    console.error("Missing salt: set INTENT_DOMAIN_SALT in .env or pass salt_seed as an argument");
    process.exit(1);
  }

  const program = getProgram();
  const provider = getProvider();
  const wallet = loadWallet();

  const salt = sha256(Buffer.from(saltSeed, "utf-8"));
  const [intentDomainPDA] = deriveIntentDomainPDA();
  const [programDataPDA] = deriveProgramDataPDA();

  console.log("=== Initialize Intent Domain ===");
  console.log("WARNING: the domain salt must differ across clusters — a shared");
  console.log("salt lets signed intents be replayed on another cluster.");
  console.log("Authority:       ", wallet.publicKey.toBase58());
  console.log("IntentDomain PDA:", intentDomainPDA.toBase58());
  console.log("Salt (sha256):   ", salt.toString("hex"));

  const sig = await program.methods
    .initializeIntentDomain(Array.from(salt))
    .accounts({
      authority: wallet.publicKey,
      intentDomain: intentDomainPDA,
      program: PROGRAM_ID,
      programData: programDataPDA,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .signers([wallet])
    .rpc();

  await confirmTx(provider, sig);
  console.log("\nIntent domain initialized!");
}

main().catch(console.error);
