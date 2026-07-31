/**
 * Gasless Rail 1 -- sponsored transaction (fee abstraction) for the Fuel `Train` contract.
 *
 * No new Sway code is involved here: this is pure fuels-ts orchestration. The user builds
 * and signs one real `ScriptTransactionRequest` calling `Train.user_lock`/`user_lock_for`,
 * funded from their own coin UTXO (the locked `amount`/`assetId`). A separate sponsor
 * account is named as the fee payer -- it contributes a base-asset coin input for gas and
 * co-signs as a second witness. Both witnesses cover the *same* transaction, so the
 * sponsor's role is strictly "pays gas, can refuse to submit" -- it cannot alter the user's
 * signed call, amount, or recipient, because the user's own signature covers every field
 * that actually sources or routes funds in this flow: every coin input, the change output's
 * destination, the script and its script-data (the call target/amount/asset), including the
 * sponsor's own fee input. (Precisely: fuels-ts's transaction-ID hash zeroes a few fields the
 * signature does NOT cover -- Variable-output to/amount/assetId and the Change-output amount
 * -- but `user_lock`/`user_lock_for` never write a Variable output, so there is nothing there
 * for a sponsor to pre-set. Re-verify this if this pattern is ever reused for a call that DOES
 * pay out, e.g. a sponsored redeem/refund.) A malicious sponsor's only lever is
 * liveness/griefing (declining to submit); it has zero ability to redirect funds here.
 *
 * Key fuels-ts (v0.103.0) API points, confirmed against the installed package and a real node:
 *   - `Provider.assembleTx({ request, feePayerAccount, accountCoinQuantities, ... })` estimates
 *     and funds the transaction server-side (the node resolves UTXOs per named account and
 *     computes gas/fee), returning the mutated `assembledRequest` + resolved `gasPrice`. Requires
 *     fuel-core >= ~0.43. Each unique coin-input owner gets its own witness slot, so naming
 *     `account: fundingUser` for the locked amount and `feePayerAccount: sponsor` for gas produces
 *     exactly two independent witness slots with no extra plumbing.
 *   - Witnesses are filled with `wallet.signTransaction(request)` +
 *     `request.updateWitnessByOwner(...)` rather than the convenience
 *     `WalletUnlocked.populateTransactionWitnessesSignature`. This is deliberate, not style:
 *     that convenience method's internal `instanceof ScriptTransactionRequest` check fails across
 *     the `fuels` vs `fuels/test-utils` bundle boundary (each esbuild bundle embeds its own copy
 *     of the class), so it silently signs a rebuilt clone and leaves the caller's own request
 *     witness slot empty. `signTransaction` + `updateWitnessByOwner` operate on the exact object
 *     the caller holds. DO NOT switch back to the convenience method.
 *   - `buildFunctionResult` decodes the ABI return value/logs from a raw `TransactionResponse` --
 *     the same helper `.call()` uses internally, reused here because we hand-roll funding/signing
 *     (`.call()` cannot split payer from funder).
 */
import {
  bn,
  buildFunctionResult,
  setAndValidateGasAndFeeForAssembledTx,
  type BigNumberish,
  type Contract,
  type FunctionInvocationScope,
  type Provider,
  type ScriptTransactionRequest,
  type TransactionResult,
  type WalletUnlocked,
} from 'fuels';

// ───────────────────────────── ABI-shaped input types ─────────────────────────────
//
// These mirror `chains/fuel/train/src/main.sw`'s `UserLockParams`/`DestinationInfo`
// field-for-field (see that file for the authoritative definitions). Deliberately hand-written
// rather than `fuels typegen`-generated, matching this repo's convention of driving the ABI JSON
// directly.

/** JS-side shape fuels-ts expects for a Sway `Identity` (`enum std::identity::Identity`). */
export type IdentityInput = { Address: { bits: string } } | { ContractId: { bits: string } };

export function identityFromAddress(bits: string): IdentityInput {
  return { Address: { bits } };
}

export function identityFromContractId(bits: string): IdentityInput {
  return { ContractId: { bits } };
}

