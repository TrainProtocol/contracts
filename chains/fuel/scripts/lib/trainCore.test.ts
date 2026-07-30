/**
 * Exhaustive core-logic test suite for the `Train` contract (`train/src/main.sw`), run against a
 * real local `fuel-core` node via `./testHarness`'s `setupTestEnvironment`.
 *
 * Scope: `user_lock`/`user_lock_for`/`solver_lock`/`redeem_user`/`redeem_solver`/`refund_user`/
 * `refund_solver`/the payout-curve path/the paginated getters.
 *
 * ONE SHARED NODE FOR THE WHOLE FILE: launching a fresh `fuel-core` per test is what
 * `sponsoredTx.test.ts` does, but this file has ~35 test cases, so a
 * single shared `TestEnvironment` (via `describe`'s `before`/`after`) is used instead purely for
 * runtime -- every test still asserts against real on-chain state from a real node, just without
 * paying node-launch cost per test. Cross-test isolation is achieved by using a fresh
 * `randomHashlock()` (and, for pagination tests, a fresh synthetic `Identity` that owns no
 * wallet -- attribution is purely a label, see `user_lock_for`'s doc comment) in every test, so
 * no two tests ever read/write the same storage key.
 *
 * REAL-WALL-CLOCK TIMELOCKS -- discovered empirically while writing this file, not assumed:
 * `std::block::timestamp()` (TAI64) genuinely tracks the host's real clock at the moment a
 * transaction is actually *committed* on this test node (`--poa-instant`), confirmed by locking
 * twice with a real 5-second sleep in between and observing the two `start_time`s differ by
 * exactly 5. HOWEVER, a `.call()`'s pre-flight dry run (`Provider.assembleTx`, used to estimate
 * gas before ever submitting) evaluates `timestamp()` against the *chain tip's last committed
 * block time*, not real "now" at simulation time -- so merely sleeping past a timelock and then
 * immediately retrying the same call still dry-run-fails, because no new block has been
 * committed in between to move the tip forward. The fix (`advanceRealTimePast` below): sleep
 * past the deadline, then commit one throwaway *successful* transaction first (which the node
 * timestamps with real "now" on commit) -- only then does a subsequent dry run see a tip time
 * past the boundary. Without this, every "redeem/refund after the timelock" test in this file
 * would flake or fail outright.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { bn, sha256 as fuelSha256 } from 'fuels';
import { TestAssetId } from 'fuels/test-utils';
import * as crypto from 'node:crypto';

import {
  callAttachSolverReward,
  callRedeemSolver,
  callRedeemUser,
  callRefundSolver,
  callRefundUser,
  callSolverLock,
  callUserLock,
  callUserLockFor,
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
  setupTestEnvironment,
  solverLockWithAttachedReward,
  type TestEnvironment,
} from './testHarness';

const ASSET = TestAssetId.A.value;
const ASSET_B = TestAssetId.B.value;
const ZERO_ADDRESS = `0x${'00'.repeat(32)}`;
const U64_MAX = '18446744073709551615'; // 2^64 - 1

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A fresh random `Identity::Address` that owns no wallet/UTXOs -- valid for anything that's
 * purely attributive (a `user_lock_for` `user`, a pagination-test owner key), never for
 * something that must actually sign or fund a call. */
function randomIdentity() {
  return identityFromAddress(randomHashlock());
}

/** A real secret/hashlock pair: `secretArg` is the exact decimal-string `u256` `redeem_user`/
 * `redeem_solver` expect, `hashlock` is `sha256(secret)` as the 32-byte big-endian value the
 * contract computes it over (mirrors `harnessSmoke.test.ts`'s approach, generalized to a full
 * random 32-byte secret rather than an 8-byte one). */
function makeSecretPair(): { secretArg: string; hashlock: string } {
  const secretBytes = crypto.randomBytes(32);
  const hashlock = fuelSha256(secretBytes);
  const secretArg = bn(`0x${secretBytes.toString('hex')}`).toString();
  return { secretArg, hashlock };
}

/**
 * Sleeps past a timelock boundary, then commits one throwaway *successful* `user_lock` (from
 * `env.wallets[BUMP_WALLET]`, a trivial amount, never asserted on) to force the chain tip's
 * committed block time to real "now" -- see the file-level doc comment's "REAL-WALL-CLOCK
 * TIMELOCKS" note for why this second step is load-bearing, not optional.
 */
async function advanceRealTimePast(env: TestEnvironment, ms: number): Promise<void> {
  await sleep(ms);
  const bumpWallet = env.wallets[BUMP_WALLET];
  const bumpParams = await makeUserLockParams({
    hashlock: randomHashlock(),
    recipient: identityFromAccount(bumpWallet),
  });
  await callUserLock({
    train: env.train,
    caller: bumpWallet,
    assetId: ASSET,
    amount: 10,
    params: bumpParams,
    dst: makeDestinationInfo(),
  });
}

// Wallet role assignments (shared across every test in this file; see the file-level doc
// comment for why one shared environment is used).
const USER_A = 0;
const USER_B = 1;
const USER_C = 2;
const FUNDER_D = 3;
const BUMP_WALLET = 4;
const SPARE_E = 5;

async function assertReverts(fn: () => Promise<unknown>, errorVariant: string, message: string) {
  await assert.rejects(fn, new RegExp(errorVariant), message);
}

