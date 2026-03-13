import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TokenContract } from '@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
import {
  decodeLockStatus,
  parseHashlock,
  requireEnv,
  updateEnvFile,
} from './utils/utils.ts';
import { getAztecNodeUrl, getTimeouts } from './utils/config.ts';

async function main(): Promise<void> {
  const timeouts = getTimeouts();
  const trainAddress = AztecAddress.fromString(requireEnv('TRAIN_ADDRESS'));
  const tokenAddress = AztecAddress.fromString(requireEnv('TOKEN_ADDRESS'));
  const expectedSolverAddress = requireEnv('SOLVER_ADDRESS');
  const hashlock = parseHashlock(requireEnv('USER_LOCK_HASHLOCK'));
  const solverIndex = BigInt(requireEnv('SOLVER_LOCK_INDEX'));

  const wallet = await setupWallet();

  const solverAccount = await wallet.createSchnorrAccount(
    Fr.fromString(requireEnv('SOLVER_SECRET')),
    Fr.fromString(requireEnv('SOLVER_SALT')),
    (GrumpkinScalar as any).fromString?.(requireEnv('SOLVER_SIGNING_KEY')) ||
      GrumpkinScalar.random(),
  );

  if (solverAccount.address.toString() !== expectedSolverAddress) {
    throw new Error(
      `SOLVER keys do not match SOLVER_ADDRESS. Expected ${expectedSolverAddress}, got ${solverAccount.address.toString()}. Re-run setup.ts.`,
    );
  }

  const paymentMethod = await getPaymentMethod(wallet, solverAccount.address);

  const train = TrainContract.at(trainAddress, wallet);
  const token = TokenContract.at(tokenAddress, wallet);

  const { result: lockBefore } = await train.methods
    .get_solver_lock(hashlock, solverIndex)
    .simulate({ from: solverAccount.address });

  const node = createAztecNodeClient(getAztecNodeUrl());
  const latestHeader = await node.getBlockHeader('latest');
  if (!latestHeader) {
    throw new Error('Could not fetch latest block header from node');
  }
  const now = Number(latestHeader.globalVariables.timestamp);
  const timelock = Number(lockBefore.timelock);

  const { result: solverBalBefore } = await token.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });
  const { result: trainBalBefore } = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: solverAccount.address });

  console.log(`Solver address: ${solverAccount.address.toString()}`);
  console.log(`Train address: ${trainAddress.toString()}`);
  console.log(`Token address: ${tokenAddress.toString()}`);
  console.log(`Hashlock: 0x${Buffer.from(hashlock).toString('hex')}`);
  console.log(`Solver lock index: ${solverIndex.toString()}`);
  console.log(`Node timestamp now: ${now}`);
  console.log(`Solver lock timelock: ${timelock}`);
  console.log(`Solver token balance before: ${solverBalBefore}`);
  console.log(`Train token balance before: ${trainBalBefore}`);

  const tx = await train.methods.refund_solver(hashlock, solverIndex).send({
    from: solverAccount.address,
    fee: { paymentMethod },
    wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
  });

  if (tx.receipt.hasExecutionReverted()) {
    throw new Error(
      `refund_solver reverted: executionResult=${tx.receipt.executionResult ?? 'unknown'}, error=${tx.receipt.error ?? 'unknown'}, block=${tx.receipt.blockNumber ?? 'unknown'}`,
    );
  }

  const { result: lockAfter } = await train.methods
    .get_solver_lock(hashlock, solverIndex)
    .simulate({ from: solverAccount.address });
  const statusAfter = decodeLockStatus(lockAfter.status);
  const { result: solverBalAfter } = await token.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });
  const { result: trainBalAfter } = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: solverAccount.address });

  const txHash = tx.receipt.txHash?.toString?.() ?? String(tx);
  updateEnvFile('.env', { SOLVER_REFUND_TX_HASH: txHash });

  console.log(`Solver refund tx: ${txHash}`);
  console.log(`Solver lock status after: ${statusAfter}`);
  console.log(`Solver token balance after: ${solverBalAfter}`);
  console.log(`Train token balance after: ${trainBalAfter}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
