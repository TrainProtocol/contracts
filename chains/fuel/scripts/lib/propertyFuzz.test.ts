/**
 * Property-based fuzz tests for the Fuel/Sway "Train" HTLC port, run against a REAL local
 * `fuel-core` node (via `./testHarness`'s `setupTestEnvironment`) -- not a pure in-memory
 * model. This is the closest attainable Fuel/Sway analog of the EVM reference port's
 * Echidna/Medusa property-fuzzing engines: no such fuzzer exists for Sway, so this uses
 * `fast-check` (a mature, actively maintained JS/TS property-testing library, the direct
 * analog of Rust's `proptest` for this port's actual TypeScript/fuels-ts toolchain) to
 * generate randomized valid parameter sequences and assert invariants hold for every
 * generated case.
 *
 * LIBRARY CHOICE: `fast-check` was not already a dependency of this package -- it was added
 * as a devDependency specifically for this phase (`chains/fuel/package.json`). It was picked
 * over alternatives (e.g. hand-rolled `Math.random()` loops, or `jsverify`) because it is the
 * most widely used, actively maintained property-testing library in the TS ecosystem, has
 * first-class `fc.asyncProperty`/`fc.assert` support for async side-effecting properties
 * (needed here, since every property below drives real chain calls), and gives automatic
 * shrinking to a minimal failing case if an invariant is ever violated -- exactly the
 * "proptest analog" role the task brief asks for.
 *
 * PERFORMANCE NOTE (read before changing `numRuns`): each generated case in the tests below
 * drives at least one REAL transaction against the local node (block production, not just an
 * in-memory state transition), so `numRuns` is deliberately kept moderate (15-25 per
 * property, noted per-test below) rather than a large fuzz campaign -- see this phase's report
 * for the actual measured wall-clock time. One `setupTestEnvironment` call is shared across an
 * entire property (not one node launch per generated case) to keep this bounded; `amountPerCoin`
 * is bumped well above the default so a single funding wallet can absorb every generated case's
 * `amount` without running dry partway through a run.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';
import { bn, sha256 } from 'fuels';
import { TestAssetId } from 'fuels/test-utils';

import {
  callRedeemUser,
  callSolverLock,
  callUserLock,
  callUserLockFor,
  getSolverLock,
  getSolverLockCount,
  getUserLock,
  getUserLockHashes,
  identityFromAccount,
  makeDestinationInfo,
  makeSolverLockParams,
  makeUserLockParams,
  randomHashlock,
  setupTestEnvironment,
} from './testHarness';

/** Reads back an `Identity`'s inner `bits`, regardless of whether it's an `Address` or a
 * `ContractId` variant -- used to compare identities case-insensitively without assuming
 * fuels-ts's exact key ordering. */
function identityBits(identity: unknown): string {
  const asRecord = identity as { Address?: { bits: string }; ContractId?: { bits: string } };
  const bits = asRecord.Address?.bits ?? asRecord.ContractId?.bits;
  assert.ok(bits, `expected an Address/ContractId-shaped Identity, got ${JSON.stringify(identity)}`);
  return (bits as string).toLowerCase();
}

/** Builds the 32-byte big-endian buffer `redeem_user`/`redeem_solver` expect as a `u256`
 * secret from a plain JS-safe integer/BigInt, mirroring `harnessSmoke.test.ts`'s convention
 * (only the low 8 bytes are ever nonzero, which is plenty of preimage space for this fuzzer's
 * purposes -- the goal is exercising the redeem path for many random `amount`s, not stressing
 * the full 256-bit secret space). Returns the derived `hashlock` alongside the secret.
 *
 * `caseSalt` is a per-generated-case value (see the "redeem_user exact amount" property below)
 * written into bytes [16, 24) -- a DISJOINT byte range from `secretValue`'s bytes [24, 32) --
 * so the resulting hashlock is unique per generated case EVEN IF `secretValue` repeats across
 * two different cases within the same `fc.assert` run. This repeat is not a hypothetical: this
 * function's caller uses `fc.bigInt({ min: 1n, max: 2n ** 63n })`, and fast-check's arbitraries
 * deliberately bias sampling toward small/edge values (0, 1, 2, MIN, MAX, ...) for corner-case
 * coverage, so seeing e.g. `secretValue === 2n` on two separate generated cases inside the same
 * 15-run property is common, not a one-in-2^63 fluke. Without `caseSalt`, two cases sharing a
 * `secretValue` compute the exact same `hashlock`; since every case in this property reuses the
 * SAME `train` contract instance (one `setupTestEnvironment` per property, not per case) and the
 * first case's lock is already `Redeemed` by the time the second runs, the second case's
 * `user_lock` call reverts with the contract's `SwapAlreadyExists` check in
 * `validate_user_lock_params` -- a real, correct contract invariant (one hashlock backs only one
 * live lock at a time), NOT a bug in `redeem_user`. That revert was the actual root cause of this
 * property's intermittent failures -- confirmed by replaying the exact failing (amount,
 * secretValue) pair in isolation against a fresh hashlock namespace, where it passed cleanly
 * (balance delta exactly `amount`), and only failed when reused against an already-consumed
 * hashlock from an earlier case in the same run. */
