import {
  AztecAddress,
  Contract,
  Fr,
  SponsoredFeePaymentMethod,
} from '@aztec/aztec.js';
import { TrainContract } from './Train.ts';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import {
  readData,
  publicLogs,
  simulateBlockPassing,
  getHTLCDetails,
  getPXEs,
} from './utils.ts';
import { getSponsoredFPCInstance } from './fpc.ts';
import { getSchnorrAccount } from '@aztec/accounts/schnorr';
import { deriveSigningKey } from '@aztec/stdlib/keys';

const TokenContractArtifact = TokenContract.artifact;

async function main(): Promise<void> {
  const [pxe1, pxe2, pxe3] = await getPXEs(['pxe1', 'pxe2', 'pxe3']);
  const sponseredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponseredFPC.address);

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
  await pxe1.registerSender(AztecAddress.fromString(data.trainContractAddress));
  const Id = Fr.fromString(data.commitId);

  const asset = await Contract.at(
    AztecAddress.fromString(data.tokenAddress),
    TokenContractArtifact,
    senderWallet,
  );
  const contract = await TrainContract.at(
    AztecAddress.fromString(data.trainContractAddress),
    senderWallet,
  );

  console.log(
    'private balance of sender: ',
    await asset.methods
      .balance_of_private(senderWallet.getAddress())
      .simulate(),
  );

  console.log(
    'contract public: ',
    await asset.methods
      .balance_of_public(AztecAddress.fromString(data.trainContractAddress))
      .simulate(),
  );

  const is_contract_initialized = await contract.methods
    .is_contract_initialized(Id)
    .simulate();

  if (!is_contract_initialized) {
    throw new Error('HTLC Does Not Exist');
  }
  const refundTx = await contract.methods
    .refund_private(Id)
    .send({ fee: { paymentMethod } })
    .wait();

  console.log('tx : ', refundTx);

  console.log(
    'private balance of sender: ',
    await asset.methods
      .balance_of_private(senderWallet.getAddress())
      .simulate(),
  );
  console.log(
    'contract public: ',
    await asset.methods
      .balance_of_public(AztecAddress.fromString(data.trainContractAddress))
      .simulate(),
  );

  const assetMinter = await TokenContract.at(
    AztecAddress.fromString(data.tokenAddress),
    deployerWallet,
  );
  await publicLogs(pxe1);
  // await simulateBlockPassing(pxe3, assetMinter, deployerWallet, 3);
  await getHTLCDetails(contract, Id);
}

main().catch((err: any) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
