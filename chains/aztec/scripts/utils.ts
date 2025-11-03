import 'dotenv/config';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import type { TestWallet } from '@aztec/test-wallet/server';
import { createStore } from '@aztec/kv-store/lmdb';
import { AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { createPXE, getPXEConfig, PXE } from '@aztec/pxe/server';
import { getSchnorrAccountContractAddress } from '@aztec/accounts/schnorr';
import { InitialAccountData } from '@aztec/accounts/testing';
import { Fr } from '@aztec/aztec.js/fields';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import { existsSync, readFileSync, writeFileSync } from 'fs';
const dataFile = 'data.json';
const BIGINT_MARK = '__bigint__';

export async function getPXEs(names: string[]): Promise<PXE[]> {
  const url = process.env.PXE_URL ?? 'http://localhost:8080';
  const node: AztecNode = createAztecNodeClient(url);

  const l1Contracts = await node.getL1ContractAddresses();
  const fullConfig = { ...getPXEConfig(), l1Contracts, proverEnabled: true };

  const svcs: PXE[] = [];
  for (const name of names) {
    const store = await createStore(name, {
      dataDirectory: 'store',
      dataStoreMapSizeKb: 1e6,
    });
    const pxe = await createPXE(node, fullConfig, { store });
    svcs.push(pxe);
  }
  return svcs;
}

export async function generateSchnorrAccounts(
  numberOfAccounts: number,
): Promise<Promise<InitialAccountData[]>> {
  const secrets = Array.from({ length: numberOfAccounts }, () => Fr.random());
  return await Promise.all(
    secrets.map(async (secret) => {
      const salt = Fr.random();
      return {
        secret,
        signingKey: deriveSigningKey(secret),
        salt,
        address: await getSchnorrAccountContractAddress(secret, salt),
      };
    }),
  );
}

export async function getSponsoredPaymentMethod(wallet: TestWallet) {
  const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) },
  );

  await wallet.registerContract(
    sponsoredFPCInstance,
    SponsoredFPCContract.artifact,
  );

  return new SponsoredFeePaymentMethod(sponsoredFPCInstance.address);
}

const stringifyWithBigint = (v: unknown) =>
  JSON.stringify(
    v,
    (_k, val) =>
      typeof val === 'bigint'
        ? { [BIGINT_MARK]: '0x' + val.toString(16) }
        : val,
    2,
  );

const parseWithBigint = (s: string) =>
  JSON.parse(s, (_k, val) =>
    val && typeof val === 'object' && BIGINT_MARK in val
      ? BigInt(val[BIGINT_MARK])
      : val,
  );

export function updateData(newData: Record<string, any>): void {
  let data: Record<string, any> = {};
  if (existsSync(dataFile)) {
    try {
      data = parseWithBigint(readFileSync(dataFile, 'utf8'));
    } catch {}
  }
  Object.assign(data, newData);
  writeFileSync(dataFile, stringifyWithBigint(data));
}

export function readData(): Record<string, any> {
  if (!existsSync(dataFile)) {
    console.error(`File ${dataFile} does not exist.`);
    return {};
  }
  try {
    return parseWithBigint(readFileSync(dataFile, 'utf8'));
  } catch (error) {
    console.error('Error reading data file:', error);
    return {};
  }
}

// const DEFAULT_HOST = 'localhost';

// function uint8ArrayToBigInt(uint8Array: Uint8Array): bigint {
//   let result = 0n;
//   for (let i = 0; i < uint8Array.length; i++) {
//     result = (result << 8n) | BigInt(uint8Array[i]);
//   }
//   return result;
// }

// /**
//  * Generates a secret and its SHA-256 hash lock, split into high and low halves.
//  * @returns A tuple with [secretHigh, secretLow, hashlockHigh, hashlockLow] as u128 bigint numbers.
//  */
// export function generateSecretAndHashlock(): [bigint, bigint, bigint, bigint] {
//   const secret = crypto.randomBytes(32);
//   const hashlock = crypto.createHash('sha256').update(secret).digest();

//   const secretUint8 = new Uint8Array(secret);
//   const hashlockUint8 = new Uint8Array(hashlock);

//   const secretHigh = uint8ArrayToBigInt(secretUint8.slice(0, 16));
//   const secretLow = uint8ArrayToBigInt(secretUint8.slice(16, 32));

//   const hashlockHigh = uint8ArrayToBigInt(hashlockUint8.slice(0, 16));
//   const hashlockLow = uint8ArrayToBigInt(hashlockUint8.slice(16, 32));

//   return [secretHigh, secretLow, hashlockHigh, hashlockLow];
// }

