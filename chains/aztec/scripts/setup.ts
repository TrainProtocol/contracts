import { getSchnorrAccount } from '@aztec/accounts/schnorr';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import {
  AztecAddress,
  Contract,
  Fr,
  SponsoredFeePaymentMethod,
} from '@aztec/aztec.js';
import { getPXEs, logPXERegistrations, updateData } from './utils.ts';
import { getSponsoredFPCInstance } from './fpc.ts';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { TokenContractArtifact } from '@aztec/noir-contracts.js/Token';

async function main(): Promise<void> {
  const [pxe1, pxe2, pxe3] = await getPXEs(['pxe1', 'pxe2', 'pxe3']);

  const sponsoredFPC = await getSponsoredFPCInstance();

  await pxe1.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });

  await pxe2.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });

  await pxe3.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });

  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  //   user wallet in PXE 1
  let secretKey = Fr.random();
  let salt = Fr.random();
  let schnorrAccount = await getSchnorrAccount(
    pxe1,
    secretKey,
    deriveSigningKey(secretKey),
    salt,
  );
  let tx = await schnorrAccount.deploy({ fee: { paymentMethod } }).wait();
  let userWallet = await schnorrAccount.getWallet();
  let userAddress = userWallet.getAddress();

  //   solver wallet in PXE 2
  let secretKey2 = Fr.random();
  let salt2 = Fr.random();
  let schnorrAccount2 = await getSchnorrAccount(
    pxe2,
    secretKey2,
    deriveSigningKey(secretKey2),
    salt2,
  );

  let tx2 = await schnorrAccount2.deploy({ fee: { paymentMethod } }).wait();
  let solverWallet = await schnorrAccount2.getWallet();
  let solverAddress = solverWallet.getAddress();

  // wallet 3 for deployment
  let secretKey3 = Fr.random();
  let salt3 = Fr.random();
  let schnorrAccount3 = await getSchnorrAccount(
    pxe3,
    secretKey3,
    deriveSigningKey(secretKey3),
    salt3,
  );

  let tx3 = await schnorrAccount3.deploy({ fee: { paymentMethod } }).wait();
  let deployer = await schnorrAccount3.getWallet();
  let deployerAddress = deployer.getAddress();

  // mint token and trasnfer to user and solver
  const token = await Contract.deploy(deployer, TokenContractArtifact, [
    deployer.getAddress(),
    'TRAIN',
    'TRN',
    18,
  ])
    .send({ fee: { paymentMethod } })
    .deployed();

  await pxe1.registerContract({
    instance: token.instance,
    artifact: TokenContractArtifact,
  });

  await pxe2.registerContract({
    instance: token.instance,
    artifact: TokenContractArtifact,
  });

  await userWallet.registerSender(deployerAddress);
  await solverWallet.registerSender(deployerAddress);

  console.log(`Token deployed at ${token.address.toString()}`);

  const amount = 2000n;
  console.log(`Minting ${amount} tokens...`);
  const contract3 = await Contract.at(
    AztecAddress.fromString(token.address.toString()),
    TokenContractArtifact,
    deployer,
  );
  const mintTx = await contract3.methods
    .mint_to_public(deployer.getAddress(), amount)
    .send({ fee: { paymentMethod } })
    .wait();
  console.log(`Public mint successful in block ${mintTx.blockNumber}`);

  await contract3.methods
    .transfer_to_private(userWallet.getAddress(), amount / 2n)
    .send({ fee: { paymentMethod } })
    .wait();
  await contract3.methods
    .transfer_to_private(solverWallet.getAddress(), amount / 2n)
    .send({ fee: { paymentMethod } })
    .wait();

  const contract1 = await Contract.at(
    AztecAddress.fromString(token.address.toString()),
    TokenContractArtifact,
    userWallet,
  );
  const contract2 = await Contract.at(
    AztecAddress.fromString(token.address.toString()),
    TokenContractArtifact,
    solverWallet,
  );

  console.log(
    'User private balance: ',
    await contract1.methods
      .balance_of_private(userWallet.getAddress())
      .simulate(),
  );

  console.log(
    'Solver private balance: ',
    await contract2.methods
      .balance_of_private(solverWallet.getAddress())
      .simulate(),
  );

  updateData({
    userSecretKey: secretKey,
    userSalt: salt,
    userAddress: userAddress,
    solverSecretKey: secretKey2,
    solverSalt: salt2,
    solverAddress: solverAddress,
    deployerSecretKey: secretKey3,
    deployerSalt: salt3,
    deployerAddress: deployerAddress,
    tokenAddress: token.address.toString(),
  });

  await logPXERegistrations([pxe1, pxe2, pxe3]);
}

main().catch((err) => {
  console.error(`❌ Error: ${err}`);
  process.exit(1);
});
