import { Contract, Wallet, Provider, Address,WalletUnlocked } from 'fuels';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config();

const filePath = path.join(__dirname, '../out/release/fuel-abi.json');
const contractAbi = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const contractAddressString = process.env.CONTRACT as string;

async function refund() {
  const providerUrl = process.env.PROVIDER?.trim();
  if (!providerUrl || !providerUrl.startsWith('http')) {
    throw new Error('Invalid PROVIDER URL. Please check your .env file.');
  }

  const provider = new Provider(providerUrl);
  const mnemonic = process.env.MNEMONIC as string;
  const wallet: WalletUnlocked = Wallet.fromMnemonic(mnemonic);
  wallet.connect(provider);

  const contractAddress = Address.fromB256(contractAddressString);
  const contractInstance = new Contract(contractAddress, contractAbi, wallet);
  const Id = process.env.ID2!;

  try {
    const { transactionId, waitForResult } = await contractInstance.functions
      .refund(Id)
      .call();

    const { logs,value } = await waitForResult();

    console.log('tx id: ', transactionId);
    console.log('refund function logs: ',logs);
    console.log('refund function result:', value);
  } catch (error) {
    console.error('Error calling refund function:', error);
  }
}

refund().catch(console.error);
