/**
 * The invariant checks themselves (SOLV/CONS/LWF/PAG/SUNIQ -- see `docs/ARCHITECTURE.md`'s
 * invariant table for the one-line description of each). Every function here asserts (via `node:assert/
 * strict`) against REAL on-chain state (`../testHarness`'s view getters, `provider.
 * getContractBalance`, `wallet.getBalance`) -- nothing here is checked against the shadow model
 * alone; the shadow model only supplies the EXPECTED value each real read is compared to.
 */
import assert from 'node:assert/strict';

import { bn } from 'fuels';

import {
  callSolverLock,
  callUserLock,
  getSolverLock,
  getUserLock,
  getUserLockHashes,
  getUserLocks,
  identityFromAccount,
  identityFromAddress,
  makeDestinationInfo,
  makeSolverLockParams,
  makeUserLockParams,
  randomHashlock,
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
  solverIdx: number,
  expectedStatus: ShadowLockStatus,
  actionNote: string,
): Promise<void> {
  const solver = identityFromAccount(env.wallets[solverIdx]);
  const lock = (await getSolverLock(env.train, hashlock, solver)) as { status: string } | null;
  assert.ok(
    lock,
    `LWF violated after (${actionNote}): get_solver_lock(${hashlock}, wallets[${solverIdx}]) returned None (expected status ${expectedStatus})`,
  );
  assert.equal(
    lock.status,
    statusToWireString(expectedStatus),
    `LWF violated after (${actionNote}): hashlock=${hashlock} solver=wallets[${solverIdx}] expected status ${expectedStatus}, on-chain status is ${lock.status}`,
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

// ───────────────────────────── SUNIQ ─────────────────────────────

/** SUNIQ: solver locks are keyed by `(hashlock, solver identity)`, at most ONE per key, EVER.
 * Verified three ways against real chain state:
 *   1. every (hashlock, solver) the shadow model knows about reads back `Some` -- and the
 *      identity-keyed read returns THAT solver's own lock (`sender` round-trips);
 *   2. an identity that never locked under `hashlock` reads back `None` (the solver's
 *      idempotency probe: "did my lock land?");
 *   3. a REAL duplicate `solver_lock` attempt by the touched lock's own creator reverts
 *      `SolverLockAlreadyExists` -- probed with an actual expected-to-revert call (mirroring
 *      `assertSwapAlreadyExists`), regardless of the lock's current status, since the guard is
 *      permanent (never lifted by refund or redeem). */
export async function assertSolverLockUniqueness(
  env: TestEnvironment,
  model: ShadowModel,
  assetId: string,
  hashlock: string,
  touchedSolverIdx: number,
  actionNote: string,
): Promise<void> {
  const bySolver = model.solverLocks.get(hashlock) ?? new Map();

  // (1) every known (hashlock, solver) is Some, and attributed to the right solver.
  for (const solverIdx of bySolver.keys()) {
    const wallet = env.wallets[solverIdx];
    const lock = (await getSolverLock(env.train, hashlock, identityFromAccount(wallet))) as {
      sender: { Address?: { bits: string }; ContractId?: { bits: string } };
    } | null;
    assert.ok(
      lock,
      `SUNIQ violated after (${actionNote}): get_solver_lock(${hashlock}, wallets[${solverIdx}]) returned None for a lock this run created`,
    );
    const senderBits = (lock.sender.Address?.bits ?? lock.sender.ContractId?.bits ?? '').toLowerCase();
    assert.equal(
      senderBits,
      wallet.address.toB256().toLowerCase(),
      `SUNIQ violated after (${actionNote}): get_solver_lock(${hashlock}, wallets[${solverIdx}]).sender is not wallets[${solverIdx}] itself`,
    );
  }

  // (2) a never-used identity reads back None under this same hashlock.
  const neverLocked = await getSolverLock(env.train, hashlock, identityFromAddress(randomHashlock()));
  assert.equal(
    neverLocked,
    null,
    `SUNIQ violated after (${actionNote}): get_solver_lock(${hashlock}, <never-used identity>) returned Some, expected None`,
  );

  // (3) the permanent one-per-(hashlock, solver) guard: a real duplicate attempt by the touched
  // lock's creator must revert SolverLockAlreadyExists, whatever the lock's status is now.
  const dupSolver = env.wallets[touchedSolverIdx];
  const dupParams = makeSolverLockParams({
    hashlock,
    recipient: identityFromAccount(dupSolver),
    assetId,
  });
  await assert.rejects(
    () =>
      callSolverLock({
        train: env.train,
        caller: dupSolver,
        assetId,
        amount: 1,
        params: dupParams,
        dst: makeDestinationInfo(),
      }),
    /SolverLockAlreadyExists/,
    `SUNIQ violated after (${actionNote}): a second solver_lock by wallets[${touchedSolverIdx}] under already-used hashlock=${hashlock} did not revert SolverLockAlreadyExists`,
  );
}
