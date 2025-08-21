import {
  AztecAddress,
  Contract,
  Fr,
  SponsoredFeePaymentMethod,
} from '@aztec/aztec.js';
import { TrainContract } from './Train.ts';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import {
  stringToUint8Array,
  readData,
  publicLogs,
  generateSecretAndHashlock,
  updateData,
  simulateBlockPassing,
  getHTLCDetails,
  getPXEs,
} from './utils.ts';
import { CheatCodes } from '@aztec/aztec.js/testing';
import { getSchnorrAccount } from '@aztec/accounts/schnorr';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import { getSponsoredFPCInstance } from './fpc.ts';

const TrainContractArtifact = TrainContract.artifact;
const ethRpcUrl = 'http://localhost:8545';

async function main(): Promise<void> {
  const [pxe1, pxe2, pxe3] = await getPXEs(['pxe1', 'pxe2', 'pxe3']);
  const cc = await CheatCodes.create([ethRpcUrl], pxe1);
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
  const deployer = await schnorWallet1.getWallet();
  console.log(`Using wallet: ${senderWallet.getAddress()}`);

  const [secretHigh, secretLow, hashlockHigh, hashlockLow] =
    generateSecretAndHashlock();
  const Id = BigInt(data.commitId);
  // const now = await cc.eth.timestamp();
  const now = Math.floor(new Date().getTime() / 1000);
  const timelock = now + 1100;

  const contract = await Contract.at(
    AztecAddress.fromString(data.trainContractAddress),
    TrainContractArtifact,
    senderWallet,
  );
  const is_contract_initialized = await contract.methods
    .is_contract_initialized(Id)
    .simulate();
  if (!is_contract_initialized) throw new Error('HTLC Does Not Exsist');
  const addLockTx = await contract.methods
    .add_lock_private_user(Id, hashlockHigh, hashlockLow, timelock)
    .send({ fee: { paymentMethod } })
    .wait({ timeout: 120000 });

  console.log('tx : ', addLockTx);
  await publicLogs(pxe1);

  const TokenContractArtifact = TokenContract.artifact;
  const asset = await Contract.at(
    AztecAddress.fromString(data.tokenAddress),
    TokenContractArtifact,
    senderWallet,
  );
  console.log(
    'Public balance of Train: ',
    await asset.methods.balance_of_public(data.trainContractAddress).simulate(),
  );
  const assetMinter = await TokenContract.at(
    AztecAddress.fromString(data.tokenAddress),
    deployer,
  );
  // await simulateBlockPassing(pxe3, assetMinter, deployer, 2);
  // getHTLCDetails(contract, Id);
  updateData({
    secretHigh: secretHigh,
    secretLow: secretLow,
    hashlockHigh: hashlockHigh,
    hashlockLow: hashlockLow,
  });
}

main().catch((err: any) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