/** Convenience: build an `Identity` from anything exposing a Fuel `.address` (a wallet). */
export function identityFromAccount(account: { address: { toB256(): string } }): IdentityInput {
  return identityFromAddress(account.address.toB256());
}

/**
 * Mirrors `UserLockParams` from `main.sw`. `payout_curve`/`payout_curve_data` are Sway
 * `Option<T>`s, which fuels-ts (`OptionCoder`) represents directly as `T | undefined` --
 * NOT as `{Some: T}`/`{None}` -- so pass the *inner* value or omit the field entirely.
 */
export interface UserLockParamsInput {
  hashlock: string;
  timelock_delta: BigNumberish;
  quote_expiry: BigNumberish;
  recipient: IdentityInput;
  refund_to: IdentityInput;
  payout_curve?: { bits: string };
  payout_curve_data?: Uint8Array;
  reward_amount: BigNumberish;
  reward_timelock_delta: BigNumberish;
  reward_token: string;
  reward_recipient: string;
  src_chain: string;
}

/** Mirrors `DestinationInfo` from `main.sw`. */
export interface DestinationInfoInput {
  dst_chain: string;
  dst_address: string;
  dst_amount: BigNumberish;
  dst_token: string;
}

/** Which `Train` entrypoint to call -- `user_lock` (caller attributed) or `user_lock_for`
 * (attributed to an arbitrary `user`, funded by the caller; see `main.sw`'s attribution
 * note on `user_lock_for`). */
export type SponsoredUserLockCall =
  | { kind: 'user_lock' }
  | { kind: 'user_lock_for'; user: IdentityInput };

export interface BuildSponsoredUserLockArgs {
  /** Provider connected to the target Fuel node (local test node or testnet). */
  provider: Provider;
  /** A `Contract` instance for the deployed `Train` contract (any account/provider works --
   * only `.id`/`.interface` are used to build the call; funding/signing is handled here). */
  trainContract: Contract;
  /** Funds the lock amount and signs the call. Attributed as `sender` for `user_lock`, or
   * as the caller (funder) for `user_lock_for`. */
  fundingUser: WalletUnlocked;
  /** Pays gas only -- contributes the fee coin input and co-signs. Never funds the lock. */
  sponsor: WalletUnlocked;
  /** Which entrypoint to call. */
  call: SponsoredUserLockCall;
  /** Asset forwarded as the lock principal (`msg_asset_id()` on-chain). */
  assetId: string;
  /** Amount forwarded as the lock principal (`msg_amount()` on-chain). */
  amount: BigNumberish;
  params: UserLockParamsInput;
  dst: DestinationInfoInput;
  userData?: Uint8Array;
  solverData?: Uint8Array;
}

export interface SponsoredUserLockBuild {
  /** The fully assembled, dual-funded transaction request. After `buildSponsoredUserLock`
   * returns, `fundingUser`'s witness is already populated; the sponsor's witness slot is
   * still an empty placeholder (filled in by `submitSponsoredUserLock`, which is also the
   * point where the transaction is actually broadcast -- nothing is submitted here). */
  request: ScriptTransactionRequest;
  provider: Provider;
  trainContract: Contract;
  /** Kept around so `submitSponsoredUserLock` can decode the return value/logs via
   * `buildFunctionResult` -- the same ABI-aware decoding `.call()` uses internally. */
  invocationScope: FunctionInvocationScope;
  /** The hashlock this lock will be created under (caller-supplied, from `params.hashlock`
   * -- `Train` does not generate it), handed back for convenience so a caller doesn't have
   * to thread `params.hashlock` through separately to look up the resulting lock/event. */
  hashlock: string;
}

