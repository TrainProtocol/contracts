/**
 * Config-driven, idempotent, re-runnable end-to-end test suite for the Train Protocol on
 * Starknet Sepolia. Runs every flow (happy path + at least one expected-failure case per
 * mechanism) against whatever network `RPC_URL` points at, using the canonical Sepolia STRK
 * (principal) and ETH (second / reward token) ERC20 contracts — no test token is ever deployed
 * or minted; the suite spends from the pre-funded balances of the configured accounts.
 *
 * Usage:
 *   cd scripts && npx tsx src/sepolia-e2e.ts
 *
 * Env (see .env.example): RPC_URL, ACCOUNT_ADDRESS/PRIVATE_KEY (the user — on Sepolia this MUST
 * be a real SNIP-9-capable wallet: Argent/Braavos/Ready), RELAYER_ADDRESS/RELAYER_PRIVATE_KEY
 * (pays gas for the gasless rails), SOLVER_ADDRESS/SOLVER_PRIVATE_KEY (optional), STRK_ADDRESS/
 * ETH_ADDRESS (optional, default to canonical Sepolia STRK/ETH), TRAIN/TRAIN_ROUTER/
 * CONSTANT_CURVE (optional, deploys fresh when unset).
 *
 * Writes `docs/e2e-testnet-report.md` (+ `.json`) in the same row-table format used by the aztec
 * chain's e2e runner (`chains/aztec/scripts/e2eTestnet.ts`).
 */
import "dotenv/config";
import { execSync } from "child_process";
import { createHash, randomBytes } from "crypto";
import { resolve } from "path";
import { cairo, ec, hash, num, shortString, src5, constants, type Call, type Contract } from "starknet";
import {
  getAccount,
  getRelayerAccount,
  getSolverAccount,
  getTrainContract,
  getTrainRouterContract,
  getErc20Contract,
  resolveTokenAddresses,
  optionalEnv,
  NO_TIP,
} from "./config.js";
import { deployAll } from "./deploy-all.js";
import { detectNetwork, redactRpc, writeReport, printSummaryTable, type Row, type RowKind, type RowStatus } from "./report.js";

// ── Sizing (small — happy paths cycle funds back; conserve testnet balances) ──

const AMOUNT = 1_000n; // STRK principal, wei-scale
const REWARD = 100n; // reward, wei-scale (same-token STRK or diff-token ETH)

const LONG_TIMELOCK = 3_600; // s — plenty of headroom for immediate redeem flows
const SHORT_TIMELOCK = 60; // s — refund flows wait this out
const SAFE_REWARD_TIMELOCK = 900; // s — redeem-before-reward-timelock comfortably beats this
const SHORT_REWARD_TIMELOCK = 30; // s — redeem-after-reward-timelock waits this out
const QUOTE_EXPIRY_DELTA = 900; // s
const INTENT_DEADLINE_DELTA = 900; // s

const ZERO_ADDRESS = "0x0";

// ── Row recording ──

const rows: Row[] = [];
let rowCounter = 0;
const runStarted = new Date();

function record(row: Omit<Row, "n">): Row {
  const full: Row = { n: ++rowCounter, ...row };
  rows.push(full);
  const parts = [
    `[${full.n}] ${full.stage} | ${full.name} -> ${full.status}`,
    full.txHash ? `tx=${full.txHash}` : "",
    full.block != null ? `block=${full.block}` : "",
    full.note ? `| ${full.note}` : "",
  ].filter(Boolean);
  console.log(parts.join(" "));
  return full;
}

function info(stage: string, name: string, note?: string): void {
  record({ stage, name, kind: "info", status: "INFO", note });
}

function check(stage: string, name: string, ok: boolean, note: string): void {
  record({ stage, name, kind: "check", status: ok ? "OK" : "FAIL", note });
}

// ── Small helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Reads the active variant name of a Cairo custom enum decoded off the contract ABI (e.g.
 * `LockStatus`). starknet.js's `CairoCustomEnum.variant` is a plain object with ALL variant names
 * as keys — the active one holds a defined value, every inactive one is explicitly `undefined`.
 * Plain `Object.keys(x.status.variant)[0]` always returns the *first-declared* variant name
 * ("Empty") regardless of which is active. `.activeVariant()` is the correct accessor: it scans
 * for the one defined entry.
 */
function lockStatusName(lock: { status: { activeVariant(): string } }): string {
  return lock.status.activeVariant();
}

/** sha256(secret as 32-byte big-endian) — matches Cairo `Train::_sha256_u256`. */
function computeHashlock(secret: bigint): bigint {
  const buf = Buffer.alloc(32);
  let v = secret;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  const digest = createHash("sha256").update(buf).digest();
  return BigInt("0x" + digest.toString("hex"));
}

/** Fresh, unique-per-run secret: current time + a random salt + a flow label, hashed to 256 bits. */
function freshSecret(label: string): bigint {
  const material = `${label}:${Date.now()}:${randomBytes(16).toString("hex")}`;
  const digest = createHash("sha256").update(material).digest("hex");
  return BigInt("0x" + digest);
}

/** A syntactically valid, essentially-never-collides dummy ContractAddress (< 2^251). */
function randomAddress(): string {
  return "0x" + randomBytes(30).toString("hex");
}

function hexShort(v: bigint): string {
  const h = num.toHex(v);
  return h.slice(0, 12) + "…";
}

function feeOf(receipt: unknown): string | undefined {
  const r = receipt as Record<string, unknown>;
  const af = r.actual_fee as Record<string, unknown> | string | undefined;
  if (af == null) return undefined;
  if (typeof af === "object" && "amount" in af) return String((af as Record<string, unknown>).amount);
  return String(af);
}

function blockOf(receipt: unknown): number | undefined {
  const r = receipt as Record<string, unknown>;
  const b = r.block_number;
  return typeof b === "number" ? b : b != null ? Number(b) : undefined;
}

function revertReasonOf(receipt: unknown): string {
  const r = receipt as Record<string, unknown>;
  return String(r.revert_reason ?? r.execution_status ?? "reverted");
}

function isReverted(receipt: unknown): boolean {
  const r = receipt as { isReverted?: () => boolean };
  return typeof r.isReverted === "function" ? r.isReverted() : false;
}

// ── Tx / check / simulate helpers ──

/**
 * Sends a tx, waits for the receipt, and records a `tx` row. Throws on an unexpected revert.
 *
 * Returns `fee` (the actual fee paid, parsed as a bigint) alongside the receipt/txHash. This
 * matters because STRK is both our principal test token AND (by default, for a v3 transaction)
 * the fee-paying asset: whenever the account whose STRK balance a flow is asserting on is ALSO
 * the one submitting a transaction, that account's own gas cost pollutes the "before/after"
 * delta by many orders of magnitude more than the tiny (~1000 wei) test amounts. Flows avoid this
 * either by having a *different* account submit the transaction than the one being measured, or
 * — when the measured account must be the submitter (e.g. Flow D's third-party-refund-caller
 * check) — by adding `fee` back before comparing.
 */
async function sendTx(
  stage: string,
  name: string,
  action: () => Promise<{ transaction_hash: string }>,
): Promise<{ receipt: unknown; txHash: string; fee: bigint }> {
  const resp = await action();
  const txHash = resp.transaction_hash;
  const receipt = await provider.waitForTransaction(txHash);
  const reverted = isReverted(receipt);
  const status: RowStatus = reverted ? "FAIL" : "OK";
  const feeStr = feeOf(receipt);
  record({
    stage,
    name,
    kind: "tx",
    status,
    txHash,
    block: blockOf(receipt),
    fee: feeStr,
    note: reverted ? `on-chain revert: ${revertReasonOf(receipt)}` : undefined,
  });
  if (reverted) {
    throw new Error(`Unexpected on-chain revert in "${name}": ${revertReasonOf(receipt)}`);
  }
  return { receipt, txHash, fee: feeStr ? BigInt(feeStr) : 0n };
}

