import {
  AztecAddress,
  Contract,
  Fr,
  SponsoredFeePaymentMethod,
  Wallet,
} from '@aztec/aztec.js';
import { TrainContract } from './Train.ts';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import {
  updateData,
  readData,
  generateId,
  publicLogs,
  simulateBlockPassing,
  getHTLCDetails,
  getPXEs,
} from './utils.ts';
import { CheatCodes } from '@aztec/aztec.js/testing';
import { getSponsoredFPCInstance } from './fpc.ts';
import { getSchnorrAccount } from '@aztec/accounts/schnorr';

const TrainContractArtifact = TrainContract.artifact;
const ethRpcUrl = 'http://localhost:8545';

async function main(): Promise<void> {
  const [pxe1, pxe2, pxe3] = await getPXEs(['pxe1', 'pxe2', 'pxe3']);
  const sponseredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponseredFPC.address);
  const cc = await CheatCodes.create([ethRpcUrl], pxe1);
  const data = readData();
  let userSecretKey = Fr.fromString(data.userSecretKey);
  let userSalt = Fr.fromString(data.userSalt);
  const schnorWallet = await getSchnorrAccount(
    pxe1,
    userSecretKey,
    deriveSigningKey(userSecretKey),
    userSalt,
  );
  const senderWallet = await schnorWallet.getWallet();

  const deployerSecretKey = Fr.fromString(data.deployerSecretKey);
  const deployerSalt = Fr.fromString(data.deployerSalt);
  const schnorWallet1 = await getSchnorrAccount(
    pxe3,
    deployerSecretKey,
    deriveSigningKey(deployerSecretKey),
    deployerSalt,
  );
  const deployerWallet = await schnorWallet1.getWallet();

  const sender: string = senderWallet.getAddress().toString();
  console.log(`Using wallet: ${sender}`);

  const Id = generateId();
  // const now = await cc.eth.timestamp();
  const now = Math.floor(new Date().getTime() / 1000);
  const timelock = now + 1100;
  const token = data.tokenAddress;
  const amount = 23n;
  let solverAddress = AztecAddress.fromString(data.solverAddress);
  const dst_chain = 'TON'.padEnd(8, ' ');
  const dst_asset = 'Toncoin'.padEnd(8, ' ');
  const dst_address = 'TONAddress'.padEnd(48, ' ');
  const randomness = generateId();
  const TokenContractArtifact = TokenContract.artifact;
  const asset = await Contract.at(
    AztecAddress.fromString(token),
    TokenContractArtifact,
    senderWallet as Wallet,
  );
  const assetMinter = await TokenContract.at(
    AztecAddress.fromString(data.tokenAddress),
    deployerWallet as Wallet,
  );

  const transfer = asset
    .withWallet(senderWallet)
    .methods.transfer_to_public(
      senderWallet.getAddress(),
      AztecAddress.fromString(data.trainContractAddress),
      amount,
      randomness,
    );

  const witness = await senderWallet.createAuthWit({
    caller: AztecAddress.fromString(data.trainContractAddress),
    action: transfer,
  });

  console.log(
    `private balance of sender ${senderWallet.getAddress()}: `,
    await asset.methods
      .balance_of_private(senderWallet.getAddress())
      .simulate(),
  );
  const contract = await Contract.at(
    AztecAddress.fromString(data.trainContractAddress),
    TrainContractArtifact,
    senderWallet,
  );
  const is_contract_initialized = await contract.methods
    .is_contract_initialized(Id)
    .simulate();
  if (is_contract_initialized) throw new Error('HTLC Exsists');
  const commitTx = await contract.methods
    .commit_private_user(
      Id,
      solverAddress,
      timelock,
      AztecAddress.fromString(token),
      amount,
      dst_chain,
      dst_asset,
      dst_address,
      randomness,
    )
    .send({ authWitnesses: [witness], fee: { paymentMethod } })
    .wait({ timeout: 120000 });

  console.log('tx : ', commitTx);
  console.log(
    `private balance of sender ${senderWallet.getAddress()}: `,
    await asset.methods
      .balance_of_private(senderWallet.getAddress())
      .simulate(),
  );

  await publicLogs(pxe1);
  updateData({ commitId: Id.toString() });
  // await simulateBlockPassing(pxe3, assetMinter, deployerWallet, 2);
  await getHTLCDetails(contract, Id);
}

main().catch((err: any) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
