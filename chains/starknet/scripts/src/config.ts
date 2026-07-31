import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  RpcProvider,
  Account,
  Contract,
  hash,
  type CompiledSierra,
  type CompiledSierraCasm,
  type ProviderInterface,
  type AccountInterface,
} from "starknet";

// ── Env helpers ──

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

function normalizeRpcUrl(url: string): string {
  // Bare-host URLs are used as-is. The old behavior appended /rpc/v0_7 "for compatibility",
  // but starknet.js v9 speaks RPC 0.8+ only and current public providers (e.g. publicnode)
  // serve a current spec on the bare path — the rewrite just broke them. Point RPC_URL at a
  // versioned path explicitly if your provider requires one.
  return url.trim();
}

// ── Provider & Accounts ──

export function getProvider(): RpcProvider {
  const nodeUrl = normalizeRpcUrl(requireEnv("RPC_URL"));
  const blockTag = optionalEnv("RPC_BLOCK_TAG") ?? "latest";
  return new RpcProvider({
    nodeUrl,
    blockIdentifier: blockTag,
  });
}

/**
 * The user account. On Sepolia this MUST be a real SNIP-9-capable wallet (Argent, Braavos, or
 * Ready) — Rail B (`execute_from_outside_v2`) is validated against this exact account, not a
 * throwaway test account, so the e2e suite reflects what a real end user's wallet can do.
 */
export function getAccount(): { account: Account; provider: RpcProvider } {
  const provider = getProvider();
  const account = new Account({
    provider,
    address: requireEnv("ACCOUNT_ADDRESS"),
    signer: requireEnv("PRIVATE_KEY"),
  });
  return { account, provider };
}

/// The relayer that pays gas for gasless flows (Rail A / Rail B). Falls back to the main
/// ACCOUNT_ADDRESS/PRIVATE_KEY (self-relay) when RELAYER_ADDRESS/RELAYER_PRIVATE_KEY are unset,
/// so the e2e suite runs standalone with a single funded key.
export function getRelayerAccount(): { relayer: Account; provider: RpcProvider } {
  const provider = getProvider();
  const address = optionalEnv("RELAYER_ADDRESS") ?? requireEnv("ACCOUNT_ADDRESS");
  const privateKey = optionalEnv("RELAYER_PRIVATE_KEY") ?? requireEnv("PRIVATE_KEY");
  const relayer = new Account({ provider, address, signer: privateKey });
  return { relayer, provider };
}

/// The solver actor used by solver-lock flows (F–J). Optional: falls back to the relayer, then
/// to the main account, so the suite runs standalone with as few as one funded key.
export function getSolverAccount(): { solver: Account; provider: RpcProvider } {
  const provider = getProvider();
  const address =
    optionalEnv("SOLVER_ADDRESS") ?? optionalEnv("RELAYER_ADDRESS") ?? requireEnv("ACCOUNT_ADDRESS");
  const privateKey =
    optionalEnv("SOLVER_PRIVATE_KEY") ?? optionalEnv("RELAYER_PRIVATE_KEY") ?? requireEnv("PRIVATE_KEY");
  const solver = new Account({ provider, address, signer: privateKey });
  return { solver, provider };
}

// ── Canonical Sepolia token defaults ──
//
// The suite deploys no test token and mints nothing: it spends from the pre-funded balances of
// whatever accounts are configured, using the real Sepolia STRK (principal) and ETH (second /
// reward token) contracts by default. Override via STRK_ADDRESS/ETH_ADDRESS (or the shorter
// TOKEN/TOKEN2 aliases) to point at different ERC20s (e.g. on a local devnet where these
// canonical addresses hold no code).
export const DEFAULT_STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const DEFAULT_ETH_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

export interface TokenAddresses {
  strk: string;
  eth: string;
}

export function resolveTokenAddresses(): TokenAddresses {
  const strk = optionalEnv("STRK_ADDRESS") ?? optionalEnv("TOKEN") ?? DEFAULT_STRK_ADDRESS;
  const eth = optionalEnv("ETH_ADDRESS") ?? optionalEnv("TOKEN2") ?? DEFAULT_ETH_ADDRESS;
  return { strk, eth };
}

// ── Build artifact loaders ──

const ARTIFACTS_DIR = resolve(import.meta.dirname, "../../target/dev");

export type ContractName = "Train" | "TrainRouter" | "ConstantPayoutCurve";

function artifactPaths(name: ContractName): { sierraPath: string; casmPath: string } {
  return {
    sierraPath: resolve(ARTIFACTS_DIR, `train_protocol_${name}.contract_class.json`),
    casmPath: resolve(ARTIFACTS_DIR, `train_protocol_${name}.compiled_contract_class.json`),
  };
}

export function loadArtifacts(name: ContractName): {
  sierra: CompiledSierra;
  casm: CompiledSierraCasm;
} {
  const { sierraPath, casmPath } = artifactPaths(name);
  const sierra = JSON.parse(readFileSync(sierraPath, "utf-8")) as CompiledSierra;
  const casm = JSON.parse(readFileSync(casmPath, "utf-8")) as CompiledSierraCasm;
  return { sierra, casm };
}

