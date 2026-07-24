/**
 * Row-table report generation for the Fuel testnet e2e suite -- same shape/purpose as the
 * testnet-report helpers the other Train ports use, adapted for Fuel: tx links point at
 * `https://app-testnet.fuel.network/tx/<txId>`, and there is no block-explorer for a local
 * `fuel-core` node (rows for such a run fall back to plain, unlinked tx ids).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type RowKind = 'tx' | 'check' | 'view' | 'info' | 'sim-reject';
export type RowStatus = 'OK' | 'REVERTED' | 'FAIL' | 'INFO';

export interface Row {
  n: number;
  stage: string;
  name: string;
  kind: RowKind;
  status: RowStatus;
  txId?: string;
  fee?: string;
  note?: string;
}

export type NetworkKind = 'local' | 'testnet' | 'mainnet' | 'custom';

/** Base explorer URL for tx links, or `undefined` on a local node (no explorer). */
export function explorerTxBase(network: NetworkKind): string | undefined {
  switch (network) {
    case 'testnet':
      return 'https://app-testnet.fuel.network/tx';
    case 'mainnet':
      return 'https://app.fuel.network/tx';
    case 'local':
    case 'custom':
    default:
      return undefined;
  }
}

/** Clickable Markdown link for a tx id (truncated label), or a plain note when no explorer
 * exists for this network. */
function txCell(network: NetworkKind, txId?: string): string {
  if (!txId) return '';
  const base = explorerTxBase(network);
  if (!base) return `\`${txId.slice(0, 14)}…\` (no explorer for this network)`;
  return `[${txId.slice(0, 14)}…](${base}/${txId})`;
}

/** Contract name -> deployed id (e.g. `{ train, payoutCurve, testAsset }`). Open-ended so a
 * throwaway fixture like `testAsset` can be listed without a schema change. */
export type ReportAddresses = Record<string, string>;

/** Role name -> address (e.g. `{ user, sponsor, recipient, refundTo, ... }`). Every actor role
 * in a run gets its own distinct address; this records them all. */
export type ReportRoles = Record<string, string>;

export interface ReportMeta {
  network: NetworkKind;
  providerUrl: string;
  addresses: ReportAddresses;
  roles: ReportRoles;
  startedAt: Date;
  /** Bullet lines for the "Build and local verification" section. */
  buildNotes: string[];
}

export function renderReport(meta: ReportMeta, rows: Row[], finishedAt: Date): string {
  const lines: string[] = [];

  lines.push(`# Train Protocol Fuel — E2E ${meta.network} report`);
  lines.push('');
  lines.push(`Started: ${meta.startedAt.toISOString()}  `);
  lines.push(`Finished: ${finishedAt.toISOString()}`);
  lines.push('');

  lines.push('## Environment');
  lines.push('');
  lines.push(`- **provider**: ${meta.providerUrl}`);
  lines.push(`- **network**: ${meta.network}`);
  for (const [name, id] of Object.entries(meta.addresses)) {
    lines.push(`- **${name}**: \`${id}\``);
  }
  lines.push('');
  lines.push('### Actor addresses (all distinct)');
  lines.push('');
  for (const [role, addr] of Object.entries(meta.roles)) {
    lines.push(`- **${role}**: \`${addr}\``);
  }
  const base = explorerTxBase(meta.network);
  lines.push(`- **explorer**: ${base ? base.replace(/\/tx$/, '') : 'no explorer (local node)'}`);
  lines.push('');

  lines.push('## Build and local verification');
  lines.push('');
  for (const note of meta.buildNotes) {
    lines.push(`- ${note}`);
  }
  lines.push('');

  lines.push('## Transactions & checks');
  lines.push('');
  lines.push('| # | Stage | Name | Kind | Status | Tx | Fee | Note |');
  lines.push('|---|-------|------|------|--------|----|----|------|');
  for (const r of rows) {
    const tx = txCell(meta.network, r.txId);
    const note = (r.note ?? '').replace(/\|/g, '/').slice(0, 260);
    lines.push(`| ${r.n} | ${r.stage} | ${r.name} | ${r.kind} | ${r.status} | ${tx} | ${r.fee ?? ''} | ${note} |`);
  }
  lines.push('');

  const fails = rows.filter((r) => r.status === 'FAIL');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- rows: ${rows.length}`);
  lines.push(`- mined txs: ${rows.filter((r) => r.kind === 'tx' && r.status !== 'FAIL').length}`);
  lines.push(`- on-chain reverted (expected): ${rows.filter((r) => r.status === 'REVERTED').length}`);
  lines.push(
    `- sim-rejected (expected): ${rows.filter((r) => r.kind === 'sim-reject' && r.status === 'OK').length}`,
  );
  lines.push(
    `- FAILURES: ${fails.length}${fails.length ? ' — ' + fails.map((f) => `#${f.n} ${f.name}`).join(', ') : ''}`,
  );
  lines.push('');

  return lines.join('\n');
}

/** Writes `reports/testnet-e2e-<timestamp>.md` (+ sibling `.json`). Each run gets its own
 * timestamped filename, so this is idempotent/re-runnable with zero manual cleanup between
 * runs. */
export function writeReport(
  reportsDir: string,
  meta: ReportMeta,
  rows: Row[],
  finishedAt: Date,
): { mdPath: string; jsonPath: string; timestamp: string } {
  mkdirSync(reportsDir, { recursive: true });
  const timestamp = finishedAt.toISOString().replace(/[:.]/g, '-');
  const mdPath = resolve(reportsDir, `testnet-e2e-${timestamp}.md`);
  const jsonPath = resolve(reportsDir, `testnet-e2e-${timestamp}.json`);
  writeFileSync(mdPath, renderReport(meta, rows, finishedAt), 'utf-8');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        startedAt: meta.startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        network: meta.network,
        providerUrl: meta.providerUrl,
        addresses: meta.addresses,
        roles: meta.roles,
        buildNotes: meta.buildNotes,
        rows,
      },
      null,
      2,
    ),
    'utf-8',
  );
  return { mdPath, jsonPath, timestamp };
}

export function printSummaryTable(rows: Row[]): void {
  console.log('\n=== E2E Summary ===');
  const fails = rows.filter((r) => r.status === 'FAIL');
  console.log(`rows: ${rows.length}`);
  console.log(`mined txs: ${rows.filter((r) => r.kind === 'tx' && r.status !== 'FAIL').length}`);
  console.log(`on-chain reverted (expected): ${rows.filter((r) => r.status === 'REVERTED').length}`);
  console.log(
    `sim-rejected (expected): ${rows.filter((r) => r.kind === 'sim-reject' && r.status === 'OK').length}`,
  );
  console.log(
    `FAILURES: ${fails.length}${fails.length ? ' — ' + fails.map((f) => `#${f.n} ${f.name}`).join(', ') : ''}`,
  );
}
