require('dotenv').config();
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { mnemonicToWalletKey } from "ton-crypto";
import { TonClient, WalletContractV5R1, Address } from "@ton/ton";
import { Redeem,Train} from "../build/train/tact_Train"; 
import { sleep, toNano } from "../utils/utils"

export async function run() {
  const endpoint = await getHttpEndpoint({ network: "testnet" });
  const client = new TonClient({ endpoint });
  
  const mnemonic = process.env.MNEMONIC!; 
  const key = await mnemonicToWalletKey(mnemonic.split(" "));
  const wallet = WalletContractV5R1.create({ publicKey: key.publicKey, workchain: 0 });
  if (!await client.isContractDeployed(wallet.address)) {
    return console.log("Wallet is not deployed");
  }

  const walletContract = client.open(wallet);
  const walletSender = walletContract.sender(key.secretKey);
  const seqno = await walletContract.getSeqno();

  const contractAddress = Address.parse(process.env.CONTRACT!);
  const newContract = Train.fromAddress(contractAddress);
  const contractProvider = client.open(newContract);

  const Id = BigInt(process.env.id!);
  const secret = BigInt(process.env.secret!); 

  const redeemMessage: Redeem = {
    $$type: "Redeem",
    Id: Id,
    secret: secret,
  };

  console.log("Redeeming HTLC...");
  await contractProvider.send(walletSender, { value: toNano("0.2"), bounce: true }, redeemMessage);

  let currentSeqno = seqno;
  while (currentSeqno == seqno) {
    console.log("Waiting for transaction to confirm...");
    await sleep(1500);
    currentSeqno = await walletContract.getSeqno();
  }
  console.log("Transaction confirmed!");
}

run().catch(console.error);
