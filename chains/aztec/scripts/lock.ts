import {
  AztecAddress,
  Contract,
  Fr,
  SponsoredFeePaymentMethod,
} from '@aztec/aztec.js';
import { TrainContract } from './Train.ts';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import {
  updateData,
  readData,
  generateSecretAndHashlock,
  generateId,
  publicLogs,
  getHTLCDetails,
  simulateBlockPassing,
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
  const sponseredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponseredFPC.address);
  const cc = await CheatCodes.create([ethRpcUrl], pxe2);

  const data = readData();
  let solverSecretKey = Fr.fromString(data.solverSecretKey);
  let solverSalt = Fr.fromString(data.solverSalt);
  const schnorWallet = await getSchnorrAccount(
    pxe2,
    solverSecretKey,
    deriveSigningKey(solverSecretKey),
    solverSalt,
  );
  const solverWallet = await schnorWallet.getWallet();

  const deployerSecretKey = Fr.fromString(data.deployerSecretKey);
  const deployerSalt = Fr.fromString(data.deployerSalt);
  const schnorWallet1 = await getSchnorrAccount(
    pxe3,
    deployerSecretKey,
    deriveSigningKey(deployerSecretKey),
    deployerSalt,
  );
  const deployerWallet = await schnorWallet1.getWallet();

  const solver: AztecAddress = solverWallet.getAddress();
  console.log(`Using wallet: ${solver.toString()}`);

  const Id = generateId();
  const pair = generateSecretAndHashlock();
  const hashlock = pair[1];
  const amount = 7n;
  const pair2 = generateSecretAndHashlock();
  const ownership_hash = pair2[1];
  // const now = await cc.eth.timestamp();
  const now = Math.floor(new Date().getTime() / 1000);
  const timelock = now + 2000;
  const token: string = data.tokenAddress;
  const randomness = generateId();
  const dst_chain = 'USDC.e'.padStart(30, ' ');
  const dst_asset = 'PROOFOFPLAYAPEX_MAINNET'.padStart(30, ' ');
  const dst_address =
    '0x01ba575951852339bfe8123463503081ea0da04448b2efc58798705c27cdb3fb'.padStart(
      90,
      ' ',
    );

  // Token contract operations using auth witness
  const TokenContractArtifact = TokenContract.artifact;
  const asset = await Contract.at(
    AztecAddress.fromString(token),
    TokenContractArtifact,
    solverWallet,
  );

  const transfer = asset
    .withWallet(solverWallet)
    .methods.transfer_to_public(
      solverWallet.getAddress(),
      AztecAddress.fromString(data.trainContractAddress),
      amount,
      randomness,
    );

  const witness = await solverWallet.createAuthWit({
    caller: AztecAddress.fromString(data.trainContractAddress),
    action: transfer,
  });

  const privateBalanceBefore = await asset.methods
    .balance_of_private(solverWallet.getAddress())
    .simulate();
  console.log('private balance of solver: ', privateBalanceBefore);
  console.log(
    'public balance of Train: ',
    await asset.methods
      .balance_of_public(AztecAddress.fromString(data.trainContractAddress))
      .simulate(),
  );

  const contract = await Contract.at(
    AztecAddress.fromString(data.trainContractAddress),
    TrainContractArtifact,
    solverWallet,
  );
  const is_contract_initialized = await contract.methods
    .is_contract_initialized(Id)
    .simulate();
  if (is_contract_initialized) throw new Error('HTLC Exsists');
  const lockTx = await contract.methods
    .lock_private_solver(
      Id,
      hashlock,
      amount,
      ownership_hash,
      timelock,
      token,
      randomness,
      dst_chain,
      dst_asset,
      dst_address,
    )
    .send({ authWitnesses: [witness], fee: { paymentMethod } })
    .wait({ timeout: 120000 });
  console.log('tx : ', lockTx);

  const privateBalanceAfter = await asset.methods
    .balance_of_private(solverWallet.getAddress())
    .simulate();
  console.log('private balance of solver: ', privateBalanceAfter);
  console.log(
    'public balance of Train: ',
    await asset.methods.balance_of_public(data.trainContractAddress).simulate(),
  );
  publicLogs(pxe2);

  updateData({
    lockId: Id.toString(),
    hashlock2: pair[1].toString(),
    secret2: pair[0].toString(),
    ownership_hash: pair2[1].toString(),
    ownership_key: pair2[0].toString(),
  });
  const assetMinter = await TokenContract.at(
    AztecAddress.fromString(data.tokenAddress),
    deployerWallet,
  );
  // await simulateBlockPassing(pxe3, assetMinter, deployerWallet, 2);
  // await getHTLCDetails(contract, Id);
}

main().catch((err: any) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
