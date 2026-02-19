import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TokenContract } from './Token.ts';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';
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
  const sponsoredFPC = await getSponsoredFPCInstance();
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

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
  const token = TokenContract.at(tokenAddress, wallet);

  const lockBefore = await train.methods.get_user_lock(hashlock).simulate({
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

  const userBalBefore = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const trainBalBefore = await token.methods
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

  if (tx.hasExecutionReverted()) {
    throw new Error(
      `refund_user reverted: executionResult=${tx.executionResult ?? 'unknown'}, error=${tx.error ?? 'unknown'}, block=${tx.blockNumber ?? 'unknown'}`,
    );
  }

  const lockAfter = await train.methods.get_user_lock(hashlock).simulate({
    from: userAccount.address,
  });
  const statusAfter = decodeLockStatus(lockAfter.status);
  const userBalAfter = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const trainBalAfter = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: userAccount.address });

  const txHash = tx.txHash?.toString?.() ?? String(tx);
  updateEnvFile('.env', { USER_REFUND_TX_HASH: txHash });

  console.log(`User refund tx: ${txHash}`);
  console.log(`User lock status after: ${statusAfter}`);
  console.log(`User token balance after: ${userBalAfter}`);
  console.log(`Train token balance after: ${trainBalAfter}`);
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
