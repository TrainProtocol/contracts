import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';
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
  console.log(`Solver lock index: ${solverIndex.toString()}`);
  console.log(`User token balance before: ${userBalBefore}`);
  console.log(`Train token balance before: ${trainBalBefore}`);

  const transferNonce = Fr.random();
  const rewardTransferNonce = Fr.random();
  const tx = await train.methods
    .redeem_solver(
      hashlock,
      solverIndex,
      secret,
      transferNonce,
      rewardTransferNonce,
    )
    .send({
      from: userAccount.address,
      fee: { paymentMethod },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (tx.hasExecutionReverted()) {
    throw new Error(
      `redeem_solver reverted: executionResult=${tx.executionResult ?? 'unknown'}, error=${tx.error ?? 'unknown'}, block=${tx.blockNumber ?? 'unknown'}`,
    );
  }

  const userBalAfter = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const trainBalAfter = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: userAccount.address });

  const txHash = tx.txHash?.toString?.() ?? String(tx);
  updateEnvFile('.env', { SOLVER_REDEEM_TX_HASH: txHash });

  console.log(`Solver redeem tx: ${txHash}`);
  console.log(`User token balance after: ${userBalAfter}`);
  console.log(`Train token balance after: ${trainBalAfter}`);
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
