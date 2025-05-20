import { getSchnorrAccount } from '@aztec/accounts/schnorr';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import {
  Fr,
  ContractInstanceWithAddress,
  ContractArtifact,
  SponsoredFeePaymentMethod,
} from '@aztec/aztec.js';
import { TrainContract } from './Train.ts';
import { getPXEs, logPXERegistrations, readData, updateData } from './utils.ts';
import { getSponsoredFPCInstance } from './fpc.ts';

async function main(): Promise<void> {
  const [pxe1, pxe2, pxe3] = await getPXEs(['pxe1', 'pxe2', 'pxe3']);

  const sponseredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponseredFPC.address);

  const data = readData();
  let secretKey = Fr.fromString(data.deployerSecretKey);
  let salt = Fr.fromString(data.deployerSalt);
  let schnorrAccount = await getSchnorrAccount(
    pxe3,
    secretKey,
    deriveSigningKey(secretKey),
    salt,
  );
  let deployerWallet = await schnorrAccount.getWallet();

  // Train protocol deployment on PXE3
  const trainContract = await TrainContract.deploy(deployerWallet)
    .send({ fee: { paymentMethod } })
    .deployed();
  const trainPartialAddress = await trainContract.partialAddress;

  //register contract in all PXEs
  await pxe1.registerContract({
    instance: trainContract.instance as ContractInstanceWithAddress,
    artifact: TrainContract.artifact as ContractArtifact,
  });

  await pxe2.registerContract({
    instance: trainContract.instance as ContractInstanceWithAddress,
    artifact: TrainContract.artifact as ContractArtifact,
  });

  await pxe3.registerContract({
    instance: trainContract.instance as ContractInstanceWithAddress,
    artifact: TrainContract.artifact as ContractArtifact,
  });

  updateData({
    trainPartialAddress: trainPartialAddress,
    trainContractAddress: trainContract.address,
    trainInitHash: trainContract.instance.initializationHash,
  });

  await logPXERegistrations([pxe1, pxe2, pxe3]);
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