/** Sends a tx expected to revert on-chain (state-dependent unhappy case). Records `REVERTED`/`FAIL`. */
async function sendExpectRevert(
  stage: string,
  name: string,
  action: () => Promise<{ transaction_hash: string }>,
): Promise<void> {
  try {
    const resp = await action();
    const receipt = await provider.waitForTransaction(resp.transaction_hash);
    const reverted = isReverted(receipt);
    record({
      stage,
      name,
      kind: "tx",
      status: reverted ? "REVERTED" : "FAIL",
      txHash: resp.transaction_hash,
      block: blockOf(receipt),
      fee: feeOf(receipt),
      note: reverted ? `on-chain revert: ${revertReasonOf(receipt)}` : "transaction succeeded (expected a revert)",
    });
  } catch (err) {
    // Some providers/accounts reject at validation (before inclusion) rather than including a
    // reverted transaction; treat that the same as an on-chain revert for reporting purposes.
    const msg = err instanceof Error ? err.message : String(err);
    record({ stage, name, kind: "tx", status: "REVERTED", note: `rejected before inclusion: ${msg.slice(0, 200)}` });
  }
}

/** Whether an error/revert message matches `expected` (a Cairo short-string assert reason),
 * tolerating the several ways a felt short-string can show up in an error message (raw ascii,
 * hex-encoded, or decimal-encoded). */
function messageMatches(msg: string, expected: string): boolean {
  if (msg.includes(expected)) return true;
  try {
    const encodedHex = shortString.encodeShortString(expected).toLowerCase();
    if (msg.toLowerCase().includes(encodedHex)) return true;
    if (msg.toLowerCase().includes(encodedHex.replace(/^0x0*/, "0x"))) return true;
    const dec = BigInt(encodedHex).toString();
    if (msg.includes(dec)) return true;
  } catch {
    /* not a valid short string — substring check above is the only option */
  }
  return false;
}

/** Raw `starknet_call` (stateless, no tx, no nonce) against `contract`'s `method` — used to
 * preview reverts for state-independent unhappy cases without spending gas or consuming state. */
async function simulateCall(contract: Contract, method: string, args: unknown[]): Promise<unknown> {
  const populated = contract.populate(method, args as never);
  return provider.callContract({
    contractAddress: populated.contractAddress,
    entrypoint: populated.entrypoint,
    calldata: populated.calldata,
  });
}

/** Expects `fn()` to reject with a message matching `expected`; records a `sim-reject` row. */
async function simReject(stage: string, name: string, expected: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    record({
      stage,
      name,
      kind: "sim-reject",
      status: "FAIL",
      note: `simulation unexpectedly SUCCEEDED (expected "${expected}")`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hit = messageMatches(msg, expected);
    record({
      stage,
      name,
      kind: "sim-reject",
      status: hit ? "OK" : "FAIL",
      note: hit ? `rejected with "${expected}"` : `expected "${expected}", got: ${msg.slice(0, 200)}`,
    });
  }
}

/**
 * Advances chain time past `target` (a unix timestamp) so a `timelock` check passes.
 *
 * `starknet-devnet`'s default block-generation mode ("transaction") only stamps a new block when
 * a transaction lands — with no transactions in flight, wall-clock time passing does NOT advance
 * the latest block's timestamp, so naive polling would hang forever. On devnet the
 * `devnet_increaseTime` JSON-RPC extension jumps time forward (and mines a block) directly. On a
 * real network (Sepolia/mainnet) new blocks arrive on their own, so we just poll.
 */
async function waitUntilChainTimeAfter(target: number, isDevnet: boolean, rpcUrl: string): Promise<void> {
  if (isDevnet) {
    const block = await provider.getBlock("latest");
    const currentTs = Number(block.timestamp);
    const delta = target - currentTs + 2; // +2s safety margin past the strict `>` check
    if (delta > 0) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "devnet_increaseTime", params: { time: delta } }),
      });
      const body = await res.json();
      if (body.error) throw new Error(`devnet_increaseTime failed: ${JSON.stringify(body.error)}`);
    }
    return;
  }
  for (;;) {
    const block = await provider.getBlock("latest");
    const ts = Number(block.timestamp);
    if (ts > target) return;
    await sleep(5_000);
  }
}

async function chainNow(): Promise<number> {
  const block = await provider.getBlock("latest");
  return Number(block.timestamp);
}

// ── Struct builders (field names/order match src/Train.cairo, src/train_router.cairo) ──

function destinationInfo(amount: bigint, token: string) {
  return {
    dst_chain: "ethereum-sepolia",
    dst_address: "0x0000000000000000000000000000000000000001",
    dst_amount: cairo.uint256(amount),
    dst_token: token,
  };
}

function userLockParams(opts: {
  hashlock: bigint;
  amount: bigint;
  recipient: string;
  refundTo: string;
  token: string;
  timelockDelta: number;
  quoteExpiry: number;
  payoutCurve?: string;
}) {
  return {
    hashlock: cairo.uint256(opts.hashlock),
    amount: cairo.uint256(opts.amount),
    reward_amount: cairo.uint256(0n),
    timelock_delta: opts.timelockDelta,
    reward_timelock_delta: 0,
    quote_expiry: opts.quoteExpiry,
    recipient: opts.recipient,
    token: opts.token,
    reward_token: "",
    reward_recipient: "",
    src_chain: "starknet-sepolia",
    refund_to: opts.refundTo,
    payout_curve: opts.payoutCurve ?? ZERO_ADDRESS,
    payout_curve_data: "",
  };
}

function solverLockParams(opts: {
  hashlock: bigint;
  amount: bigint;
  reward: bigint;
  recipient: string;
  rewardRecipient: string;
  token: string;
  rewardToken: string;
  refundTo: string;
  timelockDelta: number;
  rewardTimelockDelta: number;
}) {
  return {
    hashlock: cairo.uint256(opts.hashlock),
    amount: cairo.uint256(opts.amount),
    reward: cairo.uint256(opts.reward),
    timelock_delta: opts.timelockDelta,
    reward_timelock_delta: opts.rewardTimelockDelta,
    recipient: opts.recipient,
    reward_recipient: opts.rewardRecipient,
    token: opts.token,
    reward_token: opts.rewardToken,
    src_chain: "ethereum-sepolia",
    refund_to: opts.refundTo,
    payout_curve: ZERO_ADDRESS,
    payout_curve_data: "",
  };
}

/**
 * Converts a starknet.js `Call` (as produced by `Contract.populate`, shape
 * `{contractAddress, entrypoint, calldata}`) into the SNIP-9 `Call` struct
 * (`core::starknet::account::Call`, shape `{to, selector, calldata}`) expected inside an
 * `OutsideExecution.calls` span.
 */
function toSnip9Call(call: Call): { to: string; selector: string; calldata: string[] } {
  return {
    to: call.contractAddress,
    selector: hash.getSelectorFromName(call.entrypoint as string),
    calldata: call.calldata as string[],
  };
}

// ── SNIP-9 (OutsideExecution v2) — hand-rolled message hash & calldata ──
//
// starknet.js v9's own SNIP-9 TypedData builder (`outsideExecution.getTypedData` /
// `Account.executeFromOutside`) throws "Typed data does not match JSON schema" on this exact
// OutsideExecution shape (a starknet.js bug, not a wallet/contract issue). Rail B therefore
// bypasses that helper entirely: it derives the exact SNIP-12 revision-1 message hash by hand
// (per SNIP-9's `OutsideExecution` v2 spec: domain name `Account.execute_from_outside`, integer
// version `2`, integer revision `1`, Poseidon hashing) and serializes the `execute_from_outside_v2`
// calldata itself, so it never needs the target account's Sierra ABI loaded locally — only its
// address, matching how a real end-user wallet (Argent/Braavos/Ready) works on Sepolia.
//
// Type hashes below are the standardized SNIP-9 v2 values (same across OpenZeppelin/Argent/
// Braavos implementations); see the SNIP-9 spec for their derivation
// (`starknet_keccak(encode_type(...))`).
const CALL_TYPE_HASH_V2 = "0x3635c7f2a7ba93844c0d064e18e487f35ab90f7c39d00f186a781fc3f0c2ca9";
const OUTSIDE_EXECUTION_TYPE_HASH_V2 = "0x312b56c05a7965066ddbda31c016d8d05afc305071c0ca3cdc2192c3c2f1f0f";
const STARKNET_DOMAIN_TYPE_HASH = hash.getSelectorFromName(
  '"StarknetDomain"("name":"shortstring","version":"shortstring","chainId":"shortstring","revision":"shortstring")',
);
const STARKNET_MESSAGE_PREFIX = shortString.encodeShortString("StarkNet Message");

