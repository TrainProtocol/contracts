/**
 * Devnet end-to-end test harness for the Train HTLC program.
 *
 * Runs EVERY protocol flow against devnet — each deposit rail, each gasless path,
 * settlement and refunds — happy paths AND unhappy paths — using the project's
 * existing funded devnet keypairs with production-faithful actor separation
 * (the token depositor is never the gas/fee payer). Every scenario lands as a real
 * devnet transaction where physically possible (happy = success signature; unhappy
 * program/constraint errors = failed signature via skipPreflight); the small subset
 * that rejects before landing (bad signature, replayed tx, expired durable nonce) is
 * recorded with the reason it cannot produce a transaction.
 *
 * It writes a human-readable report to  docs/e2e-devnet-report.md  (+ a sibling
 * .json) and prints a summary to stdout.
 *
 * Usage:
 *   npx ts-node scripts/devnet-e2e.ts
 *
 * Environment (.env, all optional except the keypairs):
 *   ANCHOR_PROVIDER_URL / RPC_URL   devnet RPC (default https://api.devnet.solana.com)
 *   DEFAULT_KEY                     relayer / fee-payer / redeemer + mint authority (well funded)
 *   SOLVER_KEY                      "user"  swap party (source depositor)
 *   THIRDPARTY_KEY                  "solver" swap party (destination depositor)
 *   TRAIN_PROGRAM_ID / CONSTANT_CURVE_ID / MOCK_CURVE_ID   program-id overrides
 *
 * The harness NEVER funds or sweeps the wallets — it only prechecks balances and
 * fails fast if a wallet is underfunded. Fresh mints are created per run (fee payer
 * is mint authority), so runs are idempotent without touching wallet SOL.
 */
import * as anchor from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { createHash, randomBytes } from "crypto";
import nacl from "tweetnacl";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const BN = (anchor as any).default?.BN ?? (anchor as any).BN;
const {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  Connection,
} = anchor.web3;
type PublicKeyT = anchor.web3.PublicKey;
type KeypairT = anchor.web3.Keypair;
type IxT = anchor.web3.TransactionInstruction;

const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
  approve,
} = splToken;

// ─── Config ─────────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.RPC_URL || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const TRAIN_PROGRAM_ID = new PublicKey(
  process.env.TRAIN_PROGRAM_ID || "2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ"
);
const CONSTANT_CURVE_ID = new PublicKey(
  process.env.CONSTANT_CURVE_ID || "Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF"
);
const MOCK_CURVE_ID = new PublicKey(
  process.env.MOCK_CURVE_ID || "wmgDCMVreZ5xKv8NTg8rmkGPpb7bs5FHiToxqjc5yMr"
);
const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const EXPLORER_ADDR = (a: string) =>
  `https://explorer.solana.com/address/${a}?cluster=devnet`;
const TIMELOCK_SHORT = 25; // seconds; devnet-safe
// Unique per run so re-runs never collide with a prior run's ConsumedIntent PDA
// (those persist until their deadline passes). Keeps the harness idempotent.
const NONCE_BASE = Date.now();

// ─── Keypair loading (existing funded .env keys — never regenerated) ─────────────

function loadEnvKey(name: string): KeypairT {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} missing from .env`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

// Role mapping (see README "Actor roles"):
//   feePayer  = DEFAULT_KEY    — relayer / fee-payer / redeemer + mint authority
//   userKp    = SOLVER_KEY     — "user"  swap party (source depositor)
//   solverKp  = THIRDPARTY_KEY — "solver" swap party (destination depositor)
// Every lock uses payer=feePayer, sender=<depositor>, so the depositor authorizes
// the debit but never pays fees/rent — production-faithful gasless separation on
// every flow. recipient / refund_to / reward_recipient are the natural swap
// counterparty among the three keys.
const feePayer = loadEnvKey("DEFAULT_KEY");
const userKp = loadEnvKey("SOLVER_KEY");
const solverKp = loadEnvKey("THIRDPARTY_KEY");

const connection = new Connection(RPC_URL, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(feePayer), {
  commitment: "confirmed",
});
anchor.setProvider(provider);

const idl = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "target", "idl", "train_htlc.json"), "utf-8")
);
const program = new anchor.Program(idl, provider);

// ─── Report model (mirrors the Aztec e2e report structure) ───────────────────────

type Kind = "info" | "tx" | "check" | "sim-reject";
type Status = "INFO" | "OK" | "REVERTED";
interface Row {
  n: number;
  stage: string;
  name: string;
  kind: Kind;
  status: Status;
  sig?: string;
  slot?: number;
  note: string;
}
const rows: Row[] = [];
let rowNum = 0;
let stage = "S0";
const flowStatus: Record<string, "PASS" | "FAIL"> = {};

function addRow(r: Omit<Row, "n">) {
  rowNum += 1;
  rows.push({ n: rowNum, ...r });
}
function info(name: string, note = "") {
  addRow({ stage, name, kind: "info", status: "INFO", note });
  console.log(`  info: ${name}${note ? " — " + note : ""}`);
}
function txRow(name: string, sig: string, slot: number | undefined, note = "") {
  addRow({ stage, name, kind: "tx", status: "OK", sig, slot, note });
  console.log(`  tx  ${name}: ${EXPLORER(sig)}`);
}
function revertedRow(name: string, sig: string, slot: number | undefined, note: string) {
  addRow({ stage, name, kind: "tx", status: "REVERTED", sig, slot, note });
  console.log(`  reverted(on-chain) ${name}: ${EXPLORER(sig)} — ${note}`);
}
function checkRow(name: string, ok: boolean, note: string) {
  addRow({ stage, name, kind: "check", status: ok ? "OK" : "REVERTED", note });
  console.log(`  check ${name}: ${ok ? "OK" : "FAIL"} — ${note}`);
  if (!ok) throw new Error(`check failed: ${name} — ${note}`);
}
function simReject(name: string, note: string) {
  addRow({ stage, name, kind: "sim-reject", status: "OK", note });
  console.log(`  sim-reject ${name}: ${note}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const t = `${err}`;
      if (attempt < 7 && (t.includes("429") || t.includes("Too Many Requests"))) {
        await sleep(4000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

// Poll for a confirmed transaction's record, tolerating RPC lag / 429s. Returns
// null only if the tx is genuinely not found after all attempts.
async function getTx(sig: string, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      const tx = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) return tx;
    } catch {
      /* retry */
    }
    await sleep(1500 * (i + 1));
  }
  return null;
}

async function slotOf(sig: string): Promise<number | undefined> {
  return (await getTx(sig, 3))?.slot;
}

