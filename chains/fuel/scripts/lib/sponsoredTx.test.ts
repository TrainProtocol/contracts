/**
 * Integration proof for Rail 1 (sponsored transaction / fee abstraction), run against a
 * real local `fuel-core` node -- not a typecheck-only exercise.
 *
 * NODE VERSION NOTE (discovered while writing this test, not assumed): fuels-ts's
 * `Provider.assembleTx` uses the fuel-core GraphQL `assembleTx` query + `RequiredBalance`
 * input type, which do not exist on the older fuel-core the `train` fuelup toolchain carries
 * (that toolchain is used only for `forc build`, which does not need fuel-core) -- connecting
 * to such a node fails with "Unknown field 'assembleTx' on type 'Query'" and a version-mismatch
 * warning. fuels-ts 0.103.0 supports fuel-core 0.47.1. Rather than touch the `train` toolchain,
 * a second fuelup toolchain
 * ("fuel-core-testnode") was installed side by side with `fuel-core@0.47.1`, and its binary
 * is pointed at explicitly via `nodeOptions.fuelCorePath` -- `forc`/the default toolchain are
 * untouched. `./testHarness`'s `setupTestEnvironment` (used below) wires this up the same
 * way; see that module's `TEST_NODE_FUEL_CORE_PATH` for the exact path resolution.
 *
 * CONTRACT-COMPATIBILITY NOTE (also discovered here, not assumed): plain `user_lock` cannot
 * be sponsored by a distinct fee payer at all -- see `sponsoredTx.ts`'s doc comment on
 * `buildSponsoredUserLock` for why (`std::auth::msg_sender()` requires every coin input in
 * the transaction to share one owner). The tests below sponsor `user_lock_for` instead
 * (self-attributing the lock to the funding user, which is the direct behavioral equivalent
 * of what a sponsored `user_lock` would have done), and one test asserts `buildSponsoredUserLock`
 * rejects `{ kind: 'user_lock' }` up front with a clear error instead of letting it revert
 * on-chain.
 *
 * SAME-ASSET CAVEAT (also discovered here): `assembleTx` only allows one change destination
 * per assetId across the whole transaction, so when the locked asset is also the base asset
 * (the gas asset), the sponsor's own leftover gas-coin change cannot be routed back to the
 * sponsor independently of the user's -- it falls back to the user. Most tests below lock a
 * *different* asset (`TestAssetId.A`) than gas specifically so the balance-delta assertions
 * can be exact and unambiguous; a dedicated test documents/regression-tests the same-asset
 * fallback behavior explicitly rather than leaving it as an unverified comment. See
 * `sponsoredTx.ts`'s doc comment on `buildSponsoredUserLock` for the full mechanism.
 *
 * Node launch, contract deployment, and default-valid `UserLockParams`/`DestinationInfo`
 * construction are all delegated to `./testHarness` (`setupTestEnvironment`/
 * `makeUserLockParams`/`makeDestinationInfo`) -- shared with any later test file, rather than
 * each test file re-deriving this plumbing independently.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bn, type BigNumberish, type WalletUnlocked } from 'fuels';
import { TestAssetId } from 'fuels/test-utils';

import {
  buildSponsoredUserLock,
  submitSponsoredUserLock,
  identityFromAccount,
  makeDestinationInfo,
  makeUserLockParams,
  randomHashlock,
  setupTestEnvironment,
  type DestinationInfoInput,
  type UserLockParamsInput,
} from './testHarness';

test('Rail 1: sponsored user_lock_for (self-attributed) -- sponsor pays gas only, user funds the lock and signs', async () => {
  const { provider, wallets, train, cleanup } = await setupTestEnvironment({ walletCount: 2 });
  try {
    const [user, sponsor] = wallets;
    const baseAssetId = await provider.getBaseAssetId();
    // Lock a *different* asset than gas -- see the file-level "SAME-ASSET CAVEAT" note on
    // why this is what makes the balance-delta assertions below exact and unambiguous.
    const lockAssetId = TestAssetId.A.value;

    const lockAmount = 500_000;
    const hashlock = randomHashlock();
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(user),
      refundTo: identityFromAccount(user),
    });
    const dst = makeDestinationInfo();

    const userLockAssetBefore = await user.getBalance(lockAssetId);
    const userBaseAssetBefore = await user.getBalance(baseAssetId);
    const sponsorBaseAssetBefore = await sponsor.getBalance(baseAssetId);

    // Self-attributed `user_lock_for` is the sponsorable equivalent of `user_lock` here --
    // see the file-level note above on why plain `user_lock` can't be sponsored at all.
    const built = await buildSponsoredUserLock({
      provider,
      trainContract: train,
      fundingUser: user,
      sponsor,
      call: { kind: 'user_lock_for', user: identityFromAccount(user) },
      assetId: lockAssetId,
      amount: lockAmount,
      params,
      dst,
    });

    // --- Both parties are required signers on the assembled transaction ---
    const coinInputOwners = new Set(
      built.request.inputs
        .filter((i): i is Extract<typeof i, { owner: unknown }> => 'owner' in i && Boolean(i.owner))
        .map((i) => String(i.owner).toLowerCase()),
    );
    assert.ok(
      coinInputOwners.has(user.address.toB256().toLowerCase()),
      'user must own a coin input on the assembled transaction',
    );
    assert.ok(
      coinInputOwners.has(sponsor.address.toB256().toLowerCase()),
      'sponsor must own a coin input (the gas coin) on the assembled transaction',
    );
    // Two distinct owners => two distinct witness slots (fuels-ts assigns one witness index
    // per unique coin-input owner; see `ScriptTransactionRequest.addCoinInput`).
    assert.ok(
      built.request.witnesses.length >= 2,
      `expected at least 2 witness slots, got ${built.request.witnesses.length}`,
    );

    const result = await submitSponsoredUserLock(built, sponsor);

    // --- The lock was created correctly ---
    assert.equal(result.returnValue, hashlock, 'user_lock_for should return the hashlock it was given');

    const lockOpt = await train.functions.get_user_lock(hashlock).get();
    const lock = lockOpt.value;
    assert.ok(lock, 'get_user_lock should find the created lock');
    assert.equal(lock.status, 'Pending');
    assert.equal(bn(lock.amount).toNumber(), lockAmount);
    assert.equal(lock.asset_id.bits.toLowerCase(), lockAssetId.toLowerCase());
    assert.equal(lock.sender.Address.bits.toLowerCase(), user.address.toB256().toLowerCase());
    assert.equal(lock.recipient.Address.bits.toLowerCase(), user.address.toB256().toLowerCase());

    // --- Balance deltas: the split-payer property this whole rail exists to prove ---
    const userLockAssetAfter = await user.getBalance(lockAssetId);
    const userBaseAssetAfter = await user.getBalance(baseAssetId);
    const sponsorBaseAssetAfter = await sponsor.getBalance(baseAssetId);

    const userLockAssetDelta = userLockAssetBefore.sub(userLockAssetAfter);
    const userBaseAssetDelta = userBaseAssetBefore.sub(userBaseAssetAfter);
    const sponsorBaseAssetDelta = sponsorBaseAssetBefore.sub(sponsorBaseAssetAfter);

    // User paid exactly the locked amount, in the locked asset.
    assert.equal(
      userLockAssetDelta.toString(),
      bn(lockAmount).toString(),
      `user's lock-asset balance should drop by exactly the locked amount (${lockAmount}), dropped by ${userLockAssetDelta.toString()}`,
    );
    // User's BASE-asset balance is untouched -- no gas fee came out of their pocket at all.
    assert.equal(
      userBaseAssetDelta.toString(),
      '0',
      `user's base-asset balance should be completely untouched, changed by ${userBaseAssetDelta.toString()}`,
    );

    // Sponsor paid some gas (> 0) and nothing else -- in particular, strictly less than the
    // locked amount (a different asset, but the same order-of-magnitude sanity bound), and
    // its own coin's change correctly returned to itself (independent asset => independent
    // change routing; see the file-level "SAME-ASSET CAVEAT" note).
    assert.ok(sponsorBaseAssetDelta.gt(bn(0)), 'sponsor should have paid a nonzero gas fee');
    assert.ok(
      sponsorBaseAssetDelta.lt(bn(lockAmount)),
      'sponsor should have paid only gas, not anything close to the locked amount',
    );

    console.log(
      `Rail 1 OK: tx ${result.transactionId} | user -${userLockAssetDelta.toString()} (lock asset), base-asset untouched | sponsor -${sponsorBaseAssetDelta.toString()} (gas only)`,
    );
  } finally {
    cleanup();
  }
});

test('Rail 1: sponsored user_lock_for -- lock is attributed to a third-party "user" identity', async () => {
  const { provider, wallets, train, cleanup } = await setupTestEnvironment({ walletCount: 2 });
  try {
    const [funder, sponsor] = wallets;
    const baseAssetId = await provider.getBaseAssetId();

    // A third identity with no wallet/UTXOs at all -- attribution is purely a label, per
    // `main.sw`'s `user_lock_for` doc comment; it must not need to sign or fund anything.
    const attributedUser = identityFromAccount({
      address: { toB256: () => `0x${'ab'.repeat(32)}` },
    });

    const lockAmount = 250_000;
    const hashlock = randomHashlock();
    const params = await makeUserLockParams({
      hashlock,
      recipient: identityFromAccount(funder),
      refundTo: identityFromAccount(funder),
    });
    const dst = makeDestinationInfo();

    const built = await buildSponsoredUserLock({
      provider,
      trainContract: train,
      fundingUser: funder,
      sponsor,
      call: { kind: 'user_lock_for', user: attributedUser },
      assetId: baseAssetId,
      amount: lockAmount,
      params,
      dst,
    });

    const result = await submitSponsoredUserLock(built, sponsor);
    assert.equal(result.returnValue, hashlock);

    const lockOpt = await train.functions.get_user_lock(hashlock).get();
    const lock = lockOpt.value;
    assert.ok(lock);
    // Attributed to `attributedUser`, NOT to `funder` -- even though `funder` paid.
    assert.equal(
      lock.sender.Address.bits.toLowerCase(),
      (attributedUser as { Address: { bits: string } }).Address.bits.toLowerCase(),
    );

    console.log(`Rail 1 (user_lock_for) OK: tx ${result.transactionId}`);
  } finally {
    cleanup();
  }
});

test('Rail 1: buildSponsoredUserLock rejects { kind: "user_lock" } for a distinct sponsor', async () => {
  const { provider, wallets, train, cleanup } = await setupTestEnvironment({ walletCount: 2 });
  try {
    const [user, sponsor] = wallets;
    const baseAssetId = await provider.getBaseAssetId();
    const params = await makeUserLockParams({
      hashlock: randomHashlock(),
      recipient: identityFromAccount(user),
      refundTo: identityFromAccount(user),
    });
    const dst = makeDestinationInfo();

    // Plain `user_lock` calls Sway's `msg_sender()`, which reverts as soon as the
    // transaction's coin inputs have more than one owner -- exactly what a distinct
    // sponsor's fee input causes (see the header comment and `sponsoredTx.ts`'s doc
    // comment on `buildSponsoredUserLock`). The helper must catch this up front rather
    // than let a caller discover it as an opaque on-chain revert.
    await assert.rejects(
      () =>
        buildSponsoredUserLock({
          provider,
          trainContract: train,
          fundingUser: user,
          sponsor,
          call: { kind: 'user_lock' },
          assetId: baseAssetId,
          amount: 1000,
          params,
          dst,
        }),
      /msg_sender|InputsNotAllOwnedBySameAddress|user_lock_for/,
      'buildSponsoredUserLock should reject a sponsored plain user_lock call up front',
    );
  } finally {
    cleanup();
  }
});

test(
  'Rail 1 trust property: a sponsor cannot alter the user-signed call after the fact',
  async () => {
    const { provider, wallets, train, cleanup } = await setupTestEnvironment({ walletCount: 2 });
    try {
      const [user, sponsor] = wallets;
      const baseAssetId = await provider.getBaseAssetId();

      const lockAmount = 100_000;
      const hashlock = randomHashlock();
      const params = await makeUserLockParams({
        hashlock,
        recipient: identityFromAccount(user),
        refundTo: identityFromAccount(user),
      });
      const dst = makeDestinationInfo();

      const built = await buildSponsoredUserLock({
        provider,
        trainContract: train,
        fundingUser: user,
        sponsor,
        call: { kind: 'user_lock_for', user: identityFromAccount(user) },
        assetId: baseAssetId,
        amount: lockAmount,
        params,
        dst,
      });

      // At this point `user` has already signed (their witness is populated). Simulate a
      // malicious sponsor tampering with the transaction before it submits it: redirect the
      // forwarded coin's change output to the sponsor's own address instead of the user's.
      // The change output's `to` IS one of the fields fuels-ts's transaction-ID hash covers
      // (see sponsoredTx.ts's file doc for exactly which fields are and aren't covered), so
      // mutating it after signing must invalidate the user's witness against that owner's input.
      const changeOutputIndex = built.request.outputs.findIndex(
        (o: { type: number; to?: unknown }) => 'to' in o && o.to,
      );
      assert.ok(changeOutputIndex >= 0, 'expected at least one change/coin output to tamper with');
      const original = built.request.outputs[changeOutputIndex];
      built.request.outputs[changeOutputIndex] = {
        ...original,
        to: sponsor.address.toB256(),
      } as typeof original;

      await assert.rejects(
        () => submitSponsoredUserLock(built, sponsor),
        /InvalidTransactionOutcome|InvalidSignature|invalid-request|VM_HALTED|PredicateVerificationFailed|reason/i,
        'submitting a transaction whose outputs were altered after the user signed must fail node-side validation',
      );

      console.log('Rail 1 trust property OK: tampering after user signature was rejected by the node');
    } finally {
      cleanup();
    }
  },
);

/**
 * Three SPECIFIC field-tamper regression cases, expanding on the single generic "a sponsor
 * cannot alter the user-signed call after the fact" test above with concrete, individually
 * named attack attempts -- each swaps in a wholesale-different, independently-built
 * `scriptData` buffer (the ABI-encoded call arguments + call-parameters block a Sway contract
 * -call script embeds, which is what actually carries `params`/`dst`/the forwarded
 * `amount`/`assetId`) onto the ALREADY user-signed request, exactly mirroring how the existing
 * test above swaps in a different `outputs[i].to`: the transaction ID `fundingUser` signed is a
 * hash over the *entire* serialized transaction body, so replacing `scriptData` wholesale with
 * one built for a materially different call must invalidate that signature just as surely as
 * mutating an output does.
 */