/**
 * Builds (funds + partially signs) a sponsored `user_lock`/`user_lock_for` call.
 *
 * `fundingUser` supplies the coin covering `amount`/`assetId` (the lock principal) and
 * signs the whole transaction. `sponsor` is named as `feePayerAccount` in `assembleTx`, so
 * the Fuel node sources the *gas* coin from the sponsor's own UTXOs instead -- distinct
 * accounts, distinct witness slots, distinct balance impact. Returns a request that still
 * needs the sponsor's witness filled in and to be broadcast; see `submitSponsoredUserLock`.
 *
 * IMPORTANT, discovered empirically (see the integration test for the full repro):
 * `call: { kind: 'user_lock' }` is only usable here when `sponsor` and `fundingUser` are the
 * *same* account. `Train::user_lock` (main.sw) attributes `sender` via Sway's
 * `std::auth::msg_sender()`, which (per `sway-lib-std`'s `auth.sw`, `caller_address()`)
 * walks every coin/message input on the transaction and returns
 * `Err(AuthError::InputsNotAllOwnedBySameAddress)` the instant it sees two different owners
 * -- `user_lock`'s `msg_sender().unwrap()` then panics. A sponsor's fee input is, by
 * construction, owned by a *different* address than the user's, so plain `user_lock` will
 * always revert once a distinct sponsor is introduced (a bare `revert(0)` with no
 * decodable log, since it's a raw `Result::unwrap()` panic rather than a Sway `require()`).
 * `user_lock_for(user, ...)` sidesteps this entirely -- it takes `user` as an explicit
 * parameter instead of deriving it from `msg_sender()` -- so real Rail-1 sponsorship of a
 * `user_lock`-shaped call (attributing the lock to the funding user themself) MUST go
 * through `{ kind: 'user_lock_for', user: identityFromAccount(fundingUser) }`, not
 * `{ kind: 'user_lock' }`. This function throws early with an explanatory error rather than
 * letting the caller hit an opaque on-chain revert.
 */
export async function buildSponsoredUserLock(
  args: BuildSponsoredUserLockArgs,
): Promise<SponsoredUserLockBuild> {
  const {
    provider,
    trainContract,
    fundingUser,
    sponsor,
    call,
    assetId,
    amount,
    params,
    dst,
    userData = new Uint8Array(),
    solverData = new Uint8Array(),
  } = args;

  if (call.kind === 'user_lock' && !fundingUser.address.equals(sponsor.address)) {
    throw new Error(
      "buildSponsoredUserLock: call.kind 'user_lock' calls Sway's msg_sender(), which " +
        'reverts as soon as the transaction has coin inputs from more than one owner ' +
        '(std::auth::AuthError::InputsNotAllOwnedBySameAddress) -- which is exactly what a ' +
        "distinct sponsor's fee input causes. Use { kind: 'user_lock_for', user: " +
        'identityFromAccount(fundingUser) } instead to sponsor a user_lock-equivalent call.',
    );
  }

  const invocationScope: FunctionInvocationScope =
    call.kind === 'user_lock'
      ? trainContract.functions.user_lock(params, dst, userData, solverData)
      : trainContract.functions.user_lock_for(call.user, params, dst, userData, solverData);

  // Forwards the lock principal as this call's single (assetId, amount) coin -- the
  // Fuel-native equivalent of EVM's payable `amount`. This does NOT by itself decide whose
  // wallet the coin comes from; that's decided below via `accountCoinQuantities`.
  invocationScope.callParams({ forward: [amount, assetId] });

  const request = await invocationScope.getTransactionRequest();
  // Mirror the SDK's own `fundWithRequiredCoins` starting point (see
  // `@fuel-ts/program/dist/index.js`): zero these out so `assembleTx`'s node-side
  // estimation is the sole source of truth for gas/fee, rather than whatever default the
  // unfunded request happened to carry.
  request.maxFee = bn(0);
  request.gasLimit = bn(0);

  // SAME-ASSET CAVEAT (empirically confirmed against a real node): `assembleTx` allows only ONE
  // change destination per assetId across a transaction. This only bites when the locked `assetId`
  // is also the base (gas) asset -- the only case where the user's and sponsor's entries can
  // collide on one assetId. When they differ (the common bridge case) both entries are independent
  // and the distinct sponsor entry is added below. When they're the same, a second differently-
  // routed entry is omitted (the node would reject it), so the single shared change destination
  // falls back to `fundingUser` -- i.e. the sponsor's own unspent gas change returns to the user,
  // not the sponsor. That is a sponsor-side operational concern (it can overpay into the user's
  // pocket; keep gas coins close to the real fee), never a fund-safety issue for the user.
  const baseAssetId = await provider.getBaseAssetId();
  const sameAssetAsGas = assetId.toLowerCase() === baseAssetId.toLowerCase();
  const { assembledRequest, gasPrice } = await provider.assembleTx({
    request,
    feePayerAccount: sponsor,
    accountCoinQuantities: [
      {
        assetId,
        amount: bn(amount),
        account: fundingUser,
        // Change from this UTXO returns to the user, not the sponsor.
        changeOutputAccount: fundingUser,
      },
      // Only add a distinct sponsor entry when the assets don't collide -- see the caveat
      // above for why this must be omitted (not merely "also set to fundingUser") in the
      // same-asset case: providing it there gets flatly rejected by the node.
      ...(sameAssetAsGas
        ? []
        : [
            {
              assetId: baseAssetId,
              amount: bn(0),
              account: sponsor,
              changeOutputAccount: sponsor,
            },
          ]),
    ],
  });

  await setAndValidateGasAndFeeForAssembledTx({
    gasPrice,
    provider,
    transactionRequest: assembledRequest,
  });

  // The user signs first. Their witness covers the *entire* assembled transaction -- every
  // input/output/script/script-data, including the sponsor's fee input -- which is exactly what
  // makes the sponsor's role fee-only: the sponsor cannot alter anything the user signed off on
  // without invalidating the user's witness (the signed transaction ID hashes the whole body).
  // Uses `signTransaction` + `updateWitnessByOwner`, not `populateTransactionWitnessesSignature`
  // -- see the file-level doc comment's cross-bundle `instanceof` hazard note.
  const userSignature = await fundingUser.signTransaction(assembledRequest);
  assembledRequest.updateWitnessByOwner(fundingUser.address, userSignature);

  return {
    request: assembledRequest,
    provider,
    trainContract,
    invocationScope,
    hashlock: params.hashlock,
  };
}

