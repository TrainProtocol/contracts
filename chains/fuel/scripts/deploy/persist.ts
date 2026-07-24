/**
 * Reads/writes the machine-readable deployment record at `chains/fuel/deployments/<network>.json`
 * -- the raw data the hand-maintained `DEPLOYMENTS.md` is sourced from, keeping the raw
 * machine-written record separate from the curated, hand-written one. This directory is
 * gitignored (see `chains/fuel/.gitignore`): it is a per-run scratch/cache artifact, not a
 * source-controlled record.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const FUEL_ROOT = path.join(__dirname, '../..');
export const DEPLOYMENTS_DIR = path.join(FUEL_ROOT, 'deployments');

export interface DeploymentRecord {
  network: string;
  providerUrl: string;
  saltSeed: string;
  salts: {
    train: string;
    payoutCurve: string;
  };
  train: {
    contractId: string;
    deployed: boolean;
    transactionId?: string;
  };
  payoutCurve: {
    contractId: string;
    deployed: boolean;
    transactionId?: string;
  };
  deployer: string;
  deployedAt: string;
  toolchain: {
    forc?: string;
    fuelCore?: string;
    fuelsTs?: string;
  };
}

function recordPath(network: string): string {
  return path.join(DEPLOYMENTS_DIR, `${network}.json`);
}

export function loadDeployment(network: string): DeploymentRecord | null {
  const file = recordPath(network);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as DeploymentRecord;
}

export function saveDeployment(network: string, record: DeploymentRecord): string {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const file = recordPath(network);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  return file;
}