for (const tamperCase of [
  {
    name: 'recipient',
    mutate: (params: UserLockParamsInput, dst: DestinationInfoInput, attacker: WalletUnlocked) => ({
      params: { ...params, recipient: identityFromAccount(attacker) },
      dst,
      amount: undefined as BigNumberish | undefined,
    }),
  },
  {
    name: 'amount',
    mutate: (params: UserLockParamsInput, dst: DestinationInfoInput, _attacker: WalletUnlocked, amount: number) => ({
      params,
      dst,
      amount: amount * 2,
    }),
  },
  {
    name: 'destination dst_address',
    mutate: (params: UserLockParamsInput, dst: DestinationInfoInput) => ({
      params,
      dst: { ...dst, dst_address: '0xATTACKER_CONTROLLED_DESTINATION' },
      amount: undefined as BigNumberish | undefined,
    }),
  },
] as const) {
  test(
    `Rail 1 trust property: a sponsor cannot alter the ${tamperCase.name} after the user signed`,
    async () => {
      const { provider, wallets, train, cleanup } = await setupTestEnvironment({ walletCount: 3 });
      try {
        const [user, sponsor, attacker] = wallets;
        const baseAssetId = await provider.getBaseAssetId();
        const lockAssetId = TestAssetId.A.value;

        const lockAmount = 200_000;
        const hashlock = randomHashlock();
        const params = await makeUserLockParams({
          hashlock,
          recipient: identityFromAccount(user),
          refundTo: identityFromAccount(user),
        });
        const dst = makeDestinationInfo();

        const built = await buildSponsoredUserLock({
          provider,
          trainContract: train,
          fundingUser: user,
          sponsor,
          call: { kind: 'user_lock_for', user: identityFromAccount(user) },
          assetId: lockAssetId,
          amount: lockAmount,
          params,
          dst,
        });

        // At this point `user` has already signed. Build a SEPARATE, independent request for a
        // materially different call (one specific field changed) and steal only its
        // `scriptData` -- the encoded call arguments + call-parameters block -- splicing it
        // into the already-signed `built.request` in place of the honest one.
        const mutated = tamperCase.mutate(params, dst, attacker, lockAmount);
        const tamperedAmount = mutated.amount ?? lockAmount;
        const tamperedScope = train.functions.user_lock_for(
          identityFromAccount(user),
          mutated.params,
          mutated.dst,
          new Uint8Array(),
          new Uint8Array(),
        );
        tamperedScope.callParams({ forward: [tamperedAmount, lockAssetId] });
        const tamperedRequest = await tamperedScope.getTransactionRequest();

        assert.notDeepEqual(
          tamperedRequest.scriptData,
          built.request.scriptData,
          'sanity: the tampered call must actually encode to different scriptData',
        );
        built.request.scriptData = tamperedRequest.scriptData;

        const attackerBefore = await attacker.getBalance(lockAssetId);

        await assert.rejects(
          () => submitSponsoredUserLock(built, sponsor),
          /InvalidTransactionOutcome|InvalidSignature|invalid-request|VM_HALTED|PredicateVerificationFailed|reason/i,
          `submitting a transaction whose ${tamperCase.name} was altered after the user signed must fail node-side validation`,
        );

        // No lock was created under either the honest or the tampered hashlock, and the
        // attacker (the intended beneficiary of the recipient/amount tampers) received nothing.
        const lockOpt = await train.functions.get_user_lock(hashlock).get();
        assert.equal(lockOpt.value, undefined, 'no lock should have been created from the rejected transaction');
        const attackerAfter = await attacker.getBalance(lockAssetId);
        assert.equal(attackerAfter.sub(attackerBefore).toString(), '0', 'attacker must receive nothing');

        console.log(`Rail 1 ${tamperCase.name}-tamper rejection OK`);
      } finally {
        cleanup();
      }
    },
  );
}

