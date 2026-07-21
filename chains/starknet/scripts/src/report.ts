import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

// ── Row model (mirrors the aztec e2e-testnet report format: chains/aztec/scripts/e2eTestnet.ts) ──

export type RowKind = "tx" | "check" | "view" | "info" | "sim-reject";
export type RowStatus = "OK" | "REVERTED" | "FAIL" | "INFO";

export interface Row {
  n: number;
  stage: string;
  name: string;
  kind: RowKind;
  status: RowStatus;
  txHash?: string;
  block?: number;
  fee?: string;
  note?: string;
}

export type NetworkKind = "devnet" | "sepolia" | "mainnet" | "unknown";

/**
 * Distinguishes real Sepolia from `starknet-devnet`, which by default advertises the *same*
 * `SN_SEPOLIA` chain id (so `chainId` alone is ambiguous) — the RPC URL's host is the reliable
 * signal for local devnet.
 */
export function detectNetwork(rpcUrl: string, chainIdHex: string): NetworkKind {
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(rpcUrl);
  if (isLocal) return "devnet";

  const SN_SEPOLIA = "0x534e5f5345504f4c4941";
  const SN_MAIN = "0x534e5f4d41494e";
  const normalized = chainIdHex.toLowerCase();
  if (normalized === SN_SEPOLIA) return "sepolia";
  if (normalized === SN_MAIN) return "mainnet";
  return "unknown";
}

/** Redacts an RPC URL for logging/reporting. Remote endpoints often embed a private API key in
 * the path (e.g. Alchemy/Infura), so anything non-local is reduced to a safe placeholder — the
 * URL is NEVER written verbatim into a report. Local devnet URLs carry no secret and are kept. */
export function redactRpc(rpcUrl: string): string {
  if (!rpcUrl) return "<none>";
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(rpcUrl)) return rpcUrl;
  return "<rpc-endpoint-redacted>";
}

/** Base explorer URL for tx links, or `undefined` on devnet (no explorer). */
export function explorerTxBase(network: NetworkKind): string | undefined {
  switch (network) {
    case "sepolia":
      return "https://sepolia.voyager.online/tx";
    case "mainnet":
      return "https://voyager.online/tx";
    case "devnet":
    default:
      return undefined;
  }
}

/** Clickable Markdown link for a tx hash (truncated label), or a plain note on devnet. */
function txCell(network: NetworkKind, txHash?: string): string {
  if (!txHash) return "";
  const base = explorerTxBase(network);
  if (!base) return `\`${txHash.slice(0, 12)}…\` (local devnet, no explorer)`;
  return `[${txHash.slice(0, 12)}…](${base}/${txHash})`;
}

export interface ReportAddresses {
  train: string;
  trainRouter: string;
  constantCurve: string;
  strk: string;
  eth: string;
}

export interface ReportMeta {
  network: NetworkKind;
  chainId: string;
  rpcUrl: string;
  addresses: ReportAddresses;
  userAddress: string;
  solverAddress: string;
  relayerAddress: string;
  deployerAddress: string;
  startedAt: Date;
  /** Bullet lines for the "Build and local verification" section. */
  buildNotes: string[];
}

