import { AztecAddress, Fr, SponsoredFeePaymentMethod } from '@aztec/aztec.js';
import { TrainContract } from './Train.ts';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import {
  stringToUint8Array,
  readData,
  publicLogs,
  getHTLCDetails,
  simulateBlockPassing,
  getPXEs,
} from './utils.ts';
import { getSponsoredFPCInstance } from './fpc.ts';
import { getSchnorrAccount } from '@aztec/accounts/schnorr';

async function main(): Promise<void> {
  const [pxe1, pxe2, pxe3] = await getPXEs(['pxe1', 'pxe2', 'pxe3']);
  const sponsoredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);
  const data = readData();

  const solverSecretKey = Fr.fromString(data.solverSecretKey);
  const solverSalt = Fr.fromString(data.solverSalt);
  const schnorrSolver = await getSchnorrAccount(
    pxe2,
    solverSecretKey,
    deriveSigningKey(solverSecretKey),
    solverSalt,
  );
  const solverWallet = await schnorrSolver.getWallet();

  const deployerSecretKey = Fr.fromString(data.deployerSecretKey);
  const deployerSalt = Fr.fromString(data.deployerSalt);
  const schnorrDeployer = await getSchnorrAccount(
    pxe3,
    deployerSecretKey,
    deriveSigningKey(deployerSecretKey),
    deployerSalt,
  );
  const deployerWallet = await schnorrDeployer.getWallet();

  const Id = Fr.fromString(data.lockId);
  const secret = Array.from(stringToUint8Array(data.secret2));
  const ownershipKey = Array.from(stringToUint8Array(data.ownership_key));
  const asset = await TokenContract.at(
    AztecAddress.fromString(data.tokenAddress),
    deployerWallet,
  );
  const asset2 = await TokenContract.at(
    AztecAddress.fromString(data.tokenAddress),
    solverWallet,
  );
  const train = await TrainContract.at(
    AztecAddress.fromString(data.trainContractAddress),
    solverWallet,
  );

  console.log(
    'private balance of src_receiver:',
    await asset2.methods
      .balance_of_private(solverWallet.getAddress())
      .simulate(),
  );
  console.log(
    'contract public:',
    await asset.methods.balance_of_public(train.address).simulate(),
  );

  const redeemTx = await train.methods
    .redeem_private(Id, secret, ownershipKey)
    .send({ fee: { paymentMethod } })
    .wait();

  console.log('tx:', redeemTx);
  console.log(
    'private balance of src_receiver:',
    await asset2.methods
      .balance_of_private(solverWallet.getAddress())
      .simulate(),
  );
  console.log(
    'contract public:',
    await asset.methods
      .balance_of_public(AztecAddress.fromString(data.trainContractAddress))
      .simulate(),
  );

  await publicLogs(pxe2);
  await simulateBlockPassing(pxe3, asset, deployerWallet, 3);
  await getHTLCDetails(train, Id);
}

main().catch((err) => {
  // console.error('Full error:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});
