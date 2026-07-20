// Shared helpers for the Train HTLC test suite (no tests in this file).
import * as anchor from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { createHash, randomBytes } from "crypto";
import nacl from "tweetnacl";

export const BN = (anchor as any).default?.BN ?? (anchor as any).BN;
export type Program = anchor.Program;
export const {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} = anchor.web3;
export type PublicKeyT = anchor.web3.PublicKey;
export type KeypairT = anchor.web3.Keypair;

export const STATUS_EMPTY = 0;
export const STATUS_PENDING = 1;
export const STATUS_REFUNDED = 2;
export const STATUS_REDEEMED = 3;

export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

// ─── Hashlock / secrets ─────────────────────────────────────────────────────────

export function generateHashlock(): { secret: number[]; hashlock: number[] } {
  const secretBuf = randomBytes(32);
  const hashlockBuf = createHash("sha256").update(secretBuf).digest();
  return { secret: Array.from(secretBuf), hashlock: Array.from(hashlockBuf) };
}

export function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function indexToLeBytes(index: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(index));
  return buf;
}

export function u64Le(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

// ─── PDA derivation ──────────────────────────────────────────────────────────────

export function deriveUserLock(programId: PublicKeyT, hashlock: number[]) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_lock"), Buffer.from(hashlock)],
    programId
  );
}

export function deriveUserVault(programId: PublicKeyT, hashlock: number[]) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_vault"), Buffer.from(hashlock)],
    programId
  );
}

export function deriveSolverLock(
  programId: PublicKeyT,
  hashlock: number[],
  index: number
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_lock"), Buffer.from(hashlock), indexToLeBytes(index)],
    programId
  );
}

export function deriveSolverVault(
  programId: PublicKeyT,
  hashlock: number[],
  index: number
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_vault"), Buffer.from(hashlock), indexToLeBytes(index)],
    programId
  );
}

export function deriveSolverRewardVault(
  programId: PublicKeyT,
  hashlock: number[],
  index: number
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("solver_reward_vault"),
      Buffer.from(hashlock),
      indexToLeBytes(index),
    ],
    programId
  );
}

export function deriveSolverCount(programId: PublicKeyT, hashlock: number[]) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_count"), Buffer.from(hashlock)],
    programId
  );
}

export function deriveIntentDomain(programId: PublicKeyT) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("intent_domain")],
    programId
  );
}

export function deriveDelegate(programId: PublicKeyT) {
  return PublicKey.findProgramAddressSync([Buffer.from("delegate")], programId);
}

export function deriveConsumedIntent(
  programId: PublicKeyT,
  user: PublicKeyT,
  nonce: number | bigint
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("intent"), user.toBuffer(), u64Le(nonce)],
    programId
  );
}

export function deriveProgramData(programId: PublicKeyT) {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_ID
  );
}

// ─── Params builders ─────────────────────────────────────────────────────────────

export interface UserLockParamsInput {
  hashlock: number[];
  amount: number | InstanceType<typeof BN>;
  timelockDelta?: number;
  quoteExpiry?: number;
  recipient: PublicKeyT;
  refundTo: PublicKeyT;
  payoutCurve?: PublicKeyT;
  payoutCurveData?: Buffer;
}

export function userLockParams(input: UserLockParamsInput) {
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
    dstAddress: "0x1234567890abcdef1234567890abcdef12345678",
    dstAmount: new BN(1000),
    dstToken: "ETH",
    rewardAmount: new BN(0),
    rewardToken: "",
    rewardRecipient: "",
    rewardTimelockDelta: new BN(0),
  };
}

export interface SolverLockParamsInput {
  hashlock: number[];
  index: number;
  amount: number | InstanceType<typeof BN>;
  reward?: number | InstanceType<typeof BN>;
  timelockDelta?: number;
  rewardTimelockDelta?: number;
  recipient: PublicKeyT;
  rewardRecipient?: PublicKeyT;
  refundTo: PublicKeyT;
  payoutCurve?: PublicKeyT;
  payoutCurveData?: Buffer;
}

export function solverLockParams(input: SolverLockParamsInput) {
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
    srcChain: "solana",
    dstChain: "ethereum",
    dstAddress: "0x1234567890abcdef1234567890abcdef12345678",
    dstAmount: new BN(1000),
    dstToken: "ETH",
  };
}

// ─── Intent message (must mirror programs/train-htlc/src/intent.rs) ─────────────

export const INTENT_DOMAIN_TAG = Buffer.from("TRAIN_INTENT_V1\0", "ascii");

function borshVecU8(data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length);
  return Buffer.concat([len, data]);
}

export function computeCallHash(
  program: Program,
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
  programId: PublicKeyT;
  domainSalt: Buffer;
  user: PublicKeyT;
  mint: PublicKeyT;
  amount: number | bigint;
  callHash: Buffer;
  nonce: number | bigint;
  deadline: number | bigint;
}): Buffer {
  return Buffer.concat([
    INTENT_DOMAIN_TAG,
    args.programId.toBuffer(),
    args.domainSalt,
    args.user.toBuffer(),
    args.mint.toBuffer(),
    u64Le(args.amount),
    args.callHash,
    u64Le(args.nonce),
    u64Le(args.deadline),
  ]);
}

export function signIntent(message: Buffer, user: KeypairT): Buffer {
  return Buffer.from(nacl.sign.detached(message, user.secretKey));
}

/** The user signs the sha256 digest of the canonical intent message (EIP-712
 * style), keeping the relayer's transaction under the packet-size limit. */
export function ed25519VerifyIx(user: KeypairT, message: Buffer) {
  const digest = sha256(message);
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: user.publicKey.toBytes(),
    message: digest,
    signature: signIntent(digest, user),
  });
}

// ─── Assertions ──────────────────────────────────────────────────────────────────

export async function expectError(
  promise: Promise<unknown>,
  substring: string
): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    const text = `${err}${err?.logs ? "\n" + err.logs.join("\n") : ""}`;
    if (!text.includes(substring)) {
      throw new Error(`Expected error containing "${substring}", got: ${text}`);
    }
    return;
  }
  throw new Error(`Expected error containing "${substring}" but call succeeded`);
}

export { splToken };
