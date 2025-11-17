require('dotenv').config();
import { getHttpV4Endpoint } from '@orbs-network/ton-access';
import { mnemonicToWalletKey } from 'ton-crypto';
import { TonClient4, WalletContractV5R1, Address } from '@ton/ton';
import { Train, Lock } from '../build/train/tact_Train';
import { toNano, sleep } from '../utils/utils';

export async function run() {
    const endpoint = await getHttpV4Endpoint({ network: 'testnet' });
    const client = new TonClient4({ endpoint });
    const mnemonic = process.env.MNEMONIC!;

    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    const wallet = WalletContractV5R1.create({ publicKey: key.publicKey, workchain: 0 });

    const walletContract = client.open(wallet);
    const walletSender = walletContract.sender(key.secretKey);
    const seqno = await walletContract.getSeqno();

    const contractAddress = Address.parse(process.env.CONTRACT!);
    const newContract = Train.fromAddress(contractAddress);
    const contractProvider = client.open(newContract);

    const hashlock = BigInt(process.env.hashlock!);
    const timelock = BigInt(Math.floor(Date.now() / 1000) + 1830);
    const srcReceiver = Address.parse('0QAS8JNB0G4zVkdxABCLVG-Vy3KXE3W3zz1yxpnfu4J-B40y');
    const srcAsset = 'TON';
    const dstChain = 'STARKNET_SEPOLIA';
    const dstAddress = '0x0430a74277723D1EBba7119339F0F8276ca946c1B2c73DE7636Fd9EBA31e1c1f';
    const dstAsset = 'ETH';
    const Id = BigInt(process.env.id!);
    const amount = toNano('0.15');
    const rewardAmount = toNano('0.1');
    const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 30);

    const lockMessage: Lock = {
        $$type: 'Lock',
        id: Id,
        hashlock: hashlock,
        timelock: timelock,
        srcReceiver: srcReceiver,
        srcAsset: srcAsset,
        dstChain: dstChain,
        dstAddress: dstAddress,
        dstAsset: dstAsset,
        amount: amount,
        reward: rewardAmount,
        rewardTimelock: rewardTimelock,
    };

    console.log('Sending Lock message...');
    await contractProvider.send(walletSender, { value: toNano('0.5'), bounce: true }, lockMessage);

    let currentSeqno = seqno;
    while (currentSeqno == seqno) {
        console.log('Waiting for transaction to confirm...');
        await sleep(1500);
        currentSeqno = await walletContract.getSeqno();
    }
    console.log('Transaction confirmed!');
}

run().catch(console.error);
