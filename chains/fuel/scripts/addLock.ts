import { Contract, Wallet, Provider, Address, DateTime } from 'fuels';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config();

const filePath = path.join(__dirname, '../out/release/fuel-abi.json');
const contractAbi = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const contractAddressString = process.env.CONTRACT as string;

async function addLock() {
  const providerUrl = process.env.PROVIDER?.trim();
  if (!providerUrl || !providerUrl.startsWith('http')) {
    throw new Error('Invalid PROVIDER URL. Please check your .env file.');
  }

  const provider = new Provider(providerUrl);
  const mnemonic = process.env.MNEMONIC as string;
  const wallet = Wallet.fromMnemonic(mnemonic);
  wallet.connect(provider);

  const contractAddress = Address.fromB256(contractAddressString);
  const contractInstance = new Contract(contractAddress, contractAbi, wallet);
  const Id = BigInt(process.env.ID1!);
  const hashlock = process.env.HASHLOCK!;
  const currentUnixTime = Math.floor(Date.now() / 1000) + 910;
  const timelock = DateTime.fromUnixSeconds(currentUnixTime).toTai64();

  try {
    const { transactionId, waitForResult } = await contractInstance.functions.add_lock(Id, hashlock, timelock).call();

    const { logs, value } = await waitForResult();

    console.log('tx id: ', transactionId);
    console.log('add_lock function logs: ', logs);
    console.log('add_lock function result:', value);
  } catch (error) {
    console.error('Error calling add_lock function:', error);
  }
}

addLock().catch(console.error);