test(
  'Rail 1 same-asset caveat: locking the base asset makes the sponsor\'s own gas-coin change fall back to the user',
  async () => {
    const { provider, wallets, train, cleanup } = await setupTestEnvironment({ walletCount: 2 });
    try {
      const [user, sponsor] = wallets;
      const baseAssetId = await provider.getBaseAssetId();

      const lockAmount = 500_000;
      const hashlock = randomHashlock();
      const params = await makeUserLockParams({
        hashlock,
        recipient: identityFromAccount(user),
        refundTo: identityFromAccount(user),
      });
      const dst = makeDestinationInfo();

      const userBefore = await user.getBalance(baseAssetId);
      const sponsorBefore = await sponsor.getBalance(baseAssetId);

      // Locking the BASE asset -- the same asset the sponsor pays gas in. Per the
      // documented caveat, `assembleTx` cannot give the sponsor's gas-coin its own change
      // destination here (only one change policy per asset is allowed), so it falls back
      // to the user. This does not happen for a non-base locked asset (see the first test
      // in this file, which asserts the opposite -- exact, independent balances).
      const built = await buildSponsoredUserLock({
        provider,
        trainContract: train,
        fundingUser: user,
        sponsor,
        call: { kind: 'user_lock_for', user: identityFromAccount(user) },
        assetId: baseAssetId,
        amount: lockAmount,
        params,
        dst,
      });
      const result = await submitSponsoredUserLock(built, sponsor);
      assert.equal(result.returnValue, hashlock);

      const userAfter = await user.getBalance(baseAssetId);
      const sponsorAfter = await sponsor.getBalance(baseAssetId);

      // Sponsor's ENTIRE gas-covering coin was consumed with no change returned to it --
      // it paid vastly more than just the gas fee (the documented, sponsor-side-only
      // operational caveat -- never a risk to the user's own funds).
      const sponsorDelta = sponsorBefore.sub(sponsorAfter);
      assert.ok(
        sponsorDelta.gt(bn(lockAmount)),
        `expected the same-asset caveat to make the sponsor overpay well beyond the ${lockAmount}-unit ` +
          `lock amount (its own change wasn't returned to it), only paid ${sponsorDelta.toString()}`,
      );

      // Correspondingly, the user's balance does NOT drop by just the lock amount -- it
      // nets *positive* here, because the sponsor's leftover gas-coin change lands on the
      // user instead of the sponsor.
      const userDelta = userAfter.sub(userBefore);
      assert.ok(
        userDelta.gt(bn(0)),
        `expected the user's balance to net positive due to the sponsor's misdirected change, got delta ${userDelta.toString()}`,
      );

      console.log(
        `Rail 1 same-asset caveat OK (documented, not a bug in the protocol sense): sponsor paid ${sponsorDelta.toString()} total, user netted +${userDelta.toString()}`,
      );
    } finally {
      cleanup();
    }
  },
);
