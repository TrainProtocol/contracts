import { Contract, Wallet, Provider, Address, DateTime, WalletUnlocked } from 'fuels';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config();

const filePath = path.join(__dirname, '../out/release/fuel-abi.json');
const contractAbi = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const contractAddressString = process.env.CONTRACT as string;

async function lock() {
  const providerUrl = process.env.PROVIDER?.trim();
  if (!providerUrl || !providerUrl.startsWith('http')) {
    throw new Error('Invalid PROVIDER URL. Please check your .env file.');
  }

  const provider = new Provider(providerUrl);
  const mnemonic = process.env.MNEMONIC as string;
  const wallet: WalletUnlocked = Wallet.fromMnemonic(mnemonic);
  wallet.connect(provider);

  const Id = process.env.ID2!;
  const dstChain = 'TON'.padEnd(64, ' ');
  const dstAsset = 'Toncoin'.padEnd(64, ' ');
  const dstAddress = '0QAS8JNB0G4zVkdxABCLVG-Vy3KXE3W3zz1yxpnfu4J-B40y'.padEnd(64, ' ');
  const srcAsset = 'ETH'.padEnd(64, ' ');
  const srcReceiver = { bits: '0x8d08AAa3252C67dA78f5F4Dd2396aF1a8c231527BFEeB4a96743c646dBE9C9B2' };
  const currentUnixTime = Math.floor(Date.now() / 1000) + 1900;
  const timelock = DateTime.fromUnixSeconds(currentUnixTime).toTai64();
  const hashlock = process.env.HASHLOCK!;
  const reward = 1n;
  const rewardTimelock = DateTime.fromUnixSeconds(currentUnixTime - 300).toTai64();

  const contractAddress = Address.fromB256(contractAddressString);
  const contractInstance = new Contract(contractAddress, contractAbi, wallet);

  try {
    const { transactionId, waitForResult } = await contractInstance.functions
      .lock(Id, hashlock,reward,rewardTimelock, timelock, srcReceiver, srcAsset, dstChain, dstAsset, dstAddress)
      .callParams({
        forward: [3, await provider.getBaseAssetId()],
      })
      .call();

    const { logs, value } = await waitForResult();

    console.log('tx id: ', transactionId);
    console.log('lock function logs:', logs);
    console.log('lock function result:', value);
  } catch (error) {
    console.error('Error calling lock function:', error);
  }
}

lock().catch(console.error);
