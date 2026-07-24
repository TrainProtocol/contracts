/**
 * The handler layer for the stateful invariant-fuzzing harness: one function per possible
 * action against the deployed `Train` contract (`createUserLock`, `createSolverLock`,
 * `redeemUser`, `redeemSolver`, `refundUser`, `refundSolver`). Each handler:
 *   (a) checks its preconditions against the in-memory `ShadowModel` only (never the real
 *       chain) and returns `{ ok: false }` immediately if unsatisfiable;
 *   (b) if satisfiable, executes the real call against the live node via `../testHarness`;
 *   (c) updates the shadow model to match what SHOULD now be true;
 *   (d) returns an `ActionOutcome` carrying the expected per-wallet/contract balance deltas and
 *       which lock(s) were touched, for `./invariants.ts`/`./driver.ts` to verify against real
 *       on-chain state and real wallet balances right after.
 *
 * PAYOUT CURVES ARE OUT OF SCOPE HERE: every lock created by this harness has `payout_curve:
 * undefined`, so `compute_payout` always returns the full `amount` and `excess` is always 0 (see
 * `main.sw`'s `compute_payout`). The curve path (partial payout, excess-to-refund_to) already has
 * dedicated coverage in `trainCore.test.ts`/`propertyFuzz.test.ts`; folding it into this harness
 * too would add a whole extra dimension of bookkeeping (a third `ConstantPayoutCurve` contract
 * balance to track for SOLV/CONS) without a proportionate increase in what this SEQUENCING-
 * focused harness is meant to catch. This is a deliberate scope cut, not an oversight.
 *
 * TIMELOCK PROFILES ("fuses"), AND WHY: `redeem_user`/`redeem_solver` never consult a lock's
 * timelock at all, so any Pending lock is always a valid redeem candidate regardless of fuse.
 * `refund_user`'s non-recipient path and `refund_solver` (no early path at all) DO require real
 * wall-clock time to have passed the lock's `timelock` -- and, per `trainCore.test.ts`'s "REAL
 * WALL-CLOCK TIMELOCKS" doc comment, a subsequent dry-run only sees time past that boundary once
 * a NEW block has been committed after the real deadline (not merely once the deadline has
 * physically passed). To keep this harness's total runtime bounded:
 *   - every lock is created with either a 'short' fuse (timelock_delta 3-6s -- a refund
 *     candidate reachable within a small bounded wait) or a 'long' fuse (3600s -- effectively
 *     never refundable within this test's runtime, so these are pure redeem/immediate-refund
 *     candidates);
 *   - `refundUser`/`refundSolver` only ever pick 'short'-fuse locks whose deadline is within a
 *     small `WAIT_CAP_MS`, sleep the (small) remainder, then commit one throwaway `user_lock` to
 *     force the chain tip's committed block time past the deadline before attempting the real
 *     refund (`bumpChainTip`, mirroring `trainCore.test.ts`'s `advanceRealTimePast` exactly).
 *   - solver-lock reward-branch selection (`reward_to` = `reward_recipient` vs. the redeemer's
 *     keeper bounty) is made DETERMINISTIC by construction rather than timing-dependent: a
 *     `reward_timelock_delta` of exactly 0 makes `reward_timelock == start_time`, so the
 *     contract's `lock.reward_timelock > now` check is false from the very instant of creation
 *     onward (no ambiguity, ever); a delta of 1800s against a run whose total wall-clock budget
 *     is a small number of minutes is guaranteed to still be in the future at redeem time. See
 *     `createSolverLock` below for exactly where each is chosen.
 */
import * as crypto from 'node:crypto';

import { bn, sha256 as fuelSha256 } from 'fuels';

import {
  callRedeemSolver,
  callRedeemUser,
  callRefundSolver,
  callRefundUser,
  callSolverLock,
  callUserLock,
  identityFromAccount,
  makeDestinationInfo,
  makeSolverLockParams,
  makeUserLockParams,
  type TestEnvironment,
} from '../testHarness';
import { addDelta, ShadowModel, toBig, type ShadowSolverLock, type ShadowUserLock } from './shadowModel';

export interface HandlerCtx {
  env: TestEnvironment;
  model: ShadowModel;
  assetId: string;
  poolSize: number;
}

