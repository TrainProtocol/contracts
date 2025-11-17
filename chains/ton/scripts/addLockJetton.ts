require('dotenv').config();
import { getHttpV4Endpoint } from '@orbs-network/ton-access';
import { mnemonicToWalletKey } from 'ton-crypto';
import { TonClient4, WalletContractV5R1, Address, WalletContractV4 } from '@ton/ton';
import { AddLock, TrainJetton } from '../build/jetton_train/tact_TrainJetton';
import { toNano, sleep } from '../utils/utils';

async function run() {
    const endpoint = await getHttpV4Endpoint({ network: 'testnet' });
    const client = new TonClient4({ endpoint });

    const mnemonic = process.env.MNEMONIC!;
    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    const wallet = WalletContractV5R1.create({ publicKey: key.publicKey, workchain: 0 });

    const walletContract = client.open(wallet);
    const walletSender = walletContract.sender(key.secretKey);
    const seqno = await walletContract.getSeqno();

    const contractAddress = Address.parse(process.env.JETTONCONTRACT!);
    const newContract = TrainJetton.fromAddress(contractAddress);
    const contractProvider = client.open(newContract);
    const amount = toNano('0.0151');

    const addLockMessage: AddLock = {
        $$type: 'AddLock',
        id: BigInt(process.env.id!),
        hashlock: BigInt(process.env.hashlock!),
        timelock: BigInt(Math.floor(Date.now() / 1000) + 930),
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