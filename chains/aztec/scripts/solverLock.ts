import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from '@defi-wonderland/aztec-standards/src/artifacts/Token.ts';
import { TrainContract } from './Train.ts';
import { setupWallet, toWallet } from './utils/setupWallet.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
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

  const secretKey = Fr.fromString(requireEnv('SOLVER_SECRET'));
  const salt = Fr.fromString(requireEnv('SOLVER_SALT'));
  const signingKey = (GrumpkinScalar as any).fromString(requireEnv('SOLVER_SIGNING_KEY'));

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

  const train = TrainContract.at(trainAddress, toWallet(wallet));
  const token = TokenContract.at(tokenAddress, toWallet(wallet));
  const transferNonce = Fr.random();
  const rewardTransferNonce = Fr.random();

  const { result: solverBalBefore } = await token.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });
  const { result: trainBalBefore } = await token.methods
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
      await getPaymentMethod(wallet, solverAccount.address),
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
      await getPaymentMethod(wallet, solverAccount.address),
      timeouts.txTimeout,
    );

    if (reward > 0n && !rewardTokenAddress.equals(tokenAddress)) {
      const rewardToken = TokenContract.at(rewardTokenAddress, toWallet(wallet));
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
        await getPaymentMethod(wallet, solverAccount.address),
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
      fee: { paymentMethod: await getPaymentMethod(wallet, solverAccount.address) },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (tx.receipt.hasExecutionReverted()) {
    throw new Error(
      `solver_lock reverted: executionResult=${tx.receipt.executionResult ?? 'unknown'}, error=${tx.receipt.error ?? 'unknown'}, block=${tx.receipt.blockNumber ?? 'unknown'}`,
    );
  }

  const { result: index } = await train.methods
    .get_solver_lock_count(hashlock)
    .simulate({ from: solverAccount.address });
  const txHash = tx.receipt.txHash?.toString?.() ?? String(tx);

  const { result: solverBalAfter } = await token.methods
    .balance_of_public(solverAccount.address)
    .simulate({ from: solverAccount.address });
  const { result: trainBalAfter } = await token.methods
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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Error: ${err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