function secretAndHashlock(secretValue: bigint, caseSalt: bigint): { secret: bigint; hashlock: string } {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(16, caseSalt, false);
  view.setBigUint64(24, secretValue, false);
  const secret = (caseSalt << 64n) | secretValue;
  return { secret, hashlock: sha256(bytes) };
}

const U64_MAX = bn(2).pow(64).sub(1);

test(
  'property: user_lock round-trip fidelity for random amount/timelock/recipient/refund_to (status Pending)',
  async () => {
    const env = await setupTestEnvironment({
      walletCount: 5,
      assets: [TestAssetId.A],
      amountPerCoin: 200_000_000_000,
    });
    const { train, wallets, cleanup } = env;
    try {
      const assetId = TestAssetId.A.value;
      const funder = wallets[0];
      // Every wallet (including the funder itself) is a candidate recipient/refund_to -- these
      // fields never need to hold real funds themselves (they're attribution-only until an
      // actual redeem/refund), so reusing the funded pool is fine and lets us assert identity
      // round-trip against a real `.address`.
      const pool = wallets.map((w) => identityFromAccount(w));

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5_000_000 }),
          fc.integer({ min: 60, max: 100_000 }),
          fc.integer({ min: 0, max: pool.length - 1 }),
          fc.integer({ min: 0, max: pool.length - 1 }),
          async (amount, timelockDelta, recipientIdx, refundIdx) => {
            const recipient = pool[recipientIdx];
            const refundTo = pool[refundIdx];
            const hashlock = randomHashlock();

            const params = await makeUserLockParams({
              hashlock,
              recipient,
              refundTo,
              timelockDelta,
              quoteExpirySecondsFromNow: 24 * 3600,
            });
            const dst = makeDestinationInfo();

            const created = await callUserLock({ train, caller: funder, assetId, amount, params, dst });
            assert.equal(created.value, hashlock, 'user_lock must return the hashlock it was given');

            const lock = (await getUserLock(train, hashlock)) as Record<string, unknown> | null;
            assert.ok(lock, 'get_user_lock must find the freshly created lock');

            // --- Round-trip fidelity: every submitted field reads back exactly ---
            assert.equal(lock.status, 'Pending', 'a freshly created lock must be Pending');
            assert.equal(bn(lock.amount as never).toString(), bn(amount).toString(), 'amount round-trip');
            assert.equal(
              (lock.asset_id as { bits: string }).bits.toLowerCase(),
              assetId.toLowerCase(),
              'asset_id round-trip',
            );
            assert.equal(
              identityBits(lock.sender),
              funder.address.toB256().toLowerCase(),
              'sender must be the caller that funded this call',
            );
            assert.equal(identityBits(lock.recipient), identityBits(recipient), 'recipient round-trip');
            assert.equal(identityBits(lock.refund_to), identityBits(refundTo), 'refund_to round-trip');

            const startTime = bn(lock.start_time as never);
            const expectedTimelock = startTime.add(bn(timelockDelta));
            assert.equal(
              bn(lock.timelock as never).toString(),
              expectedTimelock.toString(),
              'timelock must equal start_time + timelock_delta exactly',
            );
            assert.equal(bn(lock.secret as never).toString(), '0', 'secret must be unset (0) before any redeem');
            assert.ok(!lock.payout_curve, 'no payout curve was submitted, so none should be stored');
          },
        ),
        { numRuns: 15 },
      );
      console.log('property (user_lock round-trip): 15/15 random cases passed');
    } finally {
      cleanup();
    }
  },
);

