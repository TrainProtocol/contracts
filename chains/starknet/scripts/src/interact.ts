import { createHash } from 'crypto';
import { cairo, CairoCustomEnum, type Call } from 'starknet';
import { getAccount, requireEnv, optionalEnv, getTrainContract, getErc20Contract } from './config.js';

// ── SHA256 hashlock (matches Cairo _sha256_u256) ──

function computeHashlock(secret: bigint): bigint {
  const buf = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(secret & 0xffn);
    secret >>= 8n;
  }
  const digest = createHash('sha256').update(buf).digest();
  return BigInt('0x' + digest.toString('hex'));
}

// ── Formatting helpers ──

function formatBigint(_k: string, v: unknown): unknown {
  if (typeof v === 'bigint') {
    // Format as hex if it looks like an address/hash (>= 2^64), decimal otherwise
    return v >= 2n ** 64n ? '0x' + v.toString(16) : v.toString();
  }
  return v;
}

// ── Lock status enum helper ──

function lockStatusEnum(variant: 'Empty' | 'Pending' | 'Refunded' | 'Redeemed'): CairoCustomEnum {
  return new CairoCustomEnum({
    Empty: variant === 'Empty' ? {} : undefined,
    Pending: variant === 'Pending' ? {} : undefined,
    Refunded: variant === 'Refunded' ? {} : undefined,
    Redeemed: variant === 'Redeemed' ? {} : undefined,
  });
}

// ── Demos ──

async function demoUserLock() {
  const { account } = getAccount();
  const contractAddress = requireEnv('CONTRACT_ADDRESS');
  const tokenAddress = requireEnv('TOKEN_ADDRESS');
  const contract = getTrainContract(contractAddress, account);
  const erc20 = getErc20Contract(tokenAddress, account);

  // Generate a random secret and compute hashlock
  const secret = BigInt(
    '0x' +
      createHash('sha256')
        .update(crypto.getRandomValues(new Uint8Array(32)))
        .digest('hex')
  );
  const hashlock = computeHashlock(secret);

  console.log('Secret:', '0x' + secret.toString(16));
  console.log('Hashlock:', '0x' + hashlock.toString(16));

  const amount = cairo.uint256(1n);
  const now = Math.floor(Date.now() / 1000);

  const approveCall: Call = erc20.populate('approve', [contractAddress, amount]);

  const userLockCall: Call = contract.populate('user_lock', [
    {
      hashlock: cairo.uint256(hashlock),
      amount,
      reward_amount: cairo.uint256(0n),
      timelock_delta: 150,
      reward_timelock_delta: 0,
      quote_expiry: now + 100,
      sender: account.address,
      recipient: account.address,
      token: tokenAddress,
      reward_token: '',
      reward_recipient: '',
      src_chain: 'starknet-sepolia',
    },
    {
      dst_chain: 'ethereum-sepolia',
      dst_address: '0x0000000000000000000000000000000000000001',
      dst_amount: cairo.uint256(1n),
      dst_token: '0x0000000000000000000000000000000000000000',
    },
    '',
    '',
  ]);

  console.log('\nSending multicall (approve + user_lock)...');
  const { transaction_hash } = await account.execute([approveCall, userLockCall]);
  console.log('Tx:', transaction_hash);

  const receipt = await account.waitForTransaction(transaction_hash);
  console.log('Status:', receipt.statusReceipt);

  const events = contract.parseEvents(receipt);
  console.log('Events:', JSON.stringify(events, formatBigint, 2));

  console.log('\nSave this to redeem later:');
  console.log(`  Secret: 0x${secret.toString(16)}`);
  console.log(`  Hashlock: 0x${hashlock.toString(16)}`);
}

