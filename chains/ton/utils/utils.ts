import { beginCell, Builder, Dictionary, Transaction } from '@ton/core';
import { StringImpl } from '../build/train/tact_Train';
import { Address } from '@ton/ton';
import { createHash, randomBytes } from 'crypto';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { JettonMinter, JettonWallet } from '@ton-community/assets-sdk';
import {
    TrainJetton,
    CommitData,
    storeCommitData,
    TokenTransfer,
    storeTokenTransfer,
    LockData,
    storeLockData,
} from '../build/jetton_train/tact_TrainJetton';

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNano(amount: string): bigint {
    return BigInt(Math.floor(parseFloat(amount) * 10 ** 9));
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createIntMap(initialData: [bigint, bigint][]): Dictionary<bigint, bigint> {
    const dict = Dictionary.empty<bigint, bigint>();

    initialData.forEach(([key, value]) => {
        dict.set(key, value);
    });

    return dict;
}

function createStrMap(initialData: [bigint, StringImpl][]): Dictionary<bigint, StringImpl> {
    const dict = Dictionary.empty<bigint, StringImpl>();

    initialData.forEach(([key, value]) => {
        dict.set(key, value);
    });

    return dict;
}

function createAddrMap(initialData: [bigint, Address][]): Dictionary<bigint, Address> {
    const dict = Dictionary.empty<bigint, Address>();

    initialData.forEach(([key, value]) => {
        dict.set(key, value);
    });

    return dict;
}

const hexToBase64 = (hex: string) =>
    btoa(String.fromCharCode(...(hex.match(/[0-9a-f]{2}/gi) ?? []).map((c) => parseInt(c, 16))));

function storageGeneric<T extends Transaction>(transaction: T) {
    if (transaction.description.type !== 'generic') throw 'Expected generic transaction';
    const storagePhase = transaction.description.storagePhase;
    if (storagePhase === null || storagePhase === undefined) throw 'Storage phase expected';
    return storagePhase;
}

function computedGeneric<T extends Transaction>(transaction: T) {
    if (transaction.description.type !== 'generic') throw 'Expected generic transaction';
    if (transaction.description.computePhase.type !== 'vm') throw 'Compute phase expected';
    return transaction.description.computePhase;
}

function getTotalFees(transactions: Transaction[]) {
    let totalFees = 0;
    transactions.forEach((tx) => {
        if (tx.description.type !== 'generic') throw 'Expected generic transaction';
        totalFees += Number(tx.totalFees.coins);
    });
    return totalFees;
}

async function commit({
    trainContract,
    userWallet,
    amount,
    contractId,
    solverWallet,
    timelock,
    senderPubKey,
}: {
    trainContract: any;
    userWallet: any;
    amount: bigint;
    contractId: any;
    solverWallet: any;
    timelock: bigint;
    senderPubKey: any;
}) {
    return await trainContract.send(
        userWallet.getSender(),
        { value: amount + toNano('0.1'), bounce: true },
        {
            $$type: 'Commit',
            dstChain: 'ETH',
            dstAsset: 'ETH',
            dstAddress: '0xabc',
            srcAsset: 'TON',
            id: contractId,
            amount: amount,
            srcReceiver: solverWallet.address,
            timelock: timelock,
            senderPubKey: senderPubKey,
            hopChains: Dictionary.empty(),
            hopAssets: Dictionary.empty(),
            hopAddresses: Dictionary.empty(),
        },
    );
}

async function lock({
    trainContract,
    senderWallet,
    amount,
    rewardAmount,
    contractId,
    hashlock,
    timelock,
    rewardTimelock,
    srcReceiver,
}: {
    trainContract: any;
    senderWallet: any;
    amount: any;
    rewardAmount: any;
    contractId: any;
    hashlock: any;
    timelock: any;
    rewardTimelock: any;
    srcReceiver: any;
}) {
    return await trainContract.send(
        senderWallet.getSender(),
        { value: amount + rewardAmount + toNano('0.25'), bounce: true },
        {
            $$type: 'Lock',
            id: contractId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: srcReceiver.address,
            dstChain: 'ETH',
            dstAsset: 'ETH',
            dstAddress: '0xabc',
            srcAsset: 'TON',
            amount: amount,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
        },
    );
}

async function addLock({
    trainContract,
    userWallet,
    amount,
    contractId,
    hashlock,
    timelock,
}: {
    trainContract: any;
    userWallet: any;
    amount: bigint;
    contractId: any;
    hashlock: any;
    timelock: bigint;
}) {
    return await trainContract.send(
        userWallet.getSender(),
        { value: amount, bounce: true },
        {
            $$type: 'AddLock',
            id: contractId,
            hashlock: hashlock,
            timelock: timelock,
        },
    );
}

function createHashlockSecretPair(): { secret: bigint; hashlock: bigint } {
    const bytes = randomBytes(32);
    const secret = BigInt('0x' + bytes.toString('hex'));
    const hashBuffer = createHash('sha256').update(bytes.toString('hex'), 'hex').digest();
    const hashlock = BigInt('0x' + hashBuffer.toString('hex'));
    return { secret, hashlock };
}

async function commitJetton(
    blockchain: Blockchain,
    trainContract: SandboxContract<TrainJetton>,
    user: SandboxContract<TreasuryContract>,
    srcReceiver: SandboxContract<TreasuryContract>,
    userJettonWallet: SandboxContract<JettonWallet>,
    jettonMaster: SandboxContract<JettonMinter>,
    overrides?: {
        amount?: bigint;
        timelockOffset?: number;
        senderPubKey?: bigint;
    },
) {
    const dstChain = 'ARBITRUM_SEPOLIA';
    const dstAsset = 'USDC';
    const dstAddress = '0xF6517026847B4c166AAA176fe0C5baD1A245778D';
    const srcAsset = 'TESTJ';
    const senderPubKey = overrides?.senderPubKey ?? 12345n;
    const hopChains = createStrMap([[0n, { $$type: 'StringImpl', data: dstChain }]]);
    const hopAssets = createStrMap([[0n, { $$type: 'StringImpl', data: dstAsset }]]);
    const hopAddresses = createStrMap([[0n, { $$type: 'StringImpl', data: dstAddress }]]);

    const commitId = BigInt(Date.now());
    const timelock = BigInt((blockchain.now ?? Math.floor(Date.now() / 1000)) + (overrides?.timelockOffset ?? 1800));
    const amount = overrides?.amount ?? 1n;

    const commitData: CommitData = {
        dstChain,
        dstAsset,
        dstAddress,
        srcAsset,
        id: commitId,
        srcReceiver: srcReceiver.address,
        timelock,
        jettonMasterAddress: jettonMaster.address,
        senderPubKey,
        hopChains,
        hopAssets,
        hopAddresses,
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

    const tokenTransferMessage: TokenTransfer = {
        $$type: 'TokenTransfer',
        queryId,
        amount,
        destination: trainContract.address,
        responseDestination: user.address,
        customPayload: beginCell().storeInt(0, 32).storeStringTail('Success').endCell(),
        forwardTonAmount: toNano('0.1'),
        forwardPayload: finalForwardPayload,
    };

    const writeTokenTransfer = storeTokenTransfer(tokenTransferMessage);
    const body = new Builder();
    writeTokenTransfer(body);

    const tx = await user.send({
        value: toNano('0.5'),
        to: userJettonWallet.address,
        sendMode: 1,
        body: body.asCell(),
    });

    return {
        tx,
        commitId,
        timelock,
        amount,
        commitData,
    };
}

async function lockJetton(
    blockchain: Blockchain,
    trainContract: SandboxContract<TrainJetton>,
    user: SandboxContract<TreasuryContract>,
    solver: SandboxContract<TreasuryContract>,
    solverJettonWallet: SandboxContract<JettonWallet>,
    jettonMaster: SandboxContract<JettonMinter>,
    overrides?: {
        amount?: bigint;
        rewardAmount?: bigint;
        timelockOffset?: number;
        rewardTimelockOffset?: number;
        hashlock?: bigint;
    },
) {
    const dstChain = 'ARBITRUM_SEPOLIA';
    const dstAsset = 'USDC';
    const dstAddress = '0xF6517026847B4c166AAA176fe0C5baD1A245778D';
    const srcAsset = 'TESTJ';

    const lockId = BigInt(Date.now());
    const now = blockchain.now ?? Math.floor(Date.now() / 1000);
    const timelock = BigInt(now + (overrides?.timelockOffset ?? 1801));
    const rewardTimelock = BigInt(now + (overrides?.rewardTimelockOffset ?? 1700));
    const rewardAmount = overrides?.rewardAmount ?? 1n;
    const hashlock = overrides?.hashlock ?? createHashlockSecretPair().hashlock;

    const lockData: LockData = {
        $$type: 'LockData',
        id: lockId,
        hashlock,
        timelock,
        srcReceiver: user.address,
        srcAsset,
        dstChain,
        dstAddress,
        dstAsset,
        reward: rewardAmount,
        rewardTimelock,
        jettonMasterAddress: jettonMaster.address,
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
    const amount = overrides?.amount ?? 3n;

    const tokenTransferMessage: TokenTransfer = {
        $$type: 'TokenTransfer',
        queryId,
        amount,
        destination: trainContract.address,
        responseDestination: solver.address,
        customPayload: beginCell().storeInt(0, 32).storeStringTail('Success').endCell(),
        forwardTonAmount: toNano('0.1'),
        forwardPayload: finalForwardPayload,
    };

    const writeTokenTransfer = storeTokenTransfer(tokenTransferMessage);
    const body = new Builder();
    writeTokenTransfer(body);

    const contractsLengthBefore = await trainContract.getGetContractsLength();
    const rewardsLengthBefore = await trainContract.getGetRewardsLength();

    const tx = await solver.send({
        value: toNano('0.5'),
        to: solverJettonWallet.address,
        sendMode: 1,
        body: body.asCell(),
    });

    return {
        tx,
        lockId,
        timelock,
        rewardTimelock,
        rewardAmount,
        amount,
        lockData,
        contractsLengthBefore,
        rewardsLengthBefore,
    };
}
export {
    delay,
    toNano,
    sleep,
    createIntMap,
    createStrMap,
    createAddrMap,
    hexToBase64,
    storageGeneric,
    computedGeneric,
    getTotalFees,
    commit,
    addLock,
    lock,
    createHashlockSecretPair,
    commitJetton,
    lockJetton,
};