interface OutsideExecutionV2 {
  caller: string;
  nonce: string;
  execute_after: number;
  execute_before: number;
  calls: { to: string; selector: string; calldata: string[] }[];
}

function hashSnip9CallV2(call: { to: string; selector: string; calldata: string[] }): string {
  const calldataHash = hash.computePoseidonHashOnElements(call.calldata);
  return hash.computePoseidonHashOnElements([CALL_TYPE_HASH_V2, call.to, call.selector, calldataHash]);
}

function hashOutsideExecutionV2(oe: OutsideExecutionV2): string {
  const callsHash = hash.computePoseidonHashOnElements(oe.calls.map(hashSnip9CallV2));
  return hash.computePoseidonHashOnElements([
    OUTSIDE_EXECUTION_TYPE_HASH_V2,
    oe.caller,
    oe.nonce,
    num.toHex(oe.execute_after),
    num.toHex(oe.execute_before),
    callsHash,
  ]);
}

function snip9DomainHashV2(chainIdFelt: string): string {
  return hash.computePoseidonHashOnElements([
    STARKNET_DOMAIN_TYPE_HASH,
    shortString.encodeShortString("Account.execute_from_outside"),
    num.toHex(2), // domain.version — the raw integer 2, NOT the shortstring encoding of "2"
    chainIdFelt,
    num.toHex(1), // domain.revision — the raw integer 1, NOT the shortstring encoding of "1"
  ]);
}

/** The exact SNIP-12 rev-1 message hash `accountAddress` must validate for `oe` (SNIP-9 v2). */
function snip9MessageHashV2(accountAddress: string, chainIdFelt: string, oe: OutsideExecutionV2): string {
  const domainHash = snip9DomainHashV2(chainIdFelt);
  const oeHash = hashOutsideExecutionV2(oe);
  return hash.computePoseidonHashOnElements([STARKNET_MESSAGE_PREFIX, domainHash, accountAddress, oeHash]);
}

/** Serializes an `OutsideExecution` (v2) + `signature` into raw `execute_from_outside_v2` calldata,
 * matching Cairo's default Serde encoding (`Array<T>`/`Span<T>` as `[len, ...items]`). Built by
 * hand so no ABI for the target account needs to be loaded — only its address is required. */
function buildExecuteFromOutsideCalldata(oe: OutsideExecutionV2, signature: string[]): string[] {
  const callFelts = oe.calls.flatMap((c) => [c.to, c.selector, num.toHex(c.calldata.length), ...c.calldata]);
  return [
    oe.caller,
    oe.nonce,
    num.toHex(oe.execute_after),
    num.toHex(oe.execute_before),
    num.toHex(oe.calls.length),
    ...callFelts,
    num.toHex(signature.length),
    ...signature,
  ];
}

// ── Build / local verification notes ──

function tryRun(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const output = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") || String(e.message ?? err);
    return { ok: false, output };
  }
}

function collectBuildNotes(): string[] {
  const repoRoot = resolve(import.meta.dirname, "../.."); // chains/starknet
  const scriptsDir = resolve(import.meta.dirname, ".."); // chains/starknet/scripts
  const notes: string[] = [];

  const scarb = tryRun("scarb build", repoRoot);
  notes.push(`Cairo build (\`scarb build\`): ${scarb.ok ? "passed" : "FAILED — " + scarb.output.trim().slice(-300)}`);

  const tsc = tryRun("npx tsc --noEmit", scriptsDir);
  notes.push(
    `TypeScript type-check (\`npx tsc --noEmit\` in scripts/): ${tsc.ok ? "passed" : "FAILED — " + tsc.output.trim().slice(-300)}`,
  );

  const snforge = tryRun("snforge test", repoRoot);
  const snforgeSummary = snforge.output
    .trim()
    .split("\n")
    .filter((l) => /result:|passed|failed/i.test(l))
    .slice(-4)
    .join(" / ");
  notes.push(`Local snforge contract tests (\`snforge test\`): ${snforgeSummary || (snforge.ok ? "passed" : "see output")}`);

  return notes;
}

// ── Provider / accounts (module scope so helpers above can use them) ──

const { account: user, provider } = getAccount();
const { relayer } = getRelayerAccount();
const { solver } = getSolverAccount();

// ── Main ──