describe('Train core', () => {
  let env: TestEnvironment;

  before(async () => {
    env = await setupTestEnvironment({ walletCount: 6, assets: [TestAssetId.A, TestAssetId.B] });
  });

  after(() => {
    env.cleanup();
  });

  // ───────────────────────────── Happy paths ─────────────────────────────

  test('user_lock -> get_user_lock returns every field written', async () => {
    const user = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const refundTo = env.wallets[USER_C];
    const hashlock = randomHashlock();
    const amount = 321_000;

    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      refundTo: identityFromAccount(refundTo),
      timelockDelta: 5000,
    });
    const dst = makeDestinationInfo();

    const locked = await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount, params, dst });
    assert.equal(locked.value, hashlock);

    const lock = (await getUserLock(env.train, hashlock)) as {
      secret: unknown;
      amount: unknown;
      sender: { Address: { bits: string } };
      timelock: unknown;
      start_time: unknown;
      status: string;
      recipient: { Address: { bits: string } };
      refund_to: { Address: { bits: string } };
      asset_id: { bits: string };
      payout_curve: unknown;
      payout_curve_data: unknown;
    } | null;
    assert.ok(lock, 'lock must exist');
    assert.equal(bn(lock.secret as never).toString(), '0', 'secret must be 0 before redemption');
    assert.equal(bn(lock.amount as never).toString(), String(amount));
    assert.equal(lock.sender.Address.bits.toLowerCase(), user.address.toB256().toLowerCase());
    assert.equal(lock.status, 'Pending');
    assert.equal(lock.recipient.Address.bits.toLowerCase(), recipient.address.toB256().toLowerCase());
    assert.equal(lock.refund_to.Address.bits.toLowerCase(), refundTo.address.toB256().toLowerCase());
    assert.equal(lock.asset_id.bits.toLowerCase(), ASSET.toLowerCase());
    assert.ok(!lock.payout_curve, 'no payout_curve was set');
    assert.ok(!lock.payout_curve_data, 'no payout_curve_data was set');
    // timelock == start_time + timelock_delta
    assert.equal(
      bn(lock.timelock as never).toString(),
      bn(lock.start_time as never).add(bn(5000)).toString(),
    );
  });

  test('redeem_user with the correct secret succeeds, transfers the full amount to recipient, and a second redeem_user fails LockNotPending', async () => {
    const user = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const { secretArg, hashlock } = makeSecretPair();
    const amount = 654_321;

    const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(recipient) });
    await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount, params, dst: makeDestinationInfo() });

    const recipientBefore = await recipient.getBalance(ASSET);
    const redeemed = await callRedeemUser(env.train, user, hashlock, secretArg);
    assert.equal(redeemed.value, true);

    const recipientAfter = await recipient.getBalance(ASSET);
    assert.equal(
      recipientAfter.sub(recipientBefore).toString(),
      String(amount),
      'recipient must receive exactly the full locked amount',
    );

    const lock = (await getUserLock(env.train, hashlock)) as { status: string; secret: unknown } | null;
    assert.ok(lock);
    assert.equal(lock.status, 'Redeemed');
    assert.equal(bn(lock.secret as never).toString(), bn(secretArg).toString());

    await assertReverts(
      () => callRedeemUser(env.train, user, hashlock, secretArg),
      'LockNotPending',
      'redeeming an already-redeemed lock must fail LockNotPending',
    );
  });

  test('user_lock_for attributes sender to `user` (funded by a different caller) and shows up in get_user_lock_hashes(user)', async () => {
    const funder = env.wallets[FUNDER_D];
    const attributedUser = randomIdentity();
    const hashlock = randomHashlock();
    const amount = 111_000;

    const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(funder) });
    const locked = await callUserLockFor({
      train: env.train,
      caller: funder,
      user: attributedUser,
      assetId: ASSET,
      amount,
      params,
      dst: makeDestinationInfo(),
    });
    assert.equal(locked.value, hashlock);

    const lock = (await getUserLock(env.train, hashlock)) as { sender: { Address: { bits: string } } } | null;
    assert.ok(lock);
    assert.equal(
      lock.sender.Address.bits.toLowerCase(),
      (attributedUser as { Address: { bits: string } }).Address.bits.toLowerCase(),
      'sender must be the attributed user, not the funding caller',
    );

    const [hashes, total] = await getUserLockHashes(env.train, attributedUser, 0, 100);
    assert.ok(total >= 1);
    assert.ok(
      hashes.some((h) => h.toLowerCase() === hashlock.toLowerCase()),
      'get_user_lock_hashes(attributedUser) must include the newly created hashlock',
    );
  });

  test('solver_lock same-asset reward split: correct amount/reward keyed by (hashlock, solver), and a DIFFERENT solver can still lock the same hashlock', async () => {
    const solver = env.wallets[USER_A];
    const otherSolver = env.wallets[SPARE_E];
    const recipient = env.wallets[USER_B];
    const rewardRecipient = env.wallets[USER_C];
    const hashlock = randomHashlock();
    const principal = 200_000;
    const reward = 5_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward,
      rewardRecipient: identityFromAccount(rewardRecipient),
      timelockDelta: 3600,
      rewardTimelockDelta: 1800,
    });
    await callSolverLock({
      train: env.train,
      caller: solver,
      assetId: ASSET,
      amount: principal + reward,
      params,
      dst: makeDestinationInfo(),
    });

    const lock1 = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as {
      amount: unknown;
      reward: unknown;
      sender: { Address: { bits: string } };
    } | null;
    assert.ok(lock1, 'the lock must be readable under (hashlock, solver identity)');
    assert.equal(bn(lock1.amount as never).toString(), String(principal));
    assert.equal(bn(lock1.reward as never).toString(), String(reward));
    assert.equal(lock1.sender.Address.bits.toLowerCase(), solver.address.toB256().toLowerCase());

    // Second solver lock under the SAME hashlock from a DIFFERENT solver -- multi-solver fill
    // is preserved: each solver gets its own (hashlock, solver) slot.
    const params2 = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward: 0,
      timelockDelta: 3600,
    });
    await callSolverLock({
      train: env.train,
      caller: otherSolver,
      assetId: ASSET,
      amount: 50_000,
      params: params2,
      dst: makeDestinationInfo(),
    });

    const lock2 = (await getSolverLock(env.train, hashlock, identityFromAccount(otherSolver))) as {
      amount: unknown;
      reward: unknown;
    } | null;
    assert.ok(lock2, 'a different solver must be able to lock under the same hashlock');
    assert.equal(bn(lock2.amount as never).toString(), '50000');
    assert.equal(bn(lock2.reward as never).toString(), '0');

    // The first solver's lock is untouched by the second solver's.
    const lock1Again = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as {
      amount: unknown;
    } | null;
    assert.ok(lock1Again);
    assert.equal(bn(lock1Again.amount as never).toString(), String(principal));
  });

  // ─────────────── Per-solver uniqueness guard (retry/replay safety) ───────────────

  test('SolverLockAlreadyExists: a duplicate solver_lock by the same solver reverts, and the reverted attempt moves none of the solver funds', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const principal = 60_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      timelockDelta: 3600,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });

    // The blind-retry shape: the exact same call again (same params, same solver).
    const solverBalanceBefore = await solver.getBalance(ASSET);
    await assertReverts(
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() }),
      'SolverLockAlreadyExists',
      'a second solver_lock by the same solver under the same hashlock must revert SolverLockAlreadyExists',
    );
    const solverBalanceAfter = await solver.getBalance(ASSET);
    assert.equal(
      solverBalanceAfter.sub(solverBalanceBefore).toString(),
      '0',
      'the reverted duplicate must not move any of the solver locked-asset funds (retry cannot double-fund)',
    );

    // The stored lock is exactly the first one, untouched.
    const lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as {
      amount: unknown;
      status: string;
    } | null;
    assert.ok(lock);
    assert.equal(bn(lock.amount as never).toString(), String(principal));
    assert.equal(lock.status, 'Pending');
  });

  test('SolverLockAlreadyExists: re-lock by the same solver STILL reverts after refund_solver -- the guard is permanent, a re-fill needs a different identity', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const principal = 12_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      refundTo: identityFromAccount(solver),
      timelockDelta: 3,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });

    await advanceRealTimePast(env, 4000);
    const refunded = await callRefundSolver(env.train, solver, hashlock, identityFromAccount(solver));
    assert.equal(refunded.value, true);
    const lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as { status: string } | null;
    assert.ok(lock);
    assert.equal(lock.status, 'Refunded');

    await assertReverts(
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() }),
      'SolverLockAlreadyExists',
      're-locking a refunded (hashlock, solver) slot must still revert -- refund never lifts the guard',
    );

    // A deliberate re-fill of the same hashlock IS possible -- from a different solver identity.
    const otherSolver = env.wallets[SPARE_E];
    const refillParams = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      timelockDelta: 3600,
    });
    await callSolverLock({ train: env.train, caller: otherSolver, assetId: ASSET, amount: principal, params: refillParams, dst: makeDestinationInfo() });
    const refill = (await getSolverLock(env.train, hashlock, identityFromAccount(otherSolver))) as { status: string } | null;
    assert.ok(refill, 'a different solver identity must be able to re-fill the refunded hashlock');
    assert.equal(refill.status, 'Pending');
  });

  test('SolverLockAlreadyExists: re-lock by the same solver reverts after redeem_solver too', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const { secretArg, hashlock } = makeSecretPair();
    const principal = 7_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      timelockDelta: 3600,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });
    await callRedeemSolver(env.train, solver, hashlock, identityFromAccount(solver), secretArg);

    await assertReverts(
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() }),
      'SolverLockAlreadyExists',
      're-locking a redeemed (hashlock, solver) slot must still revert -- redeem never lifts the guard',
    );
  });

  test('get_solver_lock for an identity that never locked returns none (the solver idempotency probe)', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();

    // Probe before anyone locks: nothing under (hashlock, solver).
    assert.equal(
      await getSolverLock(env.train, hashlock, identityFromAccount(solver)),
      null,
      'a never-locked (hashlock, solver) must read back as none',
    );

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      timelockDelta: 3600,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 5_000, params, dst: makeDestinationInfo() });

    // The probe flips for the solver that locked...
    assert.ok(await getSolverLock(env.train, hashlock, identityFromAccount(solver)));
    // ...but stays none for any identity that never locked under this hashlock.
    assert.equal(
      await getSolverLock(env.train, hashlock, randomIdentity()),
      null,
      'an identity that never locked must still read back as none under a hashlock with other locks',
    );
    assert.equal(
      await getSolverLock(env.train, hashlock, identityFromAccount(env.wallets[USER_C])),
      null,
      'another wallet that never locked must also read back as none',
    );
  });

  test('redeem_solver BEFORE reward_timelock sends the reward to reward_recipient', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const rewardRecipient = env.wallets[USER_C];
    const { secretArg, hashlock } = makeSecretPair();
    const principal = 80_000;
    const reward = 4_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward,
      rewardRecipient: identityFromAccount(rewardRecipient),
      timelockDelta: 3600,
      rewardTimelockDelta: 1800, // far in the future -- redeeming "now" is well before it
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal + reward, params, dst: makeDestinationInfo() });

    const recipientBefore = await recipient.getBalance(ASSET);
    const rewardRecipientBefore = await rewardRecipient.getBalance(ASSET);
    const redeemerBefore = await solver.getBalance(ASSET); // redeemer == solver here, distinct from rewardRecipient

    const redeemed = await callRedeemSolver(env.train, solver, hashlock, identityFromAccount(solver), secretArg);
    assert.equal(redeemed.value, true);

    const recipientAfter = await recipient.getBalance(ASSET);
    const rewardRecipientAfter = await rewardRecipient.getBalance(ASSET);

    assert.equal(recipientAfter.sub(recipientBefore).toString(), String(principal));
    assert.equal(
      rewardRecipientAfter.sub(rewardRecipientBefore).toString(),
      String(reward),
      'reward must go to reward_recipient when redeemed before reward_timelock',
    );

    const lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as { status: string } | null;
    assert.ok(lock);
    assert.equal(lock.status, 'Redeemed');
  });

  test('redeem_solver AT-OR-AFTER reward_timelock sends the reward to whoever calls redeem (keeper bounty)', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const rewardRecipient = env.wallets[USER_C];
    const keeper = env.wallets[SPARE_E]; // redeemer != reward_recipient, proves the bounty really rerouted
    const { secretArg, hashlock } = makeSecretPair();
    const principal = 60_000;
    const reward = 3_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward,
      rewardRecipient: identityFromAccount(rewardRecipient),
      timelockDelta: 3600, // long enough that the overall lock timelock never interferes
      rewardTimelockDelta: 3, // short -- we'll sleep past this real-time boundary
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal + reward, params, dst: makeDestinationInfo() });

    await advanceRealTimePast(env, 4000);

    const rewardRecipientBefore = await rewardRecipient.getBalance(ASSET);
    const keeperBefore = await keeper.getBalance(ASSET);

    const redeemed = await callRedeemSolver(env.train, keeper, hashlock, identityFromAccount(solver), secretArg);
    assert.equal(redeemed.value, true);

    const rewardRecipientAfter = await rewardRecipient.getBalance(ASSET);
    const keeperAfter = await keeper.getBalance(ASSET);

    assert.equal(
      rewardRecipientAfter.sub(rewardRecipientBefore).toString(),
      '0',
      'reward_recipient must receive NOTHING once reward_timelock has passed',
    );
    assert.equal(
      keeperAfter.sub(keeperBefore).toString(),
      String(reward),
      'the redeemer (keeper) must receive the reward once reward_timelock has passed',
    );
  });

  test('refund_user: recipient can refund before timelock expires', async () => {
    const recipient = env.wallets[USER_A];
    const hashlock = randomHashlock();
    const amount = 42_000;

    const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(recipient), timelockDelta: 3600 });
    await callUserLock({ train: env.train, caller: recipient, assetId: ASSET, amount, params, dst: makeDestinationInfo() });

    const before_ = await recipient.getBalance(ASSET);
    const refunded = await callRefundUser(env.train, recipient, hashlock);
    assert.equal(refunded.value, true);
    const after_ = await recipient.getBalance(ASSET);
    assert.equal(after_.sub(before_).toString(), String(amount));

    const lock = (await getUserLock(env.train, hashlock)) as { status: string } | null;
    assert.ok(lock);
    assert.equal(lock.status, 'Refunded');
  });

  test('refund_user: a non-recipient cannot refund early (RefundNotAllowed) but CAN refund after timelock expires', async () => {
    const recipient = env.wallets[USER_A];
    const nonRecipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const amount = 33_000;

    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      refundTo: identityFromAccount(recipient),
      timelockDelta: 3,
    });
    await callUserLock({ train: env.train, caller: recipient, assetId: ASSET, amount, params, dst: makeDestinationInfo() });

    await assertReverts(
      () => callRefundUser(env.train, nonRecipient, hashlock),
      'RefundNotAllowed',
      'a non-recipient must not be able to refund before the timelock expires',
    );

    await advanceRealTimePast(env, 4000);

    const before_ = await recipient.getBalance(ASSET); // refund_to == recipient here
    const refunded = await callRefundUser(env.train, nonRecipient, hashlock);
    assert.equal(refunded.value, true, 'a non-recipient must be able to refund once the timelock has expired');
    const after_ = await recipient.getBalance(ASSET);
    assert.equal(after_.sub(before_).toString(), String(amount));
  });

  test('refund_solver: NOBODY (not even the recipient) can refund before the timelock -- asymmetric vs refund_user', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const principal = 20_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      timelockDelta: 3600,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });

    // Even the lock's own `recipient` (who WOULD be allowed to early-refund a user lock) cannot
    // early-refund a solver lock -- there is no early-recipient carve-out for solver locks.
    await assertReverts(
      () => callRefundSolver(env.train, recipient, hashlock, identityFromAccount(solver)),
      'RefundNotAllowed',
      'the recipient must not get an early-refund path on a solver lock',
    );
    await assertReverts(
      () => callRefundSolver(env.train, solver, hashlock, identityFromAccount(solver)),
      'RefundNotAllowed',
      'not even the solver (sender) gets an early-refund path',
    );
  });

  test('refund_solver: anyone can refund after the timelock expires', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const anyone = env.wallets[SPARE_E];
    const hashlock = randomHashlock();
    const principal = 15_000;
    const reward = 1_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward,
      rewardRecipient: identityFromAccount(recipient),
      refundTo: identityFromAccount(solver),
      timelockDelta: 3,
      rewardTimelockDelta: 1,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal + reward, params, dst: makeDestinationInfo() });

    await advanceRealTimePast(env, 4000);

    const solverBefore = await solver.getBalance(ASSET);
    const refunded = await callRefundSolver(env.train, anyone, hashlock, identityFromAccount(solver));
    assert.equal(refunded.value, true, 'any caller must be able to refund a solver lock once its timelock has expired');
    const solverAfter = await solver.getBalance(ASSET);
    assert.equal(
      solverAfter.sub(solverBefore).toString(),
      String(principal + reward),
      'refund_to (the solver here) must receive amount + reward (same-asset reward path)',
    );

    const lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as { status: string } | null;
    assert.ok(lock);
    assert.equal(lock.status, 'Refunded');
  });

  test('payout curve happy path (ConstantPayoutCurve, identity curve): payout equals the full amount, zero excess', async () => {
    const user = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const { secretArg, hashlock } = makeSecretPair();
    const amount = 77_000;

    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      refundTo: identityFromAccount(user),
      payoutCurve: { bits: env.payoutCurve.id.toB256() },
    });
    await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount, params, dst: makeDestinationInfo() });

    const lockBefore = (await getUserLock(env.train, hashlock)) as { payout_curve: unknown } | null;
    assert.ok(lockBefore);
    assert.ok(lockBefore.payout_curve, 'payout_curve must be set on the stored lock');

    const recipientBefore = await recipient.getBalance(ASSET);
    const refundToBefore = await user.getBalance(ASSET);

    const redeemed = await callRedeemUser(env.train, user, hashlock, secretArg);
    assert.equal(redeemed.value, true);

    const recipientAfter = await recipient.getBalance(ASSET);
    const refundToAfter = await user.getBalance(ASSET);

    assert.equal(
      recipientAfter.sub(recipientBefore).toString(),
      String(amount),
      'the identity curve must pay out the full amount unchanged',
    );
    // refund_to's balance may move slightly due to this same tx's own gas fee if refund_to ==
    // caller and gas is paid in a different asset -- but the LOCKED asset excess-transfer to
    // refund_to must be exactly zero, so refund_to's balance in the locked asset should be
    // unchanged (no excess transfer occurred).
    assert.equal(
      refundToAfter.sub(refundToBefore).toString(),
      '0',
      'zero excess: refund_to must receive nothing in the locked asset',
    );
  });

  // ─────────────────── Different-asset solver reward (two-step funding) ───────────────────

  test('different-asset reward (two-step): principal in A, reward attached in B, redeem_solver pays both to the right recipients', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const rewardRecipient = env.wallets[USER_C];
    const { secretArg, hashlock } = makeSecretPair();
    const principal = 120_000;
    const reward = 9_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward,
      rewardAssetId: ASSET_B,
      rewardRecipient: identityFromAccount(rewardRecipient),
      timelockDelta: 3600,
      rewardTimelockDelta: 1800, // reward_timelock far ahead -> reward routes to reward_recipient
    });

    // Step 1: solver_lock forwards the PRINCIPAL ONLY (asset A). Reward is declared but unfunded.
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });

    let lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as {
      amount: unknown; reward: unknown; reward_funded: boolean; reward_asset_id: { bits: string };
    } | null;
    assert.ok(lock);
    assert.equal(bn(lock.amount as never).toString(), String(principal), 'principal is the whole forwarded coin (reward not subtracted)');
    assert.equal(bn(lock.reward as never).toString(), String(reward));
    assert.equal(lock.reward_funded, false, 'reward must be unfunded until attach');
    assert.equal(lock.reward_asset_id.bits.toLowerCase(), ASSET_B.toLowerCase());

    // Step 2: attach the reward in asset B.
    const attached = await callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward, rewardAssetId: ASSET_B });
    assert.equal(attached.value, true);

    lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as never;
    assert.equal((lock as { reward_funded: boolean }).reward_funded, true, 'reward_funded flips true after attach');

    // Redeem before reward_timelock -> recipient gets principal in A, reward_recipient gets reward in B.
    const recipientBeforeA = await recipient.getBalance(ASSET);
    const rewardRecipientBeforeB = await rewardRecipient.getBalance(ASSET_B);

    const redeemed = await callRedeemSolver(env.train, solver, hashlock, identityFromAccount(solver), secretArg);
    assert.equal(redeemed.value, true);

    assert.equal((await recipient.getBalance(ASSET)).sub(recipientBeforeA).toString(), String(principal), 'recipient receives the principal in asset A');
    assert.equal((await rewardRecipient.getBalance(ASSET_B)).sub(rewardRecipientBeforeB).toString(), String(reward), 'reward_recipient receives the reward in asset B');
  });

  test('different-asset reward via atomic multicall helper: solver_lock(A) + attach_solver_reward(B) in one transaction', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const rewardRecipient = env.wallets[USER_C];
    const hashlock = randomHashlock();
    const principal = 88_000;
    const reward = 6_000;

    const params = makeSolverLockParams({
      hashlock,
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward,
      rewardAssetId: ASSET_B,
      rewardRecipient: identityFromAccount(rewardRecipient),
      timelockDelta: 3600,
      rewardTimelockDelta: 1800,
    });

    const res = await solverLockWithAttachedReward({
      train: env.train, caller: solver, assetId: ASSET, amount: principal,
      rewardAssetId: ASSET_B, reward, params, dst: makeDestinationInfo(),
    });
    assert.equal(res.value[1], true, 'attach_solver_reward returns true');

    const lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as { reward_funded: boolean; amount: unknown; reward: unknown } | null;
    assert.ok(lock);
    assert.equal(lock.reward_funded, true, 'both calls committed atomically -> reward_funded true');
    assert.equal(bn(lock.amount as never).toString(), String(principal));
    assert.equal(bn(lock.reward as never).toString(), String(reward));
  });

  test('RewardAssetMismatch: attaching the WRONG asset reverts', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const params = makeSolverLockParams({
      hashlock, recipient: identityFromAccount(recipient), assetId: ASSET,
      reward: 5_000, rewardAssetId: ASSET_B, rewardRecipient: identityFromAccount(recipient),
      timelockDelta: 3600, rewardTimelockDelta: 1800,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 50_000, params, dst: makeDestinationInfo() });

    await assertReverts(
      // Correct amount but WRONG asset (A instead of the declared B).
      () => callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward: 5_000, rewardAssetId: ASSET }),
      'RewardAssetMismatch',
      'attaching the wrong asset must revert RewardAssetMismatch',
    );
  });

  test('RewardAssetMismatch: attaching the WRONG amount reverts', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const params = makeSolverLockParams({
      hashlock, recipient: identityFromAccount(recipient), assetId: ASSET,
      reward: 5_000, rewardAssetId: ASSET_B, rewardRecipient: identityFromAccount(recipient),
      timelockDelta: 3600, rewardTimelockDelta: 1800,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 50_000, params, dst: makeDestinationInfo() });

    await assertReverts(
      // Correct asset (B) but WRONG amount (declared reward is 5_000).
      () => callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward: 4_999, rewardAssetId: ASSET_B }),
      'RewardAssetMismatch',
      'attaching the wrong amount must revert RewardAssetMismatch',
    );
  });

  test('RewardAlreadyFunded: attaching twice reverts on the second attach', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const reward = 3_000;
    const params = makeSolverLockParams({
      hashlock, recipient: identityFromAccount(recipient), assetId: ASSET,
      reward, rewardAssetId: ASSET_B, rewardRecipient: identityFromAccount(recipient),
      timelockDelta: 3600, rewardTimelockDelta: 1800,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 40_000, params, dst: makeDestinationInfo() });

    const first = await callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward, rewardAssetId: ASSET_B });
    assert.equal(first.value, true);

    await assertReverts(
      () => callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward, rewardAssetId: ASSET_B }),
      'RewardAlreadyFunded',
      'a second attach on an already-funded lock must revert RewardAlreadyFunded',
    );
  });

  test('RewardAlreadyFunded: attaching to a SAME-asset lock (reward funded at creation) reverts', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const hashlock = randomHashlock();
    const reward = 2_000;
    // Same-asset reward -> reward_funded true at creation, no attach allowed.
    const params = makeSolverLockParams({
      hashlock, recipient: identityFromAccount(recipient), assetId: ASSET,
      reward, rewardRecipient: identityFromAccount(recipient),
      timelockDelta: 3600, rewardTimelockDelta: 1800,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 30_000 + reward, params, dst: makeDestinationInfo() });

    const lock = (await getSolverLock(env.train, hashlock, identityFromAccount(solver))) as { reward_funded: boolean } | null;
    assert.ok(lock);
    assert.equal(lock.reward_funded, true, 'same-asset reward is funded at creation');

    await assertReverts(
      () => callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward, rewardAssetId: ASSET }),
      'RewardAlreadyFunded',
      'attaching to a same-asset (already-funded) lock must revert RewardAlreadyFunded',
    );
  });

  test('LockNotFound: attach on a nonexistent (hashlock, solver) reverts', async () => {
    const solver = env.wallets[USER_A];
    const hashlock = randomHashlock(); // never locked
    await assertReverts(
      () => callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward: 1_000, rewardAssetId: ASSET_B }),
      'LockNotFound',
      'attach on a never-created solver lock must revert LockNotFound',
    );
  });

  test('LockNotPending: attach on a non-Pending (already redeemed) lock reverts, and that redeem paid only the principal', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const rewardRecipient = env.wallets[USER_C];
    const { secretArg, hashlock } = makeSecretPair();
    const principal = 45_000;
    const reward = 5_000;
    const params = makeSolverLockParams({
      hashlock, recipient: identityFromAccount(recipient), assetId: ASSET,
      reward, rewardAssetId: ASSET_B, rewardRecipient: identityFromAccount(rewardRecipient),
      timelockDelta: 3600, rewardTimelockDelta: 1800,
    });
    // Locked but reward NEVER attached (reward_funded stays false).
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });

    // Redeem with the unfunded reward -> only the principal moves; nothing in asset B.
    const recipientBeforeA = await recipient.getBalance(ASSET);
    const rewardRecipientBeforeB = await rewardRecipient.getBalance(ASSET_B);
    const redeemed = await callRedeemSolver(env.train, solver, hashlock, identityFromAccount(solver), secretArg);
    assert.equal(redeemed.value, true);
    assert.equal((await recipient.getBalance(ASSET)).sub(recipientBeforeA).toString(), String(principal), 'principal paid to recipient in asset A');
    assert.equal((await rewardRecipient.getBalance(ASSET_B)).sub(rewardRecipientBeforeB).toString(), '0', 'no reward paid for an unfunded reward');

    // Lock is now Redeemed -> attach must reject on state, not on asset/amount.
    await assertReverts(
      () => callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward, rewardAssetId: ASSET_B }),
      'LockNotPending',
      'attach on an already-redeemed lock must revert LockNotPending',
    );
  });

  test('refund_solver with an UNFUNDED reward refunds only the principal (no asset-B transfer)', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const refundTo = env.wallets[USER_C];
    const hashlock = randomHashlock();
    const principal = 25_000;
    const reward = 4_000;
    const params = makeSolverLockParams({
      hashlock, recipient: identityFromAccount(recipient), assetId: ASSET,
      reward, rewardAssetId: ASSET_B, rewardRecipient: identityFromAccount(recipient),
      refundTo: identityFromAccount(refundTo),
      timelockDelta: 3, rewardTimelockDelta: 1,
    });
    // Principal only; reward never attached.
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });

    await advanceRealTimePast(env, 4000);

    const refundToBeforeA = await refundTo.getBalance(ASSET);
    const refundToBeforeB = await refundTo.getBalance(ASSET_B);
    const refunded = await callRefundSolver(env.train, solver, hashlock, identityFromAccount(solver));
    assert.equal(refunded.value, true);
    assert.equal((await refundTo.getBalance(ASSET)).sub(refundToBeforeA).toString(), String(principal), 'refund_to receives exactly the principal in asset A');
    assert.equal((await refundTo.getBalance(ASSET_B)).sub(refundToBeforeB).toString(), '0', 'no asset-B refund for an unfunded reward');
  });

  test('refund_solver with a FUNDED different-asset reward refunds principal in A and reward in B', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const refundTo = env.wallets[USER_C];
    const hashlock = randomHashlock();
    const principal = 22_000;
    const reward = 3_500;
    const params = makeSolverLockParams({
      hashlock, recipient: identityFromAccount(recipient), assetId: ASSET,
      reward, rewardAssetId: ASSET_B, rewardRecipient: identityFromAccount(recipient),
      refundTo: identityFromAccount(refundTo),
      timelockDelta: 3, rewardTimelockDelta: 1,
    });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: principal, params, dst: makeDestinationInfo() });
    await callAttachSolverReward({ train: env.train, caller: solver, hashlock, solver: identityFromAccount(solver), reward, rewardAssetId: ASSET_B });

    await advanceRealTimePast(env, 4000);

    const refundToBeforeA = await refundTo.getBalance(ASSET);
    const refundToBeforeB = await refundTo.getBalance(ASSET_B);
    const refunded = await callRefundSolver(env.train, solver, hashlock, identityFromAccount(solver));
    assert.equal(refunded.value, true);
    assert.equal((await refundTo.getBalance(ASSET)).sub(refundToBeforeA).toString(), String(principal), 'refund_to receives the principal in asset A');
    assert.equal((await refundTo.getBalance(ASSET_B)).sub(refundToBeforeB).toString(), String(reward), 'refund_to receives the funded reward in asset B');
  });

  // ───────────────────────────── Pagination ─────────────────────────────

  test('pagination: get_user_lock_hashes / get_user_locks basic full-page read', async () => {
    const funder = env.wallets[FUNDER_D];
    const owner = randomIdentity();
    const hashlocks: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const hashlock = randomHashlock();
      const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(funder) });
      await callUserLockFor({ train: env.train, caller: funder, user: owner, assetId: ASSET, amount: 1000 + i, params, dst: makeDestinationInfo() });
      hashlocks.push(hashlock);
    }

    const [hashes, total] = await getUserLockHashes(env.train, owner, 0, 100);
    assert.equal(Number(total), 5);
    assert.equal(hashes.length, 5);
    assert.deepEqual(
      hashes.map((h) => h.toLowerCase()),
      hashlocks.map((h) => h.toLowerCase()),
      'get_user_lock_hashes must return hashlocks in creation order',
    );

    const [locks, total2] = await getUserLocks(env.train, owner, 0, 100);
    assert.equal(Number(total2), 5);
    assert.equal((locks as unknown[]).length, 5);
  });

  test('pagination: offset == total returns an empty page with the correct total', async () => {
    const funder = env.wallets[FUNDER_D];
    const owner = randomIdentity();
    for (let i = 0; i < 3; i += 1) {
      const params = await makeUserLockParams({ hashlock: randomHashlock(), recipient: identityFromAccount(funder) });
      await callUserLockFor({ train: env.train, caller: funder, user: owner, assetId: ASSET, amount: 500, params, dst: makeDestinationInfo() });
    }
    const [hashes, total] = await getUserLockHashes(env.train, owner, 3, 100);
    assert.equal(Number(total), 3);
    assert.equal(hashes.length, 0);
  });

  test('pagination: offset > total returns an empty page with the correct total (never reverts)', async () => {
    const funder = env.wallets[FUNDER_D];
    const owner = randomIdentity();
    for (let i = 0; i < 2; i += 1) {
      const params = await makeUserLockParams({ hashlock: randomHashlock(), recipient: identityFromAccount(funder) });
      await callUserLockFor({ train: env.train, caller: funder, user: owner, assetId: ASSET, amount: 500, params, dst: makeDestinationInfo() });
    }
    const [hashes, total] = await getUserLockHashes(env.train, owner, 999, 100);
    assert.equal(Number(total), 2);
    assert.equal(hashes.length, 0);
  });

  test('pagination: limit == 0 returns an empty page regardless of offset', async () => {
    const funder = env.wallets[FUNDER_D];
    const owner = randomIdentity();
    for (let i = 0; i < 4; i += 1) {
      const params = await makeUserLockParams({ hashlock: randomHashlock(), recipient: identityFromAccount(funder) });
      await callUserLockFor({ train: env.train, caller: funder, user: owner, assetId: ASSET, amount: 500, params, dst: makeDestinationInfo() });
    }
    const [hashesAtZero, totalAtZero] = await getUserLockHashes(env.train, owner, 0, 0);
    assert.equal(Number(totalAtZero), 4);
    assert.equal(hashesAtZero.length, 0);

    const [hashesAtTwo, totalAtTwo] = await getUserLockHashes(env.train, owner, 2, 0);
    assert.equal(Number(totalAtTwo), 4);
    assert.equal(hashesAtTwo.length, 0);
  });

  test('pagination: limit larger than remaining returns just the remainder', async () => {
    const funder = env.wallets[FUNDER_D];
    const owner = randomIdentity();
    const hashlocks: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const hashlock = randomHashlock();
      const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(funder) });
      await callUserLockFor({ train: env.train, caller: funder, user: owner, assetId: ASSET, amount: 500, params, dst: makeDestinationInfo() });
      hashlocks.push(hashlock);
    }
    // offset=4, limit=1000 (way more than the 2 remaining) -> must return exactly the last 2.
    const [hashes, total] = await getUserLockHashes(env.train, owner, 4, 1000);
    assert.equal(Number(total), 6);
    assert.equal(hashes.length, 2);
    assert.deepEqual(
      hashes.map((h) => h.toLowerCase()),
      hashlocks.slice(4).map((h) => h.toLowerCase()),
    );
  });

  test('REGRESSION (EVM bfe4069 equivalent): limit == u64::MAX with a nonzero offset must never revert, at any offset, for any hashlock count', async () => {
    const funder = env.wallets[FUNDER_D];

    // Case 1: zero hashlocks at all for a completely fresh owner.
    const emptyOwner = randomIdentity();
    for (const offset of [0, 1, 100]) {
      const [hashes, total] = await getUserLockHashes(env.train, emptyOwner, offset, U64_MAX);
      assert.equal(Number(total), 0);
      assert.equal(hashes.length, 0);
    }

    // Case 2: a nonzero hashlock count, exercised at offset 0, mid-range, == total, and > total.
    const owner = randomIdentity();
    const hashlocks: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const hashlock = randomHashlock();
      const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(funder) });
      await callUserLockFor({ train: env.train, caller: funder, user: owner, assetId: ASSET, amount: 500, params, dst: makeDestinationInfo() });
      hashlocks.push(hashlock);
    }

    for (const offset of [0, 1, 3, 5, 6, 1000]) {
      const [hashes, total] = await getUserLockHashes(env.train, owner, offset, U64_MAX);
      assert.equal(Number(total), 5, `total must always be 5 regardless of offset ${offset}`);
      const expectedLen = offset >= 5 ? 0 : 5 - offset;
      assert.equal(hashes.length, expectedLen, `offset ${offset} with limit=u64::MAX must return ${expectedLen} hashlocks, not revert`);
      if (expectedLen > 0) {
        assert.deepEqual(
          hashes.map((h) => h.toLowerCase()),
          hashlocks.slice(offset).map((h) => h.toLowerCase()),
        );
      }

      // Same regression for get_user_locks (the richer paginated getter).
      const [locks, total2] = await getUserLocks(env.train, owner, offset, U64_MAX);
      assert.equal(Number(total2), 5);
      assert.equal((locks as unknown[]).length, expectedLen);
    }
  });

  // ───────────────────────────── Adversarial / error paths ─────────────────────────────

  test('ZeroAmount: user_lock with a zero-value forwarded coin reverts', async () => {
    const user = env.wallets[USER_A];
    const params = await makeUserLockParams({ hashlock: randomHashlock(), recipient: identityFromAccount(user) });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 0, params, dst: makeDestinationInfo() }),
      'ZeroAmount',
      'locking a zero-value coin must revert ZeroAmount',
    );
  });

  test('ZeroAmount: solver_lock with forwarded amount <= reward (zero principal) reverts', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const reward = 100;
    const params = makeSolverLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward,
      rewardRecipient: identityFromAccount(recipient),
    });
    await assertReverts(
      // forwarded amount == reward => principal == 0
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: reward, params, dst: makeDestinationInfo() }),
      'ZeroAmount',
      'a solver lock whose forwarded amount does not exceed the reward must revert ZeroAmount',
    );
  });

  test('InvalidTimelock: user_lock with timelock_delta == 0 reverts', async () => {
    const user = env.wallets[USER_A];
    const params = await makeUserLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(user),
      timelockDelta: 0,
    });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() }),
      'InvalidTimelock',
      'a zero timelock_delta must revert InvalidTimelock',
    );
  });

  test('TimelockOverflow: user_lock with timelock_delta == u64::MAX reverts', async () => {
    const user = env.wallets[USER_A];
    const params = await makeUserLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(user),
      timelockDelta: U64_MAX,
    });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() }),
      'TimelockOverflow',
      'a timelock_delta large enough to overflow now + delta in u64 must revert TimelockOverflow',
    );
  });

  test('QuoteExpired: user_lock with quote_expiry already in the past reverts', async () => {
    const user = env.wallets[USER_A];
    const pastExpiry = await (async () => {
      // futureTai64 with a negative offset -- see testHarness's own doc comment on this helper's
      // TAI64 conversion; a negative "seconds from now" simply lands in the past.
      const { futureTai64 } = await import('./testHarness');
      return futureTai64(-3600);
    })();
    const params = await makeUserLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(user),
      quoteExpiry: pastExpiry,
    });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() }),
      'QuoteExpired',
      'a quote_expiry already in the past must revert QuoteExpired',
    );
  });

  test('ZeroAddress: user_lock with a zero recipient reverts', async () => {
    const user = env.wallets[USER_A];
    const params = await makeUserLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAddress(ZERO_ADDRESS),
      refundTo: identityFromAccount(user),
    });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() }),
      'ZeroAddress',
      'a zero recipient must revert ZeroAddress',
    );
  });

  test('ZeroAddress: user_lock with a zero refund_to reverts', async () => {
    const user = env.wallets[USER_A];
    const params = await makeUserLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(user),
      refundTo: identityFromAddress(ZERO_ADDRESS),
    });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() }),
      'ZeroAddress',
      'a zero refund_to must revert ZeroAddress',
    );
  });

  test('ZeroAddress: solver_lock with a zero recipient reverts', async () => {
    const solver = env.wallets[USER_A];
    const params = makeSolverLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAddress(ZERO_ADDRESS),
      assetId: ASSET,
      refundTo: identityFromAccount(solver),
    });
    await assertReverts(
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() }),
      'ZeroAddress',
      'a zero solver-lock recipient must revert ZeroAddress',
    );
  });

  test('ZeroAddress: solver_lock with a zero refund_to reverts', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const params = makeSolverLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      refundTo: identityFromAddress(ZERO_ADDRESS),
    });
    await assertReverts(
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() }),
      'ZeroAddress',
      'a zero solver-lock refund_to must revert ZeroAddress',
    );
  });

  test('ZeroAddress: solver_lock with reward > 0 and a zero reward_recipient reverts', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const params = makeSolverLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward: 500,
      rewardRecipient: identityFromAddress(ZERO_ADDRESS),
    });
    await assertReverts(
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 5000, params, dst: makeDestinationInfo() }),
      'ZeroAddress',
      'a zero reward_recipient with reward > 0 must revert ZeroAddress',
    );
  });

  test('SwapAlreadyExists: locking twice under the same still-pending hashlock reverts', async () => {
    const user = env.wallets[USER_A];
    const hashlock = randomHashlock();
    const params1 = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params: params1, dst: makeDestinationInfo() });

    const params2 = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 2000, params: params2, dst: makeDestinationInfo() }),
      'SwapAlreadyExists',
      'relocking a still-pending hashlock must revert SwapAlreadyExists',
    );
  });

  test('SwapAlreadyExists: relocking a hashlock that was already fully REDEEMED reverts -- hashlock squatting can never be undone', async () => {
    const user = env.wallets[USER_A];
    const { secretArg, hashlock } = makeSecretPair();
    const params1 = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params: params1, dst: makeDestinationInfo() });
    await callRedeemUser(env.train, user, hashlock, secretArg);

    const lock = (await getUserLock(env.train, hashlock)) as { status: string } | null;
    assert.ok(lock);
    assert.equal(lock.status, 'Redeemed');

    const params2 = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 2000, params: params2, dst: makeDestinationInfo() }),
      'SwapAlreadyExists',
      'relocking an already-redeemed hashlock must still revert SwapAlreadyExists',
    );
  });

  test('SwapAlreadyExists: relocking a hashlock that was already REFUNDED reverts -- hashlock squatting can never be undone', async () => {
    const user = env.wallets[USER_A];
    const hashlock = randomHashlock();
    const params1 = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params: params1, dst: makeDestinationInfo() });
    await callRefundUser(env.train, user, hashlock);

    const lock = (await getUserLock(env.train, hashlock)) as { status: string } | null;
    assert.ok(lock);
    assert.equal(lock.status, 'Refunded');

    const params2 = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await assertReverts(
      () => callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 2000, params: params2, dst: makeDestinationInfo() }),
      'SwapAlreadyExists',
      'relocking an already-refunded hashlock must still revert SwapAlreadyExists',
    );
  });

  test('InvalidUser: user_lock_for with a zero user reverts', async () => {
    const funder = env.wallets[FUNDER_D];
    const params = await makeUserLockParams({ hashlock: randomHashlock(), recipient: identityFromAccount(funder) });
    await assertReverts(
      () =>
        callUserLockFor({
          train: env.train,
          caller: funder,
          user: identityFromAddress(ZERO_ADDRESS),
          assetId: ASSET,
          amount: 1000,
          params,
          dst: makeDestinationInfo(),
        }),
      'InvalidUser',
      'user_lock_for with a zero user must revert InvalidUser',
    );
  });

  test('InvalidRewardTimelock: solver_lock with reward > 0 and reward_timelock_delta >= timelock_delta reverts', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const params = makeSolverLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(recipient),
      assetId: ASSET,
      reward: 100,
      timelockDelta: 3600,
      rewardTimelockDelta: 3600, // equal -- must be STRICTLY less than timelock_delta
    });
    await assertReverts(
      () => callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 5000, params, dst: makeDestinationInfo() }),
      'InvalidRewardTimelock',
      'reward_timelock_delta >= timelock_delta (with reward > 0) must revert InvalidRewardTimelock',
    );
  });

  test('HashlockMismatch: redeem_user with the wrong secret reverts', async () => {
    const user = env.wallets[USER_A];
    const { hashlock } = makeSecretPair();
    const { secretArg: wrongSecret } = makeSecretPair(); // a different, unrelated secret
    const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() });

    await assertReverts(
      () => callRedeemUser(env.train, user, hashlock, wrongSecret),
      'HashlockMismatch',
      'redeeming with a secret that does not hash to the hashlock must revert HashlockMismatch',
    );
  });

  test('LockNotFound: redeem_user on a hashlock that was never locked reverts', async () => {
    const user = env.wallets[USER_A];
    const { secretArg, hashlock } = makeSecretPair(); // never actually locked
    await assertReverts(
      () => callRedeemUser(env.train, user, hashlock, secretArg),
      'LockNotFound',
      'redeeming a never-locked hashlock must revert LockNotFound',
    );
  });

  test('LockNotFound: refund_solver on a (hashlock, solver) that was never locked reverts', async () => {
    const user = env.wallets[USER_A];
    const hashlock = randomHashlock(); // never locked at all
    await assertReverts(
      () => callRefundSolver(env.train, user, hashlock, identityFromAccount(user)),
      'LockNotFound',
      'refunding a never-locked (hashlock, solver) must revert LockNotFound',
    );
  });

  test('LockNotPending: refund_user on an already-redeemed lock reverts', async () => {
    const user = env.wallets[USER_A];
    const { secretArg, hashlock } = makeSecretPair();
    const params = await makeUserLockParams({ hashlock, recipient: identityFromAccount(user) });
    await callUserLock({ train: env.train, caller: user, assetId: ASSET, amount: 1000, params, dst: makeDestinationInfo() });
    await callRedeemUser(env.train, user, hashlock, secretArg);

    await assertReverts(
      () => callRefundUser(env.train, user, hashlock),
      'LockNotPending',
      'refunding an already-redeemed lock must revert LockNotPending',
    );
  });

  test('LockNotPending: redeem_solver called twice on the same lock reverts on the second call', async () => {
    const solver = env.wallets[USER_A];
    const recipient = env.wallets[USER_B];
    const { secretArg, hashlock } = makeSecretPair();
    const params = makeSolverLockParams({ hashlock, recipient: identityFromAccount(recipient), assetId: ASSET });
    await callSolverLock({ train: env.train, caller: solver, assetId: ASSET, amount: 5000, params, dst: makeDestinationInfo() });
    await callRedeemSolver(env.train, solver, hashlock, identityFromAccount(solver), secretArg);

    await assertReverts(
      () => callRedeemSolver(env.train, solver, hashlock, identityFromAccount(solver), secretArg),
      'LockNotPending',
      'redeeming an already-redeemed solver lock a second time must revert LockNotPending',
    );
  });
});
