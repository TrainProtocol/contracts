import { Contract, Wallet, Provider, Address,WalletUnlocked } from 'fuels';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '../out/release/fuel-abi.json');
const contractAbi = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

const contractAddressString = '0x00f3dfc843089523a41a08a611ad39eef57de6ebdb58915840ed81d3fe9a5476';

async function getWalletBalances() {
  const provider = await Provider.create('https://testnet.fuel.network/v1/graphql');
  const mnemonic = '';
  const wallet: WalletUnlocked = Wallet.fromMnemonic(mnemonic);
  wallet.connect(provider);

  const contractAddress = Address.fromB256(contractAddressString);
  const contractInstance = new Contract(contractAddress, contractAbi, wallet);
  const Id = 100n;
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

getWalletBalances().catch(console.error);
