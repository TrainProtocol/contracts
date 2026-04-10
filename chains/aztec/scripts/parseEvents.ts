import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TxHash } from '@aztec/aztec.js/tx';
import { getAztecNodeUrl } from './utils/config.ts';

// --- Event tag constants (must match contract globals) ---

const EVENT_TAGS: Record<number, string> = {
  1: 'UserLocked',
  2: 'SolverLocked',
  3: 'UserRedeemed',
  4: 'SolverRedeemed',
  5: 'UserRefunded',
  6: 'SolverRefunded',
};

// --- helpers ---

function bytesToHex(bytes: bigint[]): string {
  return '0x' + bytes.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
}

function bytesToString(bytes: bigint[]): string {
  return Buffer.from(bytes.map(Number))
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();
}

function formatValue(key: string, value: bigint[]): string {
  const allBytes = value.every((v) => v >= 0n && v <= 255n);
  if (allBytes) {
    if (key.includes('chain')) return bytesToString(value);
    if (key === 'userData' || key === 'solverData' || key === 'data') {
      const nonZero = value.filter((b) => b !== 0n);
      return `[${value.length} bytes, ${nonZero.length} non-zero]`;
    }
    return bytesToHex(value);
  }
  return `[${value.join(', ')}]`;
}

/** Read N fields as bigint[] from a field array starting at offset. Returns [value, newOffset]. */
function readBytes(fields: any[], offset: number, count: number): [bigint[], number] {
  const bytes: bigint[] = [];
  for (let i = 0; i < count; i++) {
    bytes.push(BigInt(fields[offset + i].toString()));
  }
  return [bytes, offset + count];
}

function readField(fields: any[], offset: number): [string, number] {
  return [fields[offset].toString(), offset + 1];
}

function readAddress(fields: any[], offset: number): [string, number] {
  return [fields[offset].toString(), offset + 1];
}

function readU128(fields: any[], offset: number): [string, number] {
  // u128 serializes as 2 fields: [high, low] or just 1 field depending on version
  // In Aztec Noir Serialize, u128 is 1 Field
  return [fields[offset].toString(), offset + 1];
}

function readU64(fields: any[], offset: number): [string, number] {
  return [fields[offset].toString(), offset + 1];
}

function decodeUserLocked(data: any[]): Record<string, string> {
  const r: Record<string, string> = {};
  let o = 0;
  let bytes: bigint[];
  [bytes, o] = readBytes(data, o, 32); r['hashlock'] = bytesToHex(bytes);
  [r['sender'], o] = readAddress(data, o);
  [r['recipient'], o] = readAddress(data, o);
  [bytes, o] = readBytes(data, o, 30); r['src_chain'] = bytesToString(bytes);
  [r['token'], o] = readAddress(data, o);
  [r['amount'], o] = readU128(data, o);
  [r['timelock'], o] = readU64(data, o);
  [bytes, o] = readBytes(data, o, 30); r['dst_chain'] = bytesToString(bytes);
  [bytes, o] = readBytes(data, o, 90); r['dst_address'] = bytesToHex(bytes);
  [r['dst_amount'], o] = readU128(data, o);
  [bytes, o] = readBytes(data, o, 90); r['dst_token'] = bytesToHex(bytes);
  [r['reward_amount'], o] = readU128(data, o);
  [bytes, o] = readBytes(data, o, 90); r['reward_token'] = bytesToHex(bytes);
  [bytes, o] = readBytes(data, o, 90); r['reward_recipient'] = bytesToHex(bytes);
  [r['reward_timelock_delta'], o] = readU64(data, o);
  [r['quote_expiry'], o] = readU64(data, o);
  [bytes, o] = readBytes(data, o, 256); r['userData'] = formatValue('userData', bytes);
  [bytes, o] = readBytes(data, o, 256); r['solverData'] = formatValue('solverData', bytes);
  return r;
}

