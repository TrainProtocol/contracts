import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  uintCV,
  PostConditionMode,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';

async function main() {
  const network = new StacksTestnet();
  const secretKey = ""
  
  const id = BigInt("6464");
  
  const txOptions = {
    contractAddress: 'ST136VTJP5KQ24EDMKWP0PJ44VVHMGX4KNKAW3XW5',
    contractName: 'Train',
    functionName: 'refund',
    functionArgs: [
      uintCV(id)
    ],
    senderKey: secretKey,
    validateWithAbi: true,
    network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  };

  try {
    const transaction = await makeContractCall(txOptions);
    const broadcastResponse = await broadcastTransaction(transaction, network);
    const txId = broadcastResponse.txid;
    console.log(`https://explorer.hiro.so/txid/0x${txId}?chain=testnet`);
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);