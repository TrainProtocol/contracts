/**
 * Stateful invariant-fuzzing harness for the Fuel/Sway "Train" HTLC port, run against a REAL
 * local `fuel-core` node (via `../testHarness`'s `setupTestEnvironment`) -- not a pure in-memory
 * simulation. Checks five invariants (SOLV/CONS/LWF/PAG/SUNIQ -- see `docs/ARCHITECTURE.md`'s
 * invariant table, or `./invariants.ts` for the exact assertions), and
 * `./handlers.ts`/`./driver.ts`'s file doc comments for the full design rationale (shadow-model
 * shape, timelock "fuse" profiles, why one shared node/model is used for the whole campaign).
 *
 * SCOPE (read alongside `trainCore.test.ts`/`propertyFuzz.test.ts`): those two files already
 * exhaustively cover individual-call correctness (every field round-trips, every error variant
 * fires under the right condition, the payout-curve path, pagination slicing) -- this file is
 * deliberately NOT re-testing any of that. Its whole point is SEQUENCES of actions and
 * cross-cutting invariants that only make sense over a run's accumulated history (has the
 * contract's balance ever silently drifted from what it should hold across dozens of
 * interleaved locks/redeems/refunds? does a hashlock's status ever move backwards? etc).
 *
 * PARAMETER CHOICE (`NUM_RUNS` x `ACTIONS_PER_RUN`): 6 runs x 18 actions = 108 real-transaction-
 * driving steps (plus each step's own invariant-check reads, plus the occasional extra
 * throwaway "bump" transaction `refundUser`/`refundSolver` need -- see `handlers.ts`). This sits
 * at the modest end of the task brief's suggested "15-30 actions per run, 5-15 runs" range,
 * chosen deliberately: this is a genuinely-executed campaign against a real node (no mocking),
 * and every action here costs at least one real submitted transaction plus several real view-
 * function reads for the invariant checks -- see this file's own measured runtime in the task
 * report for why this count, not a larger one, was picked to stay within the "well under 5
 * minutes, ideally 1-3 minutes" budget.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { TestAssetId } from 'fuels/test-utils';

import { setupTestEnvironment, type TestEnvironment } from '../testHarness';
import { runInvariantCampaign } from './driver';

const NUM_RUNS = 6;
const ACTIONS_PER_RUN = 18;
const POOL_SIZE = 6;
const ASSET_ID = TestAssetId.A.value;

describe('Train invariant fuzzing (stateful action sequences, real local node)', () => {
  let env: TestEnvironment;

  before(async () => {
    env = await setupTestEnvironment({
      walletCount: POOL_SIZE,
      assets: [TestAssetId.A],
      // Generous headroom: worst case is every one of NUM_RUNS*ACTIONS_PER_RUN steps being a
      // max-sized create (~600_000) funded by the same unlucky wallet, plus every refund/redeem
      // action's incidental `bumpChainTip` (10 units each) -- both are many orders of magnitude
      // below this per-coin amount, so no wallet can ever run dry mid-campaign.
      amountPerCoin: 5_000_000_000,
    });
  });

  after(() => {
    env.cleanup();
  });

  test(
    `${NUM_RUNS} sequences x up to ${ACTIONS_PER_RUN} actions hold SOLV/CONS/LWF/PAG/SUNIQ throughout (real node, real balances)`,
    async () => {
      const result = await runInvariantCampaign(env, {
        numRuns: NUM_RUNS,
        actionsPerRun: ACTIONS_PER_RUN,
        assetId: ASSET_ID,
        poolSize: POOL_SIZE,
      });

      assert.ok(
        result.totalActionsExecuted >= NUM_RUNS * ACTIONS_PER_RUN * 0.5,
        `expected at least half of the ${NUM_RUNS * ACTIONS_PER_RUN} scheduled steps to actually execute an action ` +
          `(got ${result.totalActionsExecuted}/${result.totalSteps}) -- a much lower ratio would suggest the ` +
          'handlers/preconditions are miscalibrated, not that the invariants held vacuously',
      );
      // Every handler must have fired at least once across the whole campaign -- otherwise this
      // run never actually exercised one of SOLV/CONS/LWF/PAG/SUNIQ's relevant code paths.
      for (const action of ['createUserLock', 'createSolverLock', 'redeemUser', 'redeemSolver', 'refundUser', 'refundSolver']) {
        assert.ok((result.actionCounts[action] ?? 0) > 0, `handler '${action}' never fired across the whole campaign`);
      }

      console.log(
        `invariant campaign: ${result.totalActionsExecuted}/${result.totalSteps} steps executed an action ` +
          `across ${NUM_RUNS} runs, breakdown=${JSON.stringify(result.actionCounts)}, runtime=${result.runtimeMs}ms`,
      );
    },
  );
});
