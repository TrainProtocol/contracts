import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getPublicEvents, type EventCursor } from '@aztec/aztec.js/events';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TxHash } from '@aztec/aztec.js/tx';
import { TrainContract } from './Train.ts';
import { getAztecNodeUrl } from './utils/config.ts';

// v5: events are #[event] structs with ABI metadata in the generated bindings.
// Retrieval is per event type via getPublicEvents (tag-based, cursor-paginated).
const EVENT_NAMES = [
  'UserLocked',
  'SolverLocked',
  'UserRedeemed',
  'SolverRedeemed',
  'UserRefunded',
  'SolverRefunded',
] as const;
type EventName = (typeof EVENT_NAMES)[number];

// --- formatting helpers ---

function bytesToHex(bytes: bigint[]): string {
  return '0x' + bytes.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
}

function bytesToString(bytes: bigint[]): string {
  return Buffer.from(bytes.map(Number))
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();
}

function formatField(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    const bytes = value.map((v) => BigInt(v as any));
    const allBytes = bytes.every((v) => v >= 0n && v <= 255n);
    if (allBytes) {
      if (key.includes('chain')) return bytesToString(bytes);
      if (key === 'user_data' || key === 'solver_data' || key === 'data') {
        const nonZero = bytes.filter((b) => b !== 0n);
        return `[${bytes.length} bytes, ${nonZero.length} non-zero]`;
      }
      return bytesToHex(bytes);
    }
    return `[${bytes.join(', ')}]`;
  }
  return `${value}`;
}

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
  console.log('  --contract <addr>   Train contract address (or TRAIN_ADDRESS env). Required.');
  console.log('  --tx <hash>         Filter by transaction hash (or TX_HASH env)');
  console.log('  --from <block>      Start block inclusive (or FROM_BLOCK env)');
  console.log('  --to <block>        End block exclusive (or TO_BLOCK env)');
  console.log('  --event <name>      Filter by event name: UserLocked, SolverLocked,');
  console.log('                      UserRedeemed, SolverRedeemed, UserRefunded, SolverRefunded');
  console.log('');
  console.log('Examples:');
  console.log('  tsx parseEvents.ts --contract 0x... --tx 0xabc123...');
  console.log('  tsx parseEvents.ts --contract 0x... --from 1 --to 100');
  console.log('  tsx parseEvents.ts --contract 0x... --event UserLocked');
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
  const eventFilter = getArg('--event') as EventName | undefined;

  if (!contractStr) {
    console.error('Error: --contract (or TRAIN_ADDRESS env) is required in v5 event queries.');
    console.error('Run with --help for usage.\n');
    process.exit(1);
  }
  if (eventFilter && !EVENT_NAMES.includes(eventFilter)) {
    console.error(`Unknown event name: ${eventFilter}`);
    console.error(`Valid names: ${EVENT_NAMES.join(', ')}`);
    process.exit(1);
  }

  const contractAddress = AztecAddress.fromStringUnsafe(contractStr);
  const txHash = txHashStr ? TxHash.fromString(txHashStr) : undefined;

  console.log(`Node: ${nodeUrl}`);
  console.log(`Contract: ${contractAddress}`);
  if (txHash) console.log(`Tx filter: ${txHash}`);
  if (fromBlock != null) console.log(`From block: ${fromBlock}`);
  if (toBlock != null) console.log(`To block: ${toBlock}`);
  if (eventFilter) console.log(`Event filter: ${eventFilter}`);

  const names = eventFilter ? [eventFilter] : [...EVENT_NAMES];
  let matched = 0;

  for (const name of names) {
    const metadata = TrainContract.events[name];
    let afterEvent: EventCursor | undefined = undefined;

    do {
      const { events, nextCursor } = await getPublicEvents<Record<string, unknown>>(node, metadata, {
        contractAddress,
        txHash,
        fromBlock: !txHash && fromBlock ? (Number(fromBlock) as any) : undefined,
        toBlock: !txHash && toBlock ? (Number(toBlock) as any) : undefined,
        afterEvent,
      });

      for (const { event, metadata: eventMeta } of events) {
        console.log(`\n--- ${name} ---`);
        console.log(`  Block: ${eventMeta.l2BlockNumber}, Tx: ${eventMeta.txHash}`);
        for (const [key, val] of Object.entries(event)) {
          console.log(`  ${key}: ${formatField(key, val)}`);
        }
        matched++;
      }

      afterEvent = nextCursor;
    } while (afterEvent !== undefined);
  }

  console.log(`\nMatched events: ${matched}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Error: ${err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
