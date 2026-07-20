/**
 * TEMPORARY one-shot testnet E2E runner for the Train v5 contract.
 *
 * Single command executes: preflight -> accounts/funding (via setup.ts on first
 * run) -> contract deployment (once, persisted to .env) -> AztecScan
 * verification (once) -> full happy-flow matrix -> unhappy cases (simulation
 * rejection capture) -> concurrency races that produce REAL on-chain reverted
 * txs. Every tx is timed (prove+submit vs inclusion) and written to
 * e2e-report-<ts>.md / .json for manual on-chain analysis.
 *
 * Usage: cd chains/aztec/scripts && npm run e2e:testnet
 * First run prerequisites: L1_PRIVATE_KEY in .env with Sepolia ETH (fee-juice
 * bridge). The script tells you when to bridge and re-run.
 */
import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SetPublicAuthwitContractInteraction } from '@aztec/aztec.js/authorization';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import type { AztecNode } from '@aztec/stdlib/interfaces/client';
import { TxHash } from '@aztec/aztec.js/tx';
import type { EmbeddedWallet } from '@aztec/wallets/embedded';
import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js';
import { TrainContract } from './Train.ts';
import { ConstantPayoutCurveContract } from './ConstantPayoutCurve.ts';
import { getAztecNodeUrl, getEnv, getTimeouts } from './utils/config.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
import { setupWallet, toWallet } from './utils/setupWallet.ts';
import { bytesToHex, stringToBytes, updateEnvFile } from './utils/utils.ts';

// ---------------------------------------------------------------- config

const LOCK_AMOUNT = 1_000n;
const REWARD_AMOUNT = 100n;
const QUOTE_EXPIRY_DELTA = 900; // s
const LONG_TIMELOCK = 3_600; // s - locks we never refund in this run
const SHORT_TIMELOCK = 60; // s - locks we wait out and refund
const SHORT_REWARD_TIMELOCK = 30; // s - reward timelock for the late-redeem case
const SAFE_REWARD_TIMELOCK = 900; // s - reward timelock the redeem comfortably beats

const SRC_CHAIN = stringToBytes('AZTEC', 30);
const DST_CHAIN = stringToBytes('ETHEREUM', 30);
const DST_ADDRESS = stringToBytes('0xE2E', 90);
const DST_TOKEN = stringToBytes('TOKEN', 90);
const ZERO_90 = new Array(90).fill(0);
const ZERO_128 = new Array(128).fill(0);
const ZERO_256 = new Array(256).fill(0);

const AZTECSCAN_BASE = process.env.AZTECSCAN_URL ?? 'https://aztecscan.xyz';

// ---------------------------------------------------------------- report

type Row = {
  n: number;
  stage: string;
  name: string;
  kind: 'tx' | 'sim-reject' | 'check' | 'view' | 'info';
  status: 'OK' | 'REVERTED' | 'FAIL' | 'INFO';
  txHash?: string;
  block?: number;
  proveSubmitMs?: number;
  inclusionMs?: number;
  feeJuice?: string;
  note?: string;
};

const rows: Row[] = [];
let rowCounter = 0;
const runStarted = new Date();

function record(row: Omit<Row, 'n'>): Row {
  const full = { n: ++rowCounter, ...row };
  rows.push(full);
  const timing =
    full.proveSubmitMs != null
      ? ` prove+submit=${(full.proveSubmitMs / 1000).toFixed(1)}s mine=${((full.inclusionMs ?? 0) / 1000).toFixed(1)}s`
      : '';
  console.log(
    `[${full.n}] ${full.stage} | ${full.name} -> ${full.status}` +
      (full.txHash ? ` tx=${full.txHash}` : '') +
      (full.block != null ? ` block=${full.block}` : '') +
      timing +
      (full.note ? ` | ${full.note}` : ''),
  );
  return full;
}

function writeReport(header: Record<string, string>): void {
  const ts = runStarted.toISOString().replace(/[:.]/g, '-');
  const mdPath = `e2e-report-${ts}.md`;
  const jsonPath = `e2e-report-${ts}.json`;

  const md: string[] = [];
  md.push(`# Train v5 testnet E2E report`);
  md.push('');
  md.push(`Started: ${runStarted.toISOString()}  `);
  md.push(`Finished: ${new Date().toISOString()}`);
  md.push('');
  md.push('## Environment');
  md.push('');
  for (const [k, v] of Object.entries(header)) {
    md.push(`- **${k}**: ${v}`);
  }
  md.push('');
  md.push('## Transactions & checks');
  md.push('');
  md.push('| # | Stage | Name | Kind | Status | Tx | Block | Prove+submit | Mine | Fee | Note |');
  md.push('|---|-------|------|------|--------|----|-------|--------------|------|-----|------|');
  for (const r of rows) {
    const tx = r.txHash ? `[${r.txHash.slice(0, 12)}…](${AZTECSCAN_BASE}/txs/${r.txHash})` : '';
    md.push(
      `| ${r.n} | ${r.stage} | ${r.name} | ${r.kind} | ${r.status} | ${tx} | ${r.block ?? ''} | ` +
        `${r.proveSubmitMs != null ? (r.proveSubmitMs / 1000).toFixed(1) + 's' : ''} | ` +
        `${r.inclusionMs != null ? (r.inclusionMs / 1000).toFixed(1) + 's' : ''} | ` +
        `${r.feeJuice ?? ''} | ${(r.note ?? '').replace(/\|/g, '/').slice(0, 220)} |`,
    );
  }
  md.push('');
  const fails = rows.filter((r) => r.status === 'FAIL');
  md.push(`## Summary`);
  md.push('');
  md.push(`- rows: ${rows.length}`);
  md.push(`- mined txs: ${rows.filter((r) => r.kind === 'tx' && r.status !== 'FAIL').length}`);
  md.push(`- on-chain reverted (expected): ${rows.filter((r) => r.status === 'REVERTED').length}`);
  md.push(`- sim-rejected (expected): ${rows.filter((r) => r.kind === 'sim-reject' && r.status === 'OK').length}`);
  md.push(`- FAILURES: ${fails.length}${fails.length ? ' — ' + fails.map((f) => `#${f.n} ${f.name}`).join(', ') : ''}`);
  md.push('');
  fs.writeFileSync(mdPath, md.join('\n'));
  fs.writeFileSync(jsonPath, JSON.stringify({ header, rows }, null, 2));
  console.log(`\nReport written: ${mdPath} / ${jsonPath}`);
}

// ---------------------------------------------------------------- chain helpers

const node: AztecNode = createAztecNodeClient(getAztecNodeUrl());
const timeouts = getTimeouts();

async function chainNow(): Promise<number> {
  const data = await node.getBlockData('latest');
  if (!data) throw new Error('Could not fetch latest block from node');
  return Number(data.header.globalVariables.timestamp);
}

async function waitUntilChainTime(target: number, label: string): Promise<void> {
  let now = await chainNow();
  if (now >= target) return;
  console.log(`Waiting for chain time >= ${target} (${label}); now=${now}, ~${target - now}s to go...`);
  while (now < target) {
    await new Promise((r) => setTimeout(r, 10_000));
    now = await chainNow();
  }
  console.log(`Chain time reached ${now} (target ${target}).`);
}

async function waitForReceipt(txHash: TxHash, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await node.getTxReceipt(txHash);
    if (receipt.isMined()) return receipt;
    if (receipt.isDropped()) {
      throw new Error(`Tx ${txHash} dropped: ${receipt.error ?? 'no error info'}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for tx ${txHash} to be mined`);
    }
    await new Promise((r) => setTimeout(r, 4_000));
  }
}

