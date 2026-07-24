/**
 * The invariant checks themselves (SOLV/CONS/LWF/PAG/SIDX -- see `docs/ARCHITECTURE.md`'s
 * invariant table for the one-line description of each). Every function here asserts (via `node:assert/
 * strict`) against REAL on-chain state (`../testHarness`'s view getters, `provider.
 * getContractBalance`, `wallet.getBalance`) -- nothing here is checked against the shadow model
 * alone; the shadow model only supplies the EXPECTED value each real read is compared to.
 */
import assert from 'node:assert/strict';

import { bn } from 'fuels';

import {
  callUserLock,
  getSolverLock,
  getSolverLockCount,
  getUserLock,
  getUserLockHashes,
  getUserLocks,
  identityFromAccount,
  makeDestinationInfo,
  makeUserLockParams,
  type IdentityInput,
  type TestEnvironment,
} from '../testHarness';
import { toBig, type ShadowLockStatus, type ShadowModel } from './shadowModel';

/** A `u64::MAX`-sized `limit` -- the "very large limit" PAG edge case. */
const U64_MAX_STR = '18446744073709551615';

// ───────────────────────────── balance snapshots (CONS) ─────────────────────────────

/** Balances as native `bigint` (NOT `BN`) -- see `shadowModel.ts`'s "SIGNED-DELTA ARITHMETIC
 * NOTE" for why: this snapshot exists specifically so `after - before` can be a correctly SIGNED
 * subtraction, and fuels-ts's `BN.sub` silently returns the unsigned magnitude instead (confirmed
 * empirically: `bn(5).sub(bn(10)).toString() === '5'`, not `'-5'`). */
export interface BalanceSnapshot {
  wallets: bigint[];
  contract: bigint;
}

export async function snapshotBalances(env: TestEnvironment, poolSize: number, assetId: string): Promise<BalanceSnapshot> {
  const wallets = await Promise.all(
    Array.from({ length: poolSize }, (_, i) => env.wallets[i].getBalance(assetId)),
  );
  const contract = await env.provider.getContractBalance(env.train.id, assetId);
  return { wallets: wallets.map(toBig), contract: toBig(contract) };
}

/** CONS: every actor's (and the contract's) balance of the tracked asset must have changed by
 * EXACTLY the amount the action's own accounting expects -- no more, no less, and untouched
 * wallets must show a ZERO delta (an implicit expectation: `expectedDeltas.get(i) ?? 0n`). Plain
 * `bigint` arithmetic throughout -- see this file's `BalanceSnapshot` doc comment for why. */
export function assertConservation(
  before: BalanceSnapshot,
  after: BalanceSnapshot,
  expectedDeltas: Map<number | 'contract', bigint>,
  actionNote: string,
): void {
  for (let i = 0; i < before.wallets.length; i += 1) {
    const expected = expectedDeltas.get(i) ?? 0n;
    const actual = after.wallets[i] - before.wallets[i];
    assert.equal(
      actual.toString(),
      expected.toString(),
      `CONS violated for wallets[${i}] after (${actionNote}): expected delta ${expected.toString()}, actual delta ${actual.toString()}`,
    );
  }
  const expectedContract = expectedDeltas.get('contract') ?? 0n;
  const actualContract = after.contract - before.contract;
  assert.equal(
    actualContract.toString(),
    expectedContract.toString(),
    `CONS violated for the Train contract's balance after (${actionNote}): expected delta ${expectedContract.toString()}, actual delta ${actualContract.toString()}`,
  );
}

// ───────────────────────────── SOLV ─────────────────────────────

/** SOLV: the contract's real balance of `assetId` must equal the shadow model's sum of every
 * currently-Pending lock's obligation (principal + pending reward) in that asset -- no more, no
 * less. */
export async function assertSolvency(
  env: TestEnvironment,
  model: ShadowModel,
  assetId: string,
  actionNote: string,
): Promise<void> {
  const expected = model.totalPendingObligation();
  const actual = await env.provider.getContractBalance(env.train.id, assetId);
  assert.equal(
    actual.toString(),
    expected.toString(),
    `SOLV violated after (${actionNote}): Train contract balance=${actual.toString()} but shadow-model pending obligations=${expected.toString()}`,
  );
}

// ───────────────────────────── LWF ─────────────────────────────

function statusToWireString(status: ShadowLockStatus): string {
  return status; // fuels-ts decodes the `LockStatus` enum to its variant name string directly
}

export async function assertUserLockStatus(
  env: TestEnvironment,
  hashlock: string,
  expectedStatus: ShadowLockStatus,
  actionNote: string,
): Promise<void> {
  const lock = (await getUserLock(env.train, hashlock)) as { status: string } | null;
  assert.ok(
    lock,
    `LWF violated after (${actionNote}): get_user_lock(${hashlock}) returned None for a hashlock this run created (expected status ${expectedStatus})`,
  );
  assert.equal(
    lock.status,
    statusToWireString(expectedStatus),
    `LWF violated after (${actionNote}): hashlock=${hashlock} expected status ${expectedStatus}, on-chain status is ${lock.status}`,
  );
}

