import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from './Token.js';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { TrainContract } from './Train.ts';
import { setupWallet } from './utils/setupWallet.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';
import {
  authorizePublicTransfer,
  bytesToHex,
  requireEnv,
  stringToBytes,
  updateEnvFile,
} from './utils/utils.ts';
import { getAztecNodeUrl, getTimeouts } from './utils/config.ts';

async function main(): Promise<void> {
  const timeouts = getTimeouts();
  const trainAddress = AztecAddress.fromString(requireEnv('TRAIN_ADDRESS'));
  const tokenAddress = AztecAddress.fromString(requireEnv('TOKEN_ADDRESS'));
  const solverAddress = AztecAddress.fromString(requireEnv('SOLVER_ADDRESS'));
  const expectedUserAddress = requireEnv('USER_ADDRESS');

  const amount = BigInt(requireEnv('AMOUNT'));
  const rewardAmount = BigInt(requireEnv('REWARD_AMOUNT'));
  const timelockDelta = Number(requireEnv('TIMELOCK_DELTA'));
  const rewardTimelockDelta = Number(requireEnv('REWARD_TIMELOCK_DELTA'));
  const quoteExpiryDelta = Number(requireEnv('QUOTE_EXPIRY_DELTA'));
  const dstAmount = BigInt(requireEnv('DST_AMOUNT'));

  const srcChain = stringToBytes(requireEnv('SRC_CHAIN'), 30);
  const dstChain = stringToBytes(requireEnv('DST_CHAIN'), 30);
  const dstAddress = stringToBytes(requireEnv('DST_ADDRESS'), 90);
  const dstToken = stringToBytes(requireEnv('DST_TOKEN'), 90);
  const rewardTokenRaw = requireEnv('REWARD_TOKEN_ADDRESS');
  const rewardToken =
    rewardTokenRaw === '0x0'
      ? AztecAddress.ZERO
      : AztecAddress.fromString(rewardTokenRaw);
  const rewardRecipient = stringToBytes(requireEnv('REWARD_RECIPIENT'), 90);
  const solverData = new Array(256).fill(0);
  const userData = new Array(256).fill(0);

  const wallet = await setupWallet();
  const sponsoredFPC = await getSponsoredFPCInstance();
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  const secretKey = Fr.fromString(requireEnv('USER_SECRET'));
  const salt = Fr.fromString(requireEnv('USER_SALT'));
  const signingKey =
    (GrumpkinScalar as any).fromString?.(requireEnv('USER_SIGNING_KEY')) ||
    GrumpkinScalar.random();

  // Setup script already deploys this account. Here we only recreate the manager.
  const account = await wallet.createSchnorrAccount(
    secretKey,
    salt,
    signingKey,
  );
  if (account.address.toString() !== expectedUserAddress) {
    throw new Error(
      `USER keys do not match USER_ADDRESS. Expected ${expectedUserAddress}, got ${account.address.toString()}. Re-run setup.ts.`,
    );
  }

  const token = TokenContract.at(tokenAddress, wallet);
  const train = TrainContract.at(trainAddress, wallet);

  const secret = crypto.randomBytes(32);
  const hashlock = crypto.createHash('sha256').update(secret).digest();
  const hashlockBytes = Array.from(hashlock);

  const node = createAztecNodeClient(getAztecNodeUrl());
  const latestHeader = await node.getBlockHeader('latest');
  if (!latestHeader) {
    throw new Error('Could not fetch latest block header from node');
  }
  const now = Number(latestHeader.globalVariables.timestamp);
  const quoteExpiry = now + quoteExpiryDelta;

  const userBalBefore = await token.methods
    .balance_of_public(account.address)
    .simulate({ from: account.address });
  const trainBalBefore = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: account.address });

  console.log(`User address: ${account.address.toString()}`);
  console.log(`Solver address: ${solverAddress.toString()}`);
  console.log(`Train address: ${trainAddress.toString()}`);
  console.log(`Token address: ${tokenAddress.toString()}`);
  console.log(`User token balance before: ${userBalBefore}`);
  console.log(`Train token balance before: ${trainBalBefore}`);
  console.log(`Node timestamp now: ${now}`);
  console.log(
    `Quote expiry: ${quoteExpiry} (in ${quoteExpiry - now}s from current block)`,
  );

  // Must match the transfer_nonce passed to Train.user_lock.
  const transferNonce = Fr.random();

  const publicAction = token.methods.transfer_public_to_public(
    account.address,
    trainAddress,
    amount,
    transferNonce,
  );

  await authorizePublicTransfer(
    wallet,
    account.address,
    trainAddress,
    publicAction,
    paymentMethod,
    timeouts.txTimeout,
  );
  console.log('Authwit tx confirmed.');

  console.log('Sending user_lock tx...');
  const lockCall = train.methods.user_lock(
    hashlockBytes,
    amount,
    transferNonce,
    rewardAmount,
    timelockDelta,
    rewardTimelockDelta,
    quoteExpiry,
    account.address,
    solverAddress,
    tokenAddress,
    rewardToken,
    rewardRecipient,
    srcChain,
    dstChain,
    dstAddress,
    dstAmount,
    dstToken,
    solverData,
    userData,
  );
  const tx = await lockCall.send({
    from: account.address,
    fee: { paymentMethod },
    wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
  });
  if (tx.hasExecutionReverted()) {
    const latestAfter = await node.getBlockHeader('latest');
    const latestTs = latestAfter
      ? Number(latestAfter.globalVariables.timestamp)
      : undefined;
    throw new Error(
      `user_lock reverted: executionResult=${tx.executionResult ?? 'unknown'}, error=${tx.error ?? 'unknown'}, block=${tx.blockNumber ?? 'unknown'}, latestTimestamp=${latestTs ?? 'unknown'}, quoteExpiry=${quoteExpiry}`,
    );
  }

  const trainBal = await token.methods
    .balance_of_public(trainAddress)
    .simulate({ from: account.address });

  const txHash = tx.txHash?.toString?.() ?? String(tx);
  const secretHex = bytesToHex(secret);
  const hashlockHex = bytesToHex(hashlock);

  updateEnvFile('.env', {
    USER_LOCK_TX_HASH: txHash,
    USER_LOCK_SECRET: secretHex,
    USER_LOCK_HASHLOCK: hashlockHex,
  });

  console.log(`User lock tx: ${txHash}`);
  console.log(`Secret: ${secretHex}`);
  console.log(`Hashlock: ${hashlockHex}`);
  console.log(`Train public balance: ${trainBal}`);
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
