import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  RpcProvider,
  Account,
  Contract,
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
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  // Most public Starknet providers expose JSON-RPC under /rpc/v0_7 or /rpc/v0_8.
  // If a bare host is provided, default to /rpc/v0_7 for compatibility.
  if (parsed.pathname === "/" || parsed.pathname === "") {
    parsed.pathname = "/rpc/v0_7";
    return parsed.toString();
  }

  return trimmed;
}

// ── Provider & Account ──

export function getProvider(): RpcProvider {
  const nodeUrl = normalizeRpcUrl(requireEnv("RPC_URL"));
  const blockTag = optionalEnv("RPC_BLOCK_TAG") ?? "latest";
  return new RpcProvider({
    nodeUrl,
    blockIdentifier: blockTag,
  });
}

export function getAccount(): { account: Account; provider: RpcProvider } {
  const provider = getProvider();
  const account = new Account({
    provider,
    address: requireEnv("ACCOUNT_ADDRESS"),
    signer: requireEnv("PRIVATE_KEY"),
  });
  return { account, provider };
}

// ── Build artifact loaders ──

const ARTIFACTS_DIR = resolve(import.meta.dirname, "../../target/dev");

export function loadSierra(): CompiledSierra {
  const raw = readFileSync(
    resolve(ARTIFACTS_DIR, "train_protocol_Train.contract_class.json"),
    "utf-8",
  );
  return JSON.parse(raw) as CompiledSierra;
}

export function loadCasm(): CompiledSierraCasm {
  const raw = readFileSync(
    resolve(ARTIFACTS_DIR, "train_protocol_Train.compiled_contract_class.json"),
    "utf-8",
  );
  return JSON.parse(raw) as CompiledSierraCasm;
}

// ── Contract helpers ──

export function getTrainContract(
  address: string,
  accountOrProvider: AccountInterface | ProviderInterface,
): Contract {
  const sierra = loadSierra();
  return new Contract({ abi: sierra.abi, address, providerOrAccount: accountOrProvider });
}

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