export function renderReport(meta: ReportMeta, rows: Row[], finishedAt: Date): string {
  const lines: string[] = [];

  lines.push(`# Train Protocol Starknet — E2E ${meta.network} report`);
  lines.push("");
  lines.push(`Started: ${meta.startedAt.toISOString()}  `);
  lines.push(`Finished: ${finishedAt.toISOString()}`);
  lines.push("");

  lines.push("## Environment");
  lines.push("");
  lines.push(`- **rpc**: ${redactRpc(meta.rpcUrl)}`);
  lines.push(`- **chainId**: ${meta.chainId} (${meta.network})`);
  lines.push(`- **train**: \`${meta.addresses.train}\``);
  lines.push(`- **trainRouter**: \`${meta.addresses.trainRouter}\``);
  lines.push(`- **payoutCurve**: \`${meta.addresses.constantCurve}\``);
  lines.push(`- **strk (principal token)**: \`${meta.addresses.strk}\``);
  lines.push(`- **eth (second / reward token)**: \`${meta.addresses.eth}\``);
  lines.push(`- **user**: \`${meta.userAddress}\``);
  lines.push(`- **solver**: \`${meta.solverAddress}\``);
  lines.push(`- **relayer**: \`${meta.relayerAddress}\``);
  lines.push(`- **deployer**: \`${meta.deployerAddress}\``);
  lines.push(
    `- **explorer**: ${explorerTxBase(meta.network) ? explorerTxBase(meta.network)!.replace(/\/tx$/, "") : "local devnet (no explorer)"}` +
      (meta.network === "sepolia" ? " (also see https://sepolia.starkscan.co)" : ""),
  );
  lines.push("");

  lines.push("## Build and local verification");
  lines.push("");
  for (const note of meta.buildNotes) {
    lines.push(`- ${note}`);
  }
  lines.push("");

  lines.push("## Transactions & checks");
  lines.push("");
  lines.push("| # | Stage | Name | Kind | Status | Tx | Block | Fee | Note |");
  lines.push("|---|-------|------|------|--------|----|-------|-----|------|");
  for (const r of rows) {
    const tx = txCell(meta.network, r.txHash);
    const note = (r.note ?? "").replace(/\|/g, "/").slice(0, 220);
    lines.push(
      `| ${r.n} | ${r.stage} | ${r.name} | ${r.kind} | ${r.status} | ${tx} | ${r.block ?? ""} | ${r.fee ?? ""} | ${note} |`,
    );
  }
  lines.push("");

  const fails = rows.filter((r) => r.status === "FAIL");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- rows: ${rows.length}`);
  lines.push(`- mined txs: ${rows.filter((r) => r.kind === "tx" && r.status !== "FAIL").length}`);
  lines.push(`- on-chain reverted (expected): ${rows.filter((r) => r.status === "REVERTED").length}`);
  lines.push(`- sim-rejected (expected): ${rows.filter((r) => r.kind === "sim-reject" && r.status === "OK").length}`);
  lines.push(
    `- FAILURES: ${fails.length}${fails.length ? " — " + fails.map((f) => `#${f.n} ${f.name}`).join(", ") : ""}`,
  );
  lines.push("");

  return lines.join("\n");
}

/** Writes `docs/e2e-testnet-report.md` and the sibling `.json` (same shape as the aztec report). */
export function writeReport(
  docsDir: string,
  meta: ReportMeta,
  rows: Row[],
  finishedAt: Date,
): { mdPath: string; jsonPath: string } {
  mkdirSync(docsDir, { recursive: true });
  const mdPath = resolve(docsDir, "e2e-testnet-report.md");
  const jsonPath = resolve(docsDir, "e2e-testnet-report.json");
  writeFileSync(mdPath, renderReport(meta, rows, finishedAt), "utf-8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        startedAt: meta.startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        network: meta.network,
        chainId: meta.chainId,
        rpcUrl: redactRpc(meta.rpcUrl),
        addresses: meta.addresses,
        userAddress: meta.userAddress,
        solverAddress: meta.solverAddress,
        relayerAddress: meta.relayerAddress,
        deployerAddress: meta.deployerAddress,
        buildNotes: meta.buildNotes,
        rows,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return { mdPath, jsonPath };
}

export function printSummaryTable(rows: Row[]): void {
  console.log("\n=== E2E Summary ===");
  const fails = rows.filter((r) => r.status === "FAIL");
  console.log(`rows: ${rows.length}`);
  console.log(`mined txs: ${rows.filter((r) => r.kind === "tx" && r.status !== "FAIL").length}`);
  console.log(`on-chain reverted (expected): ${rows.filter((r) => r.status === "REVERTED").length}`);
  console.log(
    `sim-rejected (expected): ${rows.filter((r) => r.kind === "sim-reject" && r.status === "OK").length}`,
  );
  console.log(
    `FAILURES: ${fails.length}${fails.length ? " — " + fails.map((f) => `#${f.n} ${f.name}`).join(", ") : ""}`,
  );
}
