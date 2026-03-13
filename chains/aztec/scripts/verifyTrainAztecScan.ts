import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecScanClient, fromContractInstance } from 'aztec-scan-sdk';
import type { DeployerMetadata } from 'aztec-scan-sdk';
import TrainArtifact from '../contracts/train/target/train-Train.json' with { type: 'json' };
import { getAztecNodeUrl, getEnv } from './utils/config.ts';
import { requireEnv } from './utils/utils.ts';

function optionalString(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim().length === 0) return undefined;
  return value.trim();
}

async function main(): Promise<void> {
  const trainAddressString = requireEnv('TRAIN_ADDRESS');
  const trainAddress = AztecAddress.fromString(trainAddressString);
  const artifactVersion = Number(process.env.TRAIN_ARTIFACT_VERSION ?? '1');

  const node = createAztecNodeClient(getAztecNodeUrl());
  const instance = await node.getContract(trainAddress);
  if (!instance) {
    throw new Error(
      `Contract instance not found on node for TRAIN_ADDRESS=${trainAddressString}`,
    );
  }

  const env = getEnv();
  const networkFromEnv = env === 'testnet' ? 'testnet' : 'devnet';
  const network = optionalString('AZTECSCAN_NETWORK') ?? networkFromEnv;
  const client = new AztecScanClient({
    network: network as 'devnet' | 'testnet' | 'mainnet',
    explorerApiUrl: optionalString('AZTECSCAN_API_URL'),
    apiKey: optionalString('AZTECSCAN_API_KEY'),
  });

  // The Train constructor takes no arguments
  const constructorArgsRaw = process.env.TRAIN_CONSTRUCTOR_ARGS;
  const constructorArgs: unknown[] = constructorArgsRaw
    ? JSON.parse(constructorArgsRaw)
    : [];

  const { address, contractClassId, verifyInstanceArgs } =
    fromContractInstance(instance, {
      constructorArgs,
      artifactObj: TrainArtifact as unknown as Record<string, unknown>,
    });

  console.log(`Train address: ${address}`);
  console.log(`Contract class id: ${contractClassId}`);
  console.log(`Deployer: ${verifyInstanceArgs.deployer}`);
  console.log(`Salt: ${verifyInstanceArgs.salt}`);

  // Step 1: Verify artifact (contract class)
  console.log('\n--- Verifying artifact ---');
  const artifactResult = await client.verifyArtifact(
    contractClassId,
    artifactVersion,
    TrainArtifact as unknown as Record<string, unknown>,
  );
  console.log(
    `Artifact verification: ${artifactResult.status} ${artifactResult.statusText}`,
  );
  if (!artifactResult.ok) {
    console.error('Artifact verification failed:', artifactResult.data);
  }

  // Step 2: Verify instance (deployment)
  console.log('\n--- Verifying instance ---');
  const deployerMetadata: DeployerMetadata | undefined = buildDeployerMetadata();
  const instanceResult = await client.verifyInstance(
    address,
    verifyInstanceArgs,
    deployerMetadata,
  );
  console.log(
    `Instance verification: ${instanceResult.status} ${instanceResult.statusText}`,
  );
  if (!instanceResult.ok) {
    console.error('Instance verification failed:', instanceResult.data);
  }

  if (artifactResult.ok && instanceResult.ok) {
    console.log('\nVerification complete.');
  } else {
    process.exitCode = 1;
  }
}

function buildDeployerMetadata(): DeployerMetadata | undefined {
  const contractIdentifier = optionalString('TRAIN_CONTRACT_IDENTIFIER');
  const details = optionalString('TRAIN_CONTRACT_DETAILS');
  const creatorName = optionalString('TRAIN_CREATOR_NAME');
  const creatorContact = optionalString('TRAIN_CREATOR_CONTACT');
  const appUrl = optionalString('TRAIN_APP_URL');
  const repoUrl = optionalString('TRAIN_REPO_URL');

  if (
    !contractIdentifier &&
    !details &&
    !creatorName &&
    !creatorContact &&
    !appUrl &&
    !repoUrl
  ) {
    return undefined;
  }

  return {
    contractIdentifier: contractIdentifier ?? '',
    details: details ?? '',
    creatorName: creatorName ?? '',
    creatorContact: creatorContact ?? '',
    appUrl: appUrl ?? '',
    repoUrl: repoUrl ?? '',
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
