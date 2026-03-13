import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from '@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js';
import { setupWallet } from './utils/setupWallet.ts';
import { getPaymentMethod } from './utils/feePayment.ts';
import { requireEnv, updateEnvFile } from './utils/utils.ts';
import { getTimeouts } from './utils/config.ts';

function getMintAmount(): bigint {
  const fromArg = process.argv[2];
  if (fromArg) return BigInt(fromArg);

  const fromEnv =
    process.env.MINT_AGAIN_AMOUNT ??
    process.env.MINAT_AGAIN_AMOUNT ??
    process.env.MINT_AMOUNT ??
    process.env.MINAT_AMOUNT ??
    process.env.AMOUNT;
  if (fromEnv) return BigInt(fromEnv);

  throw new Error(
    'Missing mint amount. Pass as first arg, set MINT_AGAIN_AMOUNT (or MINAT_AGAIN_AMOUNT), MINT_AMOUNT (or MINAT_AMOUNT), or AMOUNT in .env',
  );
}

async function main(): Promise<void> {
  const timeouts = getTimeouts();
  const tokenAddress = AztecAddress.fromString(requireEnv('TOKEN_ADDRESS'));
  const userAddress = AztecAddress.fromString(requireEnv('USER_ADDRESS'));
  const solverAddress = AztecAddress.fromString(requireEnv('SOLVER_ADDRESS'));
  const expectedDeployerAddress = requireEnv('DEPLOYER_ADDRESS');
  const amountEach = getMintAmount();

  const wallet = await setupWallet();

  const deployerAccount = await wallet.createSchnorrAccount(
    Fr.fromString(requireEnv('DEPLOYER_SECRET')),
    Fr.fromString(requireEnv('DEPLOYER_SALT')),
    (GrumpkinScalar as any).fromString?.(requireEnv('DEPLOYER_SIGNING_KEY')) ||
      GrumpkinScalar.random(),
  );

  if (deployerAccount.address.toString() !== expectedDeployerAddress) {
    throw new Error(
      `DEPLOYER keys do not match DEPLOYER_ADDRESS. Expected ${expectedDeployerAddress}, got ${deployerAccount.address.toString()}. Re-run setup.ts.`,
    );
  }

  const token = TokenContract.at(tokenAddress, wallet);

  const { result: userBalBefore } = await token.methods
    .balance_of_public(userAddress)
    .simulate({ from: deployerAccount.address });
  const { result: solverBalBefore } = await token.methods
    .balance_of_public(solverAddress)
    .simulate({ from: deployerAccount.address });

  console.log(`Deployer address: ${deployerAccount.address.toString()}`);
  console.log(`Token address: ${tokenAddress.toString()}`);
  console.log(`User address: ${userAddress.toString()}`);
  console.log(`Solver address: ${solverAddress.toString()}`);
  console.log(`Mint amount (each): ${amountEach.toString()}`);
  console.log(`User balance before: ${userBalBefore}`);
  console.log(`Solver balance before: ${solverBalBefore}`);

  const userMintTx = await token.methods
    .mint_to_public(userAddress, amountEach)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: await getPaymentMethod(wallet, deployerAccount.address) },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (userMintTx.receipt.hasExecutionReverted()) {
    throw new Error(
      `mint_to_public(user) reverted: executionResult=${userMintTx.receipt.executionResult ?? 'unknown'}, error=${userMintTx.receipt.error ?? 'unknown'}, block=${userMintTx.receipt.blockNumber ?? 'unknown'}`,
    );
  }

  const solverMintTx = await token.methods
    .mint_to_public(solverAddress, amountEach)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod: await getPaymentMethod(wallet, deployerAccount.address) },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (solverMintTx.receipt.hasExecutionReverted()) {
    throw new Error(
      `mint_to_public(solver) reverted: executionResult=${solverMintTx.receipt.executionResult ?? 'unknown'}, error=${solverMintTx.receipt.error ?? 'unknown'}, block=${solverMintTx.receipt.blockNumber ?? 'unknown'}`,
    );
  }

  const { result: userBalAfter } = await token.methods
    .balance_of_public(userAddress)
    .simulate({ from: deployerAccount.address });
  const { result: solverBalAfter } = await token.methods
    .balance_of_public(solverAddress)
    .simulate({ from: deployerAccount.address });

  const userMintTxHash =
    userMintTx.receipt.txHash?.toString?.() ?? String(userMintTx);
  const solverMintTxHash =
    solverMintTx.receipt.txHash?.toString?.() ?? String(solverMintTx);

  updateEnvFile('.env', {
    MINT_AGAIN_AMOUNT: amountEach.toString(),
    MINT_AGAIN_USER_TX_HASH: userMintTxHash,
    MINT_AGAIN_SOLVER_TX_HASH: solverMintTxHash,
  });

  console.log(`User mint tx: ${userMintTxHash}`);
  console.log(`Solver mint tx: ${solverMintTxHash}`);
  console.log(`User balance after: ${userBalAfter}`);
  console.log(`Solver balance after: ${solverBalAfter}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