async function demoSolverLock() {
  const { account } = getAccount();
  const contractAddress = requireEnv('CONTRACT_ADDRESS');
  const tokenAddress = requireEnv('TOKEN_ADDRESS');
  const contract = getTrainContract(contractAddress, account);
  const erc20 = getErc20Contract(tokenAddress, account);

  const hashlock = BigInt(process.argv[3] || '0x0');
  if (hashlock === 0n) {
    console.error('Usage: npm run interact -- solver-lock <hashlock>');
    process.exit(1);
  }

  const amount = cairo.uint256(1n);

  const approveCall: Call = erc20.populate('approve', [contractAddress, amount]);

  const solverLockCall: Call = contract.populate('solver_lock', [
    {
      hashlock: cairo.uint256(hashlock),
      amount,
      reward: cairo.uint256(0n),
      timelock_delta: 150,
      reward_timelock_delta: 0,
      sender: account.address,
      recipient: account.address,
      reward_recipient: account.address,
      token: tokenAddress,
      reward_token: tokenAddress,
      src_chain: 'ethereum-sepolia',
    },
    {
      dst_chain: 'starknet-sepolia',
      dst_address: account.address,
      dst_amount: cairo.uint256(1n),
      dst_token: tokenAddress,
    },
    '',
  ]);

  console.log('Sending multicall (approve + solver_lock)...');
  const { transaction_hash } = await account.execute([approveCall, solverLockCall]);
  console.log('Tx:', transaction_hash);

  const receipt = await account.waitForTransaction(transaction_hash);
  console.log('Status:', receipt.statusReceipt);

  const events = contract.parseEvents(receipt);
  console.log('Events:', JSON.stringify(events, formatBigint, 2));
}

async function demoSolverLockDiffReward() {
  const { account } = getAccount();
  const contractAddress = requireEnv('CONTRACT_ADDRESS');
  const tokenAddress = requireEnv('TOKEN_ADDRESS');
  const rewardTokenAddress = requireEnv('REWARD_TOKEN_ADDRESS');
  const contract = getTrainContract(contractAddress, account);
  const erc20 = getErc20Contract(tokenAddress, account);
  const rewardErc20 = getErc20Contract(rewardTokenAddress, account);

  const hashlock = BigInt(process.argv[3] || '0x0');
  if (hashlock === 0n) {
    console.error('Usage: npm run interact -- solver-lock-diff-reward <hashlock>');
    process.exit(1);
  }

  const amount = cairo.uint256(1n);
  const reward = cairo.uint256(1n);

  // Approve both tokens separately
  const approveMain: Call = erc20.populate('approve', [contractAddress, amount]);
  const approveReward: Call = rewardErc20.populate('approve', [contractAddress, reward]);

  const solverLockCall: Call = contract.populate('solver_lock', [
    {
      hashlock: cairo.uint256(hashlock),
      amount,
      reward,
      timelock_delta: 150,
      reward_timelock_delta: 100,
      sender: account.address,
      recipient: account.address,
      reward_recipient: account.address,
      token: tokenAddress,
      reward_token: rewardTokenAddress,
      src_chain: 'ethereum-sepolia',
    },
    {
      dst_chain: 'starknet-sepolia',
      dst_address: account.address,
      dst_amount: cairo.uint256(1n),
      dst_token: tokenAddress,
    },
    '',
  ]);

  console.log('Token:', tokenAddress);
  console.log('Reward token:', rewardTokenAddress);
  console.log('\nSending multicall (approve main + approve reward + solver_lock)...');
  const { transaction_hash } = await account.execute([approveMain, approveReward, solverLockCall]);
  console.log('Tx:', transaction_hash);

  const receipt = await account.waitForTransaction(transaction_hash);
  console.log('Status:', receipt.statusReceipt);

  const events = contract.parseEvents(receipt);
  console.log('Events:', JSON.stringify(events, formatBigint, 2));
}

async function demoView() {
  const { provider } = getAccount();
  const contractAddress = requireEnv('CONTRACT_ADDRESS');
  const contract = getTrainContract(contractAddress, provider);

  const count = await contract.get_solver_lock_count(cairo.uint256(0n));
  console.log('Solver lock count (hashlock=0):', count.toString());

  const testHashlock = process.argv[3];
  if (testHashlock) {
    const hl = cairo.uint256(BigInt(testHashlock));

    console.log('\n--- User Lock ---');
    const userLock = await contract.get_user_lock(hl);
    console.log(JSON.stringify(userLock, formatBigint, 2));

    console.log('\n--- Solver Lock Count ---');
    const solverCount = await contract.get_solver_lock_count(hl);
    console.log('Count:', solverCount.toString());

    if (solverCount > 0n) {
      console.log('\n--- Solver Lock (index 1) ---');
      const solverLock = await contract.get_solver_lock(hl, cairo.uint256(1n));
      console.log(JSON.stringify(solverLock, formatBigint, 2));
    }
  }

  // get_user_lock_hashes — starknet.js v9 returns an object, not a tuple
  const accountAddr = requireEnv('ACCOUNT_ADDRESS');
  console.log('\n--- User Lock Hashes (Empty filter = all) ---');
  const result = await contract.get_user_lock_hashes(
    accountAddr,
    lockStatusEnum('Empty'),
    cairo.uint256(0n),
    cairo.uint256(10n)
  );

  // Handle both possible return shapes: array tuple or object
  let hashes: bigint[];
  let total: bigint;
  if (Array.isArray(result)) {
    hashes = result[0] as bigint[];
    total = result[1] as bigint;
  } else {
    const keys = Object.keys(result as Record<string, unknown>);
    const obj = result as Record<string, unknown>;
    hashes = (obj[keys[0]] ?? []) as bigint[];
    total = (obj[keys[1]] ?? 0n) as bigint;
  }

  console.log('Total:', total.toString());
  console.log(
    'Hashes:',
    hashes.map((h) => '0x' + h.toString(16))
  );
}

