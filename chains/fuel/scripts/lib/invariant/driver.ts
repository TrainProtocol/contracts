/**
 * The driver: runs many bounded-length random sequences of the six handlers (`./handlers.ts`)
 * against ONE real local node, checking every invariant in `./invariants.ts` after every action
 * that actually executes.
 *
 * ONE SHARED NODE, ONE SHARED SHADOW MODEL, FOR THE WHOLE CAMPAIGN (all runs): launching a fresh
 * `fuel-core` per run is what `sponsoredTx.test.ts` does per-TEST, but here
 * it would multiply this phase's dominant fixed cost (node launch + contract deploy, several
 * seconds) by the run count for no real isolation benefit -- every hashlock in this harness is
 * freshly random (`crypto.randomBytes(32)`), so two "runs" sharing one chain can never collide on
 * storage keys, and the invariants themselves (SOLV/CONS/LWF/PAG/SIDX) are either GLOBAL sums
 * (SOLV) or keyed per-hashlock/per-wallet (everything else) -- neither cares whether the state it
 * is reading grew across one run or many. `numRuns` therefore really means "how many independent
 * ACTION SEQUENCES to statistically sample", not "how many isolated chains to boot", and the
 * total real transaction count (`numRuns * actionsPerRun`, roughly) is what actually drives this
 * phase's runtime -- see `trainCore.test.ts`'s own file doc comment for the identical one-shared-
 * environment rationale (there: for its ~35 tests; here: for this campaign's many action steps).
 *
 * ACTION SELECTION: a single weighted-random pick per step (not an exhaustive fallback chain
 * through every handler). `createUserLock`/`createSolverLock` are always satisfiable, so they
 * dominate the weight distribution; `redeemUser`/`redeemSolver`/`refundUser`/`refundSolver` can
 * occasionally find no eligible candidate this step (e.g. early in a run before any locks exist,
 * or no short-fuse lock is currently within its wait window) and are simply skipped for that step
 * (logged, not retried) -- over `actionsPerRun` steps this still exercises every handler many
 * times without over-complicating the selection logic.
 */
import assert from 'node:assert/strict';

import { identityFromAccount, identityFromAddress, randomHashlock, type TestEnvironment } from '../testHarness';
import {
  createSolverLock,
  createUserLock,
  redeemSolver,
  redeemUser,
  refundSolver,
  refundUser,
  type ActionOutcome,
  type HandlerCtx,
} from './handlers';
import {
  assertConservation,
  assertNeverUsedHashlockIsEmpty,
  assertPaginationNeverReverts,
  assertSolvency,
  assertSolverIndexBounds,
  assertSolverLockStatus,
  assertSwapAlreadyExists,
  assertUserLockStatus,
  snapshotBalances,
} from './invariants';
import { ShadowModel } from './shadowModel';

export interface DriverOptions {
  numRuns: number;
  actionsPerRun: number;
  assetId: string;
  poolSize: number;
}

export interface DriverResult {
  totalActionsExecuted: number;
  totalSteps: number;
  actionCounts: Record<string, number>;
  runtimeMs: number;
  /** Every executed action's `note` (with `run`/`step` prefixed) in order -- the closest thing
   * this harness has to fast-check's automatic shrinking: if a violation is ever found, this log
   * (plus the failing assertion's own message) is enough to manually identify the shortest
   * prefix of a run that reproduces it. */
  actionLog: string[];
}

const HANDLER_TABLE: Array<{ action: ActionOutcome['action']; weight: number; fn: (ctx: HandlerCtx) => Promise<ActionOutcome> }> = [
  { action: 'createUserLock', weight: 3, fn: createUserLock },
  { action: 'createSolverLock', weight: 3, fn: createSolverLock },
  { action: 'redeemUser', weight: 2, fn: redeemUser },
  { action: 'redeemSolver', weight: 2, fn: redeemSolver },
  { action: 'refundUser', weight: 2, fn: refundUser },
  { action: 'refundSolver', weight: 2, fn: refundSolver },
];
const TOTAL_WEIGHT = HANDLER_TABLE.reduce((sum, h) => sum + h.weight, 0);

function pickWeightedHandler(): (typeof HANDLER_TABLE)[number] {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const entry of HANDLER_TABLE) {
    if (r < entry.weight) return entry;
    r -= entry.weight;
  }
  return HANDLER_TABLE[HANDLER_TABLE.length - 1];
}