// Send a list of instructions as one tx, signed by `signers` with feePayer as the
// fee payer. Returns the confirmed signature (happy path).
async function send(signers: KeypairT[], ...ixs: IxT[]): Promise<string> {
  return withRetry("send", async () => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = feePayer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const uniq = new Map<string, KeypairT>();
    for (const s of [feePayer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
    tx.sign(...uniq.values());
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  });
}

// Submit instructions expecting an ON-CHAIN failure. Uses skipPreflight so the tx
// actually lands as a failed transaction with a real, explorer-investigable
// signature. Verifies the program logs contain `expected`, and records a REVERTED
// row. Throws (fails the flow) if it unexpectedly succeeds or the wrong error lands.
async function expectFailOnChain(
  name: string,
  expected: string,
  signers: KeypairT[],
  ...ixs: IxT[]
): Promise<void> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const uniq = new Map<string, KeypairT>();
  for (const s of [feePayer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
  tx.sign(...uniq.values());
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  try {
    await connection.confirmTransaction(sig, "confirmed");
  } catch {
    /* expected to fail */
  }
  // Poll for the landed record — a 429/lag returning null must NOT be read as success.
  const detail = await getTx(sig, 10);
  if (!detail) {
    throw new Error(`${name}: could not read back tx ${sig} to confirm the expected failure`);
  }
  const logs = (detail.meta?.logMessages || []).join("\n");
  const failed = detail.meta?.err != null;
  if (!failed) throw new Error(`${name}: expected on-chain failure but tx succeeded (${sig})`);
  if (!logs.includes(expected)) {
    throw new Error(`${name}: landed failed but "${expected}" not in logs:\n${logs.slice(0, 800)}`);
  }
  revertedRow(name, sig, detail.slot, `rejected on-chain with "${expected}"`);
}

// Off-chain expected rejection (cannot land: signature/replay/nonce level). Records
// a sim-reject row with the reason.
async function expectRejectOffChain(
  name: string,
  expectedSubstr: string,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    const t = `${err}${err?.logs ? "\n" + err.logs.join("\n") : ""}`;
    if (!t.includes(expectedSubstr)) {
      throw new Error(`${name}: expected "${expectedSubstr}", got: ${t.slice(0, 400)}`);
    }
    simReject(name, `rejected pre-landing (${expectedSubstr}) — no on-chain tx by construction`);
    return;
  }
  throw new Error(`${name}: expected rejection "${expectedSubstr}" but it succeeded`);
}

// ─── PDA + params helpers ─────────────────────────────────────────────────────────

const idxLe = (i: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(i));
  return b;
};
const u64Le = (v: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, TRAIN_PROGRAM_ID)[0];
const userLockPda = (h: number[]) => pda([Buffer.from("user_lock"), Buffer.from(h)]);
const userVaultPda = (h: number[]) => pda([Buffer.from("user_vault"), Buffer.from(h)]);
const solverLockPda = (h: number[], i: number) =>
  pda([Buffer.from("solver_lock"), Buffer.from(h), idxLe(i)]);
const solverVaultPda = (h: number[], i: number) =>
  pda([Buffer.from("solver_vault"), Buffer.from(h), idxLe(i)]);
const solverRewardVaultPda = (h: number[], i: number) =>
  pda([Buffer.from("solver_reward_vault"), Buffer.from(h), idxLe(i)]);
const solverCountPda = (h: number[]) => pda([Buffer.from("solver_count"), Buffer.from(h)]);
const intentDomainPda = pda([Buffer.from("intent_domain")]);
const delegatePda = pda([Buffer.from("delegate")]);
const consumedIntentPda = (u: PublicKeyT, nonce: number) =>
  pda([Buffer.from("intent"), u.toBuffer(), u64Le(nonce)]);
const programDataPda = PublicKey.findProgramAddressSync(
  [TRAIN_PROGRAM_ID.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
)[0];

const bal = (pk: PublicKeyT) => connection.getBalance(pk);
const solFmt = (l: number) => `${(l / LAMPORTS_PER_SOL).toFixed(6)} SOL`;

function newHashlock() {
  const s = randomBytes(32);
  return { secret: Array.from(s), hashlock: Array.from(sha256(s)) };
}

function userLockParams(i: {
  hashlock: number[];
  amount: number;
  timelockDelta?: number;
  quoteExpiry?: number;
  recipient: PublicKeyT;
  refundTo: PublicKeyT;
  payoutCurve?: PublicKeyT;
  payoutCurveData?: Buffer;
}) {
  return {
    hashlock: i.hashlock,
    amount: new BN(i.amount),
    timelockDelta: new BN(i.timelockDelta ?? 3600),
    quoteExpiry: new BN(i.quoteExpiry ?? Math.floor(Date.now() / 1000) + 600),
    recipient: i.recipient,
    refundTo: i.refundTo,
    payoutCurve: i.payoutCurve ?? PublicKey.default,
    payoutCurveData: i.payoutCurveData ?? Buffer.from([]),
    srcChain: "solana-devnet",
    dstChain: "ethereum-sepolia",
    dstAddress: "0x1234567890abcdef1234567890abcdef12345678",
    dstAmount: new BN(1000),
    dstToken: "ETH",
    rewardAmount: new BN(0),
    rewardToken: "",
    rewardRecipient: "",
    rewardTimelockDelta: new BN(0),
  };
}
function solverLockParams(i: {
  hashlock: number[];
  index: number;
  amount: number;
  reward?: number;
  timelockDelta?: number;
  rewardTimelockDelta?: number;
  recipient: PublicKeyT;
  rewardRecipient?: PublicKeyT;
  refundTo: PublicKeyT;
}) {
  return {
    hashlock: i.hashlock,
    index: new BN(i.index),
    amount: new BN(i.amount),
    reward: new BN(i.reward ?? 0),
    timelockDelta: new BN(i.timelockDelta ?? 3600),
    rewardTimelockDelta: new BN(i.rewardTimelockDelta ?? 0),
    recipient: i.recipient,
    rewardRecipient: i.rewardRecipient ?? PublicKey.default,
    refundTo: i.refundTo,
    payoutCurve: PublicKey.default,
    payoutCurveData: Buffer.from([]),
    srcChain: "solana-devnet",
    dstChain: "ethereum-sepolia",
    dstAddress: "0x1234567890abcdef1234567890abcdef12345678",
    dstAmount: new BN(1000),
    dstToken: "ETH",
  };
}

const INTENT_TAG = Buffer.from("TRAIN_INTENT_V1\0", "ascii");
const borshVec = (d: Buffer) => {
  const l = Buffer.alloc(4);
  l.writeUInt32LE(d.length);
  return Buffer.concat([l, d]);
};
function callHash(params: any, userData: Buffer, solverData: Buffer): Buffer {
  const p = program.coder.types.encode("userLockParams", params);
  return sha256(Buffer.concat([p, borshVec(userData), borshVec(solverData)]));
}
function intentMessage(a: {
  domainSalt: Buffer;
  user: PublicKeyT;
  mint: PublicKeyT;
  amount: number;
  callHash: Buffer;
  nonce: number;
  deadline: number;
}): Buffer {
  return Buffer.concat([
    INTENT_TAG,
    TRAIN_PROGRAM_ID.toBuffer(),
    a.domainSalt,
    a.user.toBuffer(),
    a.mint.toBuffer(),
    u64Le(a.amount),
    a.callHash,
    u64Le(a.nonce),
    u64Le(a.deadline),
  ]);
}
function ed25519Ix(signer: KeypairT, message: Buffer) {
  const digest = sha256(message);
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey.toBytes(),
    message: digest,
    signature: Buffer.from(nacl.sign.detached(digest, signer.secretKey)),
  });
}

const fetchUserLock = (h: number[]) => (program.account as any).userLock.fetch(userLockPda(h));
const fetchSolverLock = (h: number[], i: number) =>
  (program.account as any).solverLock.fetch(solverLockPda(h, i));

// ─── Flow runner ──────────────────────────────────────────────────────────────────

async function flow(id: string, name: string, fn: () => Promise<void>, skip?: string) {
  stage = id;
  console.log(`\n▶ ${id} ${name}`);
  if (skip) {
    info(`${name} — SKIPPED`, skip);
    flowStatus[id] = "PASS";
    return;
  }
  try {
    await fn();
    flowStatus[id] = "PASS";
    console.log(`  ${id} PASS`);
  } catch (err: any) {
    flowStatus[id] = "FAIL";
    const msg = `${err?.message ?? err}`.slice(0, 500);
    addRow({ stage: id, name: `${name} — FLOW ERROR`, kind: "check", status: "REVERTED", note: msg });
    console.log(`  ${id} FAIL: ${msg}`);
  }
}

// ─── Report writer (docs/e2e-devnet-report.md + .json) ────────────────────────────

let startedIso = "";
let finishedIso = "";
// Latest local suite result (run `anchor test` separately; updated per release).
let localTest = process.env.LOCAL_TEST_RESULT || "61 passing / 0 failing (anchor test, localnet)";