function decodeSolverLocked(data: any[]): Record<string, string> {
  const r: Record<string, string> = {};
  let o = 0;
  let bytes: bigint[];
  [bytes, o] = readBytes(data, o, 32); r['hashlock'] = bytesToHex(bytes);
  [r['sender'], o] = readAddress(data, o);
  [r['recipient'], o] = readAddress(data, o);
  [r['index'], o] = readField(data, o);
  [bytes, o] = readBytes(data, o, 30); r['src_chain'] = bytesToString(bytes);
  [r['token'], o] = readAddress(data, o);
  [r['amount'], o] = readU128(data, o);
  [r['reward'], o] = readU128(data, o);
  [r['reward_token'], o] = readAddress(data, o);
  [r['reward_recipient'], o] = readAddress(data, o);
  [r['timelock'], o] = readU64(data, o);
  [r['reward_timelock'], o] = readU64(data, o);
  [bytes, o] = readBytes(data, o, 30); r['dst_chain'] = bytesToString(bytes);
  [bytes, o] = readBytes(data, o, 90); r['dst_address'] = bytesToHex(bytes);
  [r['dst_amount'], o] = readU128(data, o);
  [bytes, o] = readBytes(data, o, 90); r['dst_token'] = bytesToHex(bytes);
  [bytes, o] = readBytes(data, o, 256); r['data'] = formatValue('data', bytes);
  return r;
}

function decodeUserRedeemed(data: any[]): Record<string, string> {
  const r: Record<string, string> = {};
  let o = 0;
  let bytes: bigint[];
  [bytes, o] = readBytes(data, o, 32); r['hashlock'] = bytesToHex(bytes);
  [r['redeemer'], o] = readAddress(data, o);
  [bytes, o] = readBytes(data, o, 32); r['secret'] = bytesToHex(bytes);
  return r;
}

function decodeSolverRedeemed(data: any[]): Record<string, string> {
  const r: Record<string, string> = {};
  let o = 0;
  let bytes: bigint[];
  [bytes, o] = readBytes(data, o, 32); r['hashlock'] = bytesToHex(bytes);
  [r['index'], o] = readField(data, o);
  [r['redeemer'], o] = readAddress(data, o);
  [bytes, o] = readBytes(data, o, 32); r['secret'] = bytesToHex(bytes);
  return r;
}

function decodeUserRefunded(data: any[]): Record<string, string> {
  const r: Record<string, string> = {};
  let o = 0;
  let bytes: bigint[];
  [bytes, o] = readBytes(data, o, 32); r['hashlock'] = bytesToHex(bytes);
  return r;
}

function decodeSolverRefunded(data: any[]): Record<string, string> {
  const r: Record<string, string> = {};
  let o = 0;
  let bytes: bigint[];
  [bytes, o] = readBytes(data, o, 32); r['hashlock'] = bytesToHex(bytes);
  [r['index'], o] = readField(data, o);
  return r;
}

const DECODERS: Record<string, (data: any[]) => Record<string, string>> = {
  UserLocked: decodeUserLocked,
  SolverLocked: decodeSolverLocked,
  UserRedeemed: decodeUserRedeemed,
  SolverRedeemed: decodeSolverRedeemed,
  UserRefunded: decodeUserRefunded,
  SolverRefunded: decodeSolverRefunded,
};

// --- CLI arg parsing ---

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function printUsage(): void {
  console.log('Usage: tsx parseEvents.ts [options]');
  console.log('');
  console.log('Options (via CLI args or .env):');
  console.log('  --tx <hash>         Filter by transaction hash (or TX_HASH env)');
  console.log('  --contract <addr>   Filter by contract address (or TRAIN_ADDRESS env)');
  console.log('  --from <block>      Start block inclusive (or FROM_BLOCK env)');
  console.log('  --to <block>        End block exclusive (or TO_BLOCK env)');
  console.log('  --event <name>      Filter by event name: UserLocked, SolverLocked,');
  console.log('                      UserRedeemed, SolverRedeemed, UserRefunded, SolverRefunded');
  console.log('');
  console.log('Examples:');
  console.log('  tsx parseEvents.ts --tx 0xabc123...');
  console.log('  tsx parseEvents.ts --contract 0x... --from 1 --to 100');
  console.log('  tsx parseEvents.ts --event UserLocked');
  console.log('  AZTEC_ENV=devnet tsx parseEvents.ts --tx 0x...');
}

