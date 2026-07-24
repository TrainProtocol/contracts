/**
 * Shared local-node test harness for the Fuel/Sway "Train" HTLC port.
 *
 * Factors out everything `sponsoredTx.test.ts` (Rail 1) and the core-contract test files
 * already proved out against a real local `fuel-core` node -- node launch, contract
 * deployment, `UserLockParams`/`SolverLockParams`/`DestinationInfo` defaults, and the common
 * call shapes -- so later test files can read like intent ("lock, then redeem, then assert")
 * instead of re-deriving this plumbing every time.
 *
 * Nothing here reimplements Rail 1: `buildSponsoredUserLock`/`submitSponsoredUserLock` are
 * re-exported directly from `./sponsoredTx` (the actual Rail-1 implementation).
 *
 * NODE VERSION NOTE: `forc build` is driven by the `train` fuelup toolchain (forc 0.68.7 / std
 * v0.68.7 -- the newest forc that fuels-ts 0.103.0 officially supports); `forc build` itself does
 * not use fuel-core. The local-node tests, however, run against a real `fuel-core` binary via
 * `launchTestNode`, and fuels-ts 0.103.0 supports fuel-core 0.47.1. A separate fuelup toolchain
 * ("fuel-core-testnode") pins `fuel-core@0.47.1` specifically for these tests;
 * `TEST_NODE_FUEL_CORE_PATH` below points `launchTestNode` at it. The `train` toolchain used for
 * `forc build` is untouched by this.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  Contract,
  ContractFactory,
  DateTime,
  type BigNumberish,
  type FunctionInvocationScope,
  type Provider,
  type TransactionResult,
  type WalletUnlocked,
} from 'fuels';
import { launchTestNode, TestAssetId } from 'fuels/test-utils';

import {
  buildSponsoredUserLock,
  submitSponsoredUserLock,
  identityFromAddress,
  identityFromContractId,
  identityFromAccount,
  type BuildSponsoredUserLockArgs,
  type DestinationInfoInput,
  type IdentityInput,
  type SponsoredUserLockBuild,
  type SponsoredUserLockCall,
  type SubmitSponsoredUserLockResult,
  type UserLockParamsInput,
} from './sponsoredTx';

// Re-exported so a test file only needs one import line for the Rail-1 primitives (`reuse
// sponsoredTx.ts's existing exports directly rather than re-implementing`, per this harness's
// brief) plus the identity/type helpers shared across every call shape below.
export {
  buildSponsoredUserLock,
  submitSponsoredUserLock,
  identityFromAddress,
  identityFromContractId,
  identityFromAccount,
  TestAssetId,
};
export type {
  BuildSponsoredUserLockArgs,
  DestinationInfoInput,
  IdentityInput,
  SponsoredUserLockBuild,
  SponsoredUserLockCall,
  SubmitSponsoredUserLockResult,
  UserLockParamsInput,
};

// ───────────────────────────── Compiled artifacts ─────────────────────────────
//
// Loaded once at module scope -- kept here so `train`'s and `payout_curve`'s ABI/bytecode are
// each read from disk exactly once no matter how many test files import this harness.

const FUEL_ROOT = path.join(__dirname, '../..');

const TRAIN_PROJECT_DIR = path.join(FUEL_ROOT, 'train');
export const trainAbi = JSON.parse(
  fs.readFileSync(path.join(TRAIN_PROJECT_DIR, 'out/debug/train-abi.json'), 'utf-8'),
);
export const trainBytecode = fs.readFileSync(path.join(TRAIN_PROJECT_DIR, 'out/debug/train.bin'));

const PAYOUT_CURVE_PROJECT_DIR = path.join(FUEL_ROOT, 'payout_curve');
export const payoutCurveAbi = JSON.parse(
  fs.readFileSync(path.join(PAYOUT_CURVE_PROJECT_DIR, 'out/debug/payout_curve-abi.json'), 'utf-8'),
);
export const payoutCurveBytecode = fs.readFileSync(
  path.join(PAYOUT_CURVE_PROJECT_DIR, 'out/debug/payout_curve.bin'),
);

/** A second fuelup toolchain's fuel-core binary (v0.47.1) -- see the file-level "NODE VERSION
 * NOTE" above. Overridable via `FUEL_CORE_TESTNODE_PATH` (as before) or per-call via
 * `setupTestEnvironment`'s `fuelCorePath` option. */
export const TEST_NODE_FUEL_CORE_PATH =
  process.env.FUEL_CORE_TESTNODE_PATH ??
  path.join(process.env.HOME ?? '', '.fuelup/toolchains/fuel-core-testnode/bin/fuel-core');