type Role = {
  label: string;
  wallet: EmbeddedWallet;
  address: AztecAddress;
};

/**
 * Sends an interaction without waiting (NO_WAIT), then polls the node for the
 * mined receipt — giving separate prove+submit vs inclusion timings.
 */
async function sendTracked(
  stage: string,
  name: string,
  interaction: { send: (opts: any) => Promise<any> },
  role: Role,
  opts: { allowRevert?: boolean } = {},
): Promise<{ row: Row; receipt: Awaited<ReturnType<typeof waitForReceipt>> }> {
  const pay = await getPaymentMethod(role.wallet, role.address);
  const t0 = Date.now();
  const sent = await interaction.send({
    from: role.address,
    ...(pay ? { fee: { paymentMethod: pay } } : {}),
    wait: 'NO_WAIT',
  });
  const t1 = Date.now();
  const txHash: TxHash = sent.txHash;
  const receipt = await waitForReceipt(txHash, timeouts.txTimeout);
  const t2 = Date.now();

  const reverted = receipt.hasExecutionReverted();
  const status: Row['status'] = reverted ? (opts.allowRevert ? 'REVERTED' : 'FAIL') : 'OK';
  const row = record({
    stage,
    name,
    kind: 'tx',
    status,
    txHash: txHash.toString(),
    block: Number(receipt.blockNumber),
    proveSubmitMs: t1 - t0,
    inclusionMs: t2 - t1,
    feeJuice: receipt.transactionFee?.toString(),
    note: reverted ? `on-chain revert: ${receipt.error ?? receipt.executionResult ?? ''}` : undefined,
  });
  if (reverted && !opts.allowRevert) {
    throw new Error(`Unexpected on-chain revert in "${name}": ${receipt.error ?? 'unknown'}`);
  }
  return { row, receipt };
}