export async function assertSolverLockStatus(
  env: TestEnvironment,
  hashlock: string,
  index: number,
  expectedStatus: ShadowLockStatus,
  actionNote: string,
): Promise<void> {
  const lock = (await getSolverLock(env.train, hashlock, index)) as { status: string } | null;
  assert.ok(
    lock,
    `LWF violated after (${actionNote}): get_solver_lock(${hashlock}, ${index}) returned None (expected status ${expectedStatus})`,
  );
  assert.equal(
    lock.status,
    statusToWireString(expectedStatus),
    `LWF violated after (${actionNote}): hashlock=${hashlock} index=${index} expected status ${expectedStatus}, on-chain status is ${lock.status}`,
  );
}

/** LWF's "hashlock squatting is permanent" clause: once a `user_lock`/`user_lock_for` has
 * succeeded under `hashlock` (regardless of its current status -- Pending, Redeemed, or
 * Refunded), every later `user_lock` attempt under that SAME hashlock must revert
 * `SwapAlreadyExists`, forever. Verified here by actually attempting exactly that (a real,
 * expected-to-revert transaction), not by re-relying on the one-shot regression tests already in
 * `trainCore.test.ts`. */
export async function assertSwapAlreadyExists(
  env: TestEnvironment,
  assetId: string,
  hashlock: string,
  actionNote: string,
): Promise<void> {
  const prober = env.wallets[0];
  const identity = identityFromAccount(prober);
  const params = await makeUserLockParams({ hashlock, recipient: identity });
  const dst = makeDestinationInfo();

  await assert.rejects(
    () => callUserLock({ train: env.train, caller: prober, assetId, amount: 1, params, dst }),
    /SwapAlreadyExists/,
    `LWF violated after (${actionNote}): a second user_lock under already-used hashlock=${hashlock} did not revert SwapAlreadyExists`,
  );
}

/** LWF's "never-used hashlock stays Empty" clause: a hashlock nobody has ever created a user
 * lock under must read back as `None` (never a stale/leftover value from unrelated storage). */
export async function assertNeverUsedHashlockIsEmpty(env: TestEnvironment, hashlock: string, actionNote: string): Promise<void> {
  const lock = await getUserLock(env.train, hashlock);
  assert.equal(
    lock,
    null,
    `LWF violated after (${actionNote}): get_user_lock(${hashlock}) for a hashlock NEVER used by this run returned Some, expected None`,
  );
}

// ───────────────────────────── PAG ─────────────────────────────

/** PAG: `get_user_lock_hashes`/`get_user_locks` must never revert for ANY `(offset, limit)`
 * pair, including `offset == total`, `limit == 0`, and a `u64::MAX`-sized `limit`. If either call
 * throws, that throw itself IS the violation -- there is nothing to catch, the test fails with
 * the real error, which is the whole point of this invariant. */
export async function assertPaginationNeverReverts(
  env: TestEnvironment,
  identity: IdentityInput,
  actionNote: string,
): Promise<void> {
  const [, totalRaw] = await getUserLockHashes(env.train, identity, 0, 1_000_000);
  const total = Number(bn(totalRaw as never).toString());

  const combos: Array<[number | string, number | string]> = [
    [0, 0],
    [total, 0],
    [total, 1],
    [total + 7, 10],
    [0, U64_MAX_STR],
    [total, U64_MAX_STR],
  ];

  for (const [offset, limit] of combos) {
    try {
      await getUserLockHashes(env.train, identity, offset, limit);
      await getUserLocks(env.train, identity, offset, limit);
    } catch (err) {
      throw new Error(
        `PAG violated after (${actionNote}): get_user_lock_hashes/get_user_locks reverted for offset=${offset} limit=${limit} (total=${total}): ${String(
          (err as Error).message ?? err,
        )}`,
      );
    }
  }
}

// ───────────────────────────── SIDX ─────────────────────────────

/** SIDX: for a hashlock with `count` solver locks, `get_solver_lock(hashlock, i)` must be `Some`
 * for every `i` in `[1, count]` and `None` for `i = count + 1`. */
export async function assertSolverIndexBounds(
  env: TestEnvironment,
  model: ShadowModel,
  hashlock: string,
  actionNote: string,
): Promise<void> {
  const expectedCount = model.solverLockCount.get(hashlock) ?? 0;
  const actualCount = Number(await getSolverLockCount(env.train, hashlock));
  assert.equal(
    actualCount,
    expectedCount,
    `SIDX violated after (${actionNote}): get_solver_lock_count(${hashlock})=${actualCount}, shadow model expects ${expectedCount}`,
  );

  for (let idx = 1; idx <= expectedCount; idx += 1) {
    const lock = await getSolverLock(env.train, hashlock, idx);
    assert.ok(
      lock,
      `SIDX violated after (${actionNote}): get_solver_lock(${hashlock}, ${idx}) returned None, but 1 <= ${idx} <= count=${expectedCount}`,
    );
  }

  const beyond = await getSolverLock(env.train, hashlock, expectedCount + 1);
  assert.equal(
    beyond,
    null,
    `SIDX violated after (${actionNote}): get_solver_lock(${hashlock}, ${expectedCount + 1}) returned Some, expected None (count=${expectedCount})`,
  );
}
