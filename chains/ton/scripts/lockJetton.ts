require('dotenv').config();
import { getHttpV4Endpoint } from '@orbs-network/ton-access';
import { mnemonicToWalletKey } from 'ton-crypto';
import { TonClient4, WalletContractV5R1, Address, Cell, beginCell, Builder, WalletContractV4 } from '@ton/ton';
import { toNano, sleep } from '../utils/utils';
import { TokenTransfer, LockData, storeLockData, storeTokenTransfer } from '../build/jetton_train/tact_TrainJetton';

export async function run() {
    const endpoint = await getHttpV4Endpoint({ network: 'testnet' });
    const client = new TonClient4({ endpoint });

    const mnemonic = process.env.MNEMONIC2!;
    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });

    const walletContract = client.open(wallet);
    const walletSender = walletContract.sender(key.secretKey);
    const seqno = await walletContract.getSeqno();
    const solverJettonWallet = Address.parse(process.env.solverJettonWallet!);

    const hashlock = BigInt(process.env.hashlock!);
    const Id = BigInt(process.env.id!);
    const dstChain: string = 'STARKNET_SEPOLIA';
    const dstAsset: string = 'ETH';
    const dstAddress: string = '0x0430a74277723D1EBba7119339F0F8276ca946c1B2c73DE7636Fd9EBA31e1c1f';
    const srcAsset: string = 'Abr Jbr';
    const srcReceiver: Address = Address.parse(process.env.srcReceiver!);
    const timelock = BigInt(Math.floor(Date.now() / 1000) + 1900);
    const reward = 2n;
    const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 100);
    const jettonMasterAddress = Address.parse(process.env.jettonMasterAddress!);
    const htlcJettonWalletAddress = Address.parse(process.env.htlcJettonWalletAddress!);

    const lockData: LockData = {
        $$type: 'LockData',
        id: Id,
        timelock: timelock,
        reward: reward,
        rewardTimelock: rewardTimelock,
        srcReceiver: srcReceiver,
        srcAsset: srcAsset,
        dstChain: dstChain,
        dstAddress: dstAddress,
        dstAsset: dstAsset,
        hashlock: hashlock,
        jettonMasterAddress: jettonMasterAddress,
        htlcJettonWalletAddress: htlcJettonWalletAddress,
    };
    const writeLockData = storeLockData(lockData);
    const forwardPayload = new Builder();
    writeLockData(forwardPayload);
    const finalForwardPayload = beginCell()
        .storeUint(1, 1)
        .storeRef(beginCell().storeUint(317164721, 32).storeBuilder(forwardPayload).endCell())
        .endCell()
        .asSlice();

    const queryId = BigInt(Date.now());
    const amount = 3n;
    const destination = Address.parse(process.env.destination!);
    const responseDestination = wallet.address;
    const customPayload: Cell | null = null;
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
    await client.provider(solverJettonWallet).internal(walletSender, {
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