export interface ActionOutcome {
  action: 'createUserLock' | 'createSolverLock' | 'redeemUser' | 'redeemSolver' | 'refundUser' | 'refundSolver';
  /** Whether the action actually executed (a real call went out). `false` means its
   * preconditions were not satisfiable against the current shadow model -- nothing was
   * attempted, nothing changed. */
  ok: boolean;
  /** Per-wallet-index (into `env.wallets`) and `'contract'` signed balance deltas this action
   * (including any internal `bumpChainTip` it needed) SHOULD have produced, in `assetId`. Native
   * `bigint`, NOT `BN` -- see `shadowModel.ts`'s "SIGNED-DELTA ARITHMETIC NOTE" for why `BN`
   * cannot represent a negative delta. */
  expectedDeltas?: Map<number | 'contract', bigint>;
  touchedUserHashlock?: string;
  touchedSolverHashlock?: { hashlock: string; index: number };
  /** Short human-readable description of exactly what this invocation did (params, indices) --
   * folded into every invariant-assertion message so a violation's minimal repro can be read
   * straight off the failing test's output. */
  note: string;
}

// ───────────────────────────── small local helpers ─────────────────────────────

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mints a fresh random 32-byte secret and its `sha256` hashlock -- the exact shape
 * `redeem_user`/`redeem_solver` expect (mirrors `trainCore.test.ts`'s `makeSecretPair`). Every
 * hashlock used anywhere in this harness is minted this way, so its secret is always known. */
function randomSecretAndHashlock(): { secretArg: string; hashlock: string } {
  const secretBytes = crypto.randomBytes(32);
  const hashlock = fuelSha256(secretBytes);
  const secretArg = bn(`0x${secretBytes.toString('hex')}`).toString();
  return { secretArg, hashlock };
}

/** A small bounded wait window: `refundUser`/`refundSolver` only act on a short-fuse lock whose
 * deadline is at most this far in the future, so no single action ever blocks the campaign for
 * long. Kept short (a few seconds) specifically so this harness's total runtime stays well
 * under the "1-3 minutes" budget stated in this phase's task brief even with many runs. */
const WAIT_CAP_MS = 4_000;

// ───────────────────────────── shared user-lock core ─────────────────────────────

/** Shared by `createUserLock` (random parameters) and `bumpChainTip` (fixed minimal
 * parameters) -- both need the exact same real-call + shadow-model-registration sequence. */
async function performUserLock(
  ctx: HandlerCtx,
  opts: {
    funderIdx: number;
    recipientIdx: number;
    refundToIdx: number;
    amount: number;
    timelockDeltaSec: number;
    fuse: 'short' | 'long';
  },
): Promise<{ hashlock: string; expectedDeltas: Map<number | 'contract', bigint> }> {
  const { env, model, assetId } = ctx;
  const { funderIdx, recipientIdx, refundToIdx, amount, timelockDeltaSec, fuse } = opts;
  const { secretArg, hashlock } = randomSecretAndHashlock();

  const funder = env.wallets[funderIdx];
  const recipient = identityFromAccount(env.wallets[recipientIdx]);
  const refundTo = identityFromAccount(env.wallets[refundToIdx]);

  const params = await makeUserLockParams({
    hashlock,
    recipient,
    refundTo,
    timelockDelta: timelockDeltaSec,
    quoteExpirySecondsFromNow: 24 * 3600,
  });
  const dst = makeDestinationInfo();

  const createdAtMs = Date.now();
  await callUserLock({ train: env.train, caller: funder, assetId, amount, params, dst });

  const lock: ShadowUserLock = {
    hashlock,
    secretArg,
    amount: bn(amount),
    recipientIdx,
    refundToIdx,
    funderIdx,
    status: 'Pending',
    createdAtMs,
    timelockDeltaSec,
    timelockDeadlineMs: createdAtMs + timelockDeltaSec * 1000,
    fuse,
  };
  model.userLocks.set(hashlock, lock);
  model.everCreatedUserHashlocks.add(hashlock);
  model.knownSecrets.set(hashlock, secretArg);

  const expectedDeltas = new Map<number | 'contract', bigint>();
  addDelta(expectedDeltas, funderIdx, -BigInt(amount));
  addDelta(expectedDeltas, 'contract', BigInt(amount));

  return { hashlock, expectedDeltas };
}

/** Commits one throwaway (but perfectly ordinary, shadow-model-registered) `user_lock` from
 * `env.wallets[0]` -- forces the chain tip's committed block time forward to real "now" so a
 * subsequent dry-run actually sees a timelock deadline as passed (see this file's doc comment).
 * Its own balance effect (`wallets[0]` -10, contract +10) is returned so the CALLING handler can
 * fold it into that handler's own `expectedDeltas` -- from the driver's point of view this is
 * still exactly one action (one before/after balance snapshot pair). */
async function bumpChainTip(ctx: HandlerCtx): Promise<Map<number | 'contract', bigint>> {
  const { expectedDeltas } = await performUserLock(ctx, {
    funderIdx: 0,
    recipientIdx: 0,
    refundToIdx: 0,
    amount: 10,
    timelockDeltaSec: 3600,
    fuse: 'long',
  });
  return expectedDeltas;
}

// ───────────────────────────── handlers ─────────────────────────────

export async function createUserLock(ctx: HandlerCtx): Promise<ActionOutcome> {
  const { poolSize } = ctx;
  const funderIdx = randInt(0, poolSize - 1);
  const recipientIdx = randInt(0, poolSize - 1);
  const refundToIdx = randInt(0, poolSize - 1);
  const amount = randInt(1, 500_000);
  const isShort = Math.random() < 0.4;
  const timelockDeltaSec = isShort ? randInt(3, 6) : 3600;

  const { hashlock, expectedDeltas } = await performUserLock(ctx, {
    funderIdx,
    recipientIdx,
    refundToIdx,
    amount,
    timelockDeltaSec,
    fuse: isShort ? 'short' : 'long',
  });

  return {
    action: 'createUserLock',
    ok: true,
    expectedDeltas,
    touchedUserHashlock: hashlock,
    note: `funder=${funderIdx} recipient=${recipientIdx} refundTo=${refundToIdx} amount=${amount} timelockDelta=${timelockDeltaSec}s fuse=${isShort ? 'short' : 'long'} hashlock=${hashlock}`,
  };
}

export async function createSolverLock(ctx: HandlerCtx): Promise<ActionOutcome> {
  const { env, model, assetId, poolSize } = ctx;
  const funderIdx = randInt(0, poolSize - 1);
  const recipientIdx = randInt(0, poolSize - 1);
  const rewardRecipientIdx = randInt(0, poolSize - 1);
  const refundToIdx = randInt(0, poolSize - 1);

  // 50% reuse an existing known hashlock (possibly one with a user lock too -- the realistic
  // HTLC shape), else mint a brand-new one.
  const known = model.allKnownHashlocks();
  let hashlock: string;
  if (known.length > 0 && Math.random() < 0.5) {
    hashlock = pick(known);
  } else {
    const fresh = randomSecretAndHashlock();
    hashlock = fresh.hashlock;
    model.knownSecrets.set(hashlock, fresh.secretArg);
  }

  const principal = randInt(1, 300_000);
  const reward = Math.random() < 0.5 ? randInt(1, 100_000) : 0;

  // Profile selection -- see this file's doc comment for the "fuses" rationale. This is biased
  // toward short-fuse (0.5, not a lower value) on purpose: `refund_solver` has NO early/immediate
  // path (unlike `refund_user`'s recipient-immediate fallback), so a short-fuse, still-Pending
  // solver lock is the ONLY thing that can ever make `refundSolver` selectable -- keeping a
  // healthy supply of them created is what guarantees that handler's code path is exercised at
  // least once per campaign rather than left to a lucky seed (see `redeemSolver` below, which
  // deliberately leaves these short-fuse locks alone so they are not cannibalized before
  // `refundSolver` can reach them).
  const isRefundCandidate = Math.random() < 0.5;
  let timelockDeltaSec: number;
  let rewardTimelockDeltaSec: number;
  if (isRefundCandidate) {
    timelockDeltaSec = randInt(3, 6);
    rewardTimelockDeltaSec = 0; // irrelevant to refund_solver; must be < timelock_delta if reward>0, 0 always qualifies
  } else {
    timelockDeltaSec = 3600;
    rewardTimelockDeltaSec = reward > 0 && Math.random() < 0.5 ? 1800 : 0;
  }

  const recipient = identityFromAccount(env.wallets[recipientIdx]);
  const rewardRecipient = identityFromAccount(env.wallets[rewardRecipientIdx]);
  const refundTo = identityFromAccount(env.wallets[refundToIdx]);

  const params = makeSolverLockParams({
    hashlock,
    assetId,
    reward,
    timelockDelta: timelockDeltaSec,
    rewardTimelockDelta: rewardTimelockDeltaSec,
    recipient,
    rewardRecipient,
    refundTo,
  });
  const dst = makeDestinationInfo();
  const msgAmount = principal + reward;

  const funder = env.wallets[funderIdx];
  const createdAtMs = Date.now();
  const result = await callSolverLock({ train: env.train, caller: funder, assetId, amount: msgAmount, params, dst });
  const index = Number(bn(result.value as never).toString());

  const lock: ShadowSolverLock = {
    hashlock,
    index,
    amount: bn(principal),
    reward: bn(reward),
    recipientIdx,
    rewardRecipientIdx,
    refundToIdx,
    funderIdx,
    status: 'Pending',
    createdAtMs,
    timelockDeltaSec,
    timelockDeadlineMs: createdAtMs + timelockDeltaSec * 1000,
    rewardTimelockDeltaSec,
    rewardTimelockDeadlineMs: createdAtMs + rewardTimelockDeltaSec * 1000,
    fuse: isRefundCandidate ? 'short' : 'long',
  };
  const byIndex = model.solverLocks.get(hashlock) ?? new Map<number, ShadowSolverLock>();
  byIndex.set(index, lock);
  model.solverLocks.set(hashlock, byIndex);
  model.solverLockCount.set(hashlock, index);

  const expectedDeltas = new Map<number | 'contract', bigint>();
  addDelta(expectedDeltas, funderIdx, -BigInt(msgAmount));
  addDelta(expectedDeltas, 'contract', BigInt(msgAmount));

  return {
    action: 'createSolverLock',
    ok: true,
    expectedDeltas,
    touchedSolverHashlock: { hashlock, index },
    note: `funder=${funderIdx} recipient=${recipientIdx} rewardRecipient=${rewardRecipientIdx} principal=${principal} reward=${reward} index=${index} rewardTimelockDelta=${rewardTimelockDeltaSec}s hashlock=${hashlock}`,
  };
}

export async function redeemUser(ctx: HandlerCtx): Promise<ActionOutcome> {
  const { env, model, poolSize } = ctx;
  const candidates = model.pendingUserLocks();
  if (candidates.length === 0) return { action: 'redeemUser', ok: false, note: 'no Pending user locks available' };

  const lock = pick(candidates);
  const redeemerIdx = randInt(0, poolSize - 1);
  const redeemer = env.wallets[redeemerIdx];

  await callRedeemUser(env.train, redeemer, lock.hashlock, lock.secretArg);
  lock.status = 'Redeemed';

  const expectedDeltas = new Map<number | 'contract', bigint>();
  addDelta(expectedDeltas, 'contract', -toBig(lock.amount));
  addDelta(expectedDeltas, lock.recipientIdx, toBig(lock.amount));

  return {
    action: 'redeemUser',
    ok: true,
    expectedDeltas,
    touchedUserHashlock: lock.hashlock,
    note: `hashlock=${lock.hashlock} redeemer=${redeemerIdx} recipient=${lock.recipientIdx} amount=${lock.amount.toString()}`,
  };
}

export async function redeemSolver(ctx: HandlerCtx): Promise<ActionOutcome> {
  const { env, model, poolSize } = ctx;
  const candidates = model.pendingSolverLocks();
  if (candidates.length === 0) return { action: 'redeemSolver', ok: false, note: 'no Pending solver locks available' };

  // `redeem_solver`'s contract logic never consults the lock's `timelock` at all, so WHICH
  // pending solver lock we redeem is immaterial to this handler's code-path coverage. Given that
  // freedom, prefer long-fuse locks so we do not consume the short-fuse ones that are
  // `refundSolver`'s ONLY possible candidates (`refund_solver` has no early path). We only fall
  // back to a short-fuse lock when there is genuinely nothing else Pending -- so redeemSolver is
  // never starved, while short-fuse locks reliably accumulate for refundSolver to reach.
  const longFuse = candidates.filter((l) => l.fuse === 'long');
  const lock = pick(longFuse.length > 0 ? longFuse : candidates);
  const secretArg = model.knownSecrets.get(lock.hashlock);
  if (!secretArg) {
    // Cannot happen given every hashlock is minted via randomSecretAndHashlock, but keep the
    // precondition explicit (see this file's doc comment: "only for a hashlock ... knows the
    // secret for") rather than silently assuming it.
    return { action: 'redeemSolver', ok: false, note: `hashlock=${lock.hashlock} has no known secret` };
  }
  const redeemerIdx = randInt(0, poolSize - 1);
  const redeemer = env.wallets[redeemerIdx];

  await callRedeemSolver(env.train, redeemer, lock.hashlock, lock.index, secretArg);
  lock.status = 'Redeemed';

  // Deterministic by construction -- see this file's doc comment.
  const now = Date.now();
  const rewardToIdx = lock.reward.isZero() ? null : now < lock.rewardTimelockDeadlineMs ? lock.rewardRecipientIdx : redeemerIdx;

  const expectedDeltas = new Map<number | 'contract', bigint>();
  addDelta(expectedDeltas, 'contract', -(toBig(lock.amount) + toBig(lock.reward)));
  addDelta(expectedDeltas, lock.recipientIdx, toBig(lock.amount));
  if (rewardToIdx !== null) addDelta(expectedDeltas, rewardToIdx, toBig(lock.reward));

  return {
    action: 'redeemSolver',
    ok: true,
    expectedDeltas,
    touchedSolverHashlock: { hashlock: lock.hashlock, index: lock.index },
    note: `hashlock=${lock.hashlock} index=${lock.index} redeemer=${redeemerIdx} rewardTo=${rewardToIdx ?? 'n/a'} reward=${lock.reward.toString()}`,
  };
}

export async function refundUser(ctx: HandlerCtx): Promise<ActionOutcome> {
  const { env, model, poolSize } = ctx;
  const pending = model.pendingUserLocks();
  if (pending.length === 0) return { action: 'refundUser', ok: false, note: 'no Pending user locks available' };

  const now = Date.now();
  const dueSoon = pending.filter((l) => l.fuse === 'short' && l.timelockDeadlineMs - now <= WAIT_CAP_MS);

  if (dueSoon.length > 0 && Math.random() < 0.5) {
    const lock = pick(dueSoon);
    const waitMs = Math.max(0, lock.timelockDeadlineMs - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    const bumpDeltas = await bumpChainTip(ctx);

    let callerIdx = randInt(0, poolSize - 1);
    if (callerIdx === lock.recipientIdx) callerIdx = (callerIdx + 1) % poolSize; // force the non-recipient path
    const caller = env.wallets[callerIdx];

    await callRefundUser(env.train, caller, lock.hashlock);
    lock.status = 'Refunded';

    const expectedDeltas = new Map<number | 'contract', bigint>(bumpDeltas);
    addDelta(expectedDeltas, 'contract', -toBig(lock.amount));
    addDelta(expectedDeltas, lock.refundToIdx, toBig(lock.amount));

    return {
      action: 'refundUser',
      ok: true,
      expectedDeltas,
      touchedUserHashlock: lock.hashlock,
      note: `path=non-recipient-after-timelock hashlock=${lock.hashlock} caller=${callerIdx} refundTo=${lock.refundToIdx} amount=${lock.amount.toString()}`,
    };
  }

  const lock = pick(pending);
  const recipientWallet = env.wallets[lock.recipientIdx];
  await callRefundUser(env.train, recipientWallet, lock.hashlock);
  lock.status = 'Refunded';

  const expectedDeltas = new Map<number | 'contract', bigint>();
  addDelta(expectedDeltas, 'contract', -toBig(lock.amount));
  addDelta(expectedDeltas, lock.refundToIdx, toBig(lock.amount));

  return {
    action: 'refundUser',
    ok: true,
    expectedDeltas,
    touchedUserHashlock: lock.hashlock,
    note: `path=recipient-immediate hashlock=${lock.hashlock} recipient=${lock.recipientIdx} refundTo=${lock.refundToIdx} amount=${lock.amount.toString()}`,
  };
}

export async function refundSolver(ctx: HandlerCtx): Promise<ActionOutcome> {
  const { env, model, poolSize } = ctx;
  const now = Date.now();
  const candidates = model
    .pendingSolverLocks()
    .filter((l) => l.fuse === 'short' && l.timelockDeadlineMs - now <= WAIT_CAP_MS);
  if (candidates.length === 0) {
    return { action: 'refundSolver', ok: false, note: 'no refund-ready (short-fuse, within wait cap) Pending solver locks' };
  }

  const lock = pick(candidates);
  const waitMs = Math.max(0, lock.timelockDeadlineMs - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  const bumpDeltas = await bumpChainTip(ctx);

  const callerIdx = randInt(0, poolSize - 1);
  const caller = env.wallets[callerIdx];
  await callRefundSolver(env.train, caller, lock.hashlock, lock.index);
  lock.status = 'Refunded';

  const expectedDeltas = new Map<number | 'contract', bigint>(bumpDeltas);
  addDelta(expectedDeltas, 'contract', -(toBig(lock.amount) + toBig(lock.reward)));
  addDelta(expectedDeltas, lock.refundToIdx, toBig(lock.amount) + toBig(lock.reward));

  return {
    action: 'refundSolver',
    ok: true,
    expectedDeltas,
    touchedSolverHashlock: { hashlock: lock.hashlock, index: lock.index },
    note: `hashlock=${lock.hashlock} index=${lock.index} caller=${callerIdx} refundTo=${lock.refundToIdx} amount=${lock.amount.toString()} reward=${lock.reward.toString()}`,
  };
}
