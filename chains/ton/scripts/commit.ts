require('dotenv').config();
import { getHttpV4Endpoint } from '@orbs-network/ton-access';
import { mnemonicToWalletKey } from 'ton-crypto';
import { TonClient4, WalletContractV5R1, Address } from '@ton/ton';
import { Commit, Train } from '../build/train/tact_Train';
import { toNano, sleep, createStrMap } from '../utils/utils';

const hopChains = createStrMap([[0n, { $$type: 'StringImpl', data: 'STARKNET_SEPOLIA' }]]);

const hopAssets = createStrMap([[0n, { $$type: 'StringImpl', data: 'ETH' }]]);

const hopAddresses = createStrMap([
    [0n, { $$type: 'StringImpl', data: '0x0430a74277723D1EBba7119339F0F8276ca946c1B2c73DE7636Fd9EBA31e1c1f' }],
]);

const dstChain: string = 'STARKNET_SEPOLIA';
const dstAsset: string = 'ETH';
const dstAddress: string = '0x0430a74277723D1EBba7119339F0F8276ca946c1B2c73DE7636Fd9EBA31e1c1f';
const srcAsset: string = 'TON';
const srcReceiver: Address = Address.parse(process.env.srcReceiver!);
const timelock = BigInt(Math.floor(Date.now() / 1000) + 3600);
const amount = toNano('0.1');
const senderPubKey = BigInt(process.env.senderPubKey!);

async function run() {
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

    const commitMessage: Commit = {
        $$type: 'Commit',
        hopChains: hopChains,
        hopAssets: hopAssets,
        hopAddresses: hopAddresses,
        dstChain: dstChain,
        dstAsset: dstAsset,
        dstAddress: dstAddress,
        srcAsset: srcAsset,
        srcReceiver: srcReceiver,
        timelock: timelock,
        senderPubKey: senderPubKey,
        amount: amount,
        Id: 133n,
    };

    console.log('Sending Commit message...');
    await contractProvider.send(walletSender, { value: toNano('1.5'), bounce: true }, commitMessage);

    let currentSeqno = seqno;
    while (currentSeqno == seqno) {
        console.log('Waiting for transaction to confirm...');
        await sleep(1500);
        currentSeqno = await walletContract.getSeqno();
    }
    console.log('Transaction confirmed!');
}

run().catch(console.error);