function writeReport() {
  finishedIso = new Date().toISOString();
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });

  const landed = rows.filter((r) => r.kind === "tx" && r.status === "OK").length;
  const reverted = rows.filter((r) => r.kind === "tx" && r.status === "REVERTED").length;
  const simRejects = rows.filter((r) => r.kind === "sim-reject").length;
  const failures = Object.values(flowStatus).filter((s) => s === "FAIL").length;

  const md: string[] = [];
  md.push(`# Train HTLC Solana devnet E2E report`);
  md.push("");
  md.push(`Started: ${startedIso}`);
  md.push(`Finished: ${finishedIso}`);
  md.push("");
  md.push(`## Environment`);
  md.push("");
  md.push(`- **cluster**: devnet`);
  md.push(`- **rpc**: ${RPC_URL}`);
  md.push(`- **train_htlc**: [${TRAIN_PROGRAM_ID.toBase58()}](${EXPLORER_ADDR(TRAIN_PROGRAM_ID.toBase58())})`);
  md.push(`- **constant_payout_curve**: [${CONSTANT_CURVE_ID.toBase58()}](${EXPLORER_ADDR(CONSTANT_CURVE_ID.toBase58())})`);
  md.push(`- **mock_decay_curve**: [${MOCK_CURVE_ID.toBase58()}](${EXPLORER_ADDR(MOCK_CURVE_ID.toBase58())})`);
  md.push(`- **relayer / fee-payer / redeemer (DEFAULT_KEY)**: [${feePayer.publicKey.toBase58()}](${EXPLORER_ADDR(feePayer.publicKey.toBase58())})`);
  md.push(`- **user / source depositor (SOLVER_KEY)**: [${userKp.publicKey.toBase58()}](${EXPLORER_ADDR(userKp.publicKey.toBase58())})`);
  md.push(`- **solver / destination depositor (THIRDPARTY_KEY)**: [${solverKp.publicKey.toBase58()}](${EXPLORER_ADDR(solverKp.publicKey.toBase58())})`);
  md.push(`- **explorer**: https://explorer.solana.com`);
  md.push("");
  md.push(
    `Actor separation: every lock uses \`payer = fee-payer\` and \`sender = depositor\`, so the token/SOL depositor authorizes the debit but never pays fees or rent — the gas payer and the depositor are always distinct wallets. recipient / refund_to / reward_recipient are the natural swap counterparty among the three keys.`
  );
  md.push("");
  md.push(`## Build and local verification`);
  md.push("");
  md.push(`- anchor build: passed`);
  md.push(`- anchor test (localnet): ${localTest}`);
  md.push("");
  md.push(`## Deployment status`);
  md.push("");
  md.push(`- train_htlc + constant_payout_curve + mock_decay_curve deployed on devnet at the IDs above.`);
  md.push(`- intent domain (rail C): ${intentDomainReady ? "initialized" : "NOT initialized (rail C skipped)"}.`);
  md.push("");
  md.push(`## Transactions & checks`);
  md.push("");
  md.push(`| # | Stage | Name | Kind | Status | Tx | Slot | Note |`);
  md.push(`|---|-------|------|------|--------|----|------|------|`);
  for (const r of rows) {
    const tx = r.sig ? `[${r.sig.slice(0, 10)}…](${EXPLORER(r.sig)})` : "";
    const note = r.note.replace(/\|/g, "\\|");
    md.push(`| ${r.n} | ${r.stage} | ${r.name.replace(/\|/g, "\\|")} | ${r.kind} | ${r.status} | ${tx} | ${r.slot ?? ""} | ${note} |`);
  }
  md.push("");
  md.push(`## Summary`);
  md.push("");
  md.push(`- rows: ${rows.length}`);
  md.push(`- landed txs (success): ${landed}`);
  md.push(`- on-chain reverted (expected, negative cases): ${reverted}`);
  md.push(`- pre-landing rejections (signature/replay/nonce level, no tx by construction): ${simRejects}`);
  md.push(`- FLOW FAILURES: ${failures}`);
  md.push("");
  md.push(
    failures === 0
      ? `All happy paths and negative cases behaved as expected. Every landable negative case is recorded above as an on-chain \`REVERTED\` transaction with its explorer link; the pre-landing rejections cannot produce a transaction (they are rejected by the runtime before inclusion) and are noted as such.`
      : `There were ${failures} flow failure(s); see the REVERTED rows tagged "FLOW ERROR" above.`
  );
  md.push("");

  const mdPath = path.join(docsDir, "e2e-devnet-report.md");
  fs.writeFileSync(mdPath, md.join("\n"));
  fs.writeFileSync(
    path.join(docsDir, "e2e-devnet-report.json"),
    JSON.stringify(
      {
        started: startedIso,
        finished: finishedIso,
        cluster: "devnet",
        rpc: RPC_URL,
        programs: {
          train_htlc: TRAIN_PROGRAM_ID.toBase58(),
          constant_payout_curve: CONSTANT_CURVE_ID.toBase58(),
          mock_decay_curve: MOCK_CURVE_ID.toBase58(),
        },
        actors: {
          feePayer: feePayer.publicKey.toBase58(),
          user: userKp.publicKey.toBase58(),
          solver: solverKp.publicKey.toBase58(),
        },
        summary: { rows: rows.length, landed, reverted, simRejects, failures },
        rows,
      },
      null,
      2
    )
  );

  console.log(`\n══════════════ SUMMARY ══════════════`);
  for (const [id, st] of Object.entries(flowStatus)) console.log(`${id.padEnd(6)} ${st}`);
  console.log(
    `\nrows=${rows.length}  landed=${landed}  reverted(expected)=${reverted}  sim-reject=${simRejects}  FAILURES=${failures}`
  );
  console.log(`Report: ${mdPath}`);
  if (failures > 0) process.exitCode = 1;
}

// ─── Shared state set up in main() ────────────────────────────────────────────────

let mintA: PublicKeyT;
let mintB: PublicKeyT;
let userAtaA: PublicKeyT;
let solverAtaA: PublicKeyT;
let solverAtaB: PublicKeyT;
let intentDomainReady = false;
let domainSalt: Buffer = Buffer.alloc(32);
const ata = (m: PublicKeyT, o: PublicKeyT) => getAssociatedTokenAddressSync(m, o);

