/**
 * One-time `deploy_account` for the mainnet deployer (Argent/Ready v0.4.0, single Stark
 * signer, no guardian). The address is counterfactual — funded with STRK but not yet
 * deployed — so this must run once before the account can send the Train declare.
 *
 * Constructor calldata ["0x0", pubkey, "0x1"] (Signer::Starknet(pubkey), Option::None) and
 * salt = pubkey were verified to reproduce ACCOUNT_ADDRESS exactly before this script was run.
 *
 * Run: npx tsx src/deploy-account-mainnet.ts
 */
import { Account, ec } from "starknet";
import { getProvider, requireEnv, NO_TIP } from "./config.js";

const ARGENT_V040_CLASS_HASH =
  "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

async function main() {
  const provider = getProvider();
  const address = requireEnv("ACCOUNT_ADDRESS");
  const pk = requireEnv("PRIVATE_KEY");
  const pub = ec.starkCurve.getStarkKey(pk);

  const chainId = (await provider.getChainId()).toString();
  if (chainId !== "0x534e5f4d41494e" && chainId !== "SN_MAIN") {
    throw new Error(`RPC is not mainnet (chain id ${chainId})`);
  }

  try {
    const existing = await provider.getClassHashAt(address);
    console.log(`Account already deployed (class ${existing}) — nothing to do.`);
    return;
  } catch {
    /* not deployed — proceed */
  }

  const account = new Account({ provider, address, signer: pk });
  const res = await account.deployAccount(
    {
      classHash: ARGENT_V040_CLASS_HASH,
      constructorCalldata: ["0x0", pub, "0x1"],
      addressSalt: pub,
      contractAddress: address,
    },
    NO_TIP,
  );
  console.log("deploy_account tx:", res.transaction_hash);
  const receipt = (await provider.waitForTransaction(res.transaction_hash)) as {
    execution_status?: string;
    actual_fee?: { amount?: string } | string;
  };
  const fee =
    typeof receipt.actual_fee === "object" ? receipt.actual_fee?.amount : receipt.actual_fee;
  console.log("status:", receipt.execution_status, "| actual fee (fri):", fee);
  if (fee) console.log("actual fee:", Number(BigInt(fee)) / 1e18, "STRK");
}

main().catch((err) => {
  console.error("deploy-account failed:", err);
  process.exit(1);
});