// --- main ---

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const nodeUrl = getAztecNodeUrl();
  const node = createAztecNodeClient(nodeUrl);

  const txHashStr = getArg('--tx') ?? process.env.TX_HASH;
  const contractStr = getArg('--contract') ?? process.env.TRAIN_ADDRESS;
  const fromBlock = getArg('--from') ?? process.env.FROM_BLOCK;
  const toBlock = getArg('--to') ?? process.env.TO_BLOCK;
  const eventFilter = getArg('--event');

  const filter: {
    txHash?: TxHash;
    contractAddress?: AztecAddress;
    fromBlock?: number;
    toBlock?: number;
  } = {};

  if (txHashStr) filter.txHash = TxHash.fromString(txHashStr);
  if (contractStr) filter.contractAddress = AztecAddress.fromString(contractStr);
  if (fromBlock) filter.fromBlock = Number(fromBlock);
  if (toBlock) filter.toBlock = Number(toBlock);

  if (!filter.txHash && !filter.contractAddress && !filter.fromBlock) {
    console.error('Error: provide at least --tx, --contract, or --from to filter events.');
    console.error('Run with --help for usage.\n');
    process.exit(1);
  }

  console.log(`Node: ${nodeUrl}`);
  if (filter.txHash) console.log(`Tx filter: ${filter.txHash}`);
  if (filter.contractAddress) console.log(`Contract filter: ${filter.contractAddress}`);
  if (filter.fromBlock != null) console.log(`From block: ${filter.fromBlock}`);
  if (filter.toBlock != null) console.log(`To block: ${filter.toBlock}`);
  if (eventFilter) console.log(`Event filter: ${eventFilter}`);

  if (eventFilter && !DECODERS[eventFilter]) {
    console.error(`Unknown event name: ${eventFilter}`);
    console.error(`Valid names: ${Object.values(EVENT_TAGS).join(', ')}`);
    process.exit(1);
  }

  // Single RPC call — fetch all public logs matching the filter
  const { logs } = await node.getPublicLogs({
    fromBlock: filter.fromBlock,
    toBlock: filter.toBlock,
    txHash: filter.txHash,
    contractAddress: filter.contractAddress,
  });

  console.log(`\nFetched ${logs.length} raw public log(s).`);

  let matched = 0;

  for (const log of logs) {
    // emit_public_log_unsafe(tag, data) — tag is the first emitted field
    const emittedFields = log.log.getEmittedFields();
    if (emittedFields.length === 0) continue;

    const tagValue = Number(emittedFields[0].toBigInt());
    const eventName = EVENT_TAGS[tagValue];
    if (!eventName) continue;
    if (eventFilter && eventName !== eventFilter) continue;

    const decoder = DECODERS[eventName];
    if (!decoder) continue;

    try {
      // Data fields start after the tag
      const dataFields = emittedFields.slice(1);
      const decoded = decoder(dataFields);

      console.log(`\n--- ${eventName} (tag=${tagValue}) ---`);
      console.log(`  Block: ${log.id.blockNumber}, Tx: ${log.id.txHash}`);
      console.log(`  Contract: ${log.log.contractAddress}`);

      for (const [key, val] of Object.entries(decoded)) {
        console.log(`  ${key}: ${val}`);
      }

      matched++;
    } catch (err) {
      console.error(`\nFailed to decode ${eventName}: ${err}`);
      console.error(
        `  Raw fields (${emittedFields.length}): [${emittedFields.map((f: any) => f.toString()).join(', ')}]`,
      );
    }
  }

  console.log(`\nMatched events: ${matched} / ${logs.length} logs`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Error: ${err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
