import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import {
  PublicKey, Connection, Keypair, clusterApiUrl, Ed25519Program,
} from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import nacl from "tweetnacl";

// Load .env from project root
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Load IDL
const idlPath = path.join(__dirname, "..", "target", "idl", "train_htlc.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;

export const PROGRAM_ID = new PublicKey('2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ');

// Wallet name → .env variable mapping
const WALLET_ENV_MAP: Record<string, string> = {
  default: "DEFAULT_KEY",
  solver: "SOLVER_KEY",
  thirdparty: "THIRDPARTY_KEY",
  user: "USER_KEY",
};

/** Load a keypair from a named .env variable (e.g. "USER_KEY"). */
export function loadWalletFromEnv(envVar: string): Keypair {
  const raw = process.env[envVar];
  if (!raw) {
    console.error(`${envVar} not found in .env`);
    process.exit(1);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

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

export async function fetchIntentDomain(program: Program<Idl>, pda: PublicKey): Promise<any> {
  return (program.account as any).intentDomain.fetch(pda);
}

export async function fetchConsumedIntent(program: Program<Idl>, pda: PublicKey): Promise<any> {
  return (program.account as any).consumedIntent.fetch(pda);
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

export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export function deriveIntentDomainPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("intent_domain")],
    PROGRAM_ID
  );
}

export function deriveDelegatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("delegate")], PROGRAM_ID);
}

export function deriveConsumedIntentPDA(
  user: PublicKey,
  nonce: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("intent"), user.toBuffer(), u64Le(nonce)],
    PROGRAM_ID
  );
}

export function deriveProgramDataPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_LOADER_UPGRADEABLE_ID
  );
}

// ─── Params builders ───────────────────────────────────────────────────────────

export interface UserLockParamsInput {
  hashlock: number[];
  amount: InstanceType<typeof BN> | number | string;
  timelockDelta?: InstanceType<typeof BN> | number | string;
  quoteExpiry?: InstanceType<typeof BN> | number | string;
  recipient: PublicKey;
  refundTo: PublicKey;
  payoutCurve?: PublicKey;
  payoutCurveData?: Buffer;
}

export function userLockParams(
  input: UserLockParamsInput,
  overrides: Record<string, unknown> = {}
) {
  return {
    hashlock: input.hashlock,
    amount: new BN(input.amount),
    timelockDelta: new BN(input.timelockDelta ?? 3600),
    quoteExpiry: new BN(input.quoteExpiry ?? Math.floor(Date.now() / 1000) + 600),
    recipient: input.recipient,
    refundTo: input.refundTo,
    payoutCurve: input.payoutCurve ?? PublicKey.default,
    payoutCurveData: input.payoutCurveData ?? Buffer.from([]),
    srcChain: "solana",
    dstChain: "ethereum",
    dstAddress: "0x0000000000000000000000000000000000000000",
    dstAmount: new BN(0),
    dstToken: "ETH",
    rewardAmount: new BN(0),
    rewardToken: "",
    rewardRecipient: "",
    rewardTimelockDelta: new BN(0),
    ...overrides,
  };
}

export interface SolverLockParamsInput {
  hashlock: number[];
  index: number;
  amount: InstanceType<typeof BN> | number | string;
  reward?: InstanceType<typeof BN> | number | string;
  timelockDelta?: InstanceType<typeof BN> | number | string;
  rewardTimelockDelta?: InstanceType<typeof BN> | number | string;
  recipient: PublicKey;
  rewardRecipient?: PublicKey;
  refundTo: PublicKey;
  payoutCurve?: PublicKey;
  payoutCurveData?: Buffer;
}

export function solverLockParams(
  input: SolverLockParamsInput,
  overrides: Record<string, unknown> = {}
) {
  return {
    hashlock: input.hashlock,
    index: new BN(input.index),
    amount: new BN(input.amount),
    reward: new BN(input.reward ?? 0),
    timelockDelta: new BN(input.timelockDelta ?? 3600),
    rewardTimelockDelta: new BN(input.rewardTimelockDelta ?? 0),
    recipient: input.recipient,
    rewardRecipient: input.rewardRecipient ?? PublicKey.default,
    refundTo: input.refundTo,
    payoutCurve: input.payoutCurve ?? PublicKey.default,
    payoutCurveData: input.payoutCurveData ?? Buffer.from([]),
    srcChain: "ethereum",
    dstChain: "solana",
    dstAddress: "",
    dstAmount: new BN(0),
    dstToken: "SOL",
    ...overrides,
  };
}

// ─── Intent message (must mirror programs/train-htlc/src/intent.rs) ────────────

export const INTENT_DOMAIN_TAG = Buffer.from("TRAIN_INTENT_V1\0", "ascii");

export function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

export function u64Le(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function borshVecU8(data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length);
  return Buffer.concat([len, data]);
}

export function computeCallHash(
  program: Program<Idl>,
  params: ReturnType<typeof userLockParams>,
  userData: Buffer,
  solverData: Buffer
): Buffer {
  const paramsBytes = program.coder.types.encode("userLockParams", params);
  return sha256(
    Buffer.concat([paramsBytes, borshVecU8(userData), borshVecU8(solverData)])
  );
}

export function buildIntentMessage(args: {
  domainSalt: Buffer;
  user: PublicKey;
  mint: PublicKey;
  amount: number | bigint;
  callHash: Buffer;
  nonce: number | bigint;
  deadline: number | bigint;
}): Buffer {
  return Buffer.concat([
    INTENT_DOMAIN_TAG,
    PROGRAM_ID.toBuffer(),
    args.domainSalt,
    args.user.toBuffer(),
    args.mint.toBuffer(),
    u64Le(args.amount),
    args.callHash,
    u64Le(args.nonce),
    u64Le(args.deadline),
  ]);
}

export function signIntent(message: Buffer, user: Keypair): Buffer {
  return Buffer.from(nacl.sign.detached(message, user.secretKey));
}

/** The user signs the sha256 digest of the canonical intent message (EIP-712
 * style), keeping the relayer's transaction under the packet-size limit. */
export function ed25519VerifyIx(user: Keypair, message: Buffer) {
  const digest = sha256(message);
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: user.publicKey.toBytes(),
    message: digest,
    signature: signIntent(digest, user),
  });
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
