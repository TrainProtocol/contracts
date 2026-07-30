#!/usr/bin/env -S npx tsx
/**
 * Config-driven, re-runnable end-to-end test suite for the Train Protocol on Fuel (Sepolia by
 * default; a local `fuel-core` node via `FUEL_PROVIDER_URL`, exactly like `scripts/deploy.ts`).
 * Runs every flow this port supports -- happy path AND at least one expected-failure case per
 * flow -- against real deployed contracts, using real wallets and real transactions. Reports as a
 * row table (PASS/FAIL, clickable tx links, before/after balance checks).
 *
 * DISTINCT ACTORS: every actor role uses its OWN freshly generated address -- `user`, `sponsor`,
 * `solver`, `relayer`, `thirdParty` (each signs and pays its own gas), plus the receive-only
 * `recipient`, `refundTo`, `rewardRecipient`, `beneficiary` (never sign; pure attribution/payout
 * targets). No two roles ever share an address within a flow, so each payout/refund/reward lands
 * on a provably-separate wallet from the sender/caller.
 *
 * TWO ASSETS: the lock principal is Fuel Sepolia's base asset (ETH); the different-asset solver
 * reward flow uses `test_asset` -- a throwaway permissionless native-asset minter deployed once
 * per run (NOT part of the protocol) so there is a genuine second `AssetId` to escrow as a reward
 * and to prove `attach_solver_reward` pays the reward in a truly different asset than the
 * principal. Rail 1's sponsored lock also uses `test_asset` as the principal so the "sponsor pays
 * gas (base) only, user pays the principal only" split is clean and unambiguous.
 *
 * FUNDING: exactly ONE pre-funded wallet is required (`FUEL_E2E_PRIMARY_PRIVATE_KEY`). Every
 * signing role is a fresh wallet topped up from the primary at the start of the run (stage S3);
 * receive-only roles need no funds. `test_asset` is minted from the primary to `solver` (reward
 * funding) and `user` (Rail-1 principal). This never polls/retries a faucet -- see
 * `scripts/lib/funding.ts` for why Sepolia funding is a single manual step.
 *
 * Usage:
 *   cd chains/fuel && npx tsx scripts/testnet-e2e.ts
 */
import 'dotenv/config';

import {
  Contract,
  ContractFactory,
  sha256,
  type FunctionInvocationScope,
  type Provider,
  type WalletUnlocked,
} from 'fuels';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

import { testAssetArtifact, trainArtifact } from './deploy/artifacts';
import { deployAll } from './deploy/core';
import { connectProvider, networkKindFromUrl, redactProviderUrl, resolveProviderUrl } from './deploy/network';
import { deploySaltSeed } from './deploy/salt';
import { requireFunded, resolveWallet } from './lib/funding';
import {
  callRedeemSolver,
  callRedeemUser,
  callRefundSolver,
  callRefundUser,
  callSolverLock,
  callUserLock,
  callUserLockFor,
  connectAs,
  futureTai64,
  getSolverLock,
  getUserLock,
  getUserLockHashes,
  identityFromAccount,
  identityFromAddress,
  makeDestinationInfo,
  makeSolverLockParams,
  makeUserLockParams,
  randomHashlock,
  solverLockWithAttachedReward,
  buildSponsoredUserLock,
  submitSponsoredUserLock,
  type IdentityInput,
  type UserLockParamsInput,
} from './lib/testHarness';
import { printSummaryTable, writeReport, type NetworkKind, type Row } from './lib/report';

// ───────────────────────────── Sizing ─────────────────────────────
// Deliberately small (this is Sepolia ETH, not play money). Happy paths that pay back to the same
// wallet cost only gas; paths that pay a DISTINCT recipient move the principal out of the sender's
// wallet (by design here -- every role is distinct), so a signing role's balance genuinely drops
// by principal + gas over the run.

const LOCK_AMOUNT = 1_000;
const REWARD_AMOUNT = 100;
// Per generated signing-role wallet. Real per-call gas is low hundreds of units and per-flow
// principal is ~1_000, across a handful of flows per role -- 150_000 is >20x the real per-wallet
// need with margin. Receive-only roles get nothing (they never sign).
const TOPUP_AMOUNT = 150_000;
// Primary funds 5 signing-role top-ups (~750k) plus its own deploys/mints/gas -- fits within the
// ~2,000,008 currently on the funded primary wallet with real margin.
const MIN_PRIMARY_BALANCE = 1_200_000;
// Minted to `solver` (reward funding) and `user` (Rail-1 principal). Free/permissionless; large
// so no negative-path attach attempt can run the minted balance down.
const TEST_ASSET_MINT = 1_000_000;

const LONG_TIMELOCK = 3_600; // s
const SHORT_TIMELOCK = 15; // s -- refund-after-timelock flows really wait this out
const WAIT_MARGIN = 12; // s -- extra sleep past a short boundary before retrying the call
const SAFE_REWARD_TIMELOCK = 1_800; // s -- strictly < LONG_TIMELOCK (InvalidRewardTimelock guard)
const SHORT_REWARD_TIMELOCK = 15; // s -- redeem-after-reward-timelock waits this out
const QUOTE_EXPIRY_DELTA = 1_800; // s

const ZERO_IDENTITY = identityFromAddress(`0x${'0'.repeat(64)}`);

// ───────────────────────────── Row recording ─────────────────────────────

const rows: Row[] = [];
let rowCounter = 0;
const runStarted = new Date();

function record(row: Omit<Row, 'n'>): Row {
  const full: Row = { n: ++rowCounter, ...row };
  rows.push(full);
  const parts = [
    `[${full.n}] ${full.stage} | ${full.name} -> ${full.status}`,
    full.txId ? `tx=${full.txId}` : '',
    full.note ? `| ${full.note}` : '',
  ].filter(Boolean);
  console.log(parts.join(' '));
  return full;
}

function info(stage: string, name: string, note?: string): void {
  record({ stage, name, kind: 'info', status: 'INFO', note });
}

function check(stage: string, name: string, ok: boolean, note: string): void {
  record({ stage, name, kind: 'check', status: ok ? 'OK' : 'FAIL', note });
  if (!ok) throw new Error(`check failed: ${stage} ${name}: ${note}`);
}

// ───────────────────────────── Small helpers ─────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A fresh, unique-per-run 32-byte secret + its sha256 hashlock, matching `Train::redeem_*`'s
 * `sha256(secret) == hashlock` check (`secret` is passed on-chain as a `u256`). */
