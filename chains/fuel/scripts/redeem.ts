import { Contract, Wallet, Provider, Address } from 'fuels';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config();

const filePath = path.join(__dirname, '../out/release/fuel-abi.json');
const contractAbi = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const contractAddressString = process.env.CONTRACT as string;

async function redeem() {
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
  const Id = BigInt(process.env.ID2!);
  const secret = BigInt(process.env.SECRET!);       

  try {
    const { transactionId, waitForResult } = await contractInstance.functions
      .redeem(Id,secret)
      .call();

    const { logs,value } = await waitForResult();

    console.log('tx id: ', transactionId);
    console.log('redeem function logs: ',logs);
    console.log('redeem function result:', value);
  } catch (error) {
    console.error('Error calling redeem function:', error);
  }
}

redeem().catch(console.error);
