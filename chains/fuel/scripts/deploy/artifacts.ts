/**
 * Loads the compiled Sway artifacts (bytecode + ABI) for the packages this port's deployment
 * tooling and testnet e2e script need: `train` and `payout_curve`.
 *
 * Reads from each package's `out/debug/` directory -- the same location
 * `scripts/lib/testHarness.ts` already reads from for the local-node test suite, so a build
 * produced by a single `forc build` run (no `--release`) is what both the tests AND this
 * deployment tooling consume, keeping exactly one build output in play. Run `forc build` from
 * `chains/fuel/` (the workspace root) before using anything in this directory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const FUEL_ROOT = path.join(__dirname, '../..');

export interface PackageArtifact {
  abi: unknown;
  bytecode: Uint8Array;
}

function loadPackage(pkgDir: string, name: string): PackageArtifact {
  const abiPath = path.join(FUEL_ROOT, pkgDir, `out/debug/${name}-abi.json`);
  const binPath = path.join(FUEL_ROOT, pkgDir, `out/debug/${name}.bin`);
  if (!fs.existsSync(abiPath) || !fs.existsSync(binPath)) {
    throw new Error(
      `Missing build artifact for "${name}" (expected ${abiPath} and ${binPath}). ` +
        `Run \`forc build\` from chains/fuel/ first.`,
    );
  }
  return {
    abi: JSON.parse(fs.readFileSync(abiPath, 'utf-8')),
    bytecode: fs.readFileSync(binPath),
  };
}

export const trainArtifact = (): PackageArtifact => loadPackage('train', 'train');
export const payoutCurveArtifact = (): PackageArtifact => loadPackage('payout_curve', 'payout_curve');
/** Throwaway Sepolia e2e fixture, not a protocol contract -- see `test_asset/src/main.sw`. */
export const testAssetArtifact = (): PackageArtifact => loadPackage('test_asset', 'test_asset');
