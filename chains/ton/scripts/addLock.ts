require('dotenv').config();
import { getHttpEndpoint } from '@orbs-network/ton-access';
import { mnemonicToWalletKey } from 'ton-crypto';
import { TonClient, WalletContractV5R1, Address } from '@ton/ton';
import { AddLock, Train } from '../build/train/tact_Train';
import { toNano, sleep } from '../utils/utils';

async function run() {
    const endpoint = await getHttpEndpoint({ network: 'testnet' });
    const client = new TonClient({ endpoint });

    const mnemonic = process.env.MNEMONIC!;
    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    const wallet = WalletContractV5R1.create({ publicKey: key.publicKey, workchain: 0 });
    if (!(await client.isContractDeployed(wallet.address))) {
        return console.log('Wallet is not deployed');
    }

    const walletContract = client.open(wallet);
    const walletSender = walletContract.sender(key.secretKey);
    const seqno = await walletContract.getSeqno();

    const contractAddress = Address.parse(process.env.CONTRACT!);
    const newContract = Train.fromAddress(contractAddress);
    const contractProvider = client.open(newContract);
    const amount = toNano('0.1');

    const addLockMessage: AddLock = {
        $$type: 'AddLock',
        Id: BigInt(process.env.id!),
        hashlock: BigInt(process.env.hashlock!),
        timelock: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };

    console.log('Sending AddLock message...');
    await contractProvider.send(walletSender, { value: amount, bounce: true }, addLockMessage);

    let currentSeqno = seqno;
    while (currentSeqno == seqno) {
        console.log('Waiting for transaction to confirm...');
        await sleep(2000);
        currentSeqno = await walletContract.getSeqno();
    }
    console.log('Transaction confirmed!');
}

run().catch(console.error);
