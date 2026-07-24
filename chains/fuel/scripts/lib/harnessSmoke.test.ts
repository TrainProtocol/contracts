/**
 * Minimal smoke test for `testHarness.ts` itself: proves `setupTestEnvironment` + the
 * default-input builders + the call/view helpers actually work end-to-end against a real local
 * `fuel-core` node, via the simplest possible round trip -- `user_lock` -> `get_user_lock` ->
 * `redeem_user`. Not a substitute for `sponsoredTx.test.ts`'s deeper rail-specific coverage;
 * this only exists to validate the harness plumbing a broader test suite will build on.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from 'fuels';
import { TestAssetId } from 'fuels/test-utils';

import {
  callRedeemUser,
  callUserLock,
  getUserLock,
  identityFromAccount,
  makeDestinationInfo,
  makeUserLockParams,
  setupTestEnvironment,
} from './testHarness';

test('harness smoke: user_lock -> get_user_lock -> redeem_user round trip', async () => {
  const env = await setupTestEnvironment({ walletCount: 2 });
  const { train, wallets, cleanup } = env;
  try {
    const [user] = wallets;
    const assetId = TestAssetId.A.value;
    const amount = 750_000;

    // A real secret/hashlock pair -- `redeem_user` checks `sha256(secret) == hashlock`.
    const secret = 123456789n;
    const secretBytes = new Uint8Array(32);
    new DataView(secretBytes.buffer).setBigUint64(24, secret, false);
    const hashlock = sha256(secretBytes);

    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(user),
    });
    const dst = makeDestinationInfo();

    const userBalanceBefore = await user.getBalance(assetId);

    const locked = await callUserLock({
      train,
      caller: user,
      assetId,
      amount,
      params,
      dst,
    });
    assert.equal(locked.value, hashlock, 'user_lock should return the hashlock it was given');

    const lock = (await getUserLock(train, hashlock)) as {
      status: string;
      amount: unknown;
      asset_id: { bits: string };
      recipient: { Address: { bits: string } };
    } | null;
    assert.ok(lock, 'get_user_lock should find the freshly created lock');
    assert.equal(lock.status, 'Pending');
    assert.equal(lock.asset_id.bits.toLowerCase(), assetId.toLowerCase());
    assert.equal(lock.recipient.Address.bits.toLowerCase(), user.address.toB256().toLowerCase());

    const redeemed = await callRedeemUser(train, user, hashlock, secret.toString());
    assert.equal(redeemed.value, true, 'redeem_user should succeed with the correct secret');

    const afterRedeem = (await getUserLock(train, hashlock)) as { status: string } | null;
    assert.ok(afterRedeem);
    assert.equal(afterRedeem.status, 'Redeemed');

    // Full round trip: user locked `amount`, then redeemed it straight back to themselves (as
    // `recipient`) -- net cost is only the gas spent across both transactions, not `amount`.
    const userBalanceAfter = await user.getBalance(assetId);
    const netDelta = userBalanceBefore.sub(userBalanceAfter);
    assert.ok(
      netDelta.abs().lt(amount),
      `expected the user's net balance change to be far less than the ${amount}-unit lock ` +
        `(self-lock, self-redeem), got a net delta of ${netDelta.toString()}`,
    );

    console.log(
      `Harness smoke OK: locked+redeemed ${amount} of ${assetId} in one round trip, tx ${locked.transactionId} -> ${redeemed.transactionId}`,
    );
  } finally {
    cleanup();
  }
});
