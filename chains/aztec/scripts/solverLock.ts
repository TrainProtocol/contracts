import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from './Token.ts';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';
import {
  authorizePublicTransfer,
  parseHashlock,
  requireEnv,
  stringToBytes,
  updateEnvFile,
} from './utils/utils.ts';
import { getTimeouts } from './utils/config.ts';

async function main(): Promise<void> {
  const timeouts = getTimeouts();
  const trainAddress = AztecAddress.fromString(requireEnv('TRAIN_ADDRESS'));
  const tokenAddress = AztecAddress.fromString(requireEnv('TOKEN_ADDRESS'));
  const expectedSolverAddress = requireEnv('SOLVER_ADDRESS');
  const userAddress = AztecAddress.fromString(requireEnv('USER_ADDRESS'));
  const hashlock = parseHashlock(requireEnv('USER_LOCK_HASHLOCK'));

  const amount = BigInt(requireEnv('AMOUNT'));
  const reward = BigInt(requireEnv('REWARD_AMOUNT'));
  const timelockDelta = Number(requireEnv('TIMELOCK_DELTA'));
  const rewardTimelockDelta = Number(requireEnv('REWARD_TIMELOCK_DELTA'));
  const dstAmount = BigInt(requireEnv('DST_AMOUNT'));

  const srcChain = stringToBytes(requireEnv('SRC_CHAIN'), 30);
  const dstChain = stringToBytes(requireEnv('DST_CHAIN'), 30);
  const dstAddress = stringToBytes(requireEnv('DST_ADDRESS'), 90);
  const dstToken = stringToBytes(requireEnv('DST_TOKEN'), 90);
  const data = new Array(256).fill(0);

  const rewardTokenRaw = requireEnv('REWARD_TOKEN_ADDRESS');
  const rewardTokenAddress =
    rewardTokenRaw === '0x0'
      ? tokenAddress
      : AztecAddress.fromString(rewardTokenRaw);

  const wallet = await setupWallet();
  const sponsoredFPC = await getSponsoredFPCInstance();
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  const secretKey = Fr.fromString(requireEnv('SOLVER_SECRET'));
  const salt = Fr.fromString(requireEnv('SOLVER_SALT'));
  const signingKey =
    (GrumpkinScalar as any).fromString?.(requireEnv('SOLVER_SIGNING_KEY')) ||
    GrumpkinScalar.random();

  const solverAccount = await wallet.createSchnorrAccount(
    secretKey,
    salt,
    signingKey,
  );
  if (solverAccount.address.toString() !== expectedSolverAddress) {
    throw new Error(
      `SOLVER keys do not match SOLVER_ADDRESS. Expected ${expectedSolverAddress}, got ${solverAccount.address.toString()}. Re-run setup.ts.`,
    );
  }

  const train = TrainContract.at(trainAddress, wallet);
  const token = TokenContract.at(tokenAddress, wallet);
  const transferNonce = Fr.random();
  const rewardTransferNonce = Fr.random();

  const solverBalBefore = await token.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });
  const trainBalBefore = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: solverAccount.address });

  console.log(`Solver address: ${solverAccount.address.toString()}`);
  console.log(`User address: ${userAddress.toString()}`);
  console.log(`Train address: ${trainAddress.toString()}`);
  console.log(`Token address: ${tokenAddress.toString()}`);
  console.log(`Hashlock: 0x${Buffer.from(hashlock).toString('hex')}`);
  console.log(`Solver token balance before: ${solverBalBefore}`);
  console.log(`Train token balance before: ${trainBalBefore}`);

  // Train.solver_lock pulls tokens with the provided transfer nonce(s),
  // so the solver must set matching public authwit(s) in advance.
  if (reward > 0n && rewardTokenAddress.equals(tokenAddress)) {
    await authorizePublicTransfer(
      wallet,
      solverAccount.address,
      trainAddress,
      token.methods.transfer_public_to_public(
        solverAccount.address,
        trainAddress,
        amount + reward,
        transferNonce,
      ),
      paymentMethod,
      timeouts.txTimeout,
    );
  } else {
    await authorizePublicTransfer(
      wallet,
      solverAccount.address,
      trainAddress,
      token.methods.transfer_public_to_public(
        solverAccount.address,
        trainAddress,
        amount,
        transferNonce,
      ),
      paymentMethod,
      timeouts.txTimeout,
    );

    if (reward > 0n && !rewardTokenAddress.equals(tokenAddress)) {
      const rewardToken = TokenContract.at(rewardTokenAddress, wallet);
      await authorizePublicTransfer(
        wallet,
        solverAccount.address,
        trainAddress,
        rewardToken.methods.transfer_public_to_public(
          solverAccount.address,
          trainAddress,
          reward,
          rewardTransferNonce,
        ),
        paymentMethod,
        timeouts.txTimeout,
      );
    }
  }

  const tx = await train.methods
    .solver_lock(
      hashlock,
      amount,
      transferNonce,
      reward,
      rewardTransferNonce,
      timelockDelta,
      rewardTimelockDelta,
      solverAccount.address,
      userAddress,
      solverAccount.address,
      tokenAddress,
      rewardTokenAddress,
      srcChain,
      dstChain,
      dstAddress,
      dstAmount,
      dstToken,
      data,
    )
    .send({
      from: solverAccount.address,
      fee: { paymentMethod },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (tx.hasExecutionReverted()) {
    throw new Error(
      `solver_lock reverted: executionResult=${tx.executionResult ?? 'unknown'}, error=${tx.error ?? 'unknown'}, block=${tx.blockNumber ?? 'unknown'}`,
    );
  }

  const index = await train.methods
    .get_solver_lock_count(hashlock)
    .simulate({ from: solverAccount.address });
  const txHash = tx.txHash?.toString?.() ?? String(tx);

  const solverBalAfter = await token.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });
  const trainBalAfter = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: solverAccount.address });

  updateEnvFile('.env', {
    SOLVER_LOCK_TX_HASH: txHash,
    SOLVER_LOCK_INDEX: index.toString(),
  });

  console.log(`Solver lock tx: ${txHash}`);
  console.log(`Solver lock index: ${index.toString()}`);
  console.log(`Solver token balance after: ${solverBalAfter}`);
  console.log(`Train token balance after: ${trainBalAfter}`);
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
