import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TokenContract } from '@defi-wonderland/aztec-standards/src/artifacts/Token.ts';
import { TrainContract } from './Train.ts';
import { setupWallet, toWallet } from './utils/setupWallet.ts';
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
  const expectedUserAddress = requireEnv('USER_ADDRESS');
  const hashlock = parseHashlock(requireEnv('USER_LOCK_HASHLOCK'));

  const wallet = await setupWallet();

  const userAccount = await wallet.createSchnorrAccount(
    Fr.fromString(requireEnv('USER_SECRET')),
    Fr.fromString(requireEnv('USER_SALT')),
    (GrumpkinScalar as any).fromString(requireEnv('USER_SIGNING_KEY')),
  );

  if (userAccount.address.toString() !== expectedUserAddress) {
    throw new Error(
      `USER keys do not match USER_ADDRESS. Expected ${expectedUserAddress}, got ${userAccount.address.toString()}. Re-run setup.ts.`,
    );
  }

  const paymentMethod = await getPaymentMethod(wallet, userAccount.address);

  const train = TrainContract.at(trainAddress, toWallet(wallet));
  const token = TokenContract.at(tokenAddress, toWallet(wallet));

  const { result: lockBefore } = await train.methods.get_user_lock(hashlock).simulate({
    from: userAccount.address,
  });
  const statusBefore = decodeLockStatus(lockBefore.status);
  if (statusBefore !== 'PENDING') {
    throw new Error(`User lock is not pending. Current status: ${statusBefore}`);
  }

  const node = createAztecNodeClient(getAztecNodeUrl());
  const latestHeader = await node.getBlockHeader('latest');
  if (!latestHeader) {
    throw new Error('Could not fetch latest block header from node');
  }
  const now = Number(latestHeader.globalVariables.timestamp);
  const timelock = Number(lockBefore.timelock);

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
  console.log(`User lock status before: ${statusBefore}`);
  console.log(`Node timestamp now: ${now}`);
  console.log(`User lock timelock: ${timelock}`);
  console.log(`User token balance before: ${userBalBefore}`);
  console.log(`Train token balance before: ${trainBalBefore}`);

  const tx = await train.methods.refund_user(hashlock).send({
    from: userAccount.address,
    fee: { paymentMethod },
    wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
  });

  if (tx.receipt.hasExecutionReverted()) {
    throw new Error(
      `refund_user reverted: executionResult=${tx.receipt.executionResult ?? 'unknown'}, error=${tx.receipt.error ?? 'unknown'}, block=${tx.receipt.blockNumber ?? 'unknown'}`,
    );
  }

  const { result: lockAfter } = await train.methods.get_user_lock(hashlock).simulate({
    from: userAccount.address,
  });
  const statusAfter = decodeLockStatus(lockAfter.status);
  const { result: userBalAfter } = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const { result: trainBalAfter } = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: userAccount.address });

  const txHash = tx.receipt.txHash?.toString?.() ?? String(tx);
  updateEnvFile('.env', { USER_REFUND_TX_HASH: txHash });

  console.log(`User refund tx: ${txHash}`);
  console.log(`User lock status after: ${statusAfter}`);
  console.log(`User token balance after: ${userBalAfter}`);
  console.log(`Train token balance after: ${trainBalAfter}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Error: ${err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
