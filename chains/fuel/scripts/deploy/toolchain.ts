/**
 * Best-effort toolchain version capture for the deployment JSON's determinism record (per the
 * plan's "Deterministic deployment" section: pin+record the exact `forc`/`fuel-core` versions
 * used, since bytecode determinism claims are only meaningful alongside the toolchain that
 * produced the bytecode). Every lookup is wrapped -- a missing/misconfigured local toolchain
 * must never crash the deploy script, only leave that field `undefined` in the record.
 *
 * NOTE: `forc --version`/`fuel-core --version` read whichever binaries are first on `PATH` on
 * the machine running this script (this repo's pinned `fuelup` toolchain, named `train` -- see
 * `~/.fuelup/toolchains/train`). That is the toolchain that produced the `out/debug/*.bin`
 * bytecode this script deploys, which is the fact that actually matters for the
 * bytecode-determinism claim. It is deliberately NOT necessarily the same `fuel-core` build
 * that is running the node this script connects to via `FUEL_PROVIDER_URL` (e.g. this repo's
 * local test-node toolchain pins a different `fuel-core` version than `PATH`'s default -- see
 * `scripts/lib/testHarness.ts`'s "NODE VERSION NOTE") -- this record does not and cannot
 * capture a remote node's own `fuel-core` version (that would need a `getNode()`/`getChain()`
 * RPC call against the target network, a separate concern from "what built this bytecode").
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

function fuelsTsVersion(): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(require.resolve('fuels/package.json'), 'utf-8')) as { version: string })
      .version;
  } catch {
    return undefined;
  }
}

function tryVersion(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

export interface ToolchainVersions {
  forc?: string;
  fuelCore?: string;
  fuelsTs?: string;
}

export function captureToolchainVersions(): ToolchainVersions {
  return {
    forc: tryVersion('forc', ['--version']),
    fuelCore: tryVersion('fuel-core', ['--version']),
    fuelsTs: fuelsTsVersion(),
  };
}
