import { Dictionary, Transaction } from '@ton/core';
import { StringImpl } from '../build/train/tact_Train';
import { Address } from '@ton/ton';
import { createHash, randomBytes, randomInt } from 'crypto';
import { sha256 } from 'ton-crypto';
import { hash } from '@tact-lang/compiler/dist/asm/runtime/util';

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
};
