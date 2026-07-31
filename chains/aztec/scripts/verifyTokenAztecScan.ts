import dotenv from 'dotenv';
dotenv.config();

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import TokenArtifact from '@aztec-foundation/aztec-standards/target/token_contract-Token.json' with { type: 'json' };
import {
  AztecScanClient,
  fromContractInstance,
  type DeployerMetadata,
} from 'aztec-scan-sdk';
import { getAztecNodeUrl, getEnv } from './utils/config.ts';
import { requireEnv } from './utils/utils.ts';

function optionalString(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim().length === 0) return undefined;
  return value.trim();
}

async function main(): Promise<void> {
  const tokenAddressString = requireEnv('TOKEN_ADDRESS');
  const tokenAddress = AztecAddress.fromStringUnsafe(tokenAddressString);
  const artifactVersion = Number(process.env.TOKEN_ARTIFACT_VERSION ?? '1');

  const node = createAztecNodeClient(getAztecNodeUrl());
  const instance = await node.getContract(tokenAddress);
  if (!instance) {
    throw new Error(
      `Contract instance not found on node for TOKEN_ADDRESS=${tokenAddressString}`,
    );
  }

  const env = getEnv();
  const networkFromEnv = env === 'testnet' ? 'testnet' : 'devnet';
  const network = optionalString('AZTECSCAN_NETWORK') ?? networkFromEnv;
  const client = new AztecScanClient({
    network: network as 'devnet' | 'testnet' | 'mainnet',
    explorerApiUrl: optionalString('AZTECSCAN_API_URL'),
    apiKey: optionalString('AZTECSCAN_API_KEY'),
    timeout: 120_000,
  });

  // Token was deployed with constructor_with_minter(name, symbol, decimals, minter, auth_contract)
  // Read constructor args from env or use defaults
  const constructorArgsRaw = process.env.TOKEN_CONSTRUCTOR_ARGS;
  const isRewardToken = tokenAddressString === optionalString('E2E_TOKEN2_ADDRESS');
  const constructorArgs: unknown[] = constructorArgsRaw
    ? JSON.parse(constructorArgsRaw)
    : [
        optionalString('TOKEN_NAME') ?? (isRewardToken ? 'RWD' : 'ETH'),
        optionalString('TOKEN_SYMBOL') ?? (isRewardToken ? 'RWD' : 'ETH'),
        Number(optionalString('TOKEN_DECIMALS') ?? '18'),
        optionalString('TOKEN_MINTER') ?? instance.deployer.toString(),
        optionalString('TOKEN_AUTH_CONTRACT') ?? AztecAddress.ZERO.toString(),
      ];

  const { address, contractClassId, verifyInstanceArgs } =
    fromContractInstance(instance, {
      constructorArgs,
      artifactObj: TokenArtifact as unknown as Record<string, unknown>,
    });

  console.log(`Token address: ${address}`);
  console.log(`Contract class id: ${contractClassId}`);
  console.log(`Deployer: ${verifyInstanceArgs.deployer}`);
  console.log(`Salt: ${verifyInstanceArgs.salt}`);

  // Step 1: Verify artifact (contract class)
  console.log('\n--- Verifying artifact ---');
  const artifactResult = await client.verifyArtifact(
    contractClassId,
    artifactVersion,
    TokenArtifact as unknown as Record<string, unknown>,
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
  // aztec-scan-sdk 0.2.0 predates v5 and rejects the v5 PublicKeys serialization with a
  // client-side length check; the explorer API itself accepts it. POST directly instead.
  const instanceUrl = `${(client as any).config?.explorerApiUrl ?? optionalString('AZTECSCAN_API_URL') ?? 'https://api.testnet.aztecscan.xyz'}/v1/${(client as any).config?.apiKey ?? 'temporary-api-key'}/l2/contract-instances/${address}`;
  const instanceBody: Record<string, unknown> = {
    verifiedDeploymentArguments: {
      salt: verifyInstanceArgs.salt,
      deployer: verifyInstanceArgs.deployer,
      publicKeysString: verifyInstanceArgs.publicKeysString,
      constructorArgs: verifyInstanceArgs.constructorArgs,
    },
  };
  if (deployerMetadata) instanceBody.deployerMetadata = deployerMetadata;
  const instanceResponse = artifactResult.ok
    ? await fetch(instanceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instanceBody),
      })
    : undefined;
  const instanceResult = instanceResponse
    ? { ok: instanceResponse.ok, status: instanceResponse.status, statusText: instanceResponse.statusText, data: await instanceResponse.text() }
    : { ok: false, status: 0, statusText: 'Skipped', data: 'Artifact verification failed' };
  console.log(
    `Instance verification: ${instanceResult.status} ${instanceResult.statusText}`,
  );
  if (!instanceResult.ok) {
    console.error('Instance verification failed:', instanceResult.data);
  }

  if (artifactResult.ok && instanceResult.ok) {
    console.log('\nVerification complete.');
  } else {
    throw new Error('Token artifact or instance verification failed');
  }
}

function buildDeployerMetadata(): DeployerMetadata | undefined {
  const contractIdentifier = optionalString('TOKEN_CONTRACT_IDENTIFIER');
  const details = optionalString('TOKEN_CONTRACT_DETAILS');
  const creatorName = optionalString('TOKEN_CREATOR_NAME');
  const creatorContact = optionalString('TOKEN_CREATOR_CONTACT');
  const appUrl = optionalString('TOKEN_APP_URL');
  const repoUrl = optionalString('TOKEN_REPO_URL');

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

main().catch((err) => {
    console.error(`Error: ${err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
