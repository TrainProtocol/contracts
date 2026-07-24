/**
 * Core deployment logic for the Fuel/Sway "Train" HTLC port: deterministic, idempotent
 * deploys of `train`/`payout_curve`.
 */
import {
  getContractId,
  getContractStorageRoot,
  type Provider,
  type WalletUnlocked,
} from 'fuels';

import {
  payoutCurveArtifact,
  trainArtifact,
} from './artifacts';
import { deterministicSalt } from './salt';

// ───────────────────────────── Deterministic contract-ID prediction ─────────────────────────────

/** Predicts a contract's deterministic ID from its bytecode + salt, with NO storage-slot
 * preinitialization (both `train` and `payout_curve`'s `out/debug/*-storage_slots.json` are
 * `[]`) -- a pure computation, no network round-trip. This is exactly what
 * `ContractFactory.createTransactionRequest` computes internally when given the same
 * `(bytecode, salt)` and no explicit `storageSlots`/`stateRoot` override, confirmed by reading
 * `@fuel-ts/contract`'s `createTransactionRequest` source. */
export function predictContractId(bytecode: Uint8Array, salt: string): string {
  const stateRoot = getContractStorageRoot([]);
  return getContractId(bytecode, salt, stateRoot);
}

// ───────────────────────────── Idempotent contract deploy ─────────────────────────────

export interface DeployResult {
  contractId: string;
  /** `true` if this call actually broadcast a deploy transaction; `false` if a contract with
   * this exact (bytecode, salt, state root) already existed on-chain and was reused. */
  deployed: boolean;
  /** Set only when `deployed` is `true`. */
  transactionId?: string;
}

/**
 * Deploys `bytecode`/`abi` with the fixed deterministic salt for `componentName` (see
 * `salt.ts`), unless a contract already exists at the predicted ID on `provider`'s network --
 * in which case that ID is reused and no transaction is sent. This gives the same
 * idempotent-deterministic-deploy guarantee the other Train ports provide: safe to re-run
 * against the same network any number of times.
 */
export async function deployDeterministic(
  componentName: string,
  bytecode: Uint8Array,
  abi: unknown,
  deployer: WalletUnlocked,
  provider: Provider,
  saltSeed?: string,
): Promise<DeployResult> {
  const salt = deterministicSalt(componentName, saltSeed);
  const predictedId = predictContractId(bytecode, salt);

  const existing = await provider.getContract(predictedId);
  if (existing) {
    return { contractId: predictedId, deployed: false };
  }

  // Lazily require ContractFactory here so the pure-computation "predict without deploying"
  // helpers above stay free of any SDK class that could make a network call.
  const { ContractFactory } = await import('fuels');
  const factory = new ContractFactory(bytecode, abi as never, deployer);
  const { contractId, waitForResult } = await factory.deploy({ salt });
  const { transactionResult } = await waitForResult();
  if (contractId.toLowerCase() !== predictedId.toLowerCase()) {
    // Would indicate this file's prediction logic has drifted from the SDK's own -- fail loudly
    // rather than silently trusting either value.
    throw new Error(
      `deployDeterministic("${componentName}"): predicted contract id ${predictedId} does not ` +
        `match the SDK's own deploy result ${contractId} -- salt/storage-root derivation has ` +
        `drifted from @fuel-ts/contract's ContractFactory.createTransactionRequest.`,
    );
  }
  return { contractId, deployed: true, transactionId: transactionResult.id };
}

// ───────────────────────────── Full orchestration ─────────────────────────────

export interface DeployAllResult {
  train: DeployResult;
  payoutCurve: DeployResult;
}

/**
 * Deploys `train` + `payout_curve` (idempotently, deterministically). `deployer` funds whichever
 * of `train`/`payout_curve` are not already deployed on `provider`'s network -- if both already
 * exist, this makes zero network writes and works even with an unfunded/read-only `deployer`
 * (`deployer` still needs a valid keypair to construct a `ContractFactory`, just not funds, in
 * that all-already-deployed case).
 */
export async function deployAll(
  deployer: WalletUnlocked,
  provider: Provider,
  saltSeed?: string,
): Promise<DeployAllResult> {
  const { abi: trainAbi, bytecode: trainBytecode } = trainArtifact();
  const { abi: payoutCurveAbi, bytecode: payoutCurveBytecode } = payoutCurveArtifact();

  const train = await deployDeterministic('train', trainBytecode, trainAbi, deployer, provider, saltSeed);
  const payoutCurve = await deployDeterministic(
    'payout_curve',
    payoutCurveBytecode,
    payoutCurveAbi,
    deployer,
    provider,
    saltSeed,
  );

  return { train, payoutCurve };
}