/** @deprecated use `loadArtifacts("Train").sierra` */
export function loadSierra(): CompiledSierra {
  return loadArtifacts("Train").sierra;
}

/** @deprecated use `loadArtifacts("Train").casm` */
export function loadCasm(): CompiledSierraCasm {
  return loadArtifacts("Train").casm;
}

// ── Contract helpers ──

export function getContract(
  name: ContractName,
  address: string,
  accountOrProvider: AccountInterface | ProviderInterface,
): Contract {
  const { sierra } = loadArtifacts(name);
  return new Contract({ abi: sierra.abi, address, providerOrAccount: accountOrProvider });
}

export function getTrainContract(
  address: string,
  accountOrProvider: AccountInterface | ProviderInterface,
): Contract {
  return getContract("Train", address, accountOrProvider);
}

export function getTrainRouterContract(
  address: string,
  accountOrProvider: AccountInterface | ProviderInterface,
): Contract {
  return getContract("TrainRouter", address, accountOrProvider);
}

export function getConstantPayoutCurveContract(
  address: string,
  accountOrProvider: AccountInterface | ProviderInterface,
): Contract {
  return getContract("ConstantPayoutCurve", address, accountOrProvider);
}

/** Minimal ERC20 surface needed to drive the e2e suite against real Sepolia STRK/ETH. No `mint` —
 * the suite never mints; it only spends from balances the configured accounts already hold. */
const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "balance_of",
    inputs: [
      { name: "account", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "recipient", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
] as const;

export function getErc20Contract(
  tokenAddress: string,
  accountOrProvider: AccountInterface | ProviderInterface,
): Contract {
  return new Contract({ abi: ERC20_ABI, address: tokenAddress, providerOrAccount: accountOrProvider });
}

// ── Deterministic, idempotent declare+deploy (UDC, unique:false) ──

/**
 * `Account.declare`/`.deploy`/`.execute` (starknet.js v9) all resolve a "tip" via
 * `resolveDetailsWithTip`, which — unless `tip` is explicitly provided — calls
 * `getEstimateTip()` -> `getTipStatsSequential()`, sampling recent blocks for V3 transactions with
 * tips. On a fresh/local `starknet-devnet` this frequently throws ("Failed to determine starting
 * block number", "Insufficient transaction data") since there isn't enough block history yet.
 * Passing `tip: 0n` explicitly short-circuits that path entirely (safe on devnet, harmless on
 * Sepolia). Every `execute`/`invoke`/`declare`/`deploy` call in this codebase threads this through.
 */
export const NO_TIP = { tip: 0n } as const;

/** Derives a stable felt salt for `contractName` from the `DEPLOY_SALT` env (default below). */
export function deterministicSalt(contractName: ContractName): string {
  const seed = optionalEnv("DEPLOY_SALT") ?? "train-protocol-e2e-v1";
  return hash.getSelectorFromName(`${seed}:${contractName}`);
}

/** Predicts the UDC address for a no-constructor-arg deploy with `unique: false`. */
export function predictAddress(classHash: string, salt: string): string {
  return hash.calculateContractAddressFromHash(salt, classHash, [], 0);
}

/** Whether `address` already holds code matching `expectedClassHash`. */
export async function isDeployedWithClass(
  provider: RpcProvider,
  address: string,
  expectedClassHash: string,
): Promise<boolean> {
  try {
    const onChain = await provider.getClassHashAt(address);
    return BigInt(onChain) === BigInt(expectedClassHash);
  } catch {
    return false;
  }
}

/**
 * Declares (if needed) and deploys (if not already deployed at the predicted address) a
 * no-constructor-arg contract deterministically via the UDC (`unique: false`), so repeated runs
 * against the same network with the same `DEPLOY_SALT` reuse the same address instead of
 * accumulating new deployments.
 */
export async function declareAndDeployDeterministic(
  account: Account,
  provider: RpcProvider,
  name: ContractName,
): Promise<{ address: string; classHash: string; deployed: boolean; declareTx?: string; deployTx?: string }> {
  const { sierra, casm } = loadArtifacts(name);

  const declareResult = await account.declareIfNot({ contract: sierra, casm }, NO_TIP);
  let declareTx: string | undefined;
  if (declareResult.transaction_hash) {
    declareTx = declareResult.transaction_hash;
    await provider.waitForTransaction(declareResult.transaction_hash);
  }
  const classHash = declareResult.class_hash;

  const salt = deterministicSalt(name);
  const address = predictAddress(classHash, salt);

  if (await isDeployedWithClass(provider, address, classHash)) {
    return { address, classHash, deployed: false, declareTx };
  }

  const deployResult = await account.deploy({
    classHash,
    salt,
    unique: false,
    constructorCalldata: [],
  }, NO_TIP);
  await provider.waitForTransaction(deployResult.transaction_hash);

  const deployedAddress =
    (Array.isArray(deployResult.contract_address)
      ? deployResult.contract_address[0]
      : deployResult.contract_address) ?? address;

  return {
    address: deployedAddress as string,
    classHash,
    deployed: true,
    declareTx,
    deployTx: deployResult.transaction_hash,
  };
}
