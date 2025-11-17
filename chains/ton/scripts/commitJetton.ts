require('dotenv').config();
import { getHttpV4Endpoint } from '@orbs-network/ton-access';
import { mnemonicToWalletKey } from 'ton-crypto';
import { TonClient4, Address, Cell, beginCell, WalletContractV4, Builder, WalletContractV5R1 } from '@ton/ton';
import { toNano, sleep, createStrMap } from '../utils/utils';
import { CommitData, TokenTransfer, storeCommitData, storeTokenTransfer } from '../build/jetton_train/tact_TrainJetton';

export async function run() {
    const endpoint = await getHttpV4Endpoint({ network: 'testnet' });
    const client = new TonClient4({ endpoint, timeout: 10000 });

    const mnemonic = process.env.MNEMONIC!;
    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    const wallet = WalletContractV5R1.create({ publicKey: key.publicKey, workchain: 0 });

    const walletContract = client.open(wallet);
    const walletSender = walletContract.sender(key.secretKey);
    const seqno = await walletContract.getSeqno();
    const userJettonWallet = Address.parse(process.env.userJettonWallet!);

    const Id = BigInt(process.env.id!);
    const dstChain: string = 'ARBITRUM_SEPOLIA';
    const dstAsset: string = 'USDC';
    const dstAddress: string = '0xF6517026847B4c166AAA176fe0C5baD1A245778D';
    const srcAsset: string = 'TESTJ';
    const srcReceiver: Address = Address.parse(process.env.srcReceiver!);
    const timelock = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const senderPubKey = BigInt(process.env.senderPubKey!);
    const jettonMasterAddress = Address.parse(process.env.jettonMasterAddress!);
    const hopChains = createStrMap([[0n, { $$type: 'StringImpl', data: 'ARBITRUM_SEPOLIA' }]]);
    const hopAssets = createStrMap([[0n, { $$type: 'StringImpl', data: 'USDC' }]]);
    const hopAddresses = createStrMap([
        [0n, { $$type: 'StringImpl', data: '0xF6517026847B4c166AAA176fe0C5baD1A245778D' }],
    ]);

    const commitData: CommitData = {
        dstChain: dstChain,
        dstAsset: dstAsset,
        dstAddress: dstAddress,
        srcAsset: srcAsset,
        id: Id,
        srcReceiver: srcReceiver,
        timelock: timelock,
        jettonMasterAddress: jettonMasterAddress,
        senderPubKey: senderPubKey,
        hopChains: hopChains,
        hopAssets: hopAssets,
        hopAddresses: hopAddresses,
        $$type: 'CommitData',
    };

    const writeCommitData = storeCommitData(commitData);
    const forwardPayload = new Builder();
    writeCommitData(forwardPayload);
    const finalForwardPayload = beginCell()
        .storeUint(1, 1)
        .storeRef(beginCell().storeUint(1734998782, 32).storeBuilder(forwardPayload).endCell())
        .endCell()
        .asSlice();
    const queryId = BigInt(Date.now());
    const amount = 1n;
    const destination = Address.parse(process.env.destination!);
    const responseDestination = wallet.address;
    const customPayload: Cell | null = beginCell().storeInt(0, 32).storeStringTail('Success').endCell();
    const forwardTonAmount = toNano('0.1');
    const tokenTransferMessage: TokenTransfer = {
        $$type: 'TokenTransfer',
        queryId: queryId,
        amount: amount,
        destination: destination,
        responseDestination: responseDestination,
        customPayload: customPayload,
        forwardTonAmount: forwardTonAmount,
        forwardPayload: finalForwardPayload,
    };

    const writeTokenTransfer = storeTokenTransfer(tokenTransferMessage);
    const body = new Builder();
    writeTokenTransfer(body);
    console.log('Sending TokenTransfer message...');
    await client.provider(userJettonWallet).internal(walletSender, {
        value: toNano('0.5'),
        bounce: true,
        sendMode: 1, // PAY_GAS_SEPARATELY
        body: body.asCell(),
    });

    let currentSeqno = seqno;
    while (currentSeqno == seqno) {
        console.log('Waiting for transaction to confirm...');
        await sleep(1500);
        currentSeqno = await walletContract.getSeqno();
    }
    console.log('Transaction confirmed!');
}

run().catch(console.error);