async function demoRedeem() {
  const { account } = getAccount();
  const contractAddress = requireEnv('CONTRACT_ADDRESS');
  const contract = getTrainContract(contractAddress, account);

  const type = process.argv[3]; // "user" or "solver"
  const hashlock = BigInt(process.argv[4] || '0x0');
  const secret = BigInt(process.argv[5] || '0x0');

  if (!type || hashlock === 0n || secret === 0n) {
    console.error('Usage: npm run interact -- redeem <user|solver> <hashlock> <secret> [index]');
    process.exit(1);
  }

  const computed = computeHashlock(secret);
  if (computed !== hashlock) {
    console.error('Hashlock mismatch! Computed:', '0x' + computed.toString(16));
    process.exit(1);
  }

  let tx: string;
  if (type === 'user') {
    const resp = await contract.invoke('redeem_user', [cairo.uint256(hashlock), cairo.uint256(secret)]);
    tx = resp.transaction_hash;
  } else {
    const index = BigInt(process.argv[6] || '1');
    const resp = await contract.invoke('redeem_solver', [
      cairo.uint256(hashlock),
      cairo.uint256(index),
      cairo.uint256(secret),
    ]);
    tx = resp.transaction_hash;
  }

  console.log('Redeem tx:', tx);
  const receipt = await account.waitForTransaction(tx);
  console.log('Status:', receipt.statusReceipt);

  const events = contract.parseEvents(receipt);
  console.log('Events:', JSON.stringify(events, formatBigint, 2));
}

async function demoRefund() {
  const { account } = getAccount();
  const contractAddress = requireEnv('CONTRACT_ADDRESS');
  const contract = getTrainContract(contractAddress, account);

  const type = process.argv[3]; // "user" or "solver"
  const hashlock = BigInt(process.argv[4] || '0x0');

  if (!type || hashlock === 0n) {
    console.error('Usage: npm run interact -- refund <user|solver> <hashlock> [index]');
    process.exit(1);
  }

  let tx: string;
  if (type === 'user') {
    const resp = await contract.invoke('refund_user', [cairo.uint256(hashlock)]);
    tx = resp.transaction_hash;
  } else {
    const index = BigInt(process.argv[5] || '1');
    const resp = await contract.invoke('refund_solver', [cairo.uint256(hashlock), cairo.uint256(index)]);
    tx = resp.transaction_hash;
  }

  console.log('Refund tx:', tx);
  const receipt = await account.waitForTransaction(tx);
  console.log('Status:', receipt.statusReceipt);

  const events = contract.parseEvents(receipt);
  console.log('Events:', JSON.stringify(events, formatBigint, 2));
}

// ── CLI router ──

const command = process.argv[2];

const commands: Record<string, () => Promise<void>> = {
  'user-lock': demoUserLock,
  'solver-lock': demoSolverLock,
  'solver-lock-diff-reward': demoSolverLockDiffReward,
  view: demoView,
  redeem: demoRedeem,
  refund: demoRefund,
};

if (!command || !commands[command]) {
  console.log('Usage: npm run interact -- <command>');
  console.log('Commands:', Object.keys(commands).join(', '));
  process.exit(1);
}

commands[command]!().catch((err) => {
  console.error(`${command} failed:`, err);
  process.exit(1);
});