// ───────────────────────────── Environment setup ─────────────────────────────

export interface SetupTestEnvironmentOptions {
  /** Number of funded test wallets to create. Default 3 (enough for the common
   * user/funder/relayer or user/sponsor + spare shapes). */
  walletCount?: number;
  /** Extra (non-base-asset) test assets each wallet is seeded with. Default `[TestAssetId.A]`. */
  assets?: TestAssetId[];
  /** Amount per coin (of each asset, including the base asset) each wallet starts with. */
  amountPerCoin?: BigNumberish;
  /** Override for the fuel-core >= 0.43 binary `launchTestNode` connects to. Defaults to
   * `TEST_NODE_FUEL_CORE_PATH`; falls back to the toolchain-default fuel-core if that path
   * doesn't exist on disk (mirrors the prior two test files' behavior exactly). */
  fuelCorePath?: string;
}

export interface TestEnvironment {
  provider: Provider;
  /** `walletCount` funded wallets, in creation order. */
  wallets: WalletUnlocked[];
  /** The deployed `Train` contract. */
  train: Contract;
  /** The deployed `ConstantPayoutCurve` contract (the reference `PayoutCurve` implementation). */
  payoutCurve: Contract;
  /** Kills the test node. Always call in a `finally` block, exactly like the prior test
   * files did. */
  cleanup: () => void;
}

/**
 * Launches the dual-toolchain local test node (see the file-level "NODE VERSION NOTE") and
 * deploys `train` and `payout_curve`.
 */
export async function setupTestEnvironment(
  options: SetupTestEnvironmentOptions = {},
): Promise<TestEnvironment> {
  const {
    walletCount = 3,
    assets = [TestAssetId.A],
    amountPerCoin = 1_000_000_000,
    fuelCorePath = TEST_NODE_FUEL_CORE_PATH,
  } = options;

  const node = await launchTestNode({
    walletsConfig: {
      count: walletCount,
      assets,
      amountPerCoin,
    },
    nodeOptions: {
      fuelCorePath: fs.existsSync(fuelCorePath) ? fuelCorePath : undefined,
    },
    contractsConfigs: [
      {
        deploy: (wallet: WalletUnlocked, deployOptions?: unknown) =>
          new ContractFactory(trainBytecode, trainAbi, wallet).deploy(deployOptions as never),
      },
      {
        deploy: (wallet: WalletUnlocked, deployOptions?: unknown) =>
          new ContractFactory(payoutCurveBytecode, payoutCurveAbi, wallet).deploy(
            deployOptions as never,
          ),
      },
    ],
  });

  const { provider, wallets, contracts, cleanup } = node;
  const [train, payoutCurve] = contracts;

  return {
    provider,
    wallets,
    train,
    payoutCurve,
    cleanup,
  };
}

// ───────────────────────────── Small time/hash utilities ─────────────────────────────

/** A TAI64 timestamp `secondsFromNow` seconds in the future -- the same time domain
 * `std::block::timestamp()` actually returns (TAI64, not raw Unix seconds; confirmed against a
 * live node in the Rail-1 phase). Matches `UserLockParams.quote_expiry`'s existing convention
 * throughout this port. */
export async function futureTai64(secondsFromNow: number): Promise<string> {
  return DateTime.fromUnixSeconds(Math.floor(Date.now() / 1000) + secondsFromNow).toTai64();
}

/** A fresh random 32-byte hex value, suitable as a `hashlock` placeholder in tests that don't
 * care about a real preimage (i.e. every test that doesn't call `redeem_user`/`redeem_solver`). */
