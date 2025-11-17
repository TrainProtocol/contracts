import { TransactionVersion } from "@stacks/transactions";
import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";

const mnemonic = '';


const wallet = await generateWallet({
  secretKey: mnemonic,
  password: 'optional-password',
});

const account = wallet.accounts[0];
const address = getStxAddress({
  account,
  transactionVersion: TransactionVersion.Testnet
});

console.log("address: ",address); 
console.log("stx private key: ",account.stxPrivateKey)