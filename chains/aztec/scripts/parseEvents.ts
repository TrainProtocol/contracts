import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TxHash } from '@aztec/aztec.js/tx';
import { EventSelector, decodeFromAbi } from '@aztec/aztec.js/abi';
import { TrainContract } from './Train.ts';
import { getAztecNodeUrl } from './utils/config.ts';

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

function formatValue(key: string, value: any): string {
  // AztecAddress (decoded by decodeFromAbi as AztecAddress instances)
  if (value instanceof AztecAddress) return value.toString();
  if (typeof value === 'object' && value !== null && value.constructor?.name === 'AztecAddress')
    return value.toString();

  // Byte arrays
  if (Array.isArray(value)) {
    const allBytes = value.every((v: any) => typeof v === 'bigint' && v >= 0n && v <= 255n);
    if (allBytes) {
      if (key.includes('chain')) return bytesToString(value);
      if (key === 'userData' || key === 'solverData' || key === 'data') {
        const nonZero = value.filter((b: bigint) => b !== 0n);
        return `[${value.length} bytes, ${nonZero.length} non-zero]`;
      }
      return bytesToHex(value);
    }
    return `[${value.join(', ')}]`;
  }

  return String(value);
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

  // Build selector -> {name, abiType, fieldNames} lookup
  const eventDefs = TrainContract.events;
  const allEventNames = [
    'UserLocked',
    'SolverLocked',
    'UserRedeemed',
    'SolverRedeemed',
    'UserRefunded',
    'SolverRefunded',
  ] as const;

  type EventName = (typeof allEventNames)[number];

  const selectorMap = new Map<
    string,
    { name: EventName; def: (typeof eventDefs)[EventName] }
  >();

  for (const name of allEventNames) {
    if (eventFilter && name !== eventFilter) continue;
    const def = eventDefs[name];
    selectorMap.set(def.eventSelector.toString(), { name, def });
  }

  if (eventFilter && selectorMap.size === 0) {
    console.error(`Unknown event name: ${eventFilter}`);
    console.error(`Valid names: ${allEventNames.join(', ')}`);
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
    // self.emit() appends the EventSelector as the last emitted field
    const emittedFields = log.log.getEmittedFields();
    if (emittedFields.length === 0) continue;

    const selectorField = emittedFields[emittedFields.length - 1];
    const selector = EventSelector.fromField(selectorField);
    const entry = selectorMap.get(selector.toString());
    if (!entry) continue;

    try {
      // decodeFromAbi reads struct fields sequentially from log.log.fields
      // (same approach as the official getPublicEvents helper)
      const decoded = decodeFromAbi(
        [entry.def.abiType],
        log.log.fields,
      ) as Record<string, any>;

      console.log(`\n--- ${entry.name} ---`);
      console.log(`  Block: ${log.id.blockNumber}, Tx: ${log.id.txHash}`);
      console.log(`  Contract: ${log.log.contractAddress}`);

      for (const fieldName of entry.def.fieldNames) {
        const val = decoded[fieldName];
        console.log(`  ${fieldName}: ${formatValue(fieldName, val)}`);
      }

      matched++;
    } catch (err) {
      console.error(`\nFailed to decode ${entry.name}: ${err}`);
      console.error(
        `  Raw fields (${log.log.fields.length}): [${log.log.fields.map((f: any) => f.toString()).join(', ')}]`,
      );
    }
  }

  console.log(`\nMatched events: ${matched} / ${logs.length} logs`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
