import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from '@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { setupWallet } from './utils/setupWallet.ts';
import { getSponsoredFPCInstance } from './utils/sponsoredFpc.ts';
import { requireEnv, updateEnvFile } from './utils/utils.ts';
import { getTimeouts } from './utils/config.ts';

function getInputToAddress(): string {
  const fromArg = process.argv[2];
  if (fromArg) {
    return fromArg;
  }

  const fromEnv = process.env.TRANSFER_TO_ADDRESS;
  if (fromEnv) {
    return fromEnv;
  }

  throw new Error(
    'Missing destination address. Pass as first arg or set TRANSFER_TO_ADDRESS in .env',
  );
}

function getInputAmount(): bigint {
  const fromArg = process.argv[3];
  if (fromArg) {
    return BigInt(fromArg);
  }

  const fromEnv = process.env.TRANSFER_AMOUNT ?? process.env.AMOUNT;
  if (fromEnv) {
    return BigInt(fromEnv);
  }

  throw new Error(
    'Missing transfer amount. Pass as second arg, set TRANSFER_AMOUNT, or set AMOUNT in .env',
  );
}

async function main(): Promise<void> {
  const timeouts = getTimeouts();
  const tokenAddress = AztecAddress.fromString(requireEnv('TOKEN_ADDRESS'));
  const expectedUserAddress = requireEnv('USER_ADDRESS');
  const toAddress = AztecAddress.fromString(getInputToAddress());
  const amount = getInputAmount();

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

  const token = TokenContract.at(tokenAddress, wallet);
  const transferNonce = Fr.random();

  const senderBalBefore = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const recipientBalBefore = await token.methods
    .balance_of_public(toAddress)
    .simulate({ from: userAccount.address });

  console.log(`User address: ${userAccount.address.toString()}`);
  console.log(`Token address: ${tokenAddress.toString()}`);
  console.log(`To address: ${toAddress.toString()}`);
  console.log(`Amount: ${amount.toString()}`);
  console.log(`User token balance before: ${senderBalBefore}`);
  console.log(`Recipient token balance before: ${recipientBalBefore}`);

  const tx = await token.methods
    .transfer_public_to_public(
      userAccount.address,
      toAddress,
      amount,
      transferNonce,
    )
    .send({
      from: userAccount.address,
      fee: { paymentMethod },
      wait: { timeout: timeouts.txTimeout, dontThrowOnRevert: true },
    });

  if (tx.hasExecutionReverted()) {
    throw new Error(
      `transfer_public_to_public reverted: executionResult=${tx.executionResult ?? 'unknown'}, error=${tx.error ?? 'unknown'}, block=${tx.blockNumber ?? 'unknown'}`,
    );
  }

  const senderBalAfter = await token.methods
    .balance_of_public(userAccount.address)
    .simulate({ from: userAccount.address });
  const recipientBalAfter = await token.methods
    .balance_of_public(toAddress)
    .simulate({ from: userAccount.address });

  const txHash = tx.txHash?.toString?.() ?? String(tx);
  updateEnvFile('.env', { USER_PUBLIC_TRANSFER_TX_HASH: txHash });

  console.log(`Transfer tx: ${txHash}`);
  console.log(`User token balance after: ${senderBalAfter}`);
  console.log(`Recipient token balance after: ${recipientBalAfter}`);
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
