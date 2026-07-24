/**
 * Network connection + naming for the Fuel deployment tooling. The SAME deploy/e2e scripts work
 * against Fuel Sepolia or a local `fuel-core` node purely by pointing `FUEL_PROVIDER_URL` at a
 * different GraphQL endpoint -- no code branches on which network is targeted anywhere in this
 * directory or in `scripts/testnet-e2e.ts`.
 */
import { Provider } from 'fuels';

/** Fuel Sepolia's public GraphQL RPC (per this task's network-access confirmation). */
export const DEFAULT_TESTNET_URL = 'https://testnet.fuel.network/v1/graphql';

export type NetworkKind = 'local' | 'testnet' | 'mainnet' | 'custom';

/** Resolves the target GraphQL endpoint: `FUEL_PROVIDER_URL` if set, else Fuel Sepolia. This is
 * the one env var that lets the identical deploy/e2e tooling target a local `fuel-core` node for
 * fast iteration (e.g. `FUEL_PROVIDER_URL=http://127.0.0.1:4000/v1/graphql`) or Fuel Sepolia for
 * the real testnet proof run. */
export function resolveProviderUrl(): string {
  return process.env.FUEL_PROVIDER_URL ?? DEFAULT_TESTNET_URL;
}

/** Best-effort network classification from the URL alone, purely for labeling the deployment
 * JSON / e2e report -- never used to change behavior. */
export function networkKindFromUrl(url: string): NetworkKind {
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) return 'local';
  if (/testnet\.fuel\.network/i.test(url)) return 'testnet';
  if (/mainnet\.fuel\.network/i.test(url)) return 'mainnet';
  return 'custom';
}

/** A short, filesystem-safe network name for `deployments/<name>.json` / report filenames.
 * Falls back to a sanitized host for a `custom` URL (e.g. a teammate's own local node on a
 * non-default port) so re-runs against the same custom endpoint keep hitting the same file. */
export function networkFileName(url: string): string {
  const kind = networkKindFromUrl(url);
  if (kind !== 'custom') return kind;
  try {
    const { hostname, port } = new URL(url);
    return `custom-${hostname}${port ? `-${port}` : ''}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  } catch {
    return 'custom';
  }
}

/** Redacts a provider URL for logging/reports. Local URLs carry no secret and are kept as-is;
 * anything else is reduced to a safe placeholder in case it embeds an API key in its path. */
export function redactProviderUrl(url: string): string {
  if (networkKindFromUrl(url) === 'local') return url;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}<redacted-path>`;
  } catch {
    return '<redacted>';
  }
}

/** Connects to `url` and eagerly runs `Provider.init()` (fetches chain/node info) so any
 * downstream network error surfaces immediately at connect time, not on the first unrelated
 * call. */
export async function connectProvider(url: string = resolveProviderUrl()): Promise<Provider> {
  const provider = new Provider(url);
  await provider.init();
  return provider;
}