export async function runInvariantCampaign(env: TestEnvironment, opts: DriverOptions): Promise<DriverResult> {
  const { numRuns, actionsPerRun, assetId, poolSize } = opts;
  const model = new ShadowModel();
  const ctx: HandlerCtx = { env, model, assetId, poolSize };

  const actionLog: string[] = [];
  const actionCounts: Record<string, number> = {};
  let totalActionsExecuted = 0;
  let totalSteps = 0;
  const start = Date.now();

  // A fixed "zero-locks" identity: a synthetic `Identity::Address` that owns no wallet and is
  // never used as a recipient/refund_to/funder anywhere in this campaign (mirrors
  // `trainCore.test.ts`'s `randomIdentity()`) -- an always-total-0 PAG probe target, run
  // alongside wallet 0's identity (a nonzero, monotonically growing total, since every
  // `bumpChainTip` also funds+attributes a throwaway lock to it).
  const neverUsedIdentity = identityFromAddress(randomHashlock());

  for (let run = 0; run < numRuns; run += 1) {
    for (let step = 0; step < actionsPerRun; step += 1) {
      totalSteps += 1;
      const entry = pickWeightedHandler();

      const before = await snapshotBalances(env, poolSize, assetId);
      const outcome = await entry.fn(ctx);

      if (!outcome.ok) {
        actionLog.push(`run=${run} step=${step} action=${outcome.action} SKIPPED: ${outcome.note}`);
        continue;
      }

      const noteFull = `run=${run} step=${step} action=${outcome.action} ${outcome.note}`;
      actionLog.push(noteFull);
      totalActionsExecuted += 1;
      actionCounts[outcome.action] = (actionCounts[outcome.action] ?? 0) + 1;

      try {
        const after = await snapshotBalances(env, poolSize, assetId);

        // CONS
        assertConservation(before, after, outcome.expectedDeltas ?? new Map(), noteFull);

        // SOLV
        await assertSolvency(env, model, assetId, noteFull);

        // LWF: status transition of whatever this action touched, plus the permanent-squatting
        // reprobe for user-lock-affecting actions.
        if (outcome.touchedUserHashlock) {
          const lock = model.userLocks.get(outcome.touchedUserHashlock);
          assert.ok(lock, `internal harness error: touched user hashlock ${outcome.touchedUserHashlock} missing from shadow model`);
          await assertUserLockStatus(env, outcome.touchedUserHashlock, lock.status, noteFull);
        }
        if (outcome.touchedSolverHashlock) {
          const { hashlock, index } = outcome.touchedSolverHashlock;
          const lock = model.solverLocks.get(hashlock)?.get(index);
          assert.ok(lock, `internal harness error: touched solver lock ${hashlock}/${index} missing from shadow model`);
          await assertSolverLockStatus(env, hashlock, index, lock.status, noteFull);
          await assertSolverIndexBounds(env, model, hashlock, noteFull);
        }
        if (
          (outcome.action === 'createUserLock' || outcome.action === 'redeemUser' || outcome.action === 'refundUser') &&
          outcome.touchedUserHashlock
        ) {
          await assertSwapAlreadyExists(env, assetId, outcome.touchedUserHashlock, noteFull);
        }
        // A hashlock nobody has ever touched must still read back Empty -- cheap, run every step.
        await assertNeverUsedHashlockIsEmpty(env, randomHashlock(), noteFull);

        // PAG: probe wallet 0's enumeration (accumulates locks across the whole campaign via
        // both real creates and every `bumpChainTip`, so its `total` only ever grows -- exercises
        // `offset == total` at an ever-increasing boundary) plus a synthetic identity that never
        // owns any lock at all (permanently `total == 0`, the other edge of the same check).
        await assertPaginationNeverReverts(env, identityFromAccount(env.wallets[0]), noteFull);
        await assertPaginationNeverReverts(env, neverUsedIdentity, noteFull);
      } catch (err) {
        // Surface the last handful of actions alongside the failing assertion -- the closest
        // thing to a "minimal repro" this non-shrinking harness can offer.
        const tail = actionLog.slice(-10).join('\n  ');
        // eslint-disable-next-line no-console
        console.error(`\nINVARIANT VIOLATION -- last actions leading up to it:\n  ${tail}\n`);
        throw err;
      }
    }
  }

  return {
    totalActionsExecuted,
    totalSteps,
    actionCounts,
    runtimeMs: Date.now() - start,
    actionLog,
  };
}
