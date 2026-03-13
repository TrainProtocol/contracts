import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { decodeLockStatus, parseHashlock, requireEnv } from './utils/utils.ts';

async function main(): Promise<void> {
  const trainAddress = AztecAddress.fromString(requireEnv('TRAIN_ADDRESS'));
  const expectedUserAddress = requireEnv('USER_ADDRESS');
  const hashlock = parseHashlock(requireEnv('USER_LOCK_HASHLOCK'));

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

  const train = TrainContract.at(trainAddress, wallet);
  const from = userAccount.address;

  const { result: userLock } = await train.methods.get_user_lock(hashlock).simulate({ from });
  const { result: solverCount } = await train.methods
    .get_solver_lock_count(hashlock)
    .simulate({ from });

  console.log(`Train: ${trainAddress.toString()}`);
  console.log(`Hashlock: 0x${Buffer.from(hashlock).toString('hex')}`);
  console.log('\n=== User Lock ===');
  console.log(`UserLock status: ${decodeLockStatus(userLock.status)}`);
  console.log(`UserLock amount: ${userLock.amount}`);
  console.log(`UserLock sender: ${userLock.sender.toString()}`);
  console.log(`UserLock recipient: ${userLock.recipient.toString()}`);
  console.log(`UserLock token: ${userLock.token.toString()}`);
  console.log(`UserLock timelock: ${userLock.timelock}`);

  const solverCountNum = Number(solverCount);
  console.log('\n=== Solver Locks ===');
  console.log(`Solver lock count: ${solverCountNum}`);
  if (solverCountNum === 0) {
    console.log('No solver locks found for this hashlock.');
    return;
  }

  for (let i = 1; i <= solverCountNum; i++) {
    const solverIndex = BigInt(i);
    const { result: solverLock } = await train.methods
      .get_solver_lock(hashlock, solverIndex)
      .simulate({ from });
    console.log(`\nSolverLock index: ${solverIndex.toString()}`);
    console.log(`SolverLock status: ${decodeLockStatus(solverLock.status)}`);
    console.log(`SolverLock amount: ${solverLock.amount}`);
    console.log(`SolverLock reward: ${solverLock.reward}`);
    console.log(`SolverLock sender: ${solverLock.sender.toString()}`);
    console.log(`SolverLock recipient: ${solverLock.recipient.toString()}`);
    console.log(`SolverLock token: ${solverLock.token.toString()}`);
    console.log(`SolverLock reward token: ${solverLock.reward_token.toString()}`);
    console.log(`SolverLock timelock: ${solverLock.timelock}`);
    console.log(`SolverLock reward timelock: ${solverLock.reward_timelock}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