export interface SubmitSponsoredUserLockResult {
  transactionId: string;
  /** The hashlock this lock was created under (echoed from the build step). */
  hashlock: string;
  /** The decoded contract return value -- `user_lock`/`user_lock_for` return the hashlock
   * as a `b256`, so this should equal `hashlock` above; kept separate so a caller can
   * assert the two actually match rather than assuming it. */
  returnValue: unknown;
  /** ABI-decoded logs from the transaction, including the `UserLocked` event. */
  logs: unknown[];
  groupedLogs: Record<string, unknown[]>;
  transactionResult: TransactionResult;
}

/**
 * Fills in the sponsor's witness and broadcasts the transaction built by
 * `buildSponsoredUserLock`. Signs directly against `built.request` (see the file-level doc
 * comment on why this doesn't go through `wallet.sendTransaction`'s own internal
 * `populateTransactionWitnessesSignature` call), then submits via `provider.sendTransaction`
 * -- the plain, wallet-independent submission path, so nothing implicitly re-derives or
 * re-signs the request between "fully signed" and "submitted". Waits for the result and
 * returns the decoded outcome.
 */
export async function submitSponsoredUserLock(
  built: SponsoredUserLockBuild,
  sponsor: WalletUnlocked,
): Promise<SubmitSponsoredUserLockResult> {
  const sponsorSignature = await sponsor.signTransaction(built.request);
  built.request.updateWitnessByOwner(sponsor.address, sponsorSignature);

  const transactionResponse = await built.provider.sendTransaction(built.request, {
    estimateTxDependencies: false,
  });

  const result = await buildFunctionResult({
    funcScope: built.invocationScope,
    isMultiCall: false,
    program: built.trainContract,
    transactionResponse,
  });

  return {
    transactionId: result.transactionId,
    hashlock: built.hashlock,
    returnValue: result.value,
    logs: result.logs,
    groupedLogs: result.groupedLogs,
    transactionResult: result.transactionResult,
  };
}