test(
  'property: solver_lock count/index invariants for random reward/timelock sequences',
  async () => {
    const env = await setupTestEnvironment({
      walletCount: 3,
      assets: [TestAssetId.A],
      amountPerCoin: 200_000_000_000,
    });
    const { train, wallets, cleanup } = env;
    try {
      const assetId = TestAssetId.A.value;
      const solverCaller = wallets[0];
      const recipient = identityFromAccount(wallets[1]);
      const rewardRecipient = identityFromAccount(wallets[2]);

      const lockSpecArb = fc.record({
        principal: fc.integer({ min: 1, max: 2_000_000 }),
        reward: fc.integer({ min: 0, max: 1_000_000 }),
        timelockDelta: fc.integer({ min: 120, max: 100_000 }),
        rewardTimelockDeltaRaw: fc.integer({ min: 0, max: 99_999 }),
      });

      await fc.assert(
        fc.asyncProperty(fc.array(lockSpecArb, { minLength: 1, maxLength: 4 }), async (specs) => {
          // Fresh hashlock per generated CASE (not per lock) -- exercises index growth 1..N
          // under one hashlock, which is the actual invariant under test.
          const hashlock = randomHashlock();
          let expectedIndex = 0;

          for (const spec of specs) {
            const { principal, reward, timelockDelta } = spec;
            // `reward > 0` requires `reward_timelock_delta < timelock_delta` (validated
            // on-chain); construct a value that always satisfies this rather than hoping a
            // freely generated one does, since we want to explore the VALID space here.
            const rewardTimelockDelta = reward > 0 ? Math.min(spec.rewardTimelockDeltaRaw, timelockDelta - 1) : 0;
            const msgAmount = principal + reward; // msg_amount() > reward, guaranteed since principal >= 1

            const beforeCount = bn(await getSolverLockCount(train, hashlock)).toNumber();
            assert.equal(beforeCount, expectedIndex, 'count before creation must equal the running index');

            const params = makeSolverLockParams({
              hashlock,
              assetId,
              reward,
              timelockDelta,
              rewardTimelockDelta,
              recipient,
              rewardRecipient,
            });
            const dst = makeDestinationInfo();

            const result = await callSolverLock({
              train,
              caller: solverCaller,
              assetId,
              amount: msgAmount,
              params,
              dst,
            });
            expectedIndex += 1;
            const returnedIndex = bn(result.value as never).toNumber();
            assert.equal(returnedIndex, expectedIndex, 'solver_lock must return the 1-based index == new count');

            const afterCount = bn(await getSolverLockCount(train, hashlock)).toNumber();
            assert.equal(afterCount, beforeCount + 1, 'count must increment by exactly 1 per creation');
            assert.equal(afterCount, expectedIndex);

            const lock = (await getSolverLock(train, hashlock, expectedIndex)) as Record<string, unknown> | null;
            assert.ok(lock, 'the newly created solver lock must be readable at its returned index');
            assert.equal(lock.status, 'Pending');
            assert.equal(bn(lock.amount as never).toString(), bn(principal).toString(), 'principal round-trip');
            assert.equal(bn(lock.reward as never).toString(), bn(reward).toString(), 'reward round-trip');
          }
        }),
        { numRuns: 10 },
      );
      console.log('property (solver_lock count/index): 10/10 random sequences passed');
    } finally {
      cleanup();
    }
  },
);

test(
  'property: redeem_user transfers exactly `amount` to recipient and moves status to Redeemed',
  async () => {
    const env = await setupTestEnvironment({
      walletCount: 3,
      assets: [TestAssetId.A],
      amountPerCoin: 200_000_000_000,
    });
    const { train, wallets, cleanup } = env;
    try {
      const assetId = TestAssetId.A.value;
      const funder = wallets[0]; // funds every lock's principal
      const recipient = wallets[1]; // always the payout destination; never signs a transaction here
      const redeemer = wallets[2]; // calls redeem_user and pays its own gas -- NOT the recipient,
      // which is what makes the recipient's balance delta exactly `amount` (no gas ever comes
      // out of the recipient's own pocket in this property).

      // Monotonic per-generated-case salt (see `secretAndHashlock`'s doc comment): every case in
      // this property shares the SAME `train` instance, so `secretValue` alone is not enough to
      // guarantee a fresh hashlock across the `numRuns` cases -- fast-check's biased sampling
      // makes repeats of small `secretValue`s (e.g. `2n`) likely within one run, which previously
      // caused an already-Redeemed hashlock to be reused and the property to fail on an unrelated
      // `SwapAlreadyExists` revert rather than on the balance-delta assertion it's meant to check.
      let caseSalt = 0n;

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5_000_000 }),
          fc.bigInt({ min: 1n, max: 2n ** 63n }),
          async (amount, secretValue) => {
            const { secret, hashlock } = secretAndHashlock(secretValue, caseSalt);
            caseSalt += 1n;

            const params = await makeUserLockParams({
              hashlock,
              recipient: identityFromAccount(recipient),
              refundTo: identityFromAccount(recipient),
              timelockDelta: 3600,
              quoteExpirySecondsFromNow: 24 * 3600,
            });
            const dst = makeDestinationInfo();

            await callUserLock({ train, caller: funder, assetId, amount, params, dst });

            const before = await recipient.getBalance(assetId);
            const redeemed = await callRedeemUser(train, redeemer, hashlock, secret.toString());
            assert.equal(redeemed.value, true, 'redeem_user must succeed with the correct secret on a Pending lock');
            const after = await recipient.getBalance(assetId);

            assert.equal(
              after.sub(before).toString(),
              bn(amount).toString(),
              `recipient balance must increase by EXACTLY amount=${amount}, no more, no less`,
            );

            const lock = (await getUserLock(train, hashlock)) as Record<string, unknown> | null;
            assert.ok(lock);
            assert.equal(lock.status, 'Redeemed');
          },
        ),
        { numRuns: 15 },
      );
      console.log('property (redeem_user exact balance delta): 15/15 random amounts passed');
    } finally {
      cleanup();
    }
  },
);

