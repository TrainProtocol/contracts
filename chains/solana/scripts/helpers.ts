import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Load IDL
const idlPath = path.join(__dirname, "..", "target", "idl", "train_htlc.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;

export const PROGRAM_ID = new PublicKey('ADwgQuJzWCrxEgsBR5EwGmvqD12xLbAW316KG8L2f8BL');

// Wallet name → .env variable mapping
const WALLET_ENV_MAP: Record<string, string> = {
  default: "DEFAULT_KEY",
  solver: "SOLVER_KEY",
  thirdparty: "THIRDPARTY_KEY",
};

/**
 * Load a wallet keypair. Resolution order:
 * 1. WALLET env var — use a named wallet from .env (e.g. WALLET=solver)
 * 2. ANCHOR_WALLET env var — use a keypair file path
 * 3. Default: ~/.config/solana/id.json
 */
export function loadWallet(): Keypair {
  const walletName = process.env.WALLET?.toLowerCase();
  if (walletName) {
    const envVar = WALLET_ENV_MAP[walletName];
    if (!envVar) {
      console.error(`Unknown wallet name: "${walletName}". Use: ${Object.keys(WALLET_ENV_MAP).join(", ")}`);
      process.exit(1);
    }
    const raw = process.env[envVar];
    if (!raw) {
      console.error(`${envVar} not found in .env`);
      process.exit(1);
    }
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME!, ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function getProvider(): AnchorProvider {
  const wallet = loadWallet();
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );
  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  return provider;
}

export function getProgram(): Program<Idl> {
  const provider = getProvider();
  return new Program(idl, provider);
}

// Typed account fetch helpers (workaround for generic Idl type)
export async function fetchUserLock(program: Program<Idl>, pda: PublicKey): Promise<any> {
  return (program.account as any).userLock.fetch(pda);
}

export async function fetchSolverLock(program: Program<Idl>, pda: PublicKey): Promise<any> {
  return (program.account as any).solverLock.fetch(pda);
}

export async function fetchSolverLockCounter(program: Program<Idl>, pda: PublicKey): Promise<any> {
  return (program.account as any).solverLockCounter.fetch(pda);
}

// PDA derivation helpers
export function deriveUserLockPDA(hashlock: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_lock"), hashlock],
    PROGRAM_ID
  );
}

export function deriveUserVaultPDA(hashlock: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_vault"), hashlock],
    PROGRAM_ID
  );
}

export function deriveSolverLockPDA(
  hashlock: Buffer,
  index: number
): [PublicKey, number] {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(index));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_lock"), hashlock, indexBuf],
    PROGRAM_ID
  );
}

export function deriveSolverVaultPDA(
  hashlock: Buffer,
  index: number
): [PublicKey, number] {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(index));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_vault"), hashlock, indexBuf],
    PROGRAM_ID
  );
}

export function deriveSolverRewardVaultPDA(
  hashlock: Buffer,
  index: number
): [PublicKey, number] {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(index));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_reward_vault"), hashlock, indexBuf],
    PROGRAM_ID
  );
}

export function deriveSolverCountPDA(hashlock: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_count"), hashlock],
    PROGRAM_ID
  );
}

// Hashlock helpers
export function generateHashlock(): { secret: Buffer; hashlock: Buffer } {
  const secret = Buffer.from(require("crypto").randomBytes(32));
  const hashlock = Buffer.from(
    createHash("sha256").update(secret).digest()
  );
  return { secret, hashlock };
}

export function computeHashlock(secret: Buffer): Buffer {
  return Buffer.from(createHash("sha256").update(secret).digest());
}

export function parseHex(hex: string): Buffer {
  return Buffer.from(hex.replace("0x", ""), "hex");
}

export function toArray32(buf: Buffer): number[] {
  return Array.from(Uint8Array.from(buf).slice(0, 32));
}

// Transaction confirmation
export async function confirmTx(
  provider: AnchorProvider,
  sig: string
): Promise<void> {
  await provider.connection.confirmTransaction(sig, "confirmed");
  const cluster = provider.connection.rpcEndpoint.includes("devnet")
    ? "devnet"
    : provider.connection.rpcEndpoint.includes("mainnet")
    ? "mainnet-beta"
    : "custom";
  console.log(`TX: ${sig}`);
  if (cluster !== "custom") {
    console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=${cluster}`);
  }
}

// Argument parsing helpers
export function requireArg(args: string[], index: number, name: string): string {
  if (!args[index]) {
    console.error(`Missing argument: ${name}`);
    process.exit(1);
  }
  return args[index];
}

export { anchor, BN, PublicKey, Keypair };
