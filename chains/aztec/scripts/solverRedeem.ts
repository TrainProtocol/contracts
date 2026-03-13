import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from '@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
import {
  parseHashlock,
  parseSecret,
  requireEnv,
  updateEnvFile,
} from './utils/utils.ts';
import { getTimeouts } from './utils/config.ts';

async function main(): Promise<void> {
  const timeouts = getTimeouts();
  const trainAddress = AztecAddress.fromString(requireEnv('TRAIN_ADDRESS'));
  const tokenAddress = AztecAddress.fromString(requireEnv('TOKEN_ADDRESS'));
  const expectedUserAddress = requireEnv('USER_ADDRESS');
  const hashlock = parseHashlock(requireEnv('USER_LOCK_HASHLOCK'));
  const secret = parseSecret(requireEnv('USER_LOCK_SECRET'));
  const solverIndex = BigInt(requireEnv('SOLVER_LOCK_INDEX'));

  const wallet = await setupWallet();

  const userAccount = await wallet.createSchnorrAccount(
    Fr.fromString(requireEnv('USER_SECRET')),
    Fr.fromString(requireEnv('USER_SALT')),
    (GrumpkinScalar as any).fromString?.(requireEnv('USER_SIGNING_KEY')) ||
      GrumpkinScalar.random(),
  );

  if (userAccount.address.toString() !== expectedUserAddress) {
    throw new Error(
      `USER keys do not match USER_ADDRESS. Expected ${expectedUserAddress}, got ${userAccount.address.toString()}. Re-run setup.ts.`,
    );
  }

  const paymentMethod = await getPaymentMethod(wallet, userAccount.address);

  const train = TrainContract.at(trainAddress, wallet);
  const token = TokenContract.at(tokenAddress, wallet);

  const { result: userBalBefore } = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const { result: trainBalBefore } = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: userAccount.address });

  console.log(`User address: ${userAccount.address.toString()}`);
  console.log(`Train address: ${trainAddress.toString()}`);
  console.log(`Token address: ${tokenAddress.toString()}`);
  console.log(`Hashlock: 0x${Buffer.from(hashlock).toString('hex')}`);
  console.log(`Solver lock index: ${solverIndex.toString()}`);
  console.log(`User token balance before: ${userBalBefore}`);
  console.log(`Train token balance before: ${trainBalBefore}`);

  const tx = await train.methods
    .redeem_solver(hashlock, solverIndex, secret)
    .send({
      from: userAccount.address,
      fee: { paymentMethod },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (tx.receipt.hasExecutionReverted()) {
    throw new Error(
      `redeem_solver reverted: executionResult=${tx.receipt.executionResult ?? 'unknown'}, error=${tx.receipt.error ?? 'unknown'}, block=${tx.receipt.blockNumber ?? 'unknown'}`,
    );
  }

  const { result: userBalAfter } = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const { result: trainBalAfter } = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: userAccount.address });

  const txHash = tx.receipt.txHash?.toString?.() ?? String(tx);
  updateEnvFile('.env', { SOLVER_REDEEM_TX_HASH: txHash });

  console.log(`Solver redeem tx: ${txHash}`);
  console.log(`User token balance after: ${userBalAfter}`);
  console.log(`Train token balance after: ${trainBalAfter}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