function freshSecretAndHashlock(label: string): { secret: string; hashlock: string } {
  const material = `${label}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  const secretBytes = crypto.createHash('sha256').update(material).digest();
  const secret = `0x${secretBytes.toString('hex')}`;
  const hashlock = sha256(secretBytes);
  return { secret, hashlock };
}

/** Sleeps past a real timelock boundary, then commits one throwaway self-transfer as a REAL
 * transaction -- required on a PoA-instant local node (its chain tip only advances on a committed
 * block) and harmless on Sepolia. Kept unconditional so behavior doesn't branch on network. */
async function advancePastBoundary(provider: Provider, nudger: WalletUnlocked, waitSeconds: number): Promise<void> {
  await sleep((waitSeconds + WAIT_MARGIN) * 1000);
  const baseAssetId = await provider.getBaseAssetId();
  const tx = await nudger.transfer(nudger.address, 1, baseAssetId);
  await tx.waitForResult();
}

/** Submits `invoke()`, awaiting the result, and records a `tx` row. Throws (aborting the run) on
 * an unexpected on-chain revert. */
async function tx<T>(
  stage: string,
  name: string,
  invoke: () => Promise<{ transactionId: string; value: T }>,
): Promise<{ transactionId: string; value: T }> {
  try {
    const result = await invoke();
    record({ stage, name, kind: 'tx', status: 'OK', txId: result.transactionId });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record({ stage, name, kind: 'tx', status: 'FAIL', note: message.slice(0, 300) });
    throw new Error(`${stage} ${name}: unexpected failure: ${message}`);
  }
}

/**
 * Submits a scope built via `buildScope()` and asserts it is rejected with `errorVariant` in the
 * decoded error message. Records a `tx`/`REVERTED` row (broadcast then reverted on-chain) or a
 * `sim-reject`/`OK` row (the SDK's own pre-flight dry run caught the revert before broadcasting),
 * depending purely on whether a transaction id was ever assigned. Mirrors `trainCore.test.ts`'s
 * `assertReverts`.
 */
async function expectRevert(
  stage: string,
  name: string,
  errorVariant: string,
  buildScope: () => FunctionInvocationScope,
): Promise<void> {
  const scope = buildScope();
  let transactionId: string | undefined;
  try {
    const called = await scope.call();
    transactionId = called.transactionId;
    await called.waitForResult();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes(errorVariant)) {
      record({
        stage,
        name,
        kind: transactionId ? 'tx' : 'sim-reject',
        status: transactionId ? 'REVERTED' : 'OK',
        txId: transactionId,
        note: transactionId
          ? `reverted on-chain as expected: ${errorVariant}`
          : `rejected in pre-flight simulation (never broadcast) as expected: ${errorVariant}`,
      });
      return;
    }
    record({ stage, name, kind: 'tx', status: 'FAIL', txId: transactionId, note: `unexpected revert reason: ${message.slice(0, 200)}` });
    throw new Error(`${stage} ${name}: expected revert containing "${errorVariant}", got: ${message}`);
  }
  record({ stage, name, kind: 'tx', status: 'FAIL', txId: transactionId, note: `expected revert "${errorVariant}" but the call succeeded` });
  throw new Error(`${stage} ${name}: expected a revert but the call succeeded`);
}

/**
 * Runs an arbitrary thunk expected to be rejected with a message matching `pattern`. Unlike
 * `expectRevert` this does not build a contract scope itself, so it covers cases that are not a
 * single named-`TrainError` revert: a node-side transaction-validation rejection (the Rail-1
 * tamper case) or a raw VM revert with no decodable Sway error (calling a payout curve address
 * that does not implement the `PayoutCurve` selector).
 */
async function expectReject(
  stage: string,
  name: string,
  pattern: RegExp,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (pattern.test(message)) {
      record({ stage, name, kind: 'sim-reject', status: 'OK', note: `rejected as expected (matched ${pattern})` });
      return;
    }
    record({ stage, name, kind: 'tx', status: 'FAIL', note: `unexpected rejection: ${message.slice(0, 200)}` });
    throw new Error(`${stage} ${name}: expected rejection matching ${pattern}, got: ${message}`);
  }
  record({ stage, name, kind: 'tx', status: 'FAIL', note: 'expected a rejection but the call succeeded' });
  throw new Error(`${stage} ${name}: expected a rejection but the call succeeded`);
}

// ───────────────────────────── Roles ─────────────────────────────

interface Roles {
  primary: WalletUnlocked; // funds everyone; also the deployer
  // Signing roles (topped up with base asset for gas):
  user: WalletUnlocked;
  sponsor: WalletUnlocked;
  solver: WalletUnlocked;
  relayer: WalletUnlocked;
  thirdParty: WalletUnlocked;
  // Receive-only roles (never sign, never funded -- pure payout/attribution targets):
  recipient: WalletUnlocked;
  refundTo: WalletUnlocked;
  rewardRecipient: WalletUnlocked;
  beneficiary: WalletUnlocked;
}

async function resolveRoles(provider: Provider): Promise<Roles> {
  return {
    primary: resolveWallet('FUEL_E2E_PRIMARY_PRIVATE_KEY', 'primary (funder + deployer)', provider),
    user: resolveWallet('FUEL_E2E_USER_PRIVATE_KEY', 'user', provider),
    sponsor: resolveWallet('FUEL_E2E_SPONSOR_PRIVATE_KEY', 'sponsor', provider),
    solver: resolveWallet('FUEL_E2E_SOLVER_PRIVATE_KEY', 'solver', provider),
    relayer: resolveWallet('FUEL_E2E_RELAYER_PRIVATE_KEY', 'relayer', provider),
    thirdParty: resolveWallet('FUEL_E2E_THIRD_PARTY_PRIVATE_KEY', 'thirdParty', provider),
    recipient: resolveWallet('FUEL_E2E_RECIPIENT_PRIVATE_KEY', 'recipient', provider),
    refundTo: resolveWallet('FUEL_E2E_REFUND_TO_PRIVATE_KEY', 'refundTo', provider),
    rewardRecipient: resolveWallet('FUEL_E2E_REWARD_RECIPIENT_PRIVATE_KEY', 'rewardRecipient', provider),
    beneficiary: resolveWallet('FUEL_E2E_BENEFICIARY_PRIVATE_KEY', 'beneficiary', provider),
  };
}

/** Asserts every role's address is distinct from every other -- the whole point of this run. */
function assertDistinctRoles(roles: Roles): void {
  const entries = Object.entries(roles) as Array<[string, WalletUnlocked]>;
  const seen = new Map<string, string>();
  for (const [name, wallet] of entries) {
    const addr = wallet.address.toB256().toLowerCase();
    const prior = seen.get(addr);
    check('S1', `role "${name}" address is distinct`, prior === undefined, prior ? `collides with "${prior}"` : addr);
    seen.set(addr, name);
  }
}

/** Tops up every SIGNING role from `primary`. Receive-only roles are excluded (never sign, so
 * need no gas). Skips a role whose wallet came from an already-set env var (assumed pre-funded). */
async function topUpRoles(provider: Provider, roles: Roles): Promise<void> {
  const baseAssetId = await provider.getBaseAssetId();
  const toFund: Array<[string, WalletUnlocked, string]> = [
    ['FUEL_E2E_USER_PRIVATE_KEY', roles.user, 'user'],
    ['FUEL_E2E_SPONSOR_PRIVATE_KEY', roles.sponsor, 'sponsor'],
    ['FUEL_E2E_SOLVER_PRIVATE_KEY', roles.solver, 'solver'],
    ['FUEL_E2E_RELAYER_PRIVATE_KEY', roles.relayer, 'relayer'],
    ['FUEL_E2E_THIRD_PARTY_PRIVATE_KEY', roles.thirdParty, 'thirdParty'],
  ];
  for (const [envVar, wallet, label] of toFund) {
    if (process.env[envVar]) {
      info('S3', `topup ${label}`, `skipped -- ${envVar} set (assumed pre-funded)`);
      continue;
    }
    const before = await provider.getBalance(wallet.address, baseAssetId);
    if (before.gte(TOPUP_AMOUNT)) {
      info('S3', `topup ${label}`, `skipped -- already has ${before.toString()}`);
      continue;
    }
    await tx('S3', `topup ${label}`, async () => {
      const transfer = await roles.primary.transfer(wallet.address, TOPUP_AMOUNT, baseAssetId);
      const result = await transfer.waitForResult();
      return { transactionId: result.id, value: true };
    });
  }
}

// ───────────────────────────── test_asset fixture ─────────────────────────────

interface TestAssetDeployment {
  contract: Contract;
  contractId: string;
  assetId: string;
}

/** Deploys the throwaway `test_asset` minter with a RANDOM salt (a fresh, one-off deploy each run
 * -- it needs no stable cross-network address, unlike the protocol contracts). Returns the
 * contract, its id, and the single `AssetId` it mints. */
async function deployTestAsset(deployer: WalletUnlocked): Promise<TestAssetDeployment> {
  const { abi, bytecode } = testAssetArtifact();
  const factory = new ContractFactory(bytecode, abi as never, deployer);
  const salt = `0x${crypto.randomBytes(32).toString('hex')}`;
  const { contractId, waitForResult } = await factory.deploy({ salt } as never);
  const { contract } = await waitForResult();
  const assetId = (await contract.functions.asset_id().get()).value.bits as string;
  return { contract, contractId, assetId };
}

/** Mints `amount` of the test asset to `recipient`, paid for (gas) by `caller`. */
async function mintTestAsset(
  testAsset: Contract,
  caller: WalletUnlocked,
  recipient: IdentityInput,
  amount: number,
): Promise<string> {
  const { transactionId, waitForResult } = await connectAs(testAsset, caller)
    .functions.mint(recipient, amount)
    .call();
  await waitForResult();
  return transactionId;
}

// ───────────────────────────── Main ─────────────────────────────

export async function main(): Promise<void> {
  const providerUrl = resolveProviderUrl();
  const provider = await connectProvider(providerUrl);
  const network: NetworkKind = networkKindFromUrl(providerUrl);
  const baseAssetId = await provider.getBaseAssetId();

  info('S0', `network ${redactProviderUrl(providerUrl)} (${network})`);

  const roles = await resolveRoles(provider);
  info(
    'S1',
    'accounts',
    Object.entries(roles)
      .map(([name, w]) => `${name}=${w.address.toB256()}`)
      .join(' '),
  );
  assertDistinctRoles(roles);

  await requireFunded({
    provider,
    wallet: roles.primary,
    assetId: baseAssetId,
    minAmount: MIN_PRIMARY_BALANCE,
    role: 'primary',
    envVar: 'FUEL_E2E_PRIMARY_PRIVATE_KEY',
  });

  const primaryStart = await provider.getBalance(roles.primary.address, baseAssetId);
  info('S1', 'primary starting balance', `${primaryStart.toString()} base units`);

  await topUpRoles(provider, roles);

  // ── S2: deploy/resolve protocol contracts ──
  const envTrain = process.env.FUEL_TRAIN_CONTRACT_ID;
  const envCurve = process.env.FUEL_PAYOUT_CURVE_CONTRACT_ID;
  let trainId: string;
  let payoutCurveId: string;
  if (envTrain && envCurve) {
    trainId = envTrain;
    payoutCurveId = envCurve;
    info('S2', 'contracts (from env)', `train=${trainId} payoutCurve=${payoutCurveId}`);
  } else {
    const deployed = await deployAll(roles.primary, provider, deploySaltSeed());
    trainId = deployed.train.contractId;
    payoutCurveId = deployed.payoutCurve.contractId;
    info(
      'S2',
      'contracts (deployed/reused)',
      `train=${trainId} (${deployed.train.deployed ? 'fresh' : 'reused'}) payoutCurve=${payoutCurveId} (${deployed.payoutCurve.deployed ? 'fresh' : 'reused'})`,
    );
  }

  const trainAbi = trainArtifact().abi;
  const train = new Contract(trainId, trainAbi as never, roles.primary);

  // ── S2b: deploy the throwaway test_asset fixture + mint to solver (reward) and user (Rail-1) ──
  const testAsset = await deployTestAsset(roles.primary);
  info('S2', 'test_asset deployed (throwaway fixture)', `contract=${testAsset.contractId} assetId=${testAsset.assetId}`);
  await tx('S2', 'mint test_asset -> solver', async () => ({
    transactionId: await mintTestAsset(testAsset.contract, roles.primary, identityFromAccount(roles.solver), TEST_ASSET_MINT),
    value: true,
  }));
  await tx('S2', 'mint test_asset -> user', async () => ({
    transactionId: await mintTestAsset(testAsset.contract, roles.primary, identityFromAccount(roles.user), TEST_ASSET_MINT),
    value: true,
  }));

  const buildNotes = [
    `Sway build (\`forc build\`): artifacts loaded from each package's \`out/debug\`.`,
    `Deployment: ${envTrain ? 'reused pre-existing contracts from env' : "via scripts/deploy.ts's deployAll (deterministic salt)"}.`,
    `Principal asset: Sepolia base asset (ETH). Different-asset solver reward + Rail-1 principal: test_asset (a throwaway per-run native-asset minter fixture, NOT a protocol contract).`,
    `Every actor role uses a distinct freshly-generated address (asserted in stage S1).`,
  ];

  // ── Flow A: user_lock (base) -> redeem_user; recipient distinct from sender ──
  {
    const { secret, hashlock } = freshSecretAndHashlock('A');
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
    });
    const locked = await tx('A', `user_lock (hashlock ${hashlock.slice(0, 10)}…)`, () =>
      callUserLock({ train, caller: roles.user, assetId: baseAssetId, amount: LOCK_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    check('A', 'lock created with correct hashlock', locked.value === hashlock, `got ${locked.value}`);

    const before = await roles.recipient.getBalance(baseAssetId);
    await tx('A', 'redeem_user (by user; pays distinct recipient)', () => callRedeemUser(train, roles.user, hashlock, secret));
    const after = await roles.recipient.getBalance(baseAssetId);
    check('A', 'recipient (distinct from sender) received amount', after.sub(before).eq(LOCK_AMOUNT), `delta=${after.sub(before).toString()}`);
    const status = ((await getUserLock(train, hashlock)) as { status: string }).status;
    check('A', 'lock status REDEEMED', status === 'Redeemed', `status=${status}`);
  }

  // ── Flow B: user_lock with ConstantPayoutCurve -> redeem_user (payout == amount, zero excess) ──
  {
    const { secret, hashlock } = freshSecretAndHashlock('B');
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
      payoutCurve: { bits: payoutCurveId },
      payoutCurveData: new Uint8Array(),
    });
    await tx('B', `user_lock with payout_curve (hashlock ${hashlock.slice(0, 10)}…)`, () =>
      callUserLock({ train, caller: roles.user, assetId: baseAssetId, amount: LOCK_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    const stored = ((await getUserLock(train, hashlock)) as { payout_curve?: { bits: string } }).payout_curve;
    check('B', 'payout_curve stored', !!stored && stored.bits.toLowerCase() === payoutCurveId.toLowerCase(), `stored=${stored?.bits}`);

    const before = await roles.recipient.getBalance(baseAssetId);
    await tx('B', 'redeem_user (via ConstantPayoutCurve)', () => callRedeemUser(train, roles.user, hashlock, secret));
    const after = await roles.recipient.getBalance(baseAssetId);
    check('B', 'identity curve pays full amount (payout == amount, zero excess)', after.sub(before).eq(LOCK_AMOUNT), `delta=${after.sub(before).toString()}`);
  }

  // ── Flow C: user_lock (long timelock) -> refund_user by recipient BEFORE timelock ──
  {
    const { hashlock } = freshSecretAndHashlock('C');
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      timelockDelta: LONG_TIMELOCK,
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
    });
    await tx('C', `user_lock (hashlock ${hashlock.slice(0, 10)}…, long timelock)`, () =>
      callUserLock({ train, caller: roles.user, assetId: baseAssetId, amount: LOCK_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    const before = await roles.refundTo.getBalance(baseAssetId);
    await tx('C', 'refund_user by recipient (before timelock)', () => callRefundUser(train, roles.recipient, hashlock));
    const after = await roles.refundTo.getBalance(baseAssetId);
    check('C', 'refund lands on refund_to (distinct from recipient caller)', after.sub(before).eq(LOCK_AMOUNT), `delta=${after.sub(before).toString()}`);
    const status = ((await getUserLock(train, hashlock)) as { status: string }).status;
    check('C', 'lock status REFUNDED', status === 'Refunded', `status=${status}`);
  }

  // ── Flow D: user_lock (short timelock) -> wait -> refund_user by a THIRD PARTY after timelock ──
  {
    const { hashlock } = freshSecretAndHashlock('D');
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      timelockDelta: SHORT_TIMELOCK,
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
    });
    await tx('D', `user_lock (hashlock ${hashlock.slice(0, 10)}…, short timelock)`, () =>
      callUserLock({ train, caller: roles.user, assetId: baseAssetId, amount: LOCK_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    const refundBefore = await roles.refundTo.getBalance(baseAssetId);
    const thirdBefore = await roles.thirdParty.getBalance(baseAssetId);
    await advancePastBoundary(provider, roles.thirdParty, SHORT_TIMELOCK);
    await tx('D', 'refund_user by third party (after timelock)', () => callRefundUser(train, roles.thirdParty, hashlock));
    const refundAfter = await roles.refundTo.getBalance(baseAssetId);
    const thirdAfter = await roles.thirdParty.getBalance(baseAssetId);
    check('D', 'refund lands on refund_to, never the third-party caller', refundAfter.sub(refundBefore).eq(LOCK_AMOUNT), `refund_to delta=${refundAfter.sub(refundBefore).toString()}`);
    info('D', 'third-party caller balance (paid own gas, received nothing)', `before=${thirdBefore.toString()} after=${thirdAfter.toString()}`);
  }

  // ── Flow E: user_lock_for(beneficiary), funded by user -> redeem_user pays recipient ──
  {
    const { secret, hashlock } = freshSecretAndHashlock('E');
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
    });
    await tx('E', `user_lock_for(beneficiary) funded by user (hashlock ${hashlock.slice(0, 10)}…)`, () =>
      callUserLockFor({ train, caller: roles.user, user: identityFromAccount(roles.beneficiary), assetId: baseAssetId, amount: LOCK_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    const lock = (await getUserLock(train, hashlock)) as { sender: { Address: { bits: string } } };
    check('E', 'lock attributed to beneficiary, not the funding caller', lock.sender.Address.bits.toLowerCase() === roles.beneficiary.address.toB256().toLowerCase(), `sender=${lock.sender.Address.bits}`);

    const before = await roles.recipient.getBalance(baseAssetId);
    await tx('E', 'redeem_user (pays recipient)', () => callRedeemUser(train, roles.user, hashlock, secret));
    const after = await roles.recipient.getBalance(baseAssetId);
    check('E', 'recipient received amount', after.sub(before).eq(LOCK_AMOUNT), `delta=${after.sub(before).toString()}`);
  }

  // ── Flow F: solver_lock (same-asset reward) -> redeem_solver BEFORE reward_timelock (reward -> reward_recipient) ──
  {
    const { secret, hashlock } = freshSecretAndHashlock('F');
    const params = makeSolverLockParams({
      recipient: identityFromAccount(roles.recipient),
      assetId: baseAssetId,
      hashlock,
      reward: REWARD_AMOUNT,
      timelockDelta: LONG_TIMELOCK,
      rewardTimelockDelta: SAFE_REWARD_TIMELOCK,
      rewardRecipient: identityFromAccount(roles.rewardRecipient),
      refundTo: identityFromAccount(roles.refundTo),
    });
    await tx('F', `solver_lock (hashlock ${hashlock.slice(0, 10)}…, same-asset reward)`, () =>
      callSolverLock({ train, caller: roles.solver, assetId: baseAssetId, amount: LOCK_AMOUNT + REWARD_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    const fLock = await getSolverLock(train, hashlock, identityFromAccount(roles.solver));
    check('F', 'lock readable under (hashlock, solver identity) -- the idempotency probe', fLock !== null, fLock ? 'present' : 'absent');

    const recipientBefore = await roles.recipient.getBalance(baseAssetId);
    const rewardBefore = await roles.rewardRecipient.getBalance(baseAssetId);
    await tx('F', 'redeem_solver (before reward_timelock, by relayer)', () => callRedeemSolver(train, roles.relayer, hashlock, identityFromAccount(roles.solver), secret));
    const recipientAfter = await roles.recipient.getBalance(baseAssetId);
    const rewardAfter = await roles.rewardRecipient.getBalance(baseAssetId);
    check('F', 'principal -> recipient', recipientAfter.sub(recipientBefore).eq(LOCK_AMOUNT), `delta=${recipientAfter.sub(recipientBefore).toString()}`);
    check('F', 'reward -> reward_recipient (before reward_timelock)', rewardAfter.sub(rewardBefore).eq(REWARD_AMOUNT), `delta=${rewardAfter.sub(rewardBefore).toString()}`);
  }

  // ── Flow G: solver_lock (short reward_timelock) -> wait -> redeem_solver AFTER reward_timelock (reward -> redeemer bounty) ──
  {
    const { secret, hashlock } = freshSecretAndHashlock('G');
    const params = makeSolverLockParams({
      recipient: identityFromAccount(roles.recipient),
      assetId: baseAssetId,
      hashlock,
      reward: REWARD_AMOUNT,
      timelockDelta: LONG_TIMELOCK,
      rewardTimelockDelta: SHORT_REWARD_TIMELOCK,
      rewardRecipient: identityFromAccount(roles.rewardRecipient),
      refundTo: identityFromAccount(roles.refundTo),
    });
    await tx('G', `solver_lock (hashlock ${hashlock.slice(0, 10)}…, short reward_timelock)`, () =>
      callSolverLock({ train, caller: roles.solver, assetId: baseAssetId, amount: LOCK_AMOUNT + REWARD_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    const relayerBefore = await roles.relayer.getBalance(baseAssetId);
    const recipientBefore = await roles.recipient.getBalance(baseAssetId);
    const rewardRcptBefore = await roles.rewardRecipient.getBalance(baseAssetId);
    await advancePastBoundary(provider, roles.relayer, SHORT_REWARD_TIMELOCK);
    await tx('G', 'redeem_solver (after reward_timelock, by relayer -> keeper bounty)', () => callRedeemSolver(train, roles.relayer, hashlock, identityFromAccount(roles.solver), secret));
    const relayerAfter = await roles.relayer.getBalance(baseAssetId);
    const recipientAfter = await roles.recipient.getBalance(baseAssetId);
    const rewardRcptAfter = await roles.rewardRecipient.getBalance(baseAssetId);
    check('G', 'principal -> recipient', recipientAfter.sub(recipientBefore).eq(LOCK_AMOUNT), `delta=${recipientAfter.sub(recipientBefore).toString()}`);
    check('G', 'reward_recipient got NOTHING after reward_timelock', rewardRcptAfter.sub(rewardRcptBefore).eq(0), `delta=${rewardRcptAfter.sub(rewardRcptBefore).toString()}`);
    info('G', 'reward -> redeemer(relayer) bounty', `relayer before=${relayerBefore.toString()} after=${relayerAfter.toString()} (net includes gas for redeem + nudge tx; reward credited)`);
  }

  // ── Flow H: solver_lock (short timelock, has reward) -> wait -> refund_solver (amount+reward back to refund_to) ──
  {
    const { hashlock } = freshSecretAndHashlock('H');
    const params = makeSolverLockParams({
      recipient: identityFromAccount(roles.recipient),
      assetId: baseAssetId,
      hashlock,
      reward: REWARD_AMOUNT,
      timelockDelta: SHORT_TIMELOCK,
      rewardTimelockDelta: 1,
      rewardRecipient: identityFromAccount(roles.rewardRecipient),
      refundTo: identityFromAccount(roles.refundTo),
    });
    await tx('H', `solver_lock (hashlock ${hashlock.slice(0, 10)}…, short timelock)`, () =>
      callSolverLock({ train, caller: roles.solver, assetId: baseAssetId, amount: LOCK_AMOUNT + REWARD_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    const before = await roles.refundTo.getBalance(baseAssetId);
    await advancePastBoundary(provider, roles.thirdParty, SHORT_TIMELOCK);
    await tx('H', 'refund_solver (after timelock, by third party)', () => callRefundSolver(train, roles.thirdParty, hashlock, identityFromAccount(roles.solver)));
    const after = await roles.refundTo.getBalance(baseAssetId);
    check('H', 'amount+reward (same asset) returned to refund_to', after.sub(before).eq(LOCK_AMOUNT + REWARD_AMOUNT), `delta=${after.sub(before).toString()}`);

    // The per-solver uniqueness guard is PERMANENT: even after the refund just above, the same
    // solver can never re-lock this (hashlock, solver) slot -- a re-fill needs a new identity.
    await expectRevert('H', 're-lock by the same solver after refund (guard never lifts)', 'SolverLockAlreadyExists', () =>
      connectAs(train, roles.solver)
        .functions.solver_lock(
          makeSolverLockParams({
            recipient: identityFromAccount(roles.recipient),
            assetId: baseAssetId,
            hashlock,
            timelockDelta: LONG_TIMELOCK,
            refundTo: identityFromAccount(roles.refundTo),
          }),
          makeDestinationInfo(),
          new Uint8Array(),
        )
        .callParams({ forward: [LOCK_AMOUNT, baseAssetId] }),
    );
  }

  // ── Flow N: solver_lock DIFFERENT-asset reward (principal in base, reward in test_asset) ──
  //    solver_lock(base) + attach_solver_reward(test_asset) bundled atomically, then redeem before
  //    reward_timelock -> principal in base to recipient, reward in test_asset to reward_recipient.
  {
    const { secret, hashlock } = freshSecretAndHashlock('N');
    const params = makeSolverLockParams({
      recipient: identityFromAccount(roles.recipient),
      assetId: baseAssetId,
      hashlock,
      reward: REWARD_AMOUNT,
      rewardAssetId: testAsset.assetId,
      rewardRecipient: identityFromAccount(roles.rewardRecipient),
      timelockDelta: LONG_TIMELOCK,
      rewardTimelockDelta: SAFE_REWARD_TIMELOCK,
      refundTo: identityFromAccount(roles.refundTo),
    });
    const res = await tx('N', `solver_lock(base) + attach_solver_reward(test_asset) atomic multicall (hashlock ${hashlock.slice(0, 10)}…)`, async () => {
      const r = await solverLockWithAttachedReward({
        train,
        caller: roles.solver,
        assetId: baseAssetId,
        amount: LOCK_AMOUNT,
        rewardAssetId: testAsset.assetId,
        reward: REWARD_AMOUNT,
        params,
        dst: makeDestinationInfo(),
      });
      return { transactionId: r.transactionId, value: r.value };
    });
    check('N', 'multicall attach_solver_reward returns true', res.value[1] === true, `got ${JSON.stringify(res.value)}`);
    const lock = (await getSolverLock(train, hashlock, identityFromAccount(roles.solver))) as { reward_funded: boolean; reward_asset_id: { bits: string } };
    check('N', 'reward_funded true and reward_asset_id is the test asset', lock.reward_funded === true && lock.reward_asset_id.bits.toLowerCase() === testAsset.assetId.toLowerCase(), `funded=${lock.reward_funded} asset=${lock.reward_asset_id.bits}`);

    const recipientBase0 = await provider.getBalance(roles.recipient.address, baseAssetId);
    const rewardRcptTA0 = await provider.getBalance(roles.rewardRecipient.address, testAsset.assetId);
    await tx('N', 'redeem_solver (before reward_timelock, by relayer)', () => callRedeemSolver(train, roles.relayer, hashlock, identityFromAccount(roles.solver), secret));
    const recipientBase1 = await provider.getBalance(roles.recipient.address, baseAssetId);
    const rewardRcptTA1 = await provider.getBalance(roles.rewardRecipient.address, testAsset.assetId);
    check('N', 'principal paid in BASE asset to recipient', recipientBase1.sub(recipientBase0).eq(LOCK_AMOUNT), `base delta=${recipientBase1.sub(recipientBase0).toString()}`);
    check('N', 'reward paid in TEST_ASSET to reward_recipient', rewardRcptTA1.sub(rewardRcptTA0).eq(REWARD_AMOUNT), `test_asset delta=${rewardRcptTA1.sub(rewardRcptTA0).toString()}`);
  }

  // ── Flow J: Gasless Rail 1 -- sponsored user_lock_for; principal in test_asset, gas in base ──
  //    Clean split: user's test_asset drops by the principal only (no gas); sponsor's base drops
  //    by gas only; user's base is untouched.
  {
    const { secret, hashlock } = freshSecretAndHashlock('J');
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
    });
    const userTaBefore = await provider.getBalance(roles.user.address, testAsset.assetId);
    const userBaseBefore = await provider.getBalance(roles.user.address, baseAssetId);
    const sponsorBaseBefore = await provider.getBalance(roles.sponsor.address, baseAssetId);

    const built = await buildSponsoredUserLock({
      provider,
      trainContract: train,
      fundingUser: roles.user,
      sponsor: roles.sponsor,
      call: { kind: 'user_lock_for', user: identityFromAccount(roles.user) },
      assetId: testAsset.assetId,
      amount: LOCK_AMOUNT,
      params,
      dst: makeDestinationInfo(),
    });
    const submitted = await tx('J', 'sponsored user_lock_for (user funds+signs test_asset, sponsor pays base gas)', async () => {
      const result = await submitSponsoredUserLock(built, roles.sponsor);
      return { transactionId: result.transactionId, value: result };
    });
    check('J', 'lock created under the user-signed hashlock', submitted.value.hashlock === hashlock, `got ${submitted.value.hashlock}`);

    const userTaAfter = await provider.getBalance(roles.user.address, testAsset.assetId);
    const userBaseAfter = await provider.getBalance(roles.user.address, baseAssetId);
    const sponsorBaseAfter = await provider.getBalance(roles.sponsor.address, baseAssetId);
    check('J', 'user paid the principal in test_asset (exactly LOCK_AMOUNT)', userTaBefore.sub(userTaAfter).eq(LOCK_AMOUNT), `user test_asset spent=${userTaBefore.sub(userTaAfter).toString()}`);
    check('J', 'user paid NO base gas (untouched)', userBaseAfter.eq(userBaseBefore), `user base before=${userBaseBefore.toString()} after=${userBaseAfter.toString()}`);
    check('J', 'sponsor paid base gas only (>0, and no principal)', sponsorBaseBefore.sub(sponsorBaseAfter).gt(0), `sponsor base spent=${sponsorBaseBefore.sub(sponsorBaseAfter).toString()} (gas)`);

    const recipientBefore = await provider.getBalance(roles.recipient.address, testAsset.assetId);
    await tx('J', 'redeem_user (pays recipient in test_asset)', () => callRedeemUser(train, roles.user, hashlock, secret));
    const recipientAfter = await provider.getBalance(roles.recipient.address, testAsset.assetId);
    check('J', 'recipient received the principal in test_asset', recipientAfter.sub(recipientBefore).eq(LOCK_AMOUNT), `delta=${recipientAfter.sub(recipientBefore).toString()}`);
  }

  // ── Flow J2: Rail 1 trust property -- a tampered (post-user-signature) transaction is rejected ──
  {
    const { hashlock } = freshSecretAndHashlock('J2');
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
    });
    const built = await buildSponsoredUserLock({
      provider,
      trainContract: train,
      fundingUser: roles.user,
      sponsor: roles.sponsor,
      call: { kind: 'user_lock_for', user: identityFromAccount(roles.user) },
      assetId: testAsset.assetId,
      amount: LOCK_AMOUNT,
      params,
      dst: makeDestinationInfo(),
    });
    // The user has signed; a malicious sponsor redirects the change output to itself before
    // submitting. The user's witness covers the whole tx body, so this must fail node-side.
    const changeOutputIndex = built.request.outputs.findIndex((o: { type: number; to?: unknown }) => 'to' in o && o.to);
    check('J2', 'found a change/coin output to tamper with', changeOutputIndex >= 0, `index=${changeOutputIndex}`);
    const original = built.request.outputs[changeOutputIndex];
    built.request.outputs[changeOutputIndex] = { ...original, to: roles.sponsor.address.toB256() } as typeof original;

    await expectReject(
      'J2',
      'tampered sponsored tx rejected (output redirected after user signed)',
      /InvalidTransactionOutcome|InvalidSignature|invalid-request|VM_HALTED|PredicateVerificationFailed|reason|Validity/i,
      () => submitSponsoredUserLock(built, roles.sponsor),
    );
    const stale = await getUserLock(train, hashlock);
    check('J2', 'no lock was created under the tampered hashlock', stale === null, `lock=${stale ? 'present' : 'absent'}`);
  }

  // ── V: Views / pagination probe ──
  {
    const [hashlocks, total] = await getUserLockHashes(train, identityFromAccount(roles.user), 0, 1000);
    info('V', `get_user_lock_hashes(user, 0, 1000) total=${total}`, `${hashlocks.length} hashlocks returned`);
    const [pageAtHugeOffset, totalAgain] = await getUserLockHashes(train, identityFromAccount(roles.user), 1_000_000, 50);
    check(
      'V',
      'pagination never reverts at an out-of-range offset',
      pageAtHugeOffset.length === 0 && Number(totalAgain) === Number(total),
      `got ${pageAtHugeOffset.length} entries, total=${totalAgain}`,
    );
  }

  // ── U1: core validation failure cases (real on-chain reverts / pre-flight sim rejects) ──
  {
    // A real far-future TAI64 quote_expiry -- NOT a large-looking plain integer (timestamp()
    // returns TAI64, ~4.611e18 offset), reused synchronously by blankUserLockParamsSync below.
    const farFutureQuoteExpiry = await futureTai64(365 * 24 * 3600);
    const blank = () => blankUserLockParamsSync(roles.recipient, roles.refundTo, farFutureQuoteExpiry);

    await expectRevert('U1', 'user_lock amount=0', 'ZeroAmount', () => {
      const p = { ...blank(), hashlock: randomHashlock() };
      return connectAs(train, roles.user)
        .functions.user_lock(p, makeDestinationInfo(), new Uint8Array(), new Uint8Array())
        .callParams({ forward: [0, baseAssetId] });
    });

    await expectRevert('U1', 'user_lock timelock_delta=0', 'InvalidTimelock', () => {
      const p = { ...blank(), hashlock: randomHashlock(), timelock_delta: 0 };
      return connectAs(train, roles.user)
        .functions.user_lock(p, makeDestinationInfo(), new Uint8Array(), new Uint8Array())
        .callParams({ forward: [1, baseAssetId] });
    });

    await expectRevert('U1', 'user_lock expired quote', 'QuoteExpired', () => {
      const p = { ...blank(), hashlock: randomHashlock(), quote_expiry: '0' };
      return connectAs(train, roles.user)
        .functions.user_lock(p, makeDestinationInfo(), new Uint8Array(), new Uint8Array())
        .callParams({ forward: [1, baseAssetId] });
    });

    await expectRevert('U1', 'user_lock zero recipient', 'ZeroAddress', () => {
      const p = { ...blank(), hashlock: randomHashlock(), recipient: ZERO_IDENTITY };
      return connectAs(train, roles.user)
        .functions.user_lock(p, makeDestinationInfo(), new Uint8Array(), new Uint8Array())
        .callParams({ forward: [1, baseAssetId] });
    });

    await expectRevert('U1', 'user_lock_for zero user', 'InvalidUser', () => {
      const p = { ...blank(), hashlock: randomHashlock() };
      return connectAs(train, roles.user)
        .functions.user_lock_for(ZERO_IDENTITY, p, makeDestinationInfo(), new Uint8Array(), new Uint8Array())
        .callParams({ forward: [1, baseAssetId] });
    });

    // SwapAlreadyExists: create a real lock, then re-lock the same hashlock.
    {
      const { hashlock } = freshSecretAndHashlock('U1-dup');
      const p = await makeUserLockParams({
        hashlock,
        recipient: identityFromAccount(roles.recipient),
        refundTo: identityFromAccount(roles.refundTo),
        timelockDelta: LONG_TIMELOCK,
        quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
      });
      await tx('U1', 'U1-dup fixture user_lock', () =>
        callUserLock({ train, caller: roles.user, assetId: baseAssetId, amount: LOCK_AMOUNT, params: p, dst: makeDestinationInfo() }),
      );
      await expectRevert('U1', 'user_lock same hashlock again', 'SwapAlreadyExists', () =>
        connectAs(train, roles.user)
          .functions.user_lock(p, makeDestinationInfo(), new Uint8Array(), new Uint8Array())
          .callParams({ forward: [LOCK_AMOUNT, baseAssetId] }),
      );
    }

    await expectRevert('U1', 'solver_lock reward_timelock_delta >= timelock_delta', 'InvalidRewardTimelock', () => {
      const p = makeSolverLockParams({
        recipient: identityFromAccount(roles.recipient),
        assetId: baseAssetId,
        hashlock: randomHashlock(),
        reward: 1,
        timelockDelta: 100,
        rewardTimelockDelta: 100,
        rewardRecipient: identityFromAccount(roles.rewardRecipient),
      });
      return connectAs(train, roles.solver)
        .functions.solver_lock(p, makeDestinationInfo(), new Uint8Array())
        .callParams({ forward: [2, baseAssetId] });
    });

    // refund_solver has no early-recipient path: nobody can refund before timelock, not even the
    // recipient (unlike refund_user).
    {
      const { hashlock } = freshSecretAndHashlock('U1-solverrefund');
      await tx('U1', 'U1 solver_lock (long timelock) for early-refund probe', () =>
        callSolverLock({
          train,
          caller: roles.solver,
          assetId: baseAssetId,
          amount: LOCK_AMOUNT,
          params: makeSolverLockParams({
            recipient: identityFromAccount(roles.recipient),
            assetId: baseAssetId,
            hashlock,
            timelockDelta: LONG_TIMELOCK,
            refundTo: identityFromAccount(roles.refundTo),
          }),
          dst: makeDestinationInfo(),
        }),
      );
      await expectRevert('U1', 'refund_solver before timelock (even by recipient) rejected', 'RefundNotAllowed', () =>
        connectAs(train, roles.recipient).functions.refund_solver(hashlock, identityFromAccount(roles.solver)),
      );

      // The same (hashlock, solver) fixture doubles as the duplicate-lock probe: a blind
      // retry of solver_lock by the same solver must be rejected before any funds move.
      await expectRevert('U1', 'solver_lock duplicate by the same solver rejected', 'SolverLockAlreadyExists', () =>
        connectAs(train, roles.solver)
          .functions.solver_lock(
            makeSolverLockParams({
              recipient: identityFromAccount(roles.recipient),
              assetId: baseAssetId,
              hashlock,
              timelockDelta: LONG_TIMELOCK,
              refundTo: identityFromAccount(roles.refundTo),
            }),
            makeDestinationInfo(),
            new Uint8Array(),
          )
          .callParams({ forward: [LOCK_AMOUNT, baseAssetId] }),
      );
    }

    await expectRevert('U1', 'redeem_user unknown hashlock', 'LockNotFound', () =>
      connectAs(train, roles.user).functions.redeem_user(randomHashlock(), '0'),
    );

    // Live fixture: a real Pending lock, probed with a wrong secret + an early non-recipient
    // refund, then cleaned up via a legit early refund by the recipient, then re-probed to prove
    // an already-Refunded lock can never be redeemed either.
    const { secret: fixtureSecret, hashlock: fixtureHashlock } = freshSecretAndHashlock('U1-live');
    const fixtureParams = await makeUserLockParams({
      hashlock: fixtureHashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      timelockDelta: LONG_TIMELOCK,
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
    });
    await tx('U1', 'U1-live fixture user_lock', () =>
      callUserLock({ train, caller: roles.user, assetId: baseAssetId, amount: LOCK_AMOUNT, params: fixtureParams, dst: makeDestinationInfo() }),
    );
    await expectRevert('U1', 'redeem_user wrong secret (on live fixture)', 'HashlockMismatch', () =>
      connectAs(train, roles.user).functions.redeem_user(fixtureHashlock, '0xdeadbeef'),
    );
    await expectRevert('U1', 'refund_user early by non-recipient (on live fixture)', 'RefundNotAllowed', () =>
      connectAs(train, roles.relayer).functions.refund_user(fixtureHashlock),
    );
    await tx('U1', 'U1-live fixture cleanup: refund by recipient', () => callRefundUser(train, roles.recipient, fixtureHashlock));
    await expectRevert('U1', 'redeem_user on an already-Refunded lock', 'LockNotPending', () =>
      connectAs(train, roles.user).functions.redeem_user(fixtureHashlock, fixtureSecret),
    );
  }

  // ── UN: different-asset reward (attach_solver_reward) failure cases -- the NEW feature ──
  {
    // A real different-asset lock (principal in base, reward in test_asset declared but unfunded).
    const mkDiffAssetLock = async (label: string) => {
      const { hashlock } = freshSecretAndHashlock(label);
      await tx('UN', `${label}: solver_lock (base principal, test_asset reward declared, unfunded)`, () =>
        callSolverLock({
          train,
          caller: roles.solver,
          assetId: baseAssetId,
          amount: LOCK_AMOUNT,
          params: makeSolverLockParams({
            recipient: identityFromAccount(roles.recipient),
            assetId: baseAssetId,
            hashlock,
            reward: REWARD_AMOUNT,
            rewardAssetId: testAsset.assetId,
            rewardRecipient: identityFromAccount(roles.rewardRecipient),
            timelockDelta: LONG_TIMELOCK,
            rewardTimelockDelta: SAFE_REWARD_TIMELOCK,
            refundTo: identityFromAccount(roles.refundTo),
          }),
          dst: makeDestinationInfo(),
        }),
      );
      return hashlock;
    };

    const solverIdentity = identityFromAccount(roles.solver);

    // Wrong asset: forward BASE where test_asset is declared.
    const wrongAssetLock = await mkDiffAssetLock('UN-wrongasset');
    await expectRevert('UN', 'attach_solver_reward wrong asset (base != declared test_asset)', 'RewardAssetMismatch', () =>
      connectAs(train, roles.solver)
        .functions.attach_solver_reward(wrongAssetLock, solverIdentity)
        .callParams({ forward: [REWARD_AMOUNT, baseAssetId] }),
    );

    // Wrong amount: forward test_asset but the wrong amount.
    const wrongAmountLock = await mkDiffAssetLock('UN-wrongamount');
    await expectRevert('UN', 'attach_solver_reward wrong amount (test_asset, reward+1)', 'RewardAssetMismatch', () =>
      connectAs(train, roles.solver)
        .functions.attach_solver_reward(wrongAmountLock, solverIdentity)
        .callParams({ forward: [REWARD_AMOUNT + 1, testAsset.assetId] }),
    );

    // Double attach: fund correctly once, then attach again -> RewardAlreadyFunded.
    const doubleAttachLock = await mkDiffAssetLock('UN-double');
    await tx('UN', 'UN-double: first attach (correct asset+amount) funds the reward', async () => {
      const { transactionId, waitForResult } = await connectAs(train, roles.solver)
        .functions.attach_solver_reward(doubleAttachLock, solverIdentity)
        .callParams({ forward: [REWARD_AMOUNT, testAsset.assetId] })
        .call();
      await waitForResult();
      return { transactionId, value: true };
    });
    await expectRevert('UN', 'attach_solver_reward twice (second rejected)', 'RewardAlreadyFunded', () =>
      connectAs(train, roles.solver)
        .functions.attach_solver_reward(doubleAttachLock, solverIdentity)
        .callParams({ forward: [REWARD_AMOUNT, testAsset.assetId] }),
    );

    // Attach on a never-created lock.
    await expectRevert('UN', 'attach_solver_reward on nonexistent lock', 'LockNotFound', () =>
      connectAs(train, roles.solver)
        .functions.attach_solver_reward(randomHashlock(), solverIdentity)
        .callParams({ forward: [REWARD_AMOUNT, testAsset.assetId] }),
    );
  }

  // ── B2: a payout curve pointed at a non-PayoutCurve contract makes redeem fail cleanly ──
  {
    const { secret, hashlock } = freshSecretAndHashlock('B2');
    // Point payout_curve at the test_asset contract, which does NOT implement compute_payout.
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(roles.recipient),
      refundTo: identityFromAccount(roles.refundTo),
      quoteExpirySecondsFromNow: QUOTE_EXPIRY_DELTA,
      payoutCurve: { bits: testAsset.contractId },
      payoutCurveData: new Uint8Array(),
    });
    await tx('B2', `user_lock with a bogus payout_curve (hashlock ${hashlock.slice(0, 10)}…)`, () =>
      callUserLock({ train, caller: roles.user, assetId: baseAssetId, amount: LOCK_AMOUNT, params, dst: makeDestinationInfo() }),
    );
    await expectReject('B2', 'redeem_user reverts cleanly when the curve is not a PayoutCurve', /revert|reason|VM_HALTED|panic|not.*found|selector|InvalidPayout/i, async () => {
      const { waitForResult } = await connectAs(train, roles.user).functions.redeem_user(hashlock, secret).call();
      await waitForResult();
    });
    const status = ((await getUserLock(train, hashlock)) as { status: string }).status;
    check('B2', 'lock stays Pending after the failed redeem (funds not lost)', status === 'Pending', `status=${status}`);
    // Clean up: recipient refunds early so no funds are stranded in the throwaway contract.
    await tx('B2', 'cleanup: refund_user by recipient', () => callRefundUser(train, roles.recipient, hashlock));
  }

  // ── Report ──
  const finishedAt = new Date();
  const primaryEnd = await provider.getBalance(roles.primary.address, baseAssetId);
  info('S9', 'primary ending balance', `${primaryEnd.toString()} base units (spent ${primaryStart.sub(primaryEnd).toString()} over the run)`);

  const reportsDir = path.join(__dirname, '../reports');
  const { mdPath, jsonPath } = writeReport(
    reportsDir,
    {
      network,
      providerUrl: redactProviderUrl(providerUrl),
      addresses: {
        train: trainId,
        payoutCurve: payoutCurveId,
        'test_asset (fixture, non-protocol)': testAsset.contractId,
      },
      roles: Object.fromEntries(
        (Object.entries(roles) as Array<[string, WalletUnlocked]>).map(([name, w]) => [name, w.address.toB256()]),
      ),
      startedAt: runStarted,
      buildNotes,
    },
    rows,
    finishedAt,
  );

  printSummaryTable(rows);
  console.log(`\nReport written:\n  ${mdPath}\n  ${jsonPath}`);
}

/** A syntactically-valid, not-yet-hashlock-set `UserLockParamsInput` for the U1 validation cases
 * that each override just the ONE field under test. Kept local (not `makeUserLockParams`, which is
 * async) so per-case overrides need no extra await. */
function blankUserLockParamsSync(
  recipient: WalletUnlocked,
  refundTo: WalletUnlocked,
  quoteExpiry: string,
): UserLockParamsInput {
  return {
    hashlock: randomHashlock(),
    timelock_delta: 3600,
    quote_expiry: quoteExpiry,
    recipient: identityFromAccount(recipient),
    refund_to: identityFromAccount(refundTo),
    reward_amount: 0,
    reward_timelock_delta: 0,
    reward_token: 'ETH',
    reward_recipient: '',
    src_chain: 'FUEL',
  };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[testnet-e2e] failed:', err instanceof Error ? err.message : err);
    printSummaryTable(rows);
    process.exit(1);
  });
}