export function randomHashlock(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

// ───────────────────────────── Default-valid input builders ─────────────────────────────

export interface MakeUserLockParamsOptions {
  /** No universally sensible default exists for a lock's owner-facing identity -- required. */
  recipient: IdentityInput;
  /** Defaults to `recipient` (a self-redeemable/refundable lock is the common test shape). */
  refundTo?: IdentityInput;
  hashlock?: string;
  timelockDelta?: BigNumberish;
  /** Seconds from now for `quote_expiry`'s TAI64 value. Ignored if `quoteExpiry` is set. */
  quoteExpirySecondsFromNow?: number;
  /** Explicit TAI64 `quote_expiry` override; takes precedence over `quoteExpirySecondsFromNow`. */
  quoteExpiry?: string;
  payoutCurve?: { bits: string };
  payoutCurveData?: Uint8Array;
  rewardAmount?: BigNumberish;
  rewardTimelockDelta?: BigNumberish;
  rewardToken?: string;
  rewardRecipient?: string;
  srcChain?: string;
}

/** Builds a default-valid `UserLockParams` (passes every `validate_user_lock_params` check as
 * long as the caller forwards a nonzero coin) -- override only the fields a given test actually
 * cares about. `recipient` has no sensible universal default and must be supplied. */
export async function makeUserLockParams(
  opts: MakeUserLockParamsOptions,
): Promise<UserLockParamsInput> {
  const quoteExpiry = opts.quoteExpiry ?? (await futureTai64(opts.quoteExpirySecondsFromNow ?? 3600));
  return {
    hashlock: opts.hashlock ?? randomHashlock(),
    timelock_delta: opts.timelockDelta ?? 3600,
    quote_expiry: quoteExpiry,
    recipient: opts.recipient,
    refund_to: opts.refundTo ?? opts.recipient,
    payout_curve: opts.payoutCurve,
    payout_curve_data: opts.payoutCurveData,
    reward_amount: opts.rewardAmount ?? 0,
    reward_timelock_delta: opts.rewardTimelockDelta ?? 0,
    reward_token: opts.rewardToken ?? 'ETH',
    reward_recipient: opts.rewardRecipient ?? '',
    src_chain: opts.srcChain ?? 'FUEL',
  };
}

/** Builds a `DestinationInfo` with placeholder-but-valid cross-chain destination fields --
 * every field is informational/logged-only (see `interfaces::DestinationInfo`), so these
 * defaults are fine for any test that doesn't specifically assert on destination routing. */
export function makeDestinationInfo(
  overrides: Partial<DestinationInfoInput> = {},
): DestinationInfoInput {
  return {
    dst_chain: 'TON',
    dst_address: '0QSomeDestinationAddress',
    dst_amount: 42,
    dst_token: 'TON',
    ...overrides,
  };
}

/** Mirrors `SolverLockParams` from `train/src/main.sw` field-for-field (hand-written, matching
 * this repo's existing convention of not using `fuels typegen`-generated types). */
export interface SolverLockParamsInput {
  hashlock: string;
  reward: BigNumberish;
  timelock_delta: BigNumberish;
  reward_timelock_delta: BigNumberish;
  recipient: IdentityInput;
  reward_recipient: IdentityInput;
  refund_to: IdentityInput;
  reward_asset_id: { bits: string };
  payout_curve?: { bits: string };
  payout_curve_data?: Uint8Array;
  src_chain: string;
}

export interface MakeSolverLockParamsOptions {
  recipient: IdentityInput;
  /** The principal asset's bits -- also the default for `reward_asset_id` (a same-asset reward,
   * the common case, is bundled into the single forwarded coin). Set `rewardAssetId` to a
   * different asset to declare a different-asset reward, then fund it via `attach_solver_reward`
   * (see `callAttachSolverReward`/`solverLockWithAttachedReward`). */
  assetId: string;
  hashlock?: string;
  reward?: BigNumberish;
  timelockDelta?: BigNumberish;
  rewardTimelockDelta?: BigNumberish;
  refundTo?: IdentityInput;
  rewardRecipient?: IdentityInput;
  rewardAssetId?: string;
  payoutCurve?: { bits: string };
  payoutCurveData?: Uint8Array;
  srcChain?: string;
}

/** Builds a default-valid `SolverLockParams` -- override only what a given test cares about.
 * `recipient`/`assetId` have no sensible universal default and must be supplied. */
export function makeSolverLockParams(opts: MakeSolverLockParamsOptions): SolverLockParamsInput {
  return {
    hashlock: opts.hashlock ?? randomHashlock(),
    reward: opts.reward ?? 0,
    timelock_delta: opts.timelockDelta ?? 3600,
    reward_timelock_delta: opts.rewardTimelockDelta ?? 0,
    recipient: opts.recipient,
    reward_recipient: opts.rewardRecipient ?? opts.recipient,
    refund_to: opts.refundTo ?? opts.recipient,
    reward_asset_id: { bits: opts.rewardAssetId ?? opts.assetId },
    payout_curve: opts.payoutCurve,
    payout_curve_data: opts.payoutCurveData,
    src_chain: opts.srcChain ?? 'FUEL',
  };
}

// ───────────────────────────── Call helpers ─────────────────────────────

/** A `Train`/`PayoutCurve` contract instance re-pointed at a different calling account (a plain
 * ABI-interface wrapper switch -- `Contract` has no `.connect()`; this is the direct
 * replacement). Used so every call helper below can take an explicit `caller` rather than a
 * test having to juggle which wallet a given contract instance happens to already be bound to. */
export function connectAs(contract: Contract, caller: WalletUnlocked): Contract {
  return new Contract(contract.id, contract.interface, caller);
}

export interface CallResult<T = unknown> {
  transactionId: string;
  value: T;
  logs: unknown[];
  transactionResult: TransactionResult;
}

async function runCall<T>(scope: FunctionInvocationScope): Promise<CallResult<T>> {
  const { transactionId, waitForResult } = await scope.call();
  const { value, logs, transactionResult } = await waitForResult();
  return { transactionId, value: value as T, logs, transactionResult };
}

export interface CallUserLockArgs {
  train: Contract;
  caller: WalletUnlocked;
  assetId: string;
  amount: BigNumberish;
  params: UserLockParamsInput;
  dst: DestinationInfoInput;
  userData?: Uint8Array;
  solverData?: Uint8Array;
}

/** Calls `Train::user_lock`, funded and signed by `caller`. Returns the decoded hashlock
 * (`value`), logs, and transaction result. */
export async function callUserLock(args: CallUserLockArgs): Promise<CallResult<string>> {
  const train = connectAs(args.train, args.caller);
  const scope = train.functions
    .user_lock(args.params, args.dst, args.userData ?? new Uint8Array(), args.solverData ?? new Uint8Array())
    .callParams({ forward: [args.amount, args.assetId] });
  return runCall<string>(scope);
}

export interface CallUserLockForArgs extends CallUserLockArgs {
  /** The identity the lock is attributed to (see `user_lock_for`'s attribution note --
   * purely a label; `caller` still funds and signs). */
  user: IdentityInput;
}

/** Calls `Train::user_lock_for`, funded and signed by `caller`, attributed to `args.user`. */
export async function callUserLockFor(args: CallUserLockForArgs): Promise<CallResult<string>> {
  const train = connectAs(args.train, args.caller);
  const scope = train.functions
    .user_lock_for(
      args.user,
      args.params,
      args.dst,
      args.userData ?? new Uint8Array(),
      args.solverData ?? new Uint8Array(),
    )
    .callParams({ forward: [args.amount, args.assetId] });
  return runCall<string>(scope);
}

export interface CallSolverLockArgs {
  train: Contract;
  caller: WalletUnlocked;
  assetId: string;
  amount: BigNumberish;
  params: SolverLockParamsInput;
  dst: DestinationInfoInput;
  data?: Uint8Array;
}

/** Calls `Train::solver_lock`, funded and signed by `caller`. Returns the decoded 1-based
 * solver-lock index (`value`). */
export async function callSolverLock(args: CallSolverLockArgs): Promise<CallResult<number>> {
  const train = connectAs(args.train, args.caller);
  const scope = train.functions
    .solver_lock(args.params, args.dst, args.data ?? new Uint8Array())
    .callParams({ forward: [args.amount, args.assetId] });
  return runCall<number>(scope);
}

/** Calls `Train::attach_solver_reward(hashlock, index)` as `caller`, forwarding the reward coin
 * (`reward` of `rewardAssetId`). This is step two of the two-step different-asset funding flow:
 * `solver_lock` locks the principal and declares the reward; this escrows it. */
export async function callAttachSolverReward(args: {
  train: Contract;
  caller: WalletUnlocked;
  hashlock: string;
  index: BigNumberish;
  reward: BigNumberish;
  rewardAssetId: string;
}): Promise<CallResult<boolean>> {
  const train = connectAs(args.train, args.caller);
  const scope = train.functions
    .attach_solver_reward(args.hashlock, args.index)
    .callParams({ forward: [args.reward, args.rewardAssetId] });
  return runCall<boolean>(scope);
}

export interface SolverLockWithAttachedRewardArgs {
  train: Contract;
  caller: WalletUnlocked;
  /** Principal asset bits + amount forwarded to `solver_lock`. */
  assetId: string;
  amount: BigNumberish;
  /** Reward asset bits + amount forwarded to `attach_solver_reward` (must be a different asset
   * than `assetId` -- a same-asset reward needs no attach step). */
  rewardAssetId: string;
  reward: BigNumberish;
  /** Must declare `reward_asset_id: rewardAssetId` and the matching `reward` (build with
   * `makeSolverLockParams({ ..., rewardAssetId })`). */
  params: SolverLockParamsInput;
  dst: DestinationInfoInput;
  data?: Uint8Array;
}

/**
 * Bundles `solver_lock` (principal in asset A) + `attach_solver_reward` (reward in asset B) into
 * ONE atomic `fuels` multi-call transaction, each call forwarding its own distinct coin.
 *
 * Empirically verified against the installed `fuels` 0.103.0 SDK + a real local `fuel-core`
 * node: `Contract.multiCall([...])` submits both calls in a single transaction, each carrying its
 * own `callParams({ forward: [amount, assetId] })` coin, and either both commit or neither does.
 * The lock is a fresh hashlock, so its solver-lock index is deterministically 1, which the attach
 * call targets. Atomicity is a UX nicety only -- the two calls are equally correct run
 * separately (see `solver_lock`'s doc comment and the `reward_funded` gate).
 */
export async function solverLockWithAttachedReward(
  args: SolverLockWithAttachedRewardArgs,
): Promise<CallResult<[number, boolean]>> {
  const train = connectAs(args.train, args.caller);
  const lockScope = train.functions
    .solver_lock(args.params, args.dst, args.data ?? new Uint8Array())
    .callParams({ forward: [args.amount, args.assetId] });
  const attachScope = train.functions
    .attach_solver_reward(args.params.hashlock, 1)
    .callParams({ forward: [args.reward, args.rewardAssetId] });
  const { transactionId, waitForResult } = await train.multiCall([lockScope, attachScope]).call();
  const { value, logs, transactionResult } = await waitForResult();
  return {
    transactionId,
    value: value as [number, boolean],
    logs,
    transactionResult,
  };
}

/** Calls `Train::redeem_user(hashlock, secret)` as `caller`. */
export async function callRedeemUser(
  train: Contract,
  caller: WalletUnlocked,
  hashlock: string,
  secret: BigNumberish,
): Promise<CallResult<boolean>> {
  const connected = connectAs(train, caller);
  return runCall<boolean>(connected.functions.redeem_user(hashlock, secret));
}

/** Calls `Train::redeem_solver(hashlock, index, secret)` as `caller`. */
export async function callRedeemSolver(
  train: Contract,
  caller: WalletUnlocked,
  hashlock: string,
  index: BigNumberish,
  secret: BigNumberish,
): Promise<CallResult<boolean>> {
  const connected = connectAs(train, caller);
  return runCall<boolean>(connected.functions.redeem_solver(hashlock, index, secret));
}

/** Calls `Train::refund_user(hashlock)` as `caller`. */
export async function callRefundUser(
  train: Contract,
  caller: WalletUnlocked,
  hashlock: string,
): Promise<CallResult<boolean>> {
  const connected = connectAs(train, caller);
  return runCall<boolean>(connected.functions.refund_user(hashlock));
}

/** Calls `Train::refund_solver(hashlock, index)` as `caller`. */
export async function callRefundSolver(
  train: Contract,
  caller: WalletUnlocked,
  hashlock: string,
  index: BigNumberish,
): Promise<CallResult<boolean>> {
  const connected = connectAs(train, caller);
  return runCall<boolean>(connected.functions.refund_solver(hashlock, index));
}

// ───────────────────────────── View helpers ─────────────────────────────

/** `Train::get_user_lock(hashlock)`, unwrapped to `null` when no such lock exists (rather than
 * the raw `Option`-shaped `{ Some }`/`undefined` fuels-ts value). */
export async function getUserLock(train: Contract, hashlock: string): Promise<unknown | null> {
  const { value } = await train.functions.get_user_lock(hashlock).get();
  return value ?? null;
}

/** `Train::get_solver_lock(hashlock, index)`, unwrapped to `null` when no such lock exists. */
export async function getSolverLock(
  train: Contract,
  hashlock: string,
  index: BigNumberish,
): Promise<unknown | null> {
  const { value } = await train.functions.get_solver_lock(hashlock, index).get();
  return value ?? null;
}

/** `Train::get_solver_lock_count(hashlock)`. */
export async function getSolverLockCount(train: Contract, hashlock: string): Promise<number> {
  const { value } = await train.functions.get_solver_lock_count(hashlock).get();
  return value;
}

/** `Train::get_user_lock_hashes(user, offset, limit)` -- returns `[hashlocks, total]`. */
export async function getUserLockHashes(
  train: Contract,
  user: IdentityInput,
  offset: BigNumberish = 0,
  limit: BigNumberish = 100,
): Promise<[string[], number]> {
  const { value } = await train.functions.get_user_lock_hashes(user, offset, limit).get();
  return value as [string[], number];
}

/** `Train::get_user_locks(user, offset, limit)` -- returns `[locks, total]`. */
export async function getUserLocks(
  train: Contract,
  user: IdentityInput,
  offset: BigNumberish = 0,
  limit: BigNumberish = 100,
): Promise<[unknown[], number]> {
  const { value } = await train.functions.get_user_locks(user, offset, limit).get();
  return value as [unknown[], number];
}