// /**
//  * Generates a unique identifier using random bytes.
//  * @returns A bigint identifier.
//  */
// export function generateId(): bigint {
//   const bytes = crypto.randomBytes(31);
//   return BigInt('0x' + bytes.toString('hex'));
// }

// /**
//  * Retrieves and logs public logs using the provided blockchain interface.
//  * @param pxe - An object with blockchain methods.
//  * @returns A promise that resolves with an array of logs.
//  */
// export async function publicLogs(pxe: any): Promise<any[]> {
//   const fromBlock = await pxe.getBlockNumber();
//   const logFilter = { fromBlock, toBlock: fromBlock + 1 };
//   const { logs } = await pxe.getPublicLogs(logFilter);
//   console.log('Public logs: ', logs);
//   return logs;
// }

// /**
//  * Converts a comma-separated string of numbers to a Uint8Array.
//  * @param str - The input string.
//  * @returns A Uint8Array representing the numbers.
//  */
// export function stringToUint8Array(str: string): Uint8Array {
//   return new Uint8Array(str.split(',').map((num) => Number(num.trim())));
// }

// /**
//  * Simulates block passing by minting tokens in each block.
//  * @param pxe - An object that provides blockchain methods.
//  * @param contract - A contract instance with the minting method.
//  * @param wallet - A wallet instance used for transactions.
//  * @param numBlocks - Number of blocks to simulate (default is 1).
//  */
// export async function simulateBlockPassing(
//   pxe: any,
//   contract: any,
//   wallet: any,
//   numBlocks: number = 1,
// ): Promise<void> {
//   const sponseredFPC = await getSponsoredFPCInstance();
//   const paymentMethod = new SponsoredFeePaymentMethod(sponseredFPC.address);
//   for (let i = 0; i < numBlocks; i++) {
//     await contract.methods
//       .mint_to_public(wallet.getAddress(), 1000n)
//       .send({ fee: { paymentMethod } })
//       .wait();
//     console.log(`Simulated block ${await pxe.getBlockNumber()} passed.`);
//   }
// }

// /**
//  * Fetches and logs HTLC details for a given Id.
//  * @param contract - A contract instance with HTLC methods.
//  * @param Id - The identifier for the HTLC.
//  */
// export async function getHTLCDetails(
//   addr: AztecAddress,
//   contract: any,
//   Id: any,
// ): Promise<void> {
//   console.log(
//     `HTLC Details for Id ${Id}: `,
//     await contract.methods.get_htlc_public(Id).simulate({ from: addr }),
//   );
// }

// export async function connectPXE(
//   port: number,
//   options: {
//     host?: string;
//     protocol?: 'http' | 'https';
//   } = {},
// ): Promise<PXE> {
//   const host = process.env.PXE_HOST ?? options.host ?? DEFAULT_HOST;
//   const protocol =
//     options.protocol ?? (process.env.PXE_HTTPS === 'true' ? 'https' : 'http');
//   const clientLib = protocol === 'https' ? https : http;

//   await new Promise<void>((resolve, reject) => {
//     const req = clientLib.request(
//       {
//         hostname: host,
//         port,
//         method: 'HEAD',
//         path: '/',
//         timeout: 2000,
//         ...(protocol === 'https' ? { rejectUnauthorized: false } : {}),
//       },
//       (res) => {
//         res.destroy();
//         resolve();
//       },
//     );
//     req.once('error', reject);
//     req.once('timeout', () => {
//       req.destroy();
//       reject(new Error('Timeout during port check'));
//     });
//     req.end();
//   });
//   const url = `${protocol}://${host}:${port}`;
//   console.log(`Connecting to PXE on: ${url}`);
//   const client = createPXEClient(url);
//   await waitForPXE(client);
//   console.log(`Connected to PXE: ${url}`);
//   return client;
// }

// /**
//  * Returns a connected AztecNode client.
//  * Uses PXE_URL from env or falls back to default.
//  */
// export async function getAztecNode(o?: string | number): Promise<AztecNode> {
//   const DEFAULT_PXE_URL = 'http://localhost:8080';
//   const s = String(o ?? ''),
//     base = process.env.PXE_URL ?? DEFAULT_PXE_URL;
//   const url =
//     o == null
//       ? base
//       : /^\d+$/.test(s)
//         ? `http://localhost:${s}`
//         : /^https?:\/\//.test(s)
//           ? s
//           : `http://${s}`;
//   return createAztecNodeClient(url);
// }

// export async function logPXERegistrations(pxes: PXE[]): Promise<void> {
//   for (let i = 0; i < pxes.length; i++) {
//     const pxe = pxes[i];
//     console.log(
//       `PXE ${i + 1} registered accounts:`,
//       await pxe.getRegisteredAccounts(),
//     );
//     console.log(`PXE ${i + 1} registered contracts:`, await pxe.getContracts());
//   }
// }
