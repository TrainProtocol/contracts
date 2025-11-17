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
import { AztecAddress } from '@aztec/aztec.js/addresses';
import crypto from 'crypto';
import { LogFilter } from '@aztec/aztec.js/log';
import { TrainContract } from './Train.ts';
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

function uint8ArrayToBigInt(uint8Array: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < uint8Array.length; i++) {
    result = (result << 8n) | BigInt(uint8Array[i]);
  }
  return result;
}

/**
 * Generates a secret and its SHA-256 hash lock, split into high and low halves.
 * @returns A tuple with [secretHigh, secretLow, hashlockHigh, hashlockLow] as u128 bigint numbers.
 */
export function generateSecretAndHashlock(): [bigint, bigint, bigint, bigint] {
  const secret = crypto.randomBytes(32);
  const hashlock = crypto.createHash('sha256').update(secret).digest();

  const secretUint8 = new Uint8Array(secret);
  const hashlockUint8 = new Uint8Array(hashlock);

  const secretHigh = uint8ArrayToBigInt(secretUint8.slice(0, 16));
  const secretLow = uint8ArrayToBigInt(secretUint8.slice(16, 32));

  const hashlockHigh = uint8ArrayToBigInt(hashlockUint8.slice(0, 16));
  const hashlockLow = uint8ArrayToBigInt(hashlockUint8.slice(16, 32));

  return [secretHigh, secretLow, hashlockHigh, hashlockLow];
}

/**
 * Generates a unique identifier using random bytes.
 * @returns A bigint identifier.
 */
export function generateId(): bigint {
  const bytes = crypto.randomBytes(31);
  return BigInt('0x' + bytes.toString('hex'));
}

/**
 * Retrieves and logs public logs using the provided blockchain interface.
 * @param pxe - An object with blockchain methods.
 * @returns A promise that resolves with an array of logs.
 */
export async function publicLogs(node: AztecNode, filter: LogFilter) {
  return await node.getPublicLogs(filter);
}

/**
 * Converts a comma-separated string of numbers to a Uint8Array.
 * @param str - The input string.
 * @returns A Uint8Array representing the numbers.
 */
export function stringToUint8Array(str: string): Uint8Array {
  return new Uint8Array(str.split(',').map((num) => Number(num.trim())));
}

/**
 * Fetches and logs HTLC details for a given Id.
 * @param contract - A contract instance with HTLC methods.
 * @param Id - The identifier for the HTLC.
 */
export async function getHTLCDetails(
  caller: AztecAddress,
  contract: TrainContract,
  id: Fr,
): Promise<void> {
  try {
    const details = await contract.methods
      .get_htlc_public(id)
      .simulate({ from: caller });
    console.log(`HTLC Details for Id ${id.toString()}:`, details);
  } catch (error) {
    console.error(
      `Failed to fetch HTLC details for Id ${id.toString()}:`,
      error,
    );
  }
}
