import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from '@defi-wonderland/aztec-standards/src/artifacts/Token.ts';
import { TrainContract } from './Train.ts';
import { setupWallet, toWallet } from './utils/setupWallet.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
import {
  parseSecret,
  parseHashlock,
  requireEnv,
  updateEnvFile,
} from './utils/utils.ts';
import { getTimeouts } from './utils/config.ts';

async function main(): Promise<void> {
  const timeouts = getTimeouts();
  const trainAddress = AztecAddress.fromString(requireEnv('TRAIN_ADDRESS'));
  const tokenAddress = AztecAddress.fromString(requireEnv('TOKEN_ADDRESS'));
  const expectedSolverAddress = requireEnv('SOLVER_ADDRESS');
  const hashlock = parseHashlock(requireEnv('USER_LOCK_HASHLOCK'));
  const secret = parseSecret(requireEnv('USER_LOCK_SECRET'));

  const wallet = await setupWallet();

  const solverAccount = await wallet.createSchnorrAccount(
    Fr.fromString(requireEnv('SOLVER_SECRET')),
    Fr.fromString(requireEnv('SOLVER_SALT')),
    (GrumpkinScalar as any).fromString(requireEnv('SOLVER_SIGNING_KEY')),
  );

  if (solverAccount.address.toString() !== expectedSolverAddress) {
    throw new Error(
      `SOLVER keys do not match SOLVER_ADDRESS. Expected ${expectedSolverAddress}, got ${solverAccount.address.toString()}. Re-run setup.ts.`,
    );
  }

  const paymentMethod = await getPaymentMethod(wallet, solverAccount.address);

  const train = TrainContract.at(trainAddress, toWallet(wallet));
  const token = TokenContract.at(tokenAddress, toWallet(wallet));

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
  console.log(`Solver token balance before: ${solverBalBefore}`);
  console.log(`Train token balance before: ${trainBalBefore}`);

  const tx = await train.methods
    .redeem_user(hashlock, secret)
    .send({
      from: solverAccount.address,
      fee: { paymentMethod },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (tx.receipt.hasExecutionReverted()) {
    throw new Error(
      `redeem_user reverted: executionResult=${tx.receipt.executionResult ?? 'unknown'}, error=${tx.receipt.error ?? 'unknown'}, block=${tx.receipt.blockNumber ?? 'unknown'}`,
    );
  }

  const { result: solverBalAfter } = await token.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });
  const { result: trainBalAfter } = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: solverAccount.address });

  const txHash = tx.receipt.txHash?.toString?.() ?? String(tx);
  updateEnvFile('.env', { USER_REDEEM_TX_HASH: txHash });

  console.log(`User redeem tx: ${txHash}`);
  console.log(`Solver token balance after: ${solverBalAfter}`);
  console.log(`Train token balance after: ${trainBalAfter}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Error: ${err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