test(
  'property: get_user_lock_hashes pagination never reverts and matches the expected slice for randomized (offset, limit)',
  async () => {
    // A handful of different `total`s (including the empty-list edge case) explored per
    // environment, rather than one fixed count -- each owned by its own wallet so their
    // enumeration lists never interfere with each other.
    const totals = [0, 1, 3, 7, 15];
    const env = await setupTestEnvironment({
      walletCount: totals.length + 1,
      assets: [TestAssetId.A],
      amountPerCoin: 200_000_000_000,
    });
    const { train, wallets, cleanup } = env;
    try {
      const assetId = TestAssetId.A.value;
      const funder = wallets[0];

      for (let t = 0; t < totals.length; t += 1) {
        const total = totals[t];
        const owner = wallets[t + 1];
        const identity = identityFromAccount(owner);
        const expectedHashes: string[] = [];

        for (let i = 0; i < total; i += 1) {
          const hashlock = randomHashlock();
          const params = await makeUserLockParams({ hashlock, recipient: identity, refundTo: identity });
          const dst = makeDestinationInfo();
          await callUserLockFor({ train, caller: funder, user: identity, assetId, amount: 1000, params, dst });
          expectedHashes.push(hashlock);
        }

        const [, sanityTotal] = await getUserLockHashes(train, identity, 0, Math.max(total, 1));
        assert.equal(bn(sanityTotal as never).toNumber(), total, `sanity: total for owner with ${total} locks`);

        const offsetArb = fc.oneof(
          fc.constant(0),
          fc.constant(total),
          fc.constant(total + 1),
          fc.nat({ max: total + 5 }),
        );
        const limitArb = fc.oneof(
          fc.constant(0),
          fc.constant(total),
          fc.constant(total + 1),
          fc.nat({ max: total + 5 }),
          fc.constant(U64_MAX.toString()), // "very large limit like u64::MAX" edge case
        );

        await fc.assert(
          fc.asyncProperty(offsetArb, limitArb, async (offset, limit) => {
            const [result, reportedTotal] = await getUserLockHashes(train, identity, offset, limit);
            assert.equal(
              bn(reportedTotal as never).toNumber(),
              total,
              'total must be stable across every pagination query for a fixed owner',
            );

            const limitBn = bn(limit);
            const offsetNum = Number(offset);
            let expectedLen: number;
            if (limitBn.isZero() || offsetNum >= total) {
              expectedLen = 0;
            } else {
              const remaining = total - offsetNum;
              expectedLen = limitBn.gt(bn(remaining)) ? remaining : Number(limitBn.toString());
            }

            assert.equal(
              result.length,
              expectedLen,
              `offset=${offset} limit=${String(limit)} total=${total}: expected ${expectedLen} hashes, got ${result.length}`,
            );
            for (let i = 0; i < result.length; i += 1) {
              assert.equal(
                (result[i] as unknown as string).toLowerCase(),
                expectedHashes[offsetNum + i].toLowerCase(),
                `slice mismatch at position ${i} for offset=${offset} limit=${String(limit)}`,
              );
            }
          }),
          { numRuns: 25 },
        );
      }
      console.log(`property (pagination fuzz): 25 random (offset,limit) pairs x ${totals.length} totals, all passed`);
    } finally {
      cleanup();
    }
  },
);