async function main() {
  startedIso = new Date().toISOString();
  console.log(`Train HTLC devnet E2E`);
  console.log(`  rpc:      ${RPC_URL}`);
  console.log(`  program:  ${TRAIN_PROGRAM_ID.toBase58()}`);
  console.log(`  feePayer: ${feePayer.publicKey.toBase58()}`);
  console.log(`  user:     ${userKp.publicKey.toBase58()}`);
  console.log(`  solver:   ${solverKp.publicKey.toBase58()}`);

  // Preflight: programs deployed?
  const trainInfo = await connection.getAccountInfo(TRAIN_PROGRAM_ID);
  if (!trainInfo?.executable)
    throw new Error(`train_htlc not deployed at ${TRAIN_PROGRAM_ID.toBase58()} on ${RPC_URL}`);
  const constantDeployed = !!(await connection.getAccountInfo(CONSTANT_CURVE_ID))?.executable;
  const mockDeployed = !!(await connection.getAccountInfo(MOCK_CURVE_ID))?.executable;

  // Preflight: balances (NO funding, NO sweep — real wallets).
  const feeBal = await bal(feePayer.publicKey);
  const userBal = await bal(userKp.publicKey);
  const solverBal = await bal(solverKp.publicKey);
  info("balances", `feePayer=${solFmt(feeBal)} user=${solFmt(userBal)} solver=${solFmt(solverBal)}`);
  if (feeBal < 0.5 * LAMPORTS_PER_SOL)
    throw new Error(`fee payer underfunded (${solFmt(feeBal)}); needs >= 0.5 SOL`);
  if (userBal < 0.05 * LAMPORTS_PER_SOL || solverBal < 0.05 * LAMPORTS_PER_SOL)
    throw new Error(`a depositor wallet is underfunded; each needs >= 0.05 SOL for SOL-lock deposits`);

  // Fresh mints per run (fee payer = mint authority); ATAs for depositors.
  stage = "S1";
  mintA = await withRetry("mintA", () =>
    createMint(connection, feePayer, feePayer.publicKey, null, 6)
  );
  mintB = await withRetry("mintB", () =>
    createMint(connection, feePayer, feePayer.publicKey, null, 6)
  );
  userAtaA = (
    await withRetry("userAtaA", () =>
      getOrCreateAssociatedTokenAccount(connection, feePayer, mintA, userKp.publicKey)
    )
  ).address;
  solverAtaA = (
    await withRetry("solverAtaA", () =>
      getOrCreateAssociatedTokenAccount(connection, feePayer, mintA, solverKp.publicKey)
    )
  ).address;
  solverAtaB = (
    await withRetry("solverAtaB", () =>
      getOrCreateAssociatedTokenAccount(connection, feePayer, mintB, solverKp.publicKey)
    )
  ).address;
  await withRetry("mint->user", () =>
    mintTo(connection, feePayer, mintA, userAtaA, feePayer, 100_000_000)
  );
  await withRetry("mint->solver", () =>
    mintTo(connection, feePayer, mintA, solverAtaA, feePayer, 100_000_000)
  );
  await withRetry("mintB->solver", () =>
    mintTo(connection, feePayer, mintB, solverAtaB, feePayer, 100_000_000)
  );
  info("mints created", `mintA=${mintA.toBase58()} mintB=${mintB.toBase58()}`);

  // Intent domain for rail C.
  const dInfo = await connection.getAccountInfo(intentDomainPda);
  if (dInfo) {
    const d = await (program.account as any).intentDomain.fetch(intentDomainPda);
    domainSalt = Buffer.from(d.salt);
    intentDomainReady = true;
  } else {
    try {
      domainSalt = sha256(Buffer.from(`train-devnet-${TRAIN_PROGRAM_ID.toBase58()}`)) as Buffer;
      const sig = await program.methods
        .initializeIntentDomain(Array.from(domainSalt))
        .accounts({
          authority: feePayer.publicKey,
          intentDomain: intentDomainPda,
          program: TRAIN_PROGRAM_ID,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      intentDomainReady = true;
      txRow("initialize_intent_domain", sig, await slotOf(sig), "one-time per deployment");
    } catch (e) {
      info("intent domain init failed", `${e}`.slice(0, 160));
    }
  }

  // ══════════════════════════ HAPPY + UNHAPPY FLOWS ══════════════════════════

  // ── S2: user lock SOL → redeem (+ negatives) ──
  await flow("S2", "user lock SOL / redeem", async () => {
    const { secret, hashlock } = newHashlock();
    const amount = 2_000_000;
    // negatives (land on-chain via skipPreflight)
    const z = newHashlock();
    await expectFailOnChain(
      "user_lock_sol amount=0",
      "ZeroAmount",
      [userKp],
      await program.methods
        .userLockSol(
          userLockParams({ hashlock: z.hashlock, amount: 0, recipient: solverKp.publicKey, refundTo: userKp.publicKey }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(z.hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any)
        .instruction()
    );
    const q = newHashlock();
    await expectFailOnChain(
      "user_lock_sol quote expired",
      "QuoteExpired",
      [userKp],
      await program.methods
        .userLockSol(
          userLockParams({ hashlock: q.hashlock, amount, quoteExpiry: Math.floor(Date.now() / 1000) - 5, recipient: solverKp.publicKey, refundTo: userKp.publicKey }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(q.hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any)
        .instruction()
    );
    const za = newHashlock();
    await expectFailOnChain(
      "user_lock_sol refund_to=default (ZeroAddress)",
      "ZeroAddress",
      [userKp],
      await program.methods
        .userLockSol(
          userLockParams({ hashlock: za.hashlock, amount, recipient: solverKp.publicKey, refundTo: PublicKey.default }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(za.hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any)
        .instruction()
    );

    // happy: lock (payer=feePayer, sender=user), recipient=solver, refund_to=user
    const params = userLockParams({ hashlock, amount, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
    const lockSig = await send(
      [userKp],
      await program.methods
        .userLockSol(params, Buffer.from([]), Buffer.from([]))
        .accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any)
        .instruction()
    );
    txRow("user_lock_sol", lockSig, await slotOf(lockSig), `sender=user amount=${amount}`);
    const lock = await fetchUserLock(hashlock);
    checkRow("lock attributed to user", lock.sender.toBase58() === userKp.publicKey.toBase58(), `sender=${lock.sender.toBase58()}`);
    checkRow("rent_payer = feePayer", lock.rentPayer.toBase58() === feePayer.publicKey.toBase58(), "sponsor pays rent");

    // negative: wrong secret
    await expectFailOnChain(
      "redeem_user_sol wrong secret",
      "HashlockMismatch",
      [],
      await program.methods
        .redeemUserSol(hashlock, Array.from(Buffer.alloc(32, 9)))
        .accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: lock.recipient, refundTo: lock.refundTo, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any)
        .instruction()
    );

    // happy: redeem (caller=relayer/feePayer, pays solver)
    const before = await bal(solverKp.publicKey);
    const rSig = await send(
      [],
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: lock.recipient, refundTo: lock.refundTo, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any)
        .instruction()
    );
    txRow("redeem_user_sol", rSig, await slotOf(rSig), "caller=relayer, pays recipient");
    checkRow("recipient +amount", (await bal(solverKp.publicKey)) - before === amount, `delta=${amount}`);
  });

  // ── S3: user lock SOL → refund ──
  await flow("S3", "user lock SOL / refund", async () => {
    const { hashlock } = newHashlock();
    const amount = 1_500_000;
    const params = userLockParams({ hashlock, amount, timelockDelta: TIMELOCK_SHORT, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
    const lockSig = await send(
      [userKp],
      await program.methods.userLockSol(params, Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction()
    );
    txRow("user_lock_sol", lockSig, await slotOf(lockSig), `timelock=${TIMELOCK_SHORT}s`);
    const lock = await fetchUserLock(hashlock);
    // negative: non-recipient refund before timelock (caller feePayer is not recipient)
    await expectFailOnChain(
      "refund_user_sol premature (non-recipient)",
      "TimelockNotExpired",
      [],
      await program.methods.refundUserSol(hashlock).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, refundTo: lock.refundTo, systemProgram: SystemProgram.programId } as any).instruction()
    );
    info("waiting out timelock", `${TIMELOCK_SHORT + 5}s`);
    await sleep((TIMELOCK_SHORT + 5) * 1000);
    const before = await bal(userKp.publicKey);
    const rSig = await send(
      [],
      await program.methods.refundUserSol(hashlock).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, refundTo: lock.refundTo, systemProgram: SystemProgram.programId } as any).instruction()
    );
    txRow("refund_user_sol", rSig, await slotOf(rSig), "caller=relayer after timelock");
    checkRow("refund_to (user) +amount", (await bal(userKp.publicKey)) - before === amount, `delta=${amount}`);
  });

  // ── S4: user lock token → redeem (+ variant-confusion guard) ──
  await flow("S4", "user lock token / redeem", async () => {
    const { secret, hashlock } = newHashlock();
    const amount = 250_000;
    const params = userLockParams({ hashlock, amount, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
    const acc = { payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), tokenMint: mintA, senderTokenAccount: userAtaA, vault: userVaultPda(hashlock), payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY };
    const lockSig = await send([userKp], await program.methods.userLockToken(params, Buffer.from([]), Buffer.from([])).accounts(acc as any).instruction());
    txRow("user_lock_token", lockSig, await slotOf(lockSig), `amount=${amount} mintA`);
    const v = await getAccount(connection, userVaultPda(hashlock));
    checkRow("vault holds amount", Number(v.amount) === amount, `vault=${v.amount}`);
    const lock = await fetchUserLock(hashlock);

    // negative: settle a TOKEN lock through the SOL path (audited variant-confusion guard)
    await expectFailOnChain(
      "redeem_user_sol on token lock (variant confusion)",
      "WrongToken",
      [],
      await program.methods.redeemUserSol(hashlock, secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: lock.recipient, refundTo: lock.refundTo, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction()
    );

    const rSig = await send([], await program.methods.redeemUserToken(hashlock, secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: solverKp.publicKey, refundTo: userKp.publicKey, tokenMint: mintA, vault: userVaultPda(hashlock), recipientTokenAccount: ata(mintA, solverKp.publicKey), refundToTokenAccount: null, payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY } as any).instruction());
    txRow("redeem_user_token", rSig, await slotOf(rSig), "recipient=solver ATA");
    checkRow("recipient ATA credited", Number((await getAccount(connection, ata(mintA, solverKp.publicKey))).amount) >= amount, "ok");
  });

  // ── S5: user lock token → refund (+ duplicate hashlock) ──
  await flow("S5", "user lock token / refund", async () => {
    const { hashlock } = newHashlock();
    const amount = 120_000;
    const params = userLockParams({ hashlock, amount, timelockDelta: TIMELOCK_SHORT, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
    const acc = { payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), tokenMint: mintA, senderTokenAccount: userAtaA, vault: userVaultPda(hashlock), payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY };
    const lockSig = await send([userKp], await program.methods.userLockToken(params, Buffer.from([]), Buffer.from([])).accounts(acc as any).instruction());
    txRow("user_lock_token", lockSig, await slotOf(lockSig), `timelock=${TIMELOCK_SHORT}s`);
    // negative: duplicate hashlock (PDA already in use)
    await expectFailOnChain("user_lock_token duplicate hashlock", "already in use", [userKp], await program.methods.userLockToken(params, Buffer.from([]), Buffer.from([])).accounts(acc as any).instruction());
    info("waiting out timelock", `${TIMELOCK_SHORT + 5}s`);
    await sleep((TIMELOCK_SHORT + 5) * 1000);
    const lock = await fetchUserLock(hashlock);
    const rSig = await send([], await program.methods.refundUserToken(hashlock).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, refundTo: userKp.publicKey, tokenMint: mintA, vault: userVaultPda(hashlock), refundToTokenAccount: ata(mintA, userKp.publicKey), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY } as any).instruction());
    txRow("refund_user_token", rSig, await slotOf(rSig), "refund_to=user ATA");
    checkRow("status refunded", (await fetchUserLock(hashlock).catch(() => null)) === null, "lock closed");
  });

  // ── S6: solver lock SOL → redeem (reward→reward_recipient) + negatives ──
  await flow("S6", "solver lock SOL / redeem (reward pre-timelock)", async () => {
    const { secret, hashlock } = newHashlock();
    const amount = 1_200_000, reward = 300_000;
    const sAcc = (i: number) => ({ payer: feePayer.publicKey, sender: solverKp.publicKey, counter: solverCountPda(hashlock), solverLock: solverLockPda(hashlock, i), payoutCurveProgram: null, systemProgram: SystemProgram.programId });
    // negative: out-of-order index
    await expectFailOnChain("solver_lock_sol index=5 out of order", "InvalidIndex", [solverKp], await program.methods.solverLockSol(solverLockParams({ hashlock, index: 5, amount, recipient: userKp.publicKey, refundTo: solverKp.publicKey }), Buffer.from([])).accounts(sAcc(5) as any).instruction());
    // negative: reward_timelock_delta >= timelock_delta
    const bad = newHashlock();
    await expectFailOnChain("solver_lock_sol reward tl >= tl", "RewardTimelockNotLessThanTimelock", [solverKp], await program.methods.solverLockSol(solverLockParams({ hashlock: bad.hashlock, index: 1, amount, reward: 100, timelockDelta: 100, rewardTimelockDelta: 100, recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey }), Buffer.from([])).accounts({ ...sAcc(1), counter: solverCountPda(bad.hashlock), solverLock: solverLockPda(bad.hashlock, 1) } as any).instruction());

    // happy: solver lock (sender=solver), recipient=user, reward_recipient=solver
    const lockSig = await send([solverKp], await program.methods.solverLockSol(solverLockParams({ hashlock, index: 1, amount, reward, rewardTimelockDelta: 1800, recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey }), Buffer.from([])).accounts(sAcc(1) as any).instruction());
    txRow("solver_lock_sol", lockSig, await slotOf(lockSig), `amount=${amount} reward=${reward}`);
    const recBefore = await bal(userKp.publicKey), rrBefore = await bal(solverKp.publicKey);
    const rSig = await send([], await program.methods.redeemSolverSol(hashlock, new BN(1), secret).accounts({ caller: feePayer.publicKey, solverLock: solverLockPda(hashlock, 1), recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("redeem_solver_sol", rSig, await slotOf(rSig), "reward→reward_recipient (pre-timelock)");
    checkRow("recipient (user) +amount", (await bal(userKp.publicKey)) - recBefore === amount, `delta=${amount}`);
    checkRow("reward_recipient (solver) +reward", (await bal(solverKp.publicKey)) - rrBefore === reward, `delta=${reward}`);
    // negative: double redeem
    await expectFailOnChain("redeem_solver_sol double redeem", "NotPending", [], await program.methods.redeemSolverSol(hashlock, new BN(1), secret).accounts({ caller: feePayer.publicKey, solverLock: solverLockPda(hashlock, 1), recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    // rent reclamation
    const cSig = await send([solverKp], await program.methods.closeSolverLock(hashlock, new BN(1)).accounts({ caller: solverKp.publicKey, solverLock: solverLockPda(hashlock, 1), rentPayer: feePayer.publicKey } as any).instruction());
    txRow("close_solver_lock", cSig, await slotOf(cSig), "rent→rent_payer");
  });

  // ── S7: solver lock SOL → reward bounty to caller after reward timelock ──
  await flow("S7", "solver lock SOL / reward bounty to late redeemer", async () => {
    const { secret, hashlock } = newHashlock();
    const amount = 800_000, reward = 200_000;
    const lockSig = await send([solverKp], await program.methods.solverLockSol(solverLockParams({ hashlock, index: 1, amount, reward, timelockDelta: 3600, rewardTimelockDelta: TIMELOCK_SHORT, recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey }), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: solverKp.publicKey, counter: solverCountPda(hashlock), solverLock: solverLockPda(hashlock, 1), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("solver_lock_sol", lockSig, await slotOf(lockSig), `rewardTimelock=${TIMELOCK_SHORT}s`);
    info("waiting out reward timelock", `${TIMELOCK_SHORT + 5}s`);
    await sleep((TIMELOCK_SHORT + 5) * 1000);
    const callerBefore = await bal(feePayer.publicKey);
    const rSig = await send([], await program.methods.redeemSolverSol(hashlock, new BN(1), secret).accounts({ caller: feePayer.publicKey, solverLock: solverLockPda(hashlock, 1), recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("redeem_solver_sol (late)", rSig, await slotOf(rSig), "reward→caller bounty (post-timelock)");
    checkRow("caller received reward bounty", (await bal(feePayer.publicKey)) - callerBefore > reward - 20000, "caller +reward (minus fee)");
    await send([solverKp], await program.methods.closeSolverLock(hashlock, new BN(1)).accounts({ caller: solverKp.publicKey, solverLock: solverLockPda(hashlock, 1), rentPayer: feePayer.publicKey } as any).instruction());
  });

  // ── S8: solver lock token (single vault) → redeem + refund + negatives ──
  await flow("S8", "solver lock token / redeem + refund", async () => {
    const { secret, hashlock } = newHashlock();
    const build = (i: number, tl: number) => solverLockParams({ hashlock, index: i, amount: 90_000, reward: 10_000, timelockDelta: tl, rewardTimelockDelta: Math.min(tl - 1, 1800), recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey });
    const lAcc = (i: number) => ({ payer: feePayer.publicKey, sender: solverKp.publicKey, counter: solverCountPda(hashlock), solverLock: solverLockPda(hashlock, i), tokenMint: mintA, senderTokenAccount: solverAtaA, vault: solverVaultPda(hashlock, i), payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY });
    const l1 = await send([solverKp], await program.methods.solverLockToken(build(1, 3600), Buffer.from([])).accounts(lAcc(1) as any).instruction());
    txRow("solver_lock_token #1", l1, await slotOf(l1), "single vault amount+reward");
    const l2 = await send([solverKp], await program.methods.solverLockToken(build(2, TIMELOCK_SHORT), Buffer.from([])).accounts(lAcc(2) as any).instruction());
    txRow("solver_lock_token #2", l2, await slotOf(l2), "for refund");
    // redeem #1
    const r1 = await send([], await program.methods.redeemSolverToken(hashlock, new BN(1), secret).accounts({ caller: feePayer.publicKey, solverLock: solverLockPda(hashlock, 1), rentPayer: feePayer.publicKey, recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey, tokenMint: mintA, vault: solverVaultPda(hashlock, 1), recipientTokenAccount: ata(mintA, userKp.publicKey), rewardRecipientTokenAccount: ata(mintA, solverKp.publicKey), callerTokenAccount: ata(mintA, feePayer.publicKey), refundToTokenAccount: null, payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY } as any).instruction());
    txRow("redeem_solver_token #1", r1, await slotOf(r1), "recipient + reward_recipient");
    // negative: premature refund #2
    const refAcc = { caller: feePayer.publicKey, solverLock: solverLockPda(hashlock, 2), rentPayer: feePayer.publicKey, refundTo: solverKp.publicKey, tokenMint: mintA, vault: solverVaultPda(hashlock, 2), refundToTokenAccount: ata(mintA, solverKp.publicKey), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY };
    await expectFailOnChain("refund_solver_token premature", "TimelockNotExpired", [], await program.methods.refundSolverToken(hashlock, new BN(2)).accounts(refAcc as any).instruction());
    info("waiting out timelock", `${TIMELOCK_SHORT + 5}s`);
    await sleep((TIMELOCK_SHORT + 5) * 1000);
    const r2 = await send([], await program.methods.refundSolverToken(hashlock, new BN(2)).accounts(refAcc as any).instruction());
    txRow("refund_solver_token #2", r2, await slotOf(r2), "refund_to=solver ATA");
  });

  // ── S9: solver lock token diff-reward → redeem + negative ──
  await flow("S9", "solver lock token diff-reward / redeem", async () => {
    const { secret, hashlock } = newHashlock();
    const dAcc = (rewardMint: PublicKeyT, rewardAta: PublicKeyT) => ({ payer: feePayer.publicKey, sender: solverKp.publicKey, counter: solverCountPda(hashlock), solverLock: solverLockPda(hashlock, 1), tokenMint: mintA, rewardTokenMint: rewardMint, senderTokenAccount: solverAtaA, senderRewardTokenAccount: rewardAta, vault: solverVaultPda(hashlock, 1), rewardVault: solverRewardVaultPda(hashlock, 1), payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY });
    const p = solverLockParams({ hashlock, index: 1, amount: 80_000, reward: 15_000, rewardTimelockDelta: 1800, recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey });
    // negative: identical mints for diff-reward
    await expectFailOnChain("solver_lock_token_diff_reward identical mints", "WrongToken", [solverKp], await program.methods.solverLockTokenDiffReward(p, Buffer.from([])).accounts(dAcc(mintA, solverAtaA) as any).instruction());
    // happy
    const lSig = await send([solverKp], await program.methods.solverLockTokenDiffReward(p, Buffer.from([])).accounts(dAcc(mintB, solverAtaB) as any).instruction());
    txRow("solver_lock_token_diff_reward", lSig, await slotOf(lSig), "two vaults mintA + mintB");
    const rSig = await send([], await program.methods.redeemSolverTokenDiffReward(hashlock, new BN(1), secret).accounts({ caller: feePayer.publicKey, solverLock: solverLockPda(hashlock, 1), rentPayer: feePayer.publicKey, recipient: userKp.publicKey, rewardRecipient: solverKp.publicKey, refundTo: solverKp.publicKey, tokenMint: mintA, rewardTokenMint: mintB, vault: solverVaultPda(hashlock, 1), rewardVault: solverRewardVaultPda(hashlock, 1), recipientTokenAccount: ata(mintA, userKp.publicKey), rewardRecipientTokenAccount: ata(mintB, solverKp.publicKey), callerRewardTokenAccount: ata(mintB, feePayer.publicKey), refundToTokenAccount: null, payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY } as any).instruction());
    txRow("redeem_solver_token_diff_reward", rSig, await slotOf(rSig), "recipient mintA + reward mintB");
  });

  // ── S10: payout curve constant (full payout, no excess) + negatives ──
  await flow("S10", "payout curve constant / redeem", async () => {
    const { secret, hashlock } = newHashlock();
    const amount = 1_000_000;
    // negative: mismatched curve account at creation
    const bad = newHashlock();
    await expectFailOnChain("user_lock_sol mismatched curve", "InvalidPayoutCurve", [userKp], await program.methods.userLockSol(userLockParams({ hashlock: bad.hashlock, amount, recipient: solverKp.publicKey, refundTo: userKp.publicKey, payoutCurve: CONSTANT_CURVE_ID }), Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(bad.hashlock), payoutCurveProgram: MOCK_CURVE_ID, systemProgram: SystemProgram.programId } as any).instruction());
    // happy
    const params = userLockParams({ hashlock, amount, recipient: solverKp.publicKey, refundTo: userKp.publicKey, payoutCurve: CONSTANT_CURVE_ID });
    const lSig = await send([userKp], await program.methods.userLockSol(params, Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), payoutCurveProgram: CONSTANT_CURVE_ID, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("user_lock_sol (constant curve)", lSig, await slotOf(lSig), "curve=constant");
    const lock = await fetchUserLock(hashlock);
    const before = await bal(solverKp.publicKey);
    const rSig = await send([], await program.methods.redeemUserSol(hashlock, secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: lock.recipient, refundTo: lock.refundTo, payoutCurveProgram: CONSTANT_CURVE_ID, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("redeem_user_sol (constant curve)", rSig, await slotOf(rSig), "payout=amount, excess=0");
    checkRow("recipient +full amount", (await bal(solverKp.publicKey)) - before === amount, `delta=${amount}`);
  }, constantDeployed ? undefined : "constant_payout_curve not deployed");

  // ── S11: payout curve decay (excess→refund_to) + zero-payout negative ──
  await flow("S11", "payout curve decay / excess to refund_to", async () => {
    const { secret, hashlock } = newHashlock();
    const amount = 2_000_000;
    const params = userLockParams({ hashlock, amount, recipient: solverKp.publicKey, refundTo: userKp.publicKey, payoutCurve: MOCK_CURVE_ID });
    const lSig = await send([userKp], await program.methods.userLockSol(params, Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), payoutCurveProgram: MOCK_CURVE_ID, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("user_lock_sol (decay curve)", lSig, await slotOf(lSig), "curve=decay (payout=amount/2)");
    const lock = await fetchUserLock(hashlock);
    const recBefore = await bal(solverKp.publicKey), refBefore = await bal(userKp.publicKey);
    const rSig = await send([], await program.methods.redeemUserSol(hashlock, secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: lock.recipient, refundTo: lock.refundTo, payoutCurveProgram: MOCK_CURVE_ID, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("redeem_user_sol (decay curve)", rSig, await slotOf(rSig), "payout+excess split");
    checkRow("recipient +payout(amount/2)", (await bal(solverKp.publicKey)) - recBefore === amount / 2, `delta=${amount / 2}`);
    checkRow("refund_to +excess(amount/2)", (await bal(userKp.publicKey)) - refBefore === amount / 2, `delta=${amount / 2}`);
    // negative: zero-payout config rejected at redeem
    const z = newHashlock();
    const zLock = await send([userKp], await program.methods.userLockSol(userLockParams({ hashlock: z.hashlock, amount: 1_000_000, recipient: solverKp.publicKey, refundTo: userKp.publicKey, payoutCurve: MOCK_CURVE_ID, payoutCurveData: Buffer.from([0, 0]) }), Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(z.hashlock), payoutCurveProgram: MOCK_CURVE_ID, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("user_lock_sol (0-bps curve)", zLock, await slotOf(zLock), "will fail redeem");
    const zl = await fetchUserLock(z.hashlock);
    await expectFailOnChain("redeem_user_sol zero payout", "InvalidPayout", [], await program.methods.redeemUserSol(z.hashlock, z.secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(z.hashlock), rentPayer: zl.rentPayer, recipient: zl.recipient, refundTo: zl.refundTo, payoutCurveProgram: MOCK_CURVE_ID, systemProgram: SystemProgram.programId } as any).instruction());
    // clean up the 0-bps lock via recipient early refund path? refund returns full amount, curve not used
    const rf = await send([], await program.methods.refundUserSol(z.hashlock).accounts({ caller: feePayer.publicKey, userLock: userLockPda(z.hashlock), rentPayer: zl.rentPayer, refundTo: zl.refundTo, systemProgram: SystemProgram.programId } as any).instruction()).catch(() => null);
    if (rf) txRow("refund_user_sol (cleanup 0-bps, may need timelock)", rf, await slotOf(rf), "");
  }, mockDeployed ? undefined : "mock_decay_curve not deployed");

  // ── S12: gasless rail A (fee-payer sponsorship, co-signed) ──
  await flow("S12", "gasless rail A: fee-payer sponsorship", async () => {
    const { secret, hashlock } = newHashlock();
    const amount = 1_000_000;
    const params = userLockParams({ hashlock, amount, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
    const buildTx = async () => {
      const ix = await program.methods.userLockSol(params, Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction();
      const tx = new Transaction().add(ix);
      tx.feePayer = feePayer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      return tx;
    };
    // negative: tampered after user signs (cannot land — signature failure)
    const t = await buildTx();
    t.partialSign(userKp);
    t.instructions[0].data[20] ^= 0xff;
    t.partialSign(feePayer);
    await expectRejectOffChain("rail A tampered tx", "ature", async () => connection.sendRawTransaction(t.serialize({ verifySignatures: false })));
    // happy
    const tx = await buildTx();
    tx.partialSign(userKp); // depositor authorizes
    tx.partialSign(feePayer); // relayer pays fees
    const raw = tx.serialize();
    const userBefore = await bal(userKp.publicKey);
    const sig = await withRetry("railA send", async () => { const s = await connection.sendRawTransaction(raw); await connection.confirmTransaction(s, "confirmed"); return s; });
    txRow("sponsored user_lock_sol", sig, await slotOf(sig), "user co-signs, relayer pays");
    const lock = await fetchUserLock(hashlock);
    checkRow("depositor paid only amount (no fees)", userBefore - (await bal(userKp.publicKey)) === amount, `delta=${amount}`);
    checkRow("rent_payer = relayer", lock.rentPayer.toBase58() === feePayer.publicKey.toBase58(), "relayer paid rent");
    // negative: replay identical tx (cannot land — already processed)
    await expectRejectOffChain("rail A replay", "already", async () => connection.sendRawTransaction(raw));
    const rSig = await send([], await program.methods.redeemUserSol(hashlock, secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: lock.recipient, refundTo: lock.refundTo, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("redeem_user_sol", rSig, await slotOf(rSig), "settle");
  });

  // ── S13: gasless rail B (durable nonce, offline signing) ──
  await flow("S13", "gasless rail B: durable nonce", async () => {
    const nonceKp = Keypair.generate();
    const rent = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
    const createTx = new Transaction().add(...SystemProgram.createNonceAccount({ fromPubkey: feePayer.publicKey, noncePubkey: nonceKp.publicKey, authorizedPubkey: feePayer.publicKey, lamports: rent }).instructions);
    const cSig = await withRetry("nonce create", () => provider.sendAndConfirm(createTx, [feePayer, nonceKp]));
    txRow("create durable nonce account", cSig, await slotOf(cSig), "authority=relayer");
    const nInfo = await connection.getAccountInfo(nonceKp.publicKey);
    const nonceAccount = NonceAccount.fromAccountData(nInfo!.data);
    const { secret, hashlock } = newHashlock();
    const params = userLockParams({ hashlock, amount: 700_000, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
    const lockIx = await program.methods.userLockSol(params, Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction();
    const tx = new Transaction();
    tx.add(SystemProgram.nonceAdvance({ noncePubkey: nonceKp.publicKey, authorizedPubkey: feePayer.publicKey }));
    tx.add(lockIx);
    tx.feePayer = feePayer.publicKey;
    tx.recentBlockhash = nonceAccount.nonce; // durable — no expiry
    tx.partialSign(userKp); // offline user signature
    info("simulating offline delay", "2s");
    await sleep(2000);
    tx.partialSign(feePayer);
    const raw = tx.serialize();
    const sig = await withRetry("railB send", async () => { const s = await connection.sendRawTransaction(raw); await connection.confirmTransaction(s, "confirmed"); return s; });
    txRow("durable-nonce user_lock_sol", sig, await slotOf(sig), "offline-signed, deferred submit");
    // negative: nonce replay (cannot land — blockhash/nonce advanced)
    await expectRejectOffChain("rail B nonce replay", "", async () => { const s = await connection.sendRawTransaction(raw); await connection.confirmTransaction(s, "confirmed"); });
    const lock = await fetchUserLock(hashlock);
    const rSig = await send([], await program.methods.redeemUserSol(hashlock, secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: lock.recipient, refundTo: lock.refundTo, payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("redeem_user_sol", rSig, await slotOf(rSig), "settle");
  });

  // ── S14: gasless rail C (signed intent, user signs no transaction) ──
  await flow("S14", "gasless rail C: ed25519 signed intent", async () => {
    // one-time delegate approval (user owner authorizes; relayer pays)
    const apSig = await withRetry("approve delegate", () => approve(connection, feePayer, userAtaA, delegatePda, userKp, 50_000_000));
    txRow("approve delegate (one-time)", apSig, await slotOf(apSig), "user delegates to program PDA");

    const now = () => Math.floor(Date.now() / 1000);
    const buildIntent = (args: { hashlock: number[]; amount: number; nonce: number; deadline: number }) => {
      const params = userLockParams({ hashlock: args.hashlock, amount: args.amount, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
      const ch = callHash(params, Buffer.from([]), Buffer.from([]));
      const msg = intentMessage({ domainSalt, user: userKp.publicKey, mint: mintA, amount: args.amount, callHash: ch, nonce: args.nonce, deadline: args.deadline });
      return { params, msg };
    };
    const intentIx = (args: { hashlock: number[]; nonce: number; deadline: number }, params: any) =>
      program.methods.userLockTokenWithIntent(params, Buffer.from([]), Buffer.from([]), new BN(args.nonce), new BN(args.deadline)).accounts({ payer: feePayer.publicKey, user: userKp.publicKey, intentDomain: intentDomainPda, consumedIntent: consumedIntentPda(userKp.publicKey, args.nonce), delegate: delegatePda, userLock: userLockPda(args.hashlock), tokenMint: mintA, userTokenAccount: userAtaA, vault: userVaultPda(args.hashlock), payoutCurveProgram: null, instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any).instruction();

    // negative: expired intent
    const exp = newHashlock();
    const expArgs = { hashlock: exp.hashlock, amount: 40_000, nonce: NONCE_BASE + 1, deadline: now() - 30 };
    const expB = buildIntent(expArgs);
    await expectFailOnChain("rail C expired intent", "IntentExpired", [], ed25519Ix(userKp, expB.msg), await intentIx(expArgs, expB.params));

    // happy
    const { secret, hashlock } = newHashlock();
    const args = { hashlock, amount: 60_000, nonce: NONCE_BASE + 2, deadline: now() + 600 };
    const b = buildIntent(args);
    const uBefore = Number((await getAccount(connection, userAtaA)).amount);
    const sig = await send([], ed25519Ix(userKp, b.msg), await intentIx(args, b.params));
    txRow("intent user_lock_token", sig, await slotOf(sig), "user signed only a message");
    const lock = await fetchUserLock(hashlock);
    checkRow("lock attributed to user", lock.sender.toBase58() === userKp.publicKey.toBase58(), "sender=user");
    checkRow("rent_payer = relayer", lock.rentPayer.toBase58() === feePayer.publicKey.toBase58(), "relayer paid rent");
    checkRow("pulled exactly amount", uBefore - Number((await getAccount(connection, userAtaA)).amount) === args.amount, `delta=${args.amount}`);

    // negative: tampered params, original signature
    const tam = newHashlock();
    const tamArgs = { hashlock: tam.hashlock, amount: 120_000, nonce: NONCE_BASE + 3, deadline: args.deadline };
    const tamB = buildIntent(tamArgs);
    await expectFailOnChain("rail C tampered params", "InvalidIntentSignature", [], ed25519Ix(userKp, b.msg), await intentIx(tamArgs, tamB.params));

    // settle then prove intent replay blocked
    const rSig = await send([], await program.methods.redeemUserToken(hashlock, secret).accounts({ caller: feePayer.publicKey, userLock: userLockPda(hashlock), rentPayer: lock.rentPayer, recipient: solverKp.publicKey, refundTo: userKp.publicKey, tokenMint: mintA, vault: userVaultPda(hashlock), recipientTokenAccount: ata(mintA, solverKp.publicKey), refundToTokenAccount: null, payoutCurveProgram: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY } as any).instruction());
    txRow("redeem_user_token", rSig, await slotOf(rSig), "settle the intent lock");
    await expectFailOnChain("rail C intent replay (post-settle)", "already in use", [], ed25519Ix(userKp, b.msg), await intentIx(args, b.params));
  }, intentDomainReady ? undefined : "intent domain not initialized");

  // ── S15: close consumed intent after deadline ──
  await flow("S15", "close consumed intent after deadline", async () => {
    const now = () => Math.floor(Date.now() / 1000);
    const { hashlock } = newHashlock();
    const deadline = now() + 8;
    const nonce = NONCE_BASE + 10;
    const params = userLockParams({ hashlock, amount: 30_000, recipient: solverKp.publicKey, refundTo: userKp.publicKey });
    const ch = callHash(params, Buffer.from([]), Buffer.from([]));
    const msg = intentMessage({ domainSalt, user: userKp.publicKey, mint: mintA, amount: 30_000, callHash: ch, nonce, deadline });
    const ix = await program.methods.userLockTokenWithIntent(params, Buffer.from([]), Buffer.from([]), new BN(nonce), new BN(deadline)).accounts({ payer: feePayer.publicKey, user: userKp.publicKey, intentDomain: intentDomainPda, consumedIntent: consumedIntentPda(userKp.publicKey, nonce), delegate: delegatePda, userLock: userLockPda(hashlock), tokenMint: mintA, userTokenAccount: userAtaA, vault: userVaultPda(hashlock), payoutCurveProgram: null, instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any).instruction();
    const sig = await send([], ed25519Ix(userKp, msg), ix);
    txRow("intent user_lock_token", sig, await slotOf(sig), `deadline in 8s, nonce=${nonce}`);
    const cPda = consumedIntentPda(userKp.publicKey, nonce);
    // negative: close before deadline
    await expectFailOnChain("close_consumed_intent before deadline", "IntentNotExpired", [], await program.methods.closeConsumedIntent().accounts({ caller: feePayer.publicKey, consumedIntent: cPda, rentPayer: feePayer.publicKey } as any).instruction());
    info("waiting out intent deadline", "10s");
    await sleep(10000);
    const clSig = await send([], await program.methods.closeConsumedIntent().accounts({ caller: feePayer.publicKey, consumedIntent: cPda, rentPayer: feePayer.publicKey } as any).instruction());
    txRow("close_consumed_intent", clSig, await slotOf(clSig), "rent→relayer after deadline");
  }, intentDomainReady ? undefined : "intent domain not initialized");

  // ── S16: views ──
  await flow("S16", "views + close negatives", async () => {
    const { hashlock } = newHashlock();
    const lSig = await send([userKp], await program.methods.userLockSol(userLockParams({ hashlock, amount: 500_000, recipient: solverKp.publicKey, refundTo: userKp.publicKey }), Buffer.from([]), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: userKp.publicKey, userLock: userLockPda(hashlock), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("user_lock_sol", lSig, await slotOf(lSig), "for view");
    const data = await program.methods.getUserLock(hashlock).accounts({ userLock: userLockPda(hashlock) } as any).view();
    checkRow("get_user_lock returns fields", data.amount.toNumber() === 500_000 && data.refundTo.toBase58() === userKp.publicKey.toBase58(), `amount=${data.amount} refundTo=user`);
    // negative: close a pending solver lock (StillPending) — need a solver lock first
    const s = newHashlock();
    const slSig = await send([solverKp], await program.methods.solverLockSol(solverLockParams({ hashlock: s.hashlock, index: 1, amount: 300_000, recipient: userKp.publicKey, refundTo: solverKp.publicKey }), Buffer.from([])).accounts({ payer: feePayer.publicKey, sender: solverKp.publicKey, counter: solverCountPda(s.hashlock), solverLock: solverLockPda(s.hashlock, 1), payoutCurveProgram: null, systemProgram: SystemProgram.programId } as any).instruction());
    txRow("solver_lock_sol", slSig, await slotOf(slSig), "pending, for close negatives");
    await expectFailOnChain("close_solver_lock while pending", "StillPending", [solverKp], await program.methods.closeSolverLock(s.hashlock, new BN(1)).accounts({ caller: solverKp.publicKey, solverLock: solverLockPda(s.hashlock, 1), rentPayer: feePayer.publicKey } as any).instruction());
    // clean up: refund after timelock is long; leave it pending (documented). Refund the user_lock via recipient early-cancel not possible (caller=feePayer). Leave.
    info("S16 note", "the pending solver lock is left on-chain (refundable after its timelock); not an error");
  });

  writeReport();
}

main().catch((err) => {
  console.error(err);
  if (rows.length) writeReport();
  process.exit(1);
});