/** Attempts a call expected to fail at local simulation; records the assert message. */
async function expectSimReject(
  stage: string,
  name: string,
  expectSubstring: string,
  interaction: { simulate: (opts: any) => Promise<any> },
  role: Role,
): Promise<void> {
  try {
    await interaction.simulate({ from: role.address });
    record({
      stage,
      name,
      kind: 'sim-reject',
      status: 'FAIL',
      note: `simulation unexpectedly SUCCEEDED (expected "${expectSubstring}")`,
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const hit = msg.includes(expectSubstring);
    record({
      stage,
      name,
      kind: 'sim-reject',
      status: hit ? 'OK' : 'FAIL',
      note: hit
        ? `rejected with "${expectSubstring}"`
        : `expected "${expectSubstring}", got: ${msg.slice(0, 200)}`,
    });
  }
}

function check(stage: string, name: string, ok: boolean, note: string): void {
  record({ stage, name, kind: 'check', status: ok ? 'OK' : 'FAIL', note });
}

// ---------------------------------------------------------------- secrets

function newSecret(): { secret: number[]; hashlock: number[]; secretHex: string; hashlockHex: string } {
  const secretBuf = crypto.randomBytes(32);
  const hashBuf = crypto.createHash('sha256').update(secretBuf).digest();
  return {
    secret: Array.from(secretBuf),
    hashlock: Array.from(hashBuf),
    secretHex: bytesToHex(secretBuf),
    hashlockHex: bytesToHex(hashBuf),
  };
}

// ---------------------------------------------------------------- contract helpers

type Ctx = {
  user: Role;
  solver: Role;
  deployer: Role;
  trainAddress: AztecAddress;
  tokenAddress: AztecAddress;
  token2Address: AztecAddress;
  curveAddress: AztecAddress;
};

function train(ctx: Ctx, role: Role): TrainContract {
  return TrainContract.at(ctx.trainAddress, toWallet(role.wallet));
}
function token(ctx: Ctx, role: Role, addr?: AztecAddress): TokenContract {
  return TokenContract.at(addr ?? ctx.tokenAddress, toWallet(role.wallet));
}

async function balanceOf(ctx: Ctx, tokenAddr: AztecAddress, owner: AztecAddress): Promise<bigint> {
  const { result } = await token(ctx, ctx.user, tokenAddr)
    .methods.balance_of_public(owner)
    .simulate({ from: ctx.user.address });
  return BigInt(result);
}

/** Registers a public authwit for Train to pull `amount` of `tokenAddr` from `role`. Mined on chain. */
async function authorizePull(
  stage: string,
  label: string,
  ctx: Ctx,
  role: Role,
  tokenAddr: AztecAddress,
  amount: bigint,
  nonce: Fr,
): Promise<void> {
  const action = token(ctx, role, tokenAddr).methods.transfer_public_to_public(
    role.address,
    ctx.trainAddress,
    amount,
    nonce,
  );
  const interaction = await SetPublicAuthwitContractInteraction.create(
    role.wallet as any,
    role.address,
    { caller: ctx.trainAddress, action },
    true,
  );
  await sendTracked(stage, `${label} [authwit ${amount} from ${role.label}]`, interaction, role);
}

type UserLockOpts = {
  timelockDelta?: number;
  quoteExpiry?: number;
  payoutCurve?: AztecAddress;
  recipient?: AztecAddress;
  refundTo?: AztecAddress;
};

async function doUserLock(stage: string, label: string, ctx: Ctx, opts: UserLockOpts = {}) {
  const s = newSecret();
  const nonce = Fr.random();
  const timelockDelta = opts.timelockDelta ?? LONG_TIMELOCK;
  const now = await chainNow();
  const quoteExpiry = opts.quoteExpiry ?? now + QUOTE_EXPIRY_DELTA;

  await authorizePull(stage, label, ctx, ctx.user, ctx.tokenAddress, LOCK_AMOUNT, nonce);
  const call = train(ctx, ctx.user).methods.user_lock(
    s.hashlock,
    LOCK_AMOUNT,
    nonce,
    0n, // reward_amount (informational)
    timelockDelta,
    0, // reward_timelock_delta (informational)
    quoteExpiry,
    opts.refundTo ?? ctx.user.address,
    opts.recipient ?? ctx.solver.address,
    ctx.tokenAddress,
    opts.payoutCurve ?? AztecAddress.ZERO,
    ZERO_128,
    ZERO_90, // reward_token
    ZERO_90, // reward_recipient
    SRC_CHAIN,
    DST_CHAIN,
    DST_ADDRESS,
    LOCK_AMOUNT, // dst_amount
    DST_TOKEN,
    ZERO_256, // user_data
    ZERO_256, // solver_data
  );
  const { receipt } = await sendTracked(stage, `${label} user_lock (hashlock ${s.hashlockHex.slice(0, 10)}…)`, call, ctx.user);
  const lockTime = await chainNow();
  return { ...s, nonce, timelock: lockTime + 0, quoteExpiry, timelockDelta, receipt };
}

type SolverLockOpts = {
  reward?: bigint;
  rewardToken?: AztecAddress;
  rewardRecipient?: AztecAddress;
  timelockDelta?: number;
  rewardTimelockDelta?: number;
  hashlock?: number[];
};

async function doSolverLock(stage: string, label: string, ctx: Ctx, opts: SolverLockOpts = {}) {
  const s = opts.hashlock ? null : newSecret();
  const hashlock = opts.hashlock ?? s!.hashlock;
  const nonce = Fr.random();
  const rewardNonce = Fr.random();
  const reward = opts.reward ?? 0n;
  const rewardToken = opts.rewardToken ?? ctx.tokenAddress;
  const timelockDelta = opts.timelockDelta ?? LONG_TIMELOCK;
  const rewardTimelockDelta = opts.rewardTimelockDelta ?? 0;

  if (reward > 0n && rewardToken.equals(ctx.tokenAddress)) {
    await authorizePull(stage, label, ctx, ctx.solver, ctx.tokenAddress, LOCK_AMOUNT + reward, nonce);
  } else {
    await authorizePull(stage, label, ctx, ctx.solver, ctx.tokenAddress, LOCK_AMOUNT, nonce);
    if (reward > 0n) {
      await authorizePull(stage, `${label} (reward)`, ctx, ctx.solver, rewardToken, reward, rewardNonce);
    }
  }

  const call = train(ctx, ctx.solver).methods.solver_lock(
    hashlock,
    LOCK_AMOUNT,
    nonce,
    reward,
    rewardNonce,
    timelockDelta,
    rewardTimelockDelta,
    ctx.solver.address, // refund_to
    ctx.user.address, // recipient
    opts.rewardRecipient ?? ctx.deployer.address,
    ctx.tokenAddress,
    rewardToken,
    AztecAddress.ZERO, // payout_curve
    ZERO_128,
    SRC_CHAIN,
    DST_CHAIN,
    DST_ADDRESS,
    LOCK_AMOUNT,
    DST_TOKEN,
    ZERO_256,
  );
  const { receipt } = await sendTracked(stage, `${label} solver_lock`, call, ctx.solver);
  // Read the index this lock got (locks under the same hashlock auto-increment)
  const { result: count } = await train(ctx, ctx.user)
    .methods.get_solver_lock_count(hashlock)
    .simulate({ from: ctx.user.address });
  const index = BigInt(count);
  return { secret: s?.secret, secretHex: s?.secretHex, hashlock, index, reward, rewardToken, receipt };
}

async function readUserLock(ctx: Ctx, hashlock: number[]): Promise<any> {
  const { result } = await train(ctx, ctx.user).methods.get_user_lock(hashlock).simulate({ from: ctx.user.address });
  return result;
}
async function readSolverLock(ctx: Ctx, hashlock: number[], index: bigint): Promise<any> {
  const { result } = await train(ctx, ctx.user)
    .methods.get_solver_lock(hashlock, index)
    .simulate({ from: ctx.user.address });
  return result;
}

// ---------------------------------------------------------------- stages

function shellOut(cmd: string, args: string[], extraEnv: Record<string, string> = {}): number {
  console.log(`\n>>> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, AZTEC_ENV: 'testnet', ...extraEnv },
  });
  return res.status ?? 1;
}

async function stagePreflight(): Promise<void> {
  const info = await (node as any).getNodeVersion?.();
  const version = info ?? 'unknown';
  record({ stage: 'S0', name: `node ${getAztecNodeUrl()} version ${version}`, kind: 'info', status: 'INFO' });
  if (String(version) !== '5.0.1') {
    console.warn(`WARNING: node version is ${version}, contracts were built for 5.0.1`);
  }
}

function haveAccountKeys(): boolean {
  return !!(
    process.env.USER_SECRET &&
    process.env.SOLVER_SECRET &&
    process.env.DEPLOYER_SECRET &&
    process.env.USER_ADDRESS
  );
}

async function stageAccounts(): Promise<{ user: Role; solver: Role; deployer: Role }> {
  if (!haveAccountKeys()) {
    console.log('No account keys in .env — running setup.ts to generate them.');
    const code = shellOut('npx', ['tsx', 'setup.ts']);
    if (code !== 0) throw new Error('setup.ts (key generation) failed');
    console.log(
      '\nKeys generated. Now:\n' +
        '  1. AZTEC_ENV=testnet npx tsx bridgeFeeJuice.ts   (needs L1_PRIVATE_KEY with Sepolia ETH)\n' +
        '  2. re-run: npm run e2e:testnet\n',
    );
    process.exit(0);
  }

  const mkRole = async (label: string, prefix: string): Promise<Role> => {
    const wallet = await setupWallet();
    const account = await wallet.createSchnorrAccount(
      Fr.fromString(process.env[`${prefix}_SECRET`]!),
      Fr.fromString(process.env[`${prefix}_SALT`]!),
      (GrumpkinScalar as any).fromString(process.env[`${prefix}_SIGNING_KEY`]!),
    );
    return { label, wallet, address: account.address };
  };

  const user = await mkRole('user', 'USER');
  const solver = await mkRole('solver', 'SOLVER');
  const deployer = await mkRole('deployer', 'DEPLOYER');

  // Accounts deployed? If not, defer to setup.ts (it consumes bridged fee-juice claims).
  const meta = await toWallet(deployer.wallet).getContractMetadata(deployer.address);
  if (meta.initializationStatus !== 'INITIALIZED') {
    console.log('Accounts not deployed yet — running setup.ts (deploy path).');
    const code = shellOut('npx', ['tsx', 'setup.ts']);
    if (code !== 0) throw new Error('setup.ts (account deployment) failed — did you run bridgeFeeJuice.ts?');
    dotenv.config({ override: true }); // pick up TOKEN_ADDRESS etc.
  }
  record({
    stage: 'S1',
    name: `accounts user=${user.address} solver=${solver.address} deployer=${deployer.address}`,
    kind: 'info',
    status: 'INFO',
  });
  return { user, solver, deployer };
}

async function stageContracts(roles: { user: Role; solver: Role; deployer: Role }): Promise<Ctx> {
  const { deployer } = roles;

  const deployTracked = async (name: string, deployMethod: any): Promise<AztecAddress> => {
    const pay = await getPaymentMethod(deployer.wallet, deployer.address);
    const t0 = Date.now();
    const result = await deployMethod.send({
      from: deployer.address,
      ...(pay ? { fee: { paymentMethod: pay } } : {}),
      wait: { timeout: timeouts.deployTimeout },
    });
    const t1 = Date.now();
    record({
      stage: 'S2',
      name: `deploy ${name}`,
      kind: 'tx',
      status: 'OK',
      txHash: result.receipt.txHash?.toString(),
      block: Number(result.receipt.blockNumber),
      proveSubmitMs: t1 - t0,
      feeJuice: result.receipt.transactionFee?.toString(),
    });
    return result.contract.address;
  };

  // Token 1 comes from setup.ts (TOKEN_ADDRESS). Everything else deployed here once.
  const tokenAddrStr = process.env.TOKEN_ADDRESS;
  if (!tokenAddrStr) {
    throw new Error(
      'TOKEN_ADDRESS missing — run `AZTEC_ENV=testnet npx tsx setup.ts` once (it deploys the token and mints to user/solver), then re-run e2e.',
    );
  }
  const tokenAddress = AztecAddress.fromStringUnsafe(tokenAddrStr);

  let token2Address: AztecAddress;
  if (process.env.E2E_TOKEN2_ADDRESS) {
    token2Address = AztecAddress.fromStringUnsafe(process.env.E2E_TOKEN2_ADDRESS);
  } else {
    token2Address = await deployTracked(
      'Token2 (reward token)',
      TokenContract.deployWithOpts(
        { wallet: toWallet(deployer.wallet), method: 'constructor_with_minter' },
        'RWD',
        'RWD',
        18,
        deployer.address,
        AztecAddress.ZERO,
      ),
    );
    updateEnvFile('.env', { E2E_TOKEN2_ADDRESS: token2Address.toString() });
  }

  let curveAddress: AztecAddress;
  if (process.env.E2E_CURVE_ADDRESS) {
    curveAddress = AztecAddress.fromStringUnsafe(process.env.E2E_CURVE_ADDRESS);
  } else {
    curveAddress = await deployTracked(
      'ConstantPayoutCurve',
      ConstantPayoutCurveContract.deploy(toWallet(deployer.wallet)),
    );
    updateEnvFile('.env', { E2E_CURVE_ADDRESS: curveAddress.toString() });
  }

  let trainAddress: AztecAddress;
  if (process.env.TRAIN_ADDRESS) {
    trainAddress = AztecAddress.fromStringUnsafe(process.env.TRAIN_ADDRESS);
  } else {
    trainAddress = await deployTracked('Train', TrainContract.deploy(toWallet(deployer.wallet)));
    updateEnvFile('.env', { TRAIN_ADDRESS: trainAddress.toString() });
  }

  const registerForAllRoles = async (
    label: string,
    address: AztecAddress,
    artifact: Parameters<ReturnType<typeof toWallet>['registerContract']>[1],
  ): Promise<void> => {
    const instance = await node.getContract(address);
    if (!instance) throw new Error(`${label} instance ${address.toString()} was not found on the node`);
    await Promise.all(
      Object.values(roles).map(({ wallet }) =>
        toWallet(wallet).registerContract(instance, artifact),
      ),
    );
  };

  // Contract.at() creates a callable wrapper but does not persist artifact metadata
  // in each EmbeddedWallet. Register every deployed instance explicitly so public
  // simulation failures can be enriched with their named Noir assertion messages.
  await registerForAllRoles('Train', trainAddress, TrainContract.artifact);
  await registerForAllRoles('Token1', tokenAddress, TokenContract.artifact);
  await registerForAllRoles('Token2', token2Address, TokenContract.artifact);
  await registerForAllRoles('ConstantPayoutCurve', curveAddress, ConstantPayoutCurveContract.artifact);

  const ctx: Ctx = { ...roles, trainAddress, tokenAddress, token2Address, curveAddress };
  record({
    stage: 'S2',
    name: `contracts train=${trainAddress} token=${tokenAddress} token2=${token2Address} curve=${curveAddress}`,
    kind: 'info',
    status: 'INFO',
  });

  // Top up balances if needed (deployer is minter of both tokens).
  const need = LOCK_AMOUNT * 30n;
  for (const [addr, who, tokenAddr, label] of [
    [ctx.user.address, ctx.user, tokenAddress, 'token1->user'],
    [ctx.solver.address, ctx.solver, tokenAddress, 'token1->solver'],
    [ctx.solver.address, ctx.solver, token2Address, 'token2->solver'],
  ] as const) {
    const bal = await balanceOf(ctx, tokenAddr, addr);
    if (bal < need) {
      const mint = token(ctx, deployer, tokenAddr).methods.mint_to_public(addr, need * 10n);
      await sendTracked('S2', `mint ${label}`, mint, deployer);
    } else {
      record({ stage: 'S2', name: `${label} balance ok (${bal})`, kind: 'info', status: 'INFO' });
    }
    void who;
  }
  return ctx;
}

async function stageVerification(ctx: Ctx): Promise<void> {
  const verificationKey = [ctx.trainAddress, ctx.tokenAddress, ctx.token2Address]
    .map((address) => address.toString())
    .join(',');
  if (process.env.E2E_VERIFIED_DEPLOYMENTS === verificationKey) {
    record({
      stage: 'S3',
      name: 'AztecScan verification (already done for these deployments)',
      kind: 'info',
      status: 'INFO',
    });
    return;
  }
  const results: Array<[string, number]> = [];
  results.push(['verify Train', shellOut('npx', ['tsx', 'verifyTrainAztecScan.ts'])]);
  results.push(['verify Token1', shellOut('npx', ['tsx', 'verifyTokenAztecScan.ts'])]);
  results.push([
    'verify Token2',
    shellOut('npx', ['tsx', 'verifyTokenAztecScan.ts'], {
      TOKEN_ADDRESS: ctx.token2Address.toString(),
      TOKEN_NAME: 'RWD',
      TOKEN_SYMBOL: 'RWD',
    }),
  ]);
  let allOk = true;
  for (const [name, code] of results) {
    const ok = code === 0;
    allOk &&= ok;
    record({ stage: 'S3', name, kind: 'check', status: ok ? 'OK' : 'FAIL', note: ok ? '' : `exit code ${code}` });
  }
  // Curve verification is best-effort inline; AztecScan has no dedicated script for it.
  record({
    stage: 'S3',
    name: 'verify ConstantPayoutCurve',
    kind: 'info',
    status: 'INFO',
    note: `not automated - verify manually with artifact payout_curve-ConstantPayoutCurve.json at ${ctx.curveAddress}`,
  });
  if (allOk) updateEnvFile('.env', { E2E_VERIFIED_DEPLOYMENTS: verificationKey });
}

// ---------------------------------------------------------------- happy flows

async function stageHappy(ctx: Ctx): Promise<{ h1Hashlock: number[]; h1Secret: number[] }> {
  const S = 'S4';
  const t1 = ctx.tokenAddress;
  const t2 = ctx.token2Address;

  // ---- H1: user_lock -> redeem_user (sent by solver; payout to recipient=solver)
  {
    const before = await balanceOf(ctx, t1, ctx.solver.address);
    const lock = await doUserLock(S, 'H1', ctx);
    const redeem = train(ctx, ctx.solver).methods.redeem_user(lock.hashlock, lock.secret);
    await sendTracked(S, 'H1 redeem_user (by solver)', redeem, ctx.solver);
    const after = await balanceOf(ctx, t1, ctx.solver.address);
    const lockState = await readUserLock(ctx, lock.hashlock);
    check(S, 'H1 recipient received amount', after - before === LOCK_AMOUNT, `delta=${after - before} (authwit fees ignored; token != fee asset)`);
    check(S, 'H1 lock status REDEEMED', Number(lockState.status) === 3, `status=${lockState.status}`);
    check(
      S,
      'H1 secret stored on-chain',
      bytesToHex(Uint8Array.from(lockState.secret.map(Number))) === lock.secretHex,
      'get_user_lock().secret matches revealed secret',
    );
    var h1Hashlock = lock.hashlock; // used by SwapAlreadyExists / LockNotPending unhappy cases
    var h1Secret = lock.secret;
  }

  // ---- H2: user_lock with ConstantPayoutCurve -> redeem_user (payout == amount)
  {
    const before = await balanceOf(ctx, t1, ctx.solver.address);
    const lock = await doUserLock(S, 'H2(curve)', ctx, { payoutCurve: ctx.curveAddress });
    const st = await readUserLock(ctx, lock.hashlock);
    check(S, 'H2 payout_curve stored', String(st.payout_curve) === ctx.curveAddress.toString(), `stored=${st.payout_curve}`);
    const redeem = train(ctx, ctx.solver).methods.redeem_user(lock.hashlock, lock.secret);
    await sendTracked(S, 'H2 redeem_user (curve)', redeem, ctx.solver);
    const after = await balanceOf(ctx, t1, ctx.solver.address);
    check(S, 'H2 full payout via constant curve', after - before === LOCK_AMOUNT, `delta=${after - before}`);
  }

  // ---- H3: user_lock -> immediate refund_user by recipient (early-cancel path)
  {
    const before = await balanceOf(ctx, t1, ctx.user.address);
    const lock = await doUserLock(S, 'H3', ctx);
    const refund = train(ctx, ctx.solver).methods.refund_user(lock.hashlock);
    await sendTracked(S, 'H3 refund_user by recipient (before timelock)', refund, ctx.solver);
    const after = await balanceOf(ctx, t1, ctx.user.address);
    const st = await readUserLock(ctx, lock.hashlock);
    check(S, 'H3 user refunded in full', after === before, `net user delta=${after - before} (lock+refund)`);
    check(S, 'H3 lock status REFUNDED', Number(st.status) === 2, `status=${st.status}`);
  }

  // ---- H4: user_lock (short timelock) -> wait -> refund_user by non-recipient
  {
    const lock = await doUserLock(S, 'H4', ctx, { timelockDelta: SHORT_TIMELOCK });
    const lockedAt = await chainNow();
    const st = await readUserLock(ctx, lock.hashlock);
    await waitUntilChainTime(Number(st.timelock), 'H4 user timelock');
    const refund = train(ctx, ctx.user).methods.refund_user(lock.hashlock);
    await sendTracked(S, 'H4 refund_user by non-recipient (after timelock)', refund, ctx.user);
    const st2 = await readUserLock(ctx, lock.hashlock);
    check(S, 'H4 refunded after timelock', Number(st2.status) === 2, `locked at ${lockedAt}, timelock ${st.timelock}`);
  }

  // ---- H5: solver_lock (no reward) -> redeem_solver by user
  {
    const before = await balanceOf(ctx, t1, ctx.user.address);
    const lock = await doSolverLock(S, 'H5', ctx);
    check(S, 'H5 first index is 1', lock.index === 1n, `index=${lock.index}`);
    const redeem = train(ctx, ctx.user).methods.redeem_solver(lock.hashlock, lock.index, lock.secret!);
    await sendTracked(S, 'H5 redeem_solver', redeem, ctx.user);
    const after = await balanceOf(ctx, t1, ctx.user.address);
    check(S, 'H5 recipient received amount', after - before === LOCK_AMOUNT, `delta=${after - before}`);
  }

  // ---- H6: solver_lock same-token reward, redeem before reward timelock -> reward to reward_recipient (deployer)
  {
    const rrBefore = await balanceOf(ctx, t1, ctx.deployer.address);
    const lock = await doSolverLock(S, 'H6', ctx, {
      reward: REWARD_AMOUNT,
      rewardTimelockDelta: SAFE_REWARD_TIMELOCK,
      timelockDelta: LONG_TIMELOCK,
    });
    const redeem = train(ctx, ctx.user).methods.redeem_solver(lock.hashlock, lock.index, lock.secret!);
    await sendTracked(S, 'H6 redeem_solver before reward timelock', redeem, ctx.user);
    const rrAfter = await balanceOf(ctx, t1, ctx.deployer.address);
    check(S, 'H6 reward went to reward_recipient', rrAfter - rrBefore === REWARD_AMOUNT, `delta=${rrAfter - rrBefore}`);
  }

  // ---- H7: solver_lock short reward timelock; wait past it; redeem -> reward to redeemer (user)
  {
    const lock = await doSolverLock(S, 'H7', ctx, {
      reward: REWARD_AMOUNT,
      rewardTimelockDelta: SHORT_REWARD_TIMELOCK,
      timelockDelta: LONG_TIMELOCK,
    });
    const st = await readSolverLock(ctx, lock.hashlock, lock.index);
    await waitUntilChainTime(Number(st.reward_timelock), 'H7 reward timelock');
    const uBefore = await balanceOf(ctx, t1, ctx.user.address);
    const redeem = train(ctx, ctx.user).methods.redeem_solver(lock.hashlock, lock.index, lock.secret!);
    await sendTracked(S, 'H7 redeem_solver after reward timelock', redeem, ctx.user);
    const uAfter = await balanceOf(ctx, t1, ctx.user.address);
    check(
      S,
      'H7 amount+reward went to redeemer',
      uAfter - uBefore === LOCK_AMOUNT + REWARD_AMOUNT,
      `delta=${uAfter - uBefore} (recipient==redeemer==user)`,
    );
  }

  // ---- H8: solver_lock with DIFFERENT reward token -> redeem pays both tokens
  {
    const uBefore = await balanceOf(ctx, t1, ctx.user.address);
    const rrBefore = await balanceOf(ctx, t2, ctx.deployer.address);
    const lock = await doSolverLock(S, 'H8', ctx, {
      reward: REWARD_AMOUNT,
      rewardToken: t2,
      rewardTimelockDelta: SAFE_REWARD_TIMELOCK,
      timelockDelta: LONG_TIMELOCK,
    });
    const redeem = train(ctx, ctx.user).methods.redeem_solver(lock.hashlock, lock.index, lock.secret!);
    await sendTracked(S, 'H8 redeem_solver (different reward token)', redeem, ctx.user);
    const uAfter = await balanceOf(ctx, t1, ctx.user.address);
    const rrAfter = await balanceOf(ctx, t2, ctx.deployer.address);
    check(S, 'H8 principal paid in token1', uAfter - uBefore === LOCK_AMOUNT, `delta=${uAfter - uBefore}`);
    check(S, 'H8 reward paid in token2', rrAfter - rrBefore === REWARD_AMOUNT, `delta=${rrAfter - rrBefore}`);
  }

  // ---- H9: solver_lock (short timelock, with reward) -> wait -> refund_solver
  {
    const sBefore = await balanceOf(ctx, t1, ctx.solver.address);
    const lock = await doSolverLock(S, 'H9', ctx, {
      reward: REWARD_AMOUNT,
      rewardTimelockDelta: 10,
      timelockDelta: SHORT_TIMELOCK,
    });
    const st = await readSolverLock(ctx, lock.hashlock, lock.index);
    await waitUntilChainTime(Number(st.timelock), 'H9 solver timelock');
    const refund = train(ctx, ctx.user).methods.refund_solver(lock.hashlock, lock.index);
    await sendTracked(S, 'H9 refund_solver after timelock', refund, ctx.user);
    const sAfter = await balanceOf(ctx, t1, ctx.solver.address);
    check(S, 'H9 amount+reward returned to solver', sAfter === sBefore, `net solver delta=${sAfter - sBefore}`);
  }

  return { h1Hashlock: h1Hashlock!, h1Secret: h1Secret! };
}

// ---------------------------------------------------------------- view probes

async function stageViewProbes(ctx: Ctx): Promise<void> {
  const S = 'S4-views';

  // Multi-arg static call probe on a real node (TXE showed 2-arg views receiving arg2 = 1):
  // build a hashlock with TWO solver locks, then read index 2 and 99.
  const s = newSecret();
  const l1 = await doSolverLock(S, 'probe lock #1', ctx, { hashlock: s.hashlock });
  const l2 = await doSolverLock(S, 'probe lock #2', ctx, { hashlock: s.hashlock });
  check(S, 'probe indices are 1 and 2', l1.index === 1n && l2.index === 2n, `got ${l1.index}, ${l2.index}`);

  const lock2 = await readSolverLock(ctx, s.hashlock, 2n);
  check(S, 'get_solver_lock(h, 2) resolves index 2 (PENDING)', Number(lock2.status) === 1, `status=${lock2.status}`);
  const lock99 = await readSolverLock(ctx, s.hashlock, 99n);
  check(S, 'get_solver_lock(h, 99) is EMPTY', Number(lock99.status) === 0, `status=${lock99.status}`);

  // Enumeration probe: count + per-index limbs must reconstruct the user's hashlocks.
  const { result: countRaw } = await train(ctx, ctx.user)
    .methods.get_user_lock_count(ctx.user.address)
    .simulate({ from: ctx.user.address });
  const count = BigInt(countRaw);
  record({ stage: S, name: `get_user_lock_count(user) = ${count}`, kind: 'view', status: 'INFO' });

  let reconstructed = 0;
  for (let i = 0n; i < count; i++) {
    const { result } = await train(ctx, ctx.user)
      .methods.get_user_lock_hash_at(ctx.user.address, i)
      .simulate({ from: ctx.user.address });
    const high = BigInt(result[0]);
    const low = BigInt(result[1]);
    const hashHex = '0x' + ((high << 128n) | low).toString(16).padStart(64, '0');
    // Cross-check: the reconstructed hashlock must exist as a user lock on chain
    const bytes = Array.from(Buffer.from(hashHex.slice(2), 'hex'));
    const lock = await readUserLock(ctx, bytes);
    if (Number(lock.status) !== 0) reconstructed++;
    record({
      stage: S,
      name: `get_user_lock_hash_at(${i}) -> ${hashHex.slice(0, 14)}… status=${lock.status}`,
      kind: 'view',
      status: Number(lock.status) !== 0 ? 'INFO' : 'FAIL',
    });
  }
  check(
    S,
    'enumeration entries all resolve to existing locks',
    reconstructed === Number(count),
    `${reconstructed}/${count} resolve`,
  );
}

// ---------------------------------------------------------------- unhappy (simulation rejections)

async function stageUnhappy(ctx: Ctx, h1Hashlock: number[], h1Secret: number[]): Promise<void> {
  const S = 'S5';
  const now = await chainNow();
  const quote = now + QUOTE_EXPIRY_DELTA;
  const t = train(ctx, ctx.user);
  const ts = train(ctx, ctx.solver);
  const s = newSecret();

  const userLockArgs = (over: Partial<Record<string, any>> = {}) =>
    [
      over.hashlock ?? s.hashlock,
      over.amount ?? LOCK_AMOUNT,
      Fr.random(),
      0n,
      over.timelockDelta ?? LONG_TIMELOCK,
      0,
      over.quoteExpiry ?? quote,
      ctx.user.address,
      over.recipient ?? ctx.solver.address,
      ctx.tokenAddress,
      over.payoutCurve ?? AztecAddress.ZERO,
      ZERO_128,
      ZERO_90,
      ZERO_90,
      SRC_CHAIN,
      DST_CHAIN,
      DST_ADDRESS,
      LOCK_AMOUNT,
      DST_TOKEN,
      ZERO_256,
      ZERO_256,
    ] as const;

  await expectSimReject(S, 'user_lock amount=0', 'ZeroAmount', t.methods.user_lock(...userLockArgs({ amount: 0n })), ctx.user);
  await expectSimReject(S, 'user_lock timelock_delta=0', 'InvalidTimelock', t.methods.user_lock(...userLockArgs({ timelockDelta: 0 })), ctx.user);
  await expectSimReject(S, 'user_lock expired quote', 'QuoteExpired', t.methods.user_lock(...userLockArgs({ quoteExpiry: 1 })), ctx.user);
  await expectSimReject(S, 'user_lock duplicate hashlock (H1)', 'SwapAlreadyExists', t.methods.user_lock(...userLockArgs({ hashlock: h1Hashlock })), ctx.user);
  await expectSimReject(S, 'user_lock zero recipient', 'ZeroAddress', t.methods.user_lock(...userLockArgs({ recipient: AztecAddress.ZERO })), ctx.user);
  await expectSimReject(
    S,
    'user_lock bogus payout curve',
    '', // any failure is acceptable: the lock-time curve probe must abort the call
    t.methods.user_lock(...userLockArgs({ payoutCurve: AztecAddress.fromStringUnsafe('0x' + '12'.repeat(32)) })),
    ctx.user,
  );

  const solverLockArgs = (over: Partial<Record<string, any>> = {}) =>
    [
      s.hashlock,
      LOCK_AMOUNT,
      Fr.random(),
      over.reward ?? REWARD_AMOUNT,
      Fr.random(),
      over.timelockDelta ?? LONG_TIMELOCK,
      over.rewardTimelockDelta ?? SAFE_REWARD_TIMELOCK,
      ctx.solver.address,
      ctx.user.address,
      over.rewardRecipient ?? ctx.deployer.address,
      ctx.tokenAddress,
      ctx.tokenAddress,
      AztecAddress.ZERO,
      ZERO_128,
      SRC_CHAIN,
      DST_CHAIN,
      DST_ADDRESS,
      LOCK_AMOUNT,
      DST_TOKEN,
      ZERO_256,
    ] as const;

  await expectSimReject(
    S,
    'solver_lock reward_timelock >= timelock',
    'InvalidRewardTimelock',
    ts.methods.solver_lock(...solverLockArgs({ rewardTimelockDelta: LONG_TIMELOCK })),
    ctx.solver,
  );
  await expectSimReject(
    S,
    'solver_lock zero reward_recipient',
    'ZeroAddress',
    ts.methods.solver_lock(...solverLockArgs({ rewardRecipient: AztecAddress.ZERO })),
    ctx.solver,
  );

  // Redeem / refund failures
  const fresh = newSecret();
  await expectSimReject(S, 'redeem_user unknown hashlock', 'LockNotFound', t.methods.redeem_user(fresh.hashlock, fresh.secret), ctx.user);
  await expectSimReject(S, 'refund_user unknown hashlock', 'LockNotFound', t.methods.refund_user(fresh.hashlock), ctx.user);
  await expectSimReject(S, 'redeem_solver unknown index', 'LockNotFound', t.methods.redeem_solver(fresh.hashlock, 1n, fresh.secret), ctx.user);
  await expectSimReject(S, 'refund_solver unknown', 'LockNotFound', t.methods.refund_solver(fresh.hashlock, 1n), ctx.user);
  // must use the REAL H1 secret: a wrong secret trips HashlockMismatch before the status check
  await expectSimReject(S, 'redeem_user H1 again (already redeemed)', 'LockNotPending', t.methods.redeem_user(h1Hashlock, h1Secret), ctx.user);

  // Live lock for wrong-secret / early-refund cases (long timelock; then cooperatively refunded)
  const live = await doUserLock(S, 'U-live', ctx);
  await expectSimReject(S, 'redeem_user wrong secret', 'HashlockMismatch', t.methods.redeem_user(live.hashlock, newSecret().secret), ctx.user);
  await expectSimReject(S, 'refund_user early by non-recipient', 'RefundNotAllowed', t.methods.refund_user(live.hashlock), ctx.user);
  // clean up: recipient refunds it (also a happy tx)
  await sendTracked(S, 'U-live cleanup refund by recipient', train(ctx, ctx.solver).methods.refund_user(live.hashlock), ctx.solver);

  const liveSolver = await doSolverLock(S, 'S-live', ctx, { timelockDelta: LONG_TIMELOCK });
  await expectSimReject(
    S,
    'refund_solver early (even by recipient)',
    'RefundNotAllowed',
    t.methods.refund_solver(liveSolver.hashlock, liveSolver.index),
    ctx.user,
  );
  // clean up: redeem it
  await sendTracked(
    S,
    'S-live cleanup redeem',
    train(ctx, ctx.user).methods.redeem_solver(liveSolver.hashlock, liveSolver.index, liveSolver.secret!),
    ctx.user,
  );
}

// ---------------------------------------------------------------- races (real on-chain reverts)

async function stageRaces(ctx: Ctx): Promise<void> {
  const S = 'S6';

  // R1: two concurrent redeem_user of the same lock. Both pass local simulation,
  // one mines OK, the other mines REVERTED (LockNotPending) on chain.
  {
    const lock = await doUserLock(S, 'R1', ctx);
    console.log('\nR1: submitting two concurrent redeem_user txs (user + solver)...');
    const results = await Promise.allSettled([
      sendTracked(S, 'R1 redeem_user (sender: user)', train(ctx, ctx.user).methods.redeem_user(lock.hashlock, lock.secret), ctx.user, { allowRevert: true }),
      sendTracked(S, 'R1 redeem_user (sender: solver)', train(ctx, ctx.solver).methods.redeem_user(lock.hashlock, lock.secret), ctx.solver, { allowRevert: true }),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? (r.value.row.status as string) : `error: ${String((r as any).reason).slice(0, 120)}`));
    const okCount = statuses.filter((st) => st === 'OK').length;
    const revertCount = statuses.filter((st) => st === 'REVERTED').length;
    check(
      S,
      'R1 exactly one redeem succeeded',
      okCount === 1,
      `outcomes: [${statuses.join(' | ')}]` +
        (revertCount === 1 ? ' — loser REVERTED ON CHAIN' : ' — loser lost before inclusion (timing artifact, not a contract bug)'),
    );
  }

  // R2: solver lock past timelock -> concurrent redeem_solver (user) vs refund_solver (solver).
  {
    const lock = await doSolverLock(S, 'R2', ctx, { timelockDelta: SHORT_TIMELOCK, reward: 0n });
    const st = await readSolverLock(ctx, lock.hashlock, lock.index);
    await waitUntilChainTime(Number(st.timelock), 'R2 solver timelock');
    console.log('\nR2: submitting concurrent redeem_solver vs refund_solver...');
    const results = await Promise.allSettled([
      sendTracked(S, 'R2 redeem_solver (user)', train(ctx, ctx.user).methods.redeem_solver(lock.hashlock, lock.index, lock.secret!), ctx.user, { allowRevert: true }),
      sendTracked(S, 'R2 refund_solver (solver)', train(ctx, ctx.solver).methods.refund_solver(lock.hashlock, lock.index), ctx.solver, { allowRevert: true }),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? (r.value.row.status as string) : `error: ${String((r as any).reason).slice(0, 120)}`));
    const okCount = statuses.filter((st) => st === 'OK').length;
    const revertCount = statuses.filter((st) => st === 'REVERTED').length;
    check(
      S,
      'R2 exactly one of redeem/refund succeeded',
      okCount === 1,
      `outcomes: [${statuses.join(' | ')}]` +
        (revertCount === 1 ? ' — loser REVERTED ON CHAIN' : ' — loser lost before inclusion (timing artifact, not a contract bug)'),
    );
  }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (getEnv() !== 'testnet') {
    throw new Error('Run with AZTEC_ENV=testnet (npm run e2e:testnet)');
  }

  let header: Record<string, string> = { node: getAztecNodeUrl() };
  try {
    await stagePreflight();
    const roles = await stageAccounts();
    const ctx = await stageContracts(roles);
    header = {
      node: getAztecNodeUrl(),
      train: ctx.trainAddress.toString(),
      token1: ctx.tokenAddress.toString(),
      token2: ctx.token2Address.toString(),
      payoutCurve: ctx.curveAddress.toString(),
      user: ctx.user.address.toString(),
      solver: ctx.solver.address.toString(),
      deployer: ctx.deployer.address.toString(),
      explorer: AZTECSCAN_BASE,
    };
    await stageVerification(ctx);
    const { h1Hashlock, h1Secret } = await stageHappy(ctx);
    await stageViewProbes(ctx);
    await stageUnhappy(ctx, h1Hashlock, h1Secret);
    await stageRaces(ctx);
  } finally {
    writeReport(header);
  }

  const fails = rows.filter((r) => r.status === 'FAIL');
  if (fails.length > 0) {
    console.error(`\n${fails.length} FAILURE(S) — see report.`);
    process.exit(1);
  }
  console.log('\nAll stages completed with no failures.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Fatal: ${err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