async function main() {
  const chainIdHex = num.toHex(await provider.getChainId());
  const rpcUrl = optionalEnv("RPC_URL") ?? "";
  const network = detectNetwork(rpcUrl, chainIdHex);
  const isDevnet = network === "devnet";

  info("S0", `network ${redactRpc(rpcUrl)} chainId=${chainIdHex} (${network})`);

  const { strk, eth } = resolveTokenAddresses();
  info("S0", `tokens strk=${strk} eth=${eth}`);

  info(
    "S1",
    `accounts user=${user.address} solver=${solver.address} relayer=${relayer.address}` +
      (solver.address === user.address ? " (solver == user)" : "") +
      (solver.address === relayer.address ? " (solver == relayer)" : ""),
  );

  const addresses = await deployAll();
  info(
    "S2",
    `contracts train=${addresses.train} trainRouter=${addresses.trainRouter} curve=${addresses.constantCurve}`,
  );

  const train = getTrainContract(addresses.train, user);
  const trainAsSolver = getTrainContract(addresses.train, solver);
  const trainAsRelayer = getTrainContract(addresses.train, relayer);
  const trainView = getTrainContract(addresses.train, provider);
  const trainRouter = getTrainRouterContract(addresses.trainRouter, user);
  const trainRouterAsRelayer = getTrainRouterContract(addresses.trainRouter, relayer);
  const trainRouterView = getTrainRouterContract(addresses.trainRouter, provider);

  const strkToken = getErc20Contract(strk, user);
  const strkTokenAsSolver = getErc20Contract(strk, solver);
  const ethTokenAsSolver = getErc20Contract(eth, solver);
  const strkView = getErc20Contract(strk, provider);
  const ethView = getErc20Contract(eth, provider);

  for (const [label, tok, holder] of [
    ["strk->user", strkView, user.address],
    ["strk->solver", strkView, solver.address],
    ["eth->solver", ethView, solver.address],
  ] as const) {
    const bal = (await tok.balance_of(holder)) as bigint;
    info("S2", `${label} balance = ${bal}`);
  }

  // ── State threaded between happy flows and their grouped unhappy-path checks ──
  let aHashlock = 0n;
  let aSecret = 0n;
  let railAIntent: Record<string, unknown> | undefined;
  let railACalldata: string[] = [];
  let railASignature: string[] = [];
  let railBSupported = false;
  let railBOutsideExecution: OutsideExecutionV2 | undefined;
  let railBSignature: string[] = [];

  // ════════════════════════════════════════════════════════════════════
  // HAPPY FLOWS
  // ════════════════════════════════════════════════════════════════════

  // ── A: direct happy — user_lock -> redeem_user ──
  {
    const S = "A";
    const secret = freshSecret("A");
    const hashlock = computeHashlock(secret);
    const now = await chainNow();

    const approveCall = strkToken.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lockCall = train.populate("user_lock", [
      userLockParams({
        hashlock,
        amount: AMOUNT,
        recipient: solver.address,
        refundTo: user.address,
        token: strk,
        timelockDelta: LONG_TIMELOCK,
        quoteExpiry: now + QUOTE_EXPIRY_DELTA,
      }),
      destinationInfo(AMOUNT, strk),
      "",
      "",
    ]);
    await sendTx(S, `A user_lock (hashlock ${hexShort(hashlock)})`, () => user.execute([approveCall, lockCall], NO_TIP));
    // redeem is submitted by `user` (the depositor), NOT `solver` (the recipient) — solver's own
    // STRK balance must stay untouched by gas so its delta cleanly reflects only the payout.
    const before = (await strkView.balance_of(solver.address)) as bigint;
    await sendTx(S, "A redeem_user (by depositor, pays solver)", () =>
      train.invoke("redeem_user", [cairo.uint256(hashlock), cairo.uint256(secret)], NO_TIP),
    );
    const after = (await strkView.balance_of(solver.address)) as bigint;
    const lock = await train.get_user_lock(cairo.uint256(hashlock));
    check(S, "A recipient received amount", after - before === AMOUNT, `delta=${after - before}`);
    check(S, "A lock status REDEEMED", lockStatusName(lock) === "Redeemed", `status=${lockStatusName(lock)}`);

    aHashlock = hashlock;
    aSecret = secret;
  }

  // ── B: ConstantPayoutCurve happy — user_lock(payout_curve) -> redeem, full payout / zero excess ──
  {
    const S = "B";
    const secret = freshSecret("B");
    const hashlock = computeHashlock(secret);
    const now = await chainNow();

    const approveCall = strkToken.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lockCall = train.populate("user_lock", [
      userLockParams({
        hashlock,
        amount: AMOUNT,
        recipient: solver.address,
        refundTo: user.address,
        token: strk,
        timelockDelta: LONG_TIMELOCK,
        quoteExpiry: now + QUOTE_EXPIRY_DELTA,
        payoutCurve: addresses.constantCurve,
      }),
      destinationInfo(AMOUNT, strk),
      "",
      "",
    ]);
    await sendTx(S, `B user_lock with payout_curve (hashlock ${hexShort(hashlock)})`, () =>
      user.execute([approveCall, lockCall], NO_TIP),
    );
    const lockAfterCreate = await train.get_user_lock(cairo.uint256(hashlock));
    check(
      S,
      "B payout_curve stored",
      String(lockAfterCreate.payout_curve) === BigInt(addresses.constantCurve).toString(),
      `stored=${num.toHex(lockAfterCreate.payout_curve)}`,
    );

    // redeem submitted by `user` (depositor), not `solver` (recipient) — see Flow A's comment.
    const before = (await strkView.balance_of(solver.address)) as bigint;
    await sendTx(S, "B redeem_user (curve, by depositor)", () =>
      train.invoke("redeem_user", [cairo.uint256(hashlock), cairo.uint256(secret)], NO_TIP),
    );
    const after = (await strkView.balance_of(solver.address)) as bigint;
    check(S, "B full payout via constant curve, zero excess", after - before === AMOUNT, `delta=${after - before}`);
  }

  // ── C: refund_user by recipient BEFORE timelock ──
  {
    const S = "C";
    const secret = freshSecret("C");
    const hashlock = computeHashlock(secret);
    const now = await chainNow();

    const approveCall = strkToken.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lockCall = train.populate("user_lock", [
      userLockParams({
        hashlock,
        amount: AMOUNT,
        recipient: solver.address,
        refundTo: user.address,
        token: strk,
        timelockDelta: LONG_TIMELOCK,
        quoteExpiry: now + QUOTE_EXPIRY_DELTA,
      }),
      destinationInfo(AMOUNT, strk),
      "",
      "",
    ]);
    await sendTx(S, `C user_lock (hashlock ${hexShort(hashlock)}, long timelock)`, () =>
      user.execute([approveCall, lockCall], NO_TIP),
    );
    // `before` is captured AFTER the lock tx (which `user` itself submitted, paying gas in STRK)
    // and the refund is submitted by `solver` (the recipient), not `user` — so this window is
    // clean of any gas cost on the account (`user`) whose balance we're asserting on.
    const before = (await strkView.balance_of(user.address)) as bigint;
    await sendTx(S, "C refund_user by recipient (before timelock)", () =>
      trainAsSolver.invoke("refund_user", [cairo.uint256(hashlock)], NO_TIP),
    );
    const after = (await strkView.balance_of(user.address)) as bigint;
    const lock = await train.get_user_lock(cairo.uint256(hashlock));
    check(S, "C refunded to refund_to (user) despite long timelock", after - before === AMOUNT, `delta=${after - before}`);
    check(S, "C lock status REFUNDED", lockStatusName(lock) === "Refunded", `status=${lockStatusName(lock)}`);
  }

  // ── D: refund_user by non-recipient (third party) AFTER timelock ──
  {
    const S = "D";
    const secret = freshSecret("D");
    const hashlock = computeHashlock(secret);
    const counterparty = randomAddress();
    const now = await chainNow();

    const approveCall = strkToken.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lockCall = train.populate("user_lock", [
      userLockParams({
        hashlock,
        amount: AMOUNT,
        recipient: counterparty,
        refundTo: user.address,
        token: strk,
        timelockDelta: SHORT_TIMELOCK,
        quoteExpiry: now + QUOTE_EXPIRY_DELTA,
      }),
      destinationInfo(AMOUNT, strk),
      "",
      "",
    ]);
    await sendTx(S, `D user_lock (hashlock ${hexShort(hashlock)}, short timelock)`, () =>
      user.execute([approveCall, lockCall], NO_TIP),
    );
    const lock = await train.get_user_lock(cairo.uint256(hashlock));
    await waitUntilChainTimeAfter(Number(lock.timelock), isDevnet, rpcUrl);

    const userBefore = (await strkView.balance_of(user.address)) as bigint;
    const relayerBefore = (await strkView.balance_of(relayer.address)) as bigint;
    // Relayer is neither the depositor nor the recipient — a genuine third party. Relayer itself
    // submits this tx, so its own STRK balance also drops by the gas fee it pays; `fee` is added
    // back before comparing so the assertion reflects "did the caller receive any Train funds",
    // not "is the caller's wallet balance perfectly unchanged" (impossible — it always pays gas).
    const { fee: refundFee } = await sendTx(S, "D refund_user by third party (relayer, after timelock)", () =>
      trainAsRelayer.invoke("refund_user", [cairo.uint256(hashlock)], NO_TIP),
    );
    const userAfter = (await strkView.balance_of(user.address)) as bigint;
    const relayerAfter = (await strkView.balance_of(relayer.address)) as bigint;
    const userGained = userAfter - userBefore;
    const relayerGained = relayerAfter - relayerBefore + refundFee;
    check(
      S,
      "D refund lands on refund_to (user), never the third-party caller",
      userGained === AMOUNT && relayerGained === 0n,
      `refund_to gained ${userGained} (expected ${AMOUNT}); caller gained ${relayerGained} (expected 0, fee-corrected)`,
    );
  }

  // ── E: user_lock_for(beneficiary) -> redeem, attributed to beneficiary ──
  {
    const S = "E";
    const secret = freshSecret("E");
    const hashlock = computeHashlock(secret);
    const beneficiary = randomAddress();
    const now = await chainNow();

    const approveCall = strkToken.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lockCall = train.populate("user_lock_for", [
      beneficiary,
      userLockParams({
        hashlock,
        amount: AMOUNT,
        recipient: beneficiary,
        refundTo: beneficiary,
        token: strk,
        timelockDelta: LONG_TIMELOCK,
        quoteExpiry: now + QUOTE_EXPIRY_DELTA,
      }),
      destinationInfo(AMOUNT, strk),
      "",
      "",
    ]);
    await sendTx(S, `E user_lock_for(beneficiary) (hashlock ${hexShort(hashlock)})`, () =>
      user.execute([approveCall, lockCall], NO_TIP),
    );
    const lock = await train.get_user_lock(cairo.uint256(hashlock));
    const attributedOk = BigInt(lock.sender) === BigInt(beneficiary);
    check(S, "E lock attributed to beneficiary, not caller", attributedOk, `sender=${num.toHex(lock.sender)}`);

    const before = (await strkView.balance_of(beneficiary)) as bigint;
    await sendTx(S, "E redeem_user (by depositor, pays beneficiary)", () =>
      train.invoke("redeem_user", [cairo.uint256(hashlock), cairo.uint256(secret)], NO_TIP),
    );
    const after = (await strkView.balance_of(beneficiary)) as bigint;
    check(S, "E beneficiary received amount", after - before === AMOUNT, `delta=${after - before}`);
  }

  // ── F: solver_lock -> redeem_solver (no reward), first index is 1 ──
  {
    const S = "F";
    const secret = freshSecret("F");
    const hashlock = computeHashlock(secret);

    const approveCall = strkTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lockCall = trainAsSolver.populate("solver_lock", [
      solverLockParams({
        hashlock,
        amount: AMOUNT,
        reward: 0n,
        recipient: user.address,
        rewardRecipient: user.address,
        token: strk,
        rewardToken: strk,
        refundTo: solver.address,
        timelockDelta: LONG_TIMELOCK,
        rewardTimelockDelta: 0,
      }),
      destinationInfo(AMOUNT, strk),
      "",
    ]);
    await sendTx(S, `F solver_lock (hashlock ${hexShort(hashlock)})`, () =>
      solver.execute([approveCall, lockCall], NO_TIP),
    );
    const index = (await train.get_solver_lock_count(cairo.uint256(hashlock))) as bigint;
    check(S, "F first index is 1", index === 1n, `index=${index}`);

    // redeem submitted by `relayer`, not `user` (the principal recipient) — see Flow A's comment
    // on why the recipient must never be the one paying its own gas in the measured window.
    const before = (await strkView.balance_of(user.address)) as bigint;
    await sendTx(S, "F redeem_solver (by relayer)", () =>
      trainAsRelayer.invoke("redeem_solver", [cairo.uint256(hashlock), index, cairo.uint256(secret)], NO_TIP),
    );
    const after = (await strkView.balance_of(user.address)) as bigint;
    check(S, "F recipient received amount", after - before === AMOUNT, `delta=${after - before}`);
  }

  // ── G: solver_lock with reward, redeem BEFORE reward_timelock -> reward to reward_recipient ──
  {
    const S = "G";
    const secret = freshSecret("G");
    const hashlock = computeHashlock(secret);
    const rewardRecipient = randomAddress();

    const approveCall = strkTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(AMOUNT + REWARD)]);
    const lockCall = trainAsSolver.populate("solver_lock", [
      solverLockParams({
        hashlock,
        amount: AMOUNT,
        reward: REWARD,
        recipient: user.address,
        rewardRecipient,
        token: strk,
        rewardToken: strk,
        refundTo: solver.address,
        timelockDelta: LONG_TIMELOCK,
        rewardTimelockDelta: SAFE_REWARD_TIMELOCK,
      }),
      destinationInfo(AMOUNT, strk),
      "",
    ]);
    await sendTx(S, `G solver_lock (hashlock ${hexShort(hashlock)}, reward)`, () =>
      solver.execute([approveCall, lockCall], NO_TIP),
    );
    const index = (await train.get_solver_lock_count(cairo.uint256(hashlock))) as bigint;

    const rewardBefore = (await strkView.balance_of(rewardRecipient)) as bigint;
    await sendTx(S, "G redeem_solver (before reward_timelock, by relayer)", () =>
      trainAsRelayer.invoke("redeem_solver", [cairo.uint256(hashlock), index, cairo.uint256(secret)], NO_TIP),
    );
    const rewardAfter = (await strkView.balance_of(rewardRecipient)) as bigint;
    check(
      S,
      "G reward went to reward_recipient (not redeemer)",
      rewardAfter - rewardBefore === REWARD,
      `delta=${rewardAfter - rewardBefore}`,
    );
  }

  // ── H: solver_lock with reward, redeem AFTER reward_timelock -> reward to redeemer ──
  {
    const S = "H";
    const secret = freshSecret("H");
    const hashlock = computeHashlock(secret);

    const approveCall = strkTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(AMOUNT + REWARD)]);
    const lockCall = trainAsSolver.populate("solver_lock", [
      solverLockParams({
        hashlock,
        amount: AMOUNT,
        reward: REWARD,
        recipient: user.address,
        rewardRecipient: randomAddress(),
        token: strk,
        rewardToken: strk,
        refundTo: solver.address,
        timelockDelta: LONG_TIMELOCK,
        rewardTimelockDelta: SHORT_REWARD_TIMELOCK,
      }),
      destinationInfo(AMOUNT, strk),
      "",
    ]);
    await sendTx(S, `H solver_lock (hashlock ${hexShort(hashlock)}, short reward_timelock)`, () =>
      solver.execute([approveCall, lockCall], NO_TIP),
    );
    const index = (await train.get_solver_lock_count(cairo.uint256(hashlock))) as bigint;
    const lock = await train.get_solver_lock(cairo.uint256(hashlock), index);
    await waitUntilChainTimeAfter(Number(lock.reward_timelock), isDevnet, rpcUrl);

    // Redeemed by `relayer` after `reward_timelock`: the principal goes to `recipient` (user, who
    // pays no gas here so its delta is clean) and the reward goes to the *redeemer* (the caller,
    // i.e. the relayer). The relayer pays gas in STRK, so its measured gain is fee-corrected.
    const userBefore = (await strkView.balance_of(user.address)) as bigint;
    const relayerBefore = (await strkView.balance_of(relayer.address)) as bigint;
    const { fee: redeemFee } = await sendTx(S, "H redeem_solver (after reward_timelock, by relayer)", () =>
      trainAsRelayer.invoke("redeem_solver", [cairo.uint256(hashlock), index, cairo.uint256(secret)], NO_TIP),
    );
    const userGained = ((await strkView.balance_of(user.address)) as bigint) - userBefore;
    const relayerGained = ((await strkView.balance_of(relayer.address)) as bigint) - relayerBefore + redeemFee;
    check(
      S,
      "H after reward_timelock: amount -> recipient(user), reward -> redeemer(relayer)",
      userGained === AMOUNT && relayerGained === REWARD,
      `recipient(user) gained ${userGained} (expected ${AMOUNT}); redeemer(relayer) gained ${relayerGained} (expected ${REWARD}, fee-corrected)`,
    );
  }

  // ── I: solver_lock, principal STRK + reward ETH (different token) -> redeem pays both legs ──
  {
    const S = "I";
    const secret = freshSecret("I");
    const hashlock = computeHashlock(secret);
    const rewardRecipient = randomAddress();

    const approveMain = strkTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const approveReward = ethTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(REWARD)]);
    const lockCall = trainAsSolver.populate("solver_lock", [
      solverLockParams({
        hashlock,
        amount: AMOUNT,
        reward: REWARD,
        recipient: user.address,
        rewardRecipient,
        token: strk,
        rewardToken: eth,
        refundTo: solver.address,
        timelockDelta: LONG_TIMELOCK,
        rewardTimelockDelta: SAFE_REWARD_TIMELOCK,
      }),
      destinationInfo(AMOUNT, strk),
      "",
    ]);
    await sendTx(S, `I solver_lock (hashlock ${hexShort(hashlock)}, diff reward token)`, () =>
      solver.execute([approveMain, approveReward, lockCall], NO_TIP),
    );
    const index = (await train.get_solver_lock_count(cairo.uint256(hashlock))) as bigint;

    // redeem submitted by `relayer`, not `user` (the STRK principal recipient) — see Flow A's
    // comment; the ETH reward_recipient is an unrelated dummy address either way.
    const userBefore = (await strkView.balance_of(user.address)) as bigint;
    const rewardBefore = (await ethView.balance_of(rewardRecipient)) as bigint;
    await sendTx(S, "I redeem_solver (different reward token, by relayer)", () =>
      trainAsRelayer.invoke("redeem_solver", [cairo.uint256(hashlock), index, cairo.uint256(secret)], NO_TIP),
    );
    const userAfter = (await strkView.balance_of(user.address)) as bigint;
    const rewardAfter = (await ethView.balance_of(rewardRecipient)) as bigint;
    check(S, "I principal paid in STRK", userAfter - userBefore === AMOUNT, `delta=${userAfter - userBefore}`);
    check(S, "I reward paid in ETH", rewardAfter - rewardBefore === REWARD, `delta=${rewardAfter - rewardBefore}`);
  }

  // ── J: refund_solver AFTER timelock (amount+reward back to refund_to) ──
  {
    const S = "J";
    const secret = freshSecret("J");
    const hashlock = computeHashlock(secret);

    const approveCall = strkTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(AMOUNT + REWARD)]);
    const lockCall = trainAsSolver.populate("solver_lock", [
      solverLockParams({
        hashlock,
        amount: AMOUNT,
        reward: REWARD,
        recipient: user.address,
        rewardRecipient: user.address,
        token: strk,
        rewardToken: strk,
        refundTo: solver.address,
        timelockDelta: SHORT_TIMELOCK,
        rewardTimelockDelta: Math.max(1, SHORT_TIMELOCK - 10),
      }),
      destinationInfo(AMOUNT, strk),
      "",
    ]);
    await sendTx(S, `J solver_lock (hashlock ${hexShort(hashlock)}, short timelock)`, () =>
      solver.execute([approveCall, lockCall], NO_TIP),
    );
    const index = (await train.get_solver_lock_count(cairo.uint256(hashlock))) as bigint;
    const lock = await train.get_solver_lock(cairo.uint256(hashlock), index);
    await waitUntilChainTimeAfter(Number(lock.timelock), isDevnet, rpcUrl);

    // `before` is captured AFTER solver_lock (which `solver` itself submitted, paying gas) and
    // refund is submitted by `user`, not `solver` — so this window is clean of any gas cost on
    // the account (`solver`) whose balance we're asserting on.
    const before = (await strkView.balance_of(solver.address)) as bigint;
    await sendTx(S, "J refund_solver (after timelock, by user)", () =>
      train.invoke("refund_solver", [cairo.uint256(hashlock), index], NO_TIP),
    );
    const after = (await strkView.balance_of(solver.address)) as bigint;
    check(S, "J amount+reward returned to solver", after - before === AMOUNT + REWARD, `delta=${after - before}`);
  }

  // ── K: Rail A gasless — TrainRouter.forward_intent ──
  {
    const S = "K";
    const secret = freshSecret("K");
    const hashlock = computeHashlock(secret);
    const now = await chainNow();

    // One-time approval: user approves the router directly (paid by the user, once).
    await sendTx(S, "K user: one-time STRK.approve(router, amount)", () =>
      user.execute(strkToken.populate("approve", [addresses.trainRouter, cairo.uint256(AMOUNT)]), NO_TIP),
    );

    const userLockForCall = train.populate("user_lock_for", [
      user.address,
      userLockParams({
        hashlock,
        amount: AMOUNT,
        recipient: user.address,
        refundTo: user.address,
        token: strk,
        timelockDelta: LONG_TIMELOCK,
        quoteExpiry: now + QUOTE_EXPIRY_DELTA,
      }),
      destinationInfo(AMOUNT, strk),
      "",
      "",
    ]);
    const calldataArr = userLockForCall.calldata as string[];
    const selector = hash.getSelectorFromName("user_lock_for");
    const callHash = hash.computePoseidonHashOnElements(calldataArr);
    const nonce = num.toHex(freshSecret("K-nonce") % 2n ** 200n);
    const deadline = now + INTENT_DEADLINE_DELTA;

    const intent = {
      user: user.address,
      router: addresses.trainRouter,
      train: addresses.train,
      token: strk,
      amount: cairo.uint256(AMOUNT),
      selector,
      call_hash: callHash,
      nonce,
      deadline,
    };

    // Ask the router itself for the exact SNIP-12 digest to sign — avoids re-deriving the SNIP-12
    // domain/type-hash machinery client-side (unlike Rail B, where no such convenience view
    // exists on an arbitrary end-user wallet).
    const intentHash = (await trainRouter.get_intent_hash(intent)) as bigint;
    info(S, `K intent digest (get_intent_hash): ${num.toHex(intentHash)}`);

    const userPrivateKey = num.toHex(BigInt(requireEnvPrivateKey()));
    const sig = ec.starkCurve.sign(num.toHex(intentHash), userPrivateKey);
    const signature = [num.toHex(sig.r), num.toHex(sig.s)];

    const routerBalBefore = (await strkView.balance_of(addresses.trainRouter)) as bigint;
    await sendTx(S, "K relayer: forward_intent (pays gas)", () =>
      trainRouterAsRelayer.invoke("forward_intent", [intent, calldataArr, signature], NO_TIP),
    );
    const routerBalAfter = (await strkView.balance_of(addresses.trainRouter)) as bigint;
    check(
      S,
      "K router never holds a residual balance",
      routerBalBefore === 0n && routerBalAfter === 0n,
      `before=${routerBalBefore}, after=${routerBalAfter}`,
    );

    const lock = await train.get_user_lock(cairo.uint256(hashlock));
    const attributedOk = BigInt(lock.sender) === BigInt(user.address);
    check(S, "K lock attributed to user", attributedOk, `sender=${num.toHex(lock.sender)}`);

    const consumed = (await trainRouter.is_consumed(num.toHex(intentHash))) as boolean;
    check(S, "K is_consumed(intentHash) true after forward", consumed === true, `is_consumed=${consumed}`);

    await sendTx(S, "K redeem_user", () =>
      train.invoke("redeem_user", [cairo.uint256(hashlock), cairo.uint256(secret)], NO_TIP),
    );

    railAIntent = intent;
    railACalldata = calldataArr;
    railASignature = signature;
  }

  // ── L: Rail B gasless — SNIP-9 execute_from_outside_v2 (the real user wallet) ──
  {
    const S = "L";
    railBSupported = await src5.supportsInterface(provider, user.address, constants.SNIP9_V2_INTERFACE_ID);
    info(S, `user account SNIP-9 (ISRC9_V2) support: ${railBSupported}`);

    if (!railBSupported) {
      info(
        S,
        "L Rail B SKIPPED — user account does not support SNIP-9 execute_from_outside_v2",
        isDevnet
          ? "expected on devnet: the default devnet account is not SNIP-9 capable — pending validation on Sepolia with a real Argent/Braavos/Ready wallet"
          : "ACCOUNT_ADDRESS must be a real SNIP-9-capable wallet (Argent/Braavos/Ready) for Rail B",
      );
    } else {
      const secret = freshSecret("L");
      const hashlock = computeHashlock(secret);
      const now = await chainNow();

      const approveCall: Call = strkToken.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
      const lockCall: Call = train.populate("user_lock_for", [
        user.address,
        userLockParams({
          hashlock,
          amount: AMOUNT,
          recipient: user.address,
          refundTo: user.address,
          token: strk,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: now + QUOTE_EXPIRY_DELTA,
        }),
        destinationInfo(AMOUNT, strk),
        "",
        "",
      ]);

      const outsideExecution: OutsideExecutionV2 = {
        caller: relayer.address,
        nonce: num.toHex(freshSecret("L-nonce") % 2n ** 200n),
        execute_after: now - 60,
        execute_before: now + INTENT_DEADLINE_DELTA,
        calls: [approveCall, lockCall].map(toSnip9Call),
      };

      const messageHash = snip9MessageHashV2(user.address, chainIdHex, outsideExecution);
      info(S, `L OutsideExecution message hash (hand-rolled SNIP-9 v2): ${messageHash}`);

      const userPrivateKey = num.toHex(BigInt(requireEnvPrivateKey()));
      const sig = ec.starkCurve.sign(messageHash, userPrivateKey);
      const signature = [num.toHex(sig.r), num.toHex(sig.s)];

      const calldata = buildExecuteFromOutsideCalldata(outsideExecution, signature);
      await sendTx(S, "L relayer: execute_from_outside_v2 (approve + user_lock_for)", () =>
        relayer.execute({ contractAddress: user.address, entrypoint: "execute_from_outside_v2", calldata }, NO_TIP),
      );

      const lock = await train.get_user_lock(cairo.uint256(hashlock));
      const attributedOk = BigInt(lock.sender) === BigInt(user.address);
      check(S, "L lock attributed to user", attributedOk, `sender=${num.toHex(lock.sender)}`);

      await sendTx(S, "L redeem_user (by relayer, pays user)", () =>
        trainAsRelayer.invoke("redeem_user", [cairo.uint256(hashlock), cairo.uint256(secret)], NO_TIP),
      );

      railBOutsideExecution = outsideExecution;
      railBSignature = signature;
    }
  }

  // ── V: view / enumeration probes ──
  {
    const S = "V";
    const s = freshSecret("V-probe");
    const probeHashlock = computeHashlock(s);

    const approve1 = strkTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lock1 = trainAsSolver.populate("solver_lock", [
      solverLockParams({
        hashlock: probeHashlock,
        amount: AMOUNT,
        reward: 0n,
        recipient: user.address,
        rewardRecipient: user.address,
        token: strk,
        rewardToken: strk,
        refundTo: solver.address,
        timelockDelta: LONG_TIMELOCK,
        rewardTimelockDelta: 0,
      }),
      destinationInfo(AMOUNT, strk),
      "",
    ]);
    await sendTx(S, "V probe lock #1 solver_lock", () => solver.execute([approve1, lock1], NO_TIP));
    const index1 = (await train.get_solver_lock_count(cairo.uint256(probeHashlock))) as bigint;

    const approve2 = strkTokenAsSolver.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lock2 = trainAsSolver.populate("solver_lock", [
      solverLockParams({
        hashlock: probeHashlock,
        amount: AMOUNT,
        reward: 0n,
        recipient: user.address,
        rewardRecipient: user.address,
        token: strk,
        rewardToken: strk,
        refundTo: solver.address,
        timelockDelta: LONG_TIMELOCK,
        rewardTimelockDelta: 0,
      }),
      destinationInfo(AMOUNT, strk),
      "",
    ]);
    await sendTx(S, "V probe lock #2 solver_lock", () => solver.execute([approve2, lock2], NO_TIP));
    const index2 = (await train.get_solver_lock_count(cairo.uint256(probeHashlock))) as bigint;
    check(S, "V probe indices are 1 and 2", index1 === 1n && index2 === 2n, `got ${index1}, ${index2}`);

    const lockAt2 = await train.get_solver_lock(cairo.uint256(probeHashlock), 2n);
    check(S, "V get_solver_lock(h, 2) resolves index 2 (Pending)", lockStatusName(lockAt2) === "Pending", `status=${lockStatusName(lockAt2)}`);
    const lockAt99 = await train.get_solver_lock(cairo.uint256(probeHashlock), 99n);
    check(S, "V get_solver_lock(h, 99) is Empty", lockStatusName(lockAt99) === "Empty", `status=${lockStatusName(lockAt99)}`);

    // Pagination over user.address's enumerated user-lock hashes (A, B, C, D, K, L if run, and
    // the U1-live fixture below all attribute to `user`).
    const page = (await train.get_user_lock_hashes(user.address, cairo.uint256(0n), cairo.uint256(1000n))) as unknown;
    const [hashesRaw, totalRaw] = unwrapPair(page);
    const hashes = hashesRaw as bigint[];
    const total = totalRaw as bigint;
    info(S, `V get_user_lock_hashes(user, 0, 1000) total=${total}`);
    let resolved = 0;
    for (const h of hashes) {
      const l = await train.get_user_lock(cairo.uint256(h));
      if (lockStatusName(l) !== "Empty") resolved++;
    }
    check(S, "V enumeration entries all resolve to existing locks", resolved === Number(total), `${resolved}/${total} resolve`);
  }

  // ════════════════════════════════════════════════════════════════════
  // UNHAPPY PATHS
  // ════════════════════════════════════════════════════════════════════

  // ── U1: general unhappy paths ──
  {
    const S = "U1";
    const now = await chainNow();
    const freshQuote = now + QUOTE_EXPIRY_DELTA;

    await simReject(S, "user_lock amount=0", "ZeroAmount", () =>
      simulateCall(trainView, "user_lock", [
        userLockParams({
          hashlock: computeHashlock(freshSecret("U1-a")),
          amount: 0n,
          recipient: solver.address,
          refundTo: user.address,
          token: strk,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: freshQuote,
        }),
        destinationInfo(0n, strk),
        "",
        "",
      ]),
    );

    await simReject(S, "user_lock token=0", "InvalidToken", () =>
      simulateCall(trainView, "user_lock", [
        userLockParams({
          hashlock: computeHashlock(freshSecret("U1-b")),
          amount: AMOUNT,
          recipient: solver.address,
          refundTo: user.address,
          token: ZERO_ADDRESS,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: freshQuote,
        }),
        destinationInfo(AMOUNT, strk),
        "",
        "",
      ]),
    );

    await simReject(S, "user_lock timelock_delta=0", "InvalidTimelock", () =>
      simulateCall(trainView, "user_lock", [
        userLockParams({
          hashlock: computeHashlock(freshSecret("U1-c")),
          amount: AMOUNT,
          recipient: solver.address,
          refundTo: user.address,
          token: strk,
          timelockDelta: 0,
          quoteExpiry: freshQuote,
        }),
        destinationInfo(AMOUNT, strk),
        "",
        "",
      ]),
    );

    await simReject(S, "user_lock expired quote", "QuoteExpired", () =>
      simulateCall(trainView, "user_lock", [
        userLockParams({
          hashlock: computeHashlock(freshSecret("U1-d")),
          amount: AMOUNT,
          recipient: solver.address,
          refundTo: user.address,
          token: strk,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: 1,
        }),
        destinationInfo(AMOUNT, strk),
        "",
        "",
      ]),
    );

    await simReject(S, "user_lock duplicate hashlock (A)", "SwapAlreadyExists", () =>
      simulateCall(trainView, "user_lock", [
        userLockParams({
          hashlock: aHashlock,
          amount: AMOUNT,
          recipient: solver.address,
          refundTo: user.address,
          token: strk,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: freshQuote,
        }),
        destinationInfo(AMOUNT, strk),
        "",
        "",
      ]),
    );

    await simReject(S, "user_lock zero recipient", "ZeroAddress", () =>
      simulateCall(trainView, "user_lock", [
        userLockParams({
          hashlock: computeHashlock(freshSecret("U1-e")),
          amount: AMOUNT,
          recipient: ZERO_ADDRESS,
          refundTo: user.address,
          token: strk,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: freshQuote,
        }),
        destinationInfo(AMOUNT, strk),
        "",
        "",
      ]),
    );

    await simReject(S, "user_lock_for zero user", "InvalidUser", () =>
      simulateCall(trainView, "user_lock_for", [
        ZERO_ADDRESS,
        userLockParams({
          hashlock: computeHashlock(freshSecret("U1-f")),
          amount: AMOUNT,
          recipient: solver.address,
          refundTo: user.address,
          token: strk,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: freshQuote,
        }),
        destinationInfo(AMOUNT, strk),
        "",
        "",
      ]),
    );

    await simReject(S, "solver_lock reward_timelock_delta >= timelock_delta", "InvalidRewardTimelock", () =>
      simulateCall(trainView, "solver_lock", [
        solverLockParams({
          hashlock: computeHashlock(freshSecret("U1-g")),
          amount: AMOUNT,
          reward: REWARD,
          recipient: user.address,
          rewardRecipient: user.address,
          token: strk,
          rewardToken: strk,
          refundTo: solver.address,
          timelockDelta: 100,
          rewardTimelockDelta: 100,
        }),
        destinationInfo(AMOUNT, strk),
        "",
      ]),
    );

    await simReject(S, "solver_lock zero reward_recipient", "ZeroAddress", () =>
      simulateCall(trainView, "solver_lock", [
        solverLockParams({
          hashlock: computeHashlock(freshSecret("U1-h")),
          amount: AMOUNT,
          reward: REWARD,
          recipient: user.address,
          rewardRecipient: ZERO_ADDRESS,
          token: strk,
          rewardToken: strk,
          refundTo: solver.address,
          timelockDelta: LONG_TIMELOCK,
          rewardTimelockDelta: 100,
        }),
        destinationInfo(AMOUNT, strk),
        "",
      ]),
    );

    await simReject(S, "redeem_user unknown hashlock", "LockNotFound", () =>
      simulateCall(trainView, "redeem_user", [cairo.uint256(computeHashlock(freshSecret("U1-i"))), cairo.uint256(1n)]),
    );

    await simReject(S, "refund_solver unknown", "LockNotFound", () =>
      simulateCall(trainView, "refund_solver", [cairo.uint256(computeHashlock(freshSecret("U1-j"))), cairo.uint256(1n)]),
    );

    await simReject(S, "redeem_user A again (already redeemed)", "LockNotPending", () =>
      simulateCall(trainView, "redeem_user", [cairo.uint256(aHashlock), cairo.uint256(aSecret)]),
    );

    // Live fixture (still PENDING) for checks that need an existing, un-redeemed lock.
    const liveSecret = freshSecret("U1-live");
    const liveHashlock = computeHashlock(liveSecret);
    const liveNow = await chainNow();
    const approveLive = strkToken.populate("approve", [addresses.train, cairo.uint256(AMOUNT)]);
    const lockLive = train.populate("user_lock", [
      userLockParams({
        hashlock: liveHashlock,
        amount: AMOUNT,
        recipient: solver.address,
        refundTo: user.address,
        token: strk,
        timelockDelta: LONG_TIMELOCK,
        quoteExpiry: liveNow + QUOTE_EXPIRY_DELTA,
      }),
      destinationInfo(AMOUNT, strk),
      "",
      "",
    ]);
    await sendTx(S, "U1-live user_lock (fixture)", () => user.execute([approveLive, lockLive], NO_TIP));

    await simReject(S, "redeem_user wrong secret", "HashlockMismatch", () =>
      simulateCall(trainView, "redeem_user", [cairo.uint256(liveHashlock), cairo.uint256(freshSecret("wrong"))]),
    );
    await simReject(S, "refund_user early by non-recipient", "RefundNotAllowed", () =>
      simulateCall(trainView, "refund_user", [cairo.uint256(liveHashlock)]),
    );

    // Cleanup: reclaim the fixture's funds via the recipient (allowed before timelock).
    await sendTx(S, "U1-live cleanup refund by recipient", () =>
      trainAsSolver.invoke("refund_user", [cairo.uint256(liveHashlock)], NO_TIP),
    );
  }

  // ── U2: Rail A unhappy paths ──
  if (railAIntent) {
    const S = "U2";
    const now = await chainNow();

    await simReject(S, "forward_intent wrong router", "RouterMismatch", () =>
      simulateCall(trainRouterView, "forward_intent", [
        { ...railAIntent, router: randomAddress(), nonce: num.toHex(freshSecret("U2-a") % 2n ** 200n) },
        railACalldata,
        railASignature,
      ]),
    );

    await simReject(S, "forward_intent expired deadline", "IntentExpired", () =>
      simulateCall(trainRouterView, "forward_intent", [
        { ...railAIntent, deadline: 1, nonce: num.toHex(freshSecret("U2-b") % 2n ** 200n) },
        railACalldata,
        railASignature,
      ]),
    );

    await simReject(S, "forward_intent calldata does not match call_hash", "CallHashMismatch", () =>
      simulateCall(trainRouterView, "forward_intent", [
        { ...railAIntent, nonce: num.toHex(freshSecret("U2-c") % 2n ** 200n) },
        [...railACalldata.slice(0, -1), num.toHex(BigInt(railACalldata[railACalldata.length - 1] ?? "0x0") + 1n)],
        railASignature,
      ]),
    );

    await simReject(S, "forward_intent wrong signature", "InvalidSignature", () =>
      simulateCall(trainRouterView, "forward_intent", [
        { ...railAIntent, nonce: num.toHex(freshSecret("U2-d") % 2n ** 200n) },
        railACalldata,
        [railASignature[0], num.toHex(BigInt(railASignature[1]) + 1n)],
      ]),
    );

    // ResidualBalance: sign an intent whose committed `amount` differs from the amount actually
    // consumed by the forwarded calldata (`params.amount`), so the router is left holding (or
    // short) a residual balance after the forward.
    {
      const secret = freshSecret("U2-e");
      const hashlock = computeHashlock(secret);
      // Fresh standing approval covering the amount the router will pull (K's was consumed by K's
      // forward). The router pulls `intent.amount` (= AMOUNT) but the forwarded call consumes only
      // `params.amount` (= AMOUNT - 1), so the router is left holding a 1-wei residual.
      await sendTx(S, "U2 user re-approves router (residual-balance probe)", () =>
        user.execute(strkToken.populate("approve", [addresses.trainRouter, cairo.uint256(AMOUNT)]), NO_TIP),
      );
      const badLockCall = train.populate("user_lock_for", [
        user.address,
        userLockParams({
          hashlock,
          amount: AMOUNT - 1n, // forwarded call consumes one less than the router pulls
          recipient: user.address,
          refundTo: user.address,
          token: strk,
          timelockDelta: LONG_TIMELOCK,
          quoteExpiry: now + QUOTE_EXPIRY_DELTA,
        }),
        destinationInfo(AMOUNT - 1n, strk),
        "",
        "",
      ]);
      const badCalldata = badLockCall.calldata as string[];
      const badCallHash = hash.computePoseidonHashOnElements(badCalldata);
      const badIntent = {
        user: user.address,
        router: addresses.trainRouter,
        train: addresses.train,
        token: strk,
        amount: cairo.uint256(AMOUNT), // router pulls AMOUNT; forward consumes only AMOUNT - 1
        selector: hash.getSelectorFromName("user_lock_for"),
        call_hash: badCallHash,
        nonce: num.toHex(freshSecret("U2-e-nonce") % 2n ** 200n),
        deadline: now + INTENT_DEADLINE_DELTA,
      };
      const badIntentHash = (await trainRouter.get_intent_hash(badIntent)) as bigint;
      const userPrivateKey = num.toHex(BigInt(requireEnvPrivateKey()));
      const sig = ec.starkCurve.sign(num.toHex(badIntentHash), userPrivateKey);
      const badSignature = [num.toHex(sig.r), num.toHex(sig.s)];
      await simReject(S, "forward_intent under-consumes pulled amount (ResidualBalance)", "ResidualBalance", () =>
        simulateCall(trainRouterView, "forward_intent", [badIntent, badCalldata, badSignature]),
      );
    }

    // IntentConsumed: replay the exact intent Flow K already forwarded (real, state-dependent).
    await sendExpectRevert(S, "forward_intent REPLAY of K's already-consumed intent", () =>
      trainRouterAsRelayer.invoke("forward_intent", [railAIntent, railACalldata, railASignature], NO_TIP),
    );
  }

  // ── U3: Rail B unhappy paths ──
  if (railBSupported && railBOutsideExecution) {
    const S = "U3";
    const now = await chainNow();

    const expired: OutsideExecutionV2 = {
      ...railBOutsideExecution,
      nonce: num.toHex(freshSecret("U3-nonce") % 2n ** 200n),
      execute_before: now - 100,
    };
    const expiredHash = snip9MessageHashV2(user.address, chainIdHex, expired);
    const userPrivateKey = num.toHex(BigInt(requireEnvPrivateKey()));
    const sig = ec.starkCurve.sign(expiredHash, userPrivateKey);
    const expiredSignature = [num.toHex(sig.r), num.toHex(sig.s)];
    const expiredCalldata = buildExecuteFromOutsideCalldata(expired, expiredSignature);
    await sendExpectRevert(S, "execute_from_outside_v2 expired time-bounds", () =>
      relayer.execute(
        { contractAddress: user.address, entrypoint: "execute_from_outside_v2", calldata: expiredCalldata },
        NO_TIP,
      ),
    );

    // Duplicate-nonce: replay Flow L's already-consumed OutsideExecution (real, state-dependent).
    const replayCalldata = buildExecuteFromOutsideCalldata(railBOutsideExecution, railBSignature);
    await sendExpectRevert(S, "execute_from_outside_v2 REPLAY of L's already-consumed nonce", () =>
      relayer.execute(
        { contractAddress: user.address, entrypoint: "execute_from_outside_v2", calldata: replayCalldata },
        NO_TIP,
      ),
    );
  } else {
    info("U3", "Rail B unhappy paths SKIPPED (Rail B not exercised — see stage L)");
  }

  // ── Report ──

  printSummaryTable(rows);

  const buildNotes = collectBuildNotes();
  const finishedAt = new Date();
  const docsDir = resolve(import.meta.dirname, "../../docs");
  const { mdPath, jsonPath } = writeReport(
    docsDir,
    {
      network,
      chainId: chainIdHex,
      rpcUrl,
      addresses: { train: addresses.train, trainRouter: addresses.trainRouter, constantCurve: addresses.constantCurve, strk, eth },
      userAddress: user.address,
      solverAddress: solver.address,
      relayerAddress: relayer.address,
      deployerAddress: user.address,
      startedAt: runStarted,
      buildNotes,
    },
    rows,
    finishedAt,
  );
  console.log(`\nReport written: ${mdPath}\n            and: ${jsonPath}`);

  const anyFail = rows.some((r) => r.status === "FAIL");
  if (anyFail) process.exitCode = 1;
}

/** Reads PRIVATE_KEY straight from the environment for raw STARK-curve signing (Rail A/B), since
 * the account object itself doesn't expose its signer's raw key. */
function requireEnvPrivateKey(): string {
  const pk = optionalEnv("PRIVATE_KEY");
  if (!pk) throw new Error("Missing required env var: PRIVATE_KEY");
  return pk;
}

/** Unwraps a 2-tuple view return that starknet.js may hand back as either a plain array or an
 * object keyed by the (often auto-generated) tuple member names. */
function unwrapPair(result: unknown): [unknown, unknown] {
  if (Array.isArray(result)) return [result[0], result[1]];
  const obj = result as Record<string, unknown>;
  const keys = Object.keys(obj);
  return [obj[keys[0]], obj[keys[1]]];
}

main().catch((err) => {
  console.error("e2e failed:", err);
  process.exit(1);
});
