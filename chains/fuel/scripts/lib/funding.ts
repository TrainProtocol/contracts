/**
 * Wallet resolution + funding checks shared by `scripts/deploy.ts` and `scripts/testnet-e2e.ts`.
 *
 * FAUCET INVESTIGATION (per this task's requirement to check the actual mechanism, not assume
 * one): Fuel's testnet faucet (https://faucet-testnet.fuel.network/, linked from
 * docs.fuel.network's "Get testnet tokens" page) is fronted by Cloudflare with a bot-challenge
 * page -- a plain HTTP GET to it returns `cf-mitigated: challenge` and a Turnstile
 * "Just a moment..." interstitial, confirmed empirically against the live endpoint while
 * building this file. The faucet's own backend (github.com/FuelLabs/faucet) additionally
 * requires `CAPTCHA_SECRET`/`CAPTCHA_KEY` (Google reCAPTCHA) server-side for every dispense
 * request -- i.e. this is CAPTCHA-gated by design, not merely an incidental bot-protection
 * layer in front of an otherwise-scriptable endpoint. There is no documented/discoverable
 * unauthenticated API path that skips this. Conclusion: this faucet CANNOT be automated
 * end-to-end from a script, and this file does not attempt to (solving a CAPTCHA
 * programmatically would also defeat its actual anti-abuse purpose, independent of feasibility).
 *
 * Consequently, funding on Sepolia is **manual**: a human funds a wallet address via the faucet
 * (or a pre-funded wallet is supplied via env), and this file's job is limited to (a) resolving
 * whichever wallet a given role should use, from env if set, else a freshly generated one, and
 * (b) checking ONCE whether it already holds enough balance to proceed -- printing the exact
 * manual step and exiting non-zero if not. Per this project's standing rule: never silently
 * swallow a funding gap and never loop/poll waiting for a human to act -- a single check, then
 * a clear, actionable error.
 */
import { bn, WalletUnlocked, type BigNumberish, type Provider } from 'fuels';

import { networkKindFromUrl } from '../deploy/network';

export const FAUCET_URL = 'https://faucet-testnet.fuel.network/';

/**
 * Resolves the wallet for `role` (e.g. `'deployer'`, `'user'`, `'sponsor'`): if `envVar` is set,
 * unlocks that private key; otherwise generates a fresh keypair and prints the address so a
 * human can fund it (the caller is expected to follow up with `requireFunded`, which is what
 * actually enforces/reports on funding).
 */
export function resolveWallet(envVar: string, role: string, provider: Provider): WalletUnlocked {
  const privateKey = process.env[envVar];
  if (privateKey) {
    return new WalletUnlocked(privateKey, provider);
  }
  const wallet = WalletUnlocked.generate({ provider });
  // Never print the private key by default -- these wallets are auto-topped-up from the
  // primary wallet every run, so persisting one across runs is a convenience, not a
  // requirement, and this same code path should stay safe to reuse against a real-value
  // network. Opt in explicitly (e.g. local iteration) via FUEL_E2E_PRINT_GENERATED_KEYS=1.
  const showKey = process.env.FUEL_E2E_PRINT_GENERATED_KEYS === '1';
  console.log(
    `[funding] ${envVar} not set -- generated a fresh ${role} wallet: ${wallet.address.toB256()}. ` +
      (showKey
        ? `private key: ${wallet.privateKey}. `
        : `Set FUEL_E2E_PRINT_GENERATED_KEYS=1 to print its private key. `) +
      `Set ${envVar} to reuse this wallet across runs.`,
  );
  return wallet;
}

export interface RequireFundedOptions {
  provider: Provider;
  wallet: WalletUnlocked;
  /** Asset to check -- defaults to the network's base asset. */
  assetId?: string;
  /** Minimum required balance, in the asset's base units. */
  minAmount: BigNumberish;
  role: string;
  /** Env var the caller should set to skip this wallet's manual-funding step next time. */
  envVar: string;
}

/**
 * Checks ONCE whether `wallet` already holds at least `minAmount` of the target asset. Throws a
 * single, instructive error (never retries, never polls) naming the exact manual step if not --
 * see the file-level doc comment for why this cannot be automated on Sepolia.
 */
export async function requireFunded(opts: RequireFundedOptions): Promise<void> {
  const { provider, wallet, minAmount, role, envVar } = opts;
  const assetId = opts.assetId ?? (await provider.getBaseAssetId());
  const balance = await provider.getBalance(wallet.address, assetId);
  const required = bn(minAmount);
  if (balance.gte(required)) {
    console.log(`[funding] ${role} ${wallet.address.toB256()} balance ${balance.toString()} >= required ${required.toString()} -- OK`);
    return;
  }

  const kind = networkKindFromUrl(provider.url);
  const address = wallet.address.toB256();
  const lines = [
    `[funding] ${role} wallet ${address} has balance ${balance.toString()} but needs at least ` +
      `${required.toString()} of asset ${assetId} to proceed.`,
  ];
  if (kind === 'local') {
    lines.push(
      `This is a local node -- fund ${address} from a genesis/pre-funded wallet ` +
        `(e.g. \`launchTestNode\`'s own wallets, or a local faucet if your dev node runs one), ` +
        `then re-run. If you generated this wallet just now (see the log line above), you can ` +
        `also just set ${envVar} to an already-funded local private key instead.`,
    );
  } else {
    lines.push(
      `Fuel's testnet faucet (${FAUCET_URL}) is CAPTCHA-gated (Cloudflare bot-challenge + ` +
        `Google reCAPTCHA on the dispense endpoint itself -- confirmed against the live ` +
        `endpoint, see this file's header comment) and CANNOT be automated from this script. ` +
        `To proceed:\n` +
        `  1. Open ${FAUCET_URL} in a browser, complete the CAPTCHA, and request funds for ${address}.\n` +
        `  2. Re-run this script once the faucet confirms the transfer (this script does not ` +
        `poll or retry -- run it again yourself after funding).\n` +
        `  Alternatively, set ${envVar} to the private key of an already-funded Sepolia wallet.`,
    );
  }
  throw new Error(lines.join('\n'));
}
