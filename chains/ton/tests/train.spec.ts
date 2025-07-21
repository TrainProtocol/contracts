import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, Dictionary, toNano } from '@ton/core';
import { Train } from '../build/train/tact_Train';
import '@ton/test-utils';
import { commit, createHashlockSecretPair, getTotalFees, lock } from '../utils/utils';
import { randomInt } from 'crypto';
import { keyPairFromSeed, getSecureRandomBytes, sign } from '@ton/crypto';

describe('TRAIN Protocol Native Asset Tests', () => {
    let blockchain: Blockchain;

    let deployerWallet: SandboxContract<TreasuryContract>;
    let userWallet: SandboxContract<TreasuryContract>;
    let solverWallet: SandboxContract<TreasuryContract>;
    let trainContract: SandboxContract<Train>;

    const dstChain = 'ETH';
    const dstAsset = 'ETH';
    const dstAddress = '0xabc';
    const srcAsset = 'TON';
    let userSeed;
    let kp: { publicKey: any; secretKey: any };
    let senderPubKey: bigint;

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = Number(Math.floor(Date.now() / 1000));
        deployerWallet = await blockchain.treasury('deployer');
        userWallet = await blockchain.treasury('user');
        solverWallet = await blockchain.treasury('solver');
        trainContract = blockchain.openContract(await Train.fromInit());
        userSeed = await getSecureRandomBytes(32);
        kp = keyPairFromSeed(userSeed);
        senderPubKey = BigInt('0x' + kp.publicKey.toString('hex'));

        const trainDeployResult = await trainContract.send(deployerWallet.getSender(), { value: toNano('1') }, null);
        expect(trainDeployResult.transactions).toHaveTransaction({
            from: deployerWallet.address,
            to: trainContract.address,
            deploy: true,
            success: true,
        });
    });

    it('deploys contract with initial state', async () => {
        expect(await trainContract.getGetRewardsLength()).toBe(0n);
        expect(await trainContract.getGetContractsLength()).toBe(0n);
    });

    it('commits and stores contract', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const timelock = BigInt(blockchain.now! + 3600);
        const contractsBefore = await trainContract.getGetContractsLength();

        const commitTx = await trainContract.send(
            userWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Commit',
                dstChain,
                dstAsset,
                dstAddress,
                srcAsset,
                id: contractId,
                amount,
                srcReceiver: solverWallet.address,
                timelock,
                senderPubKey,
                hopChains: Dictionary.empty(),
                hopAssets: Dictionary.empty(),
                hopAddresses: Dictionary.empty(),
            },
        );

        expect(commitTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Commit,
        });
        expect(commitTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
        });
        expect(commitTx.externals.some((x) => x.body.beginParse().loadUint(32) === Train.opcodes.TokenCommitted)).toBe(
            true,
        );

        expect((await trainContract.getGetContractsLength()) - contractsBefore).toBe(1n);
        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails?.sender.toString()).toBe(userWallet.address.toString());
        expect(htlcDetails?.amount).toBe(amount);
        expect(htlcDetails?.timelock).toBe(timelock);
        expect(htlcDetails?.srcReceiver.toString()).toBe(solverWallet.address.toString());
        expect(htlcDetails?.senderPubKey).toBe(senderPubKey);
        expect(htlcDetails?.hashlock).toBe(1n);
        console.log('Total Fees for Commit Msg: ', getTotalFees(commitTx.transactions) / 10 ** 9, ' TON');
    });

    it('fails to commit with 0 amount', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0');
        const timelock = BigInt(blockchain.now! + 3600);
        const contractsBefore = await trainContract.getGetContractsLength();

        const commitTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.01'), bounce: true },
            {
                $$type: 'Commit',
                dstChain,
                dstAsset,
                dstAddress,
                srcAsset,
                id: contractId,
                amount,
                srcReceiver: solverWallet.address,
                timelock,
                senderPubKey,
                hopChains: Dictionary.empty(),
                hopAssets: Dictionary.empty(),
                hopAddresses: Dictionary.empty(),
            },
        );
        expect((await trainContract.getGetContractsLength()) - contractsBefore).toBe(0n);
        expect(commitTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Commit,
            exitCode: Train.errors['Funds Not Sent'],
        });
        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails).toBeNull();
    });

    it('fails to commit with invalid timelock', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 800);

        const commitTx = await trainContract.send(
            userWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Commit',
                dstChain,
                dstAsset,
                dstAddress,
                srcAsset,
                id: contractId,
                amount,
                srcReceiver: solverWallet.address,
                timelock,
                senderPubKey,
                hopChains: Dictionary.empty(),
                hopAssets: Dictionary.empty(),
                hopAddresses: Dictionary.empty(),
            },
        );

        expect(commitTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Commit,
            exitCode: Train.errors['Not Future Timelock'],
        });
        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails).toBeNull();
    });

    it('fails to commit with existing id', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 3600);

        await trainContract.send(
            userWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Commit',
                dstChain,
                dstAsset,
                dstAddress,
                srcAsset,
                id: contractId,
                amount,
                srcReceiver: solverWallet.address,
                timelock,
                senderPubKey,
                hopChains: Dictionary.empty(),
                hopAssets: Dictionary.empty(),
                hopAddresses: Dictionary.empty(),
            },
        );

        const commitTx = await trainContract.send(
            userWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Commit',
                dstChain,
                dstAsset,
                dstAddress,
                srcAsset,
                id: contractId,
                amount,
                srcReceiver: solverWallet.address,
                timelock,
                senderPubKey,
                hopChains: Dictionary.empty(),
                hopAssets: Dictionary.empty(),
                hopAddresses: Dictionary.empty(),
            },
        );

        expect(commitTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Commit,
            exitCode: Train.errors['Contract Already Exists'],
        });
    });

    it('successfully adds lock', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 3600);
        const hashlock = BigInt(randomInt(256));

        await trainContract.send(
            userWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Commit',
                dstChain,
                dstAsset,
                dstAddress,
                srcAsset,
                id: contractId,
                amount,
                srcReceiver: solverWallet.address,
                timelock,
                senderPubKey,
                hopChains: Dictionary.empty(),
                hopAssets: Dictionary.empty(),
                hopAddresses: Dictionary.empty(),
            },
        );

        const addLockTx = await trainContract.send(
            userWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLock',
                id: contractId,
                hashlock,
                timelock,
            },
        );

        expect(addLockTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.AddLock,
        });

        expect(addLockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails?.sender.toString()).toBe(userWallet.address.toString());
        expect(htlcDetails?.amount).toBe(amount);
        expect(htlcDetails?.timelock).toBe(timelock);
        expect(htlcDetails?.hashlock).toBe(hashlock);
        expect(htlcDetails?.srcReceiver.toString()).toBe(solverWallet.address.toString());
        expect(htlcDetails?.senderPubKey).toBe(senderPubKey);
        console.log('Total Fees for AddLock Msg: ', getTotalFees(addLockTx.transactions) / 10 ** 9, ' TON');
    });

    it('AddLock fails Contract Does Not Exist', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 3600);
        const hashlock = BigInt(randomInt(256));
        const carlo = await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });
        const addLockTx = await trainContract.send(
            userWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLock',
                id: contractId + 10n,
                hashlock,
                timelock: timelock + 10n,
            },
        );
        expect(addLockTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLock,
            exitCode: Train.errors['Contract Does Not Exist'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId + 10n);
        expect(htlcDetails).toBeNull();
    });

    it('AddLock fails No Allowance', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 3600);
        const hashlock = BigInt(randomInt(256));
        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });

        const addLockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLock',
                id: contractId,
                hashlock,
                timelock: timelock + 10n,
            },
        );

        expect(addLockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLock,
            exitCode: Train.errors['No Allowance'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails?.hashlock).toBe(1n);
        expect(htlcDetails?.timelock).toBe(timelock);
    });

    it('AddLock fails Hashlock Already Set', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 3600);
        const hashlock = BigInt(randomInt(256));
        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });

        await trainContract.send(
            userWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLock',
                id: contractId,
                hashlock,
                timelock,
            },
        );

        const addLockTx = await trainContract.send(
            userWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLock',
                id: contractId,
                hashlock: BigInt(randomInt(256)),
                timelock: timelock + 10n,
            },
        );
        expect(addLockTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLock,
            exitCode: Train.errors['Hashlock Already Set'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails?.hashlock).toBe(hashlock);
        expect(htlcDetails?.timelock).toBe(timelock);
    });

    it('AddLock fails Not Future Timelock', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 901);
        const hashlock = BigInt(randomInt(256));
        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });
        const addLockTx = await trainContract.send(
            userWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLock',
                id: contractId,
                hashlock,
                timelock: timelock - 10n,
            },
        );
        expect(addLockTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLock,
            exitCode: Train.errors['Not Future Timelock'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails?.hashlock).toBe(1n);
        expect(htlcDetails?.timelock).toBe(timelock);
    });

    it('Lock successful', async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(blockchain.now! + 3600);
        const amount = toNano('0.15');
        const reward = toNano('0.05');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 2000);

        const contractsBefore = await trainContract.getGetContractsLength();
        const rewardsBefore = await trainContract.getGetRewardsLength();
        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Lock,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solverWallet.address,
            success: true,
            op: 0x0,
        });

        expect(lockTx.externals.some((x) => x.body.beginParse().loadUint(32) === Train.opcodes.TokenLocked)).toBe(true);

        expect((await trainContract.getGetContractsLength()) - contractsBefore).toBe(1n);
        expect((await trainContract.getGetRewardsLength()) - rewardsBefore).toBe(1n);
        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        const rewardDetails = await trainContract.getGetRewardDetails(contractId);
        expect(htlcDetails?.sender.toString()).toBe(solverWallet.address.toString());
        expect(htlcDetails?.amount).toBe(amount);
        expect(htlcDetails?.timelock).toBe(timelock);
        expect(htlcDetails?.srcReceiver.toString()).toBe(userWallet.address.toString());
        expect(htlcDetails?.hashlock).toBe(hashlock);
        expect(rewardDetails?.amount).toBe(reward);
        expect(rewardDetails?.timelock).toBe(rewardTimelock);
        console.log('Total Fees for Lock Msg: ', getTotalFees(lockTx.transactions) / 10 ** 9, ' TON');
    });

    it("Lock successful with 0 reward isn't fixed in rewards mapping", async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(blockchain.now! + 3600);
        const amount = toNano('0.15');
        const reward = toNano('0');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 2000);

        const contractsBefore = await trainContract.getGetContractsLength();
        const rewardsBefore = await trainContract.getGetRewardsLength();
        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Lock,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solverWallet.address,
            success: true,
            op: 0x0,
        });

        expect(lockTx.externals.some((x) => x.body.beginParse().loadUint(32) === Train.opcodes.TokenLocked)).toBe(true);

        expect((await trainContract.getGetContractsLength()) - contractsBefore).toBe(1n);
        expect((await trainContract.getGetRewardsLength()) - rewardsBefore).toBe(0n);
        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        const rewardDetails = await trainContract.getGetRewardDetails(contractId);
        expect(rewardDetails).toBeNull();
        expect(htlcDetails?.sender.toString()).toBe(solverWallet.address.toString());
        expect(htlcDetails?.amount).toBe(amount);
        expect(htlcDetails?.timelock).toBe(timelock);
        expect(htlcDetails?.srcReceiver.toString()).toBe(userWallet.address.toString());
        expect(htlcDetails?.hashlock).toBe(hashlock);
    });

    it('Lock fail Funds Not Sent', async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(blockchain.now! + 3600);
        const amount = toNano('0');
        const reward = toNano('0.05');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 2000);

        const contractsBefore = await trainContract.getGetContractsLength();
        const rewardsBefore = await trainContract.getGetRewardsLength();
        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount + reward + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Lock,
            exitCode: Train.errors['Funds Not Sent'],
        });

        expect((await trainContract.getGetContractsLength()) - contractsBefore).toBe(0n);
        expect((await trainContract.getGetRewardsLength()) - rewardsBefore).toBe(0n);
        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        const rewardDetails = await trainContract.getGetRewardDetails(contractId);
        expect(htlcDetails).toBeNull();
        expect(rewardDetails).toBeNull();
    });

    it('Lock fail Funds Not Sent (not enough value)', async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(blockchain.now! + 3600);
        const amount = toNano('1');
        const reward = toNano('0.05');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 2000);

        const contractsBefore = await trainContract.getGetContractsLength();
        const rewardsBefore = await trainContract.getGetRewardsLength();
        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Lock,
            exitCode: Train.errors['Funds Not Sent'],
        });

        expect((await trainContract.getGetContractsLength()) - contractsBefore).toBe(0n);
        expect((await trainContract.getGetRewardsLength()) - rewardsBefore).toBe(0n);
        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        const rewardDetails = await trainContract.getGetRewardDetails(contractId);
        expect(htlcDetails).toBeNull();
        expect(rewardDetails).toBeNull();
    });

    it('Lock fail Contract Already Exists', async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(blockchain.now! + 3600);
        const amount = toNano('1');
        const reward = toNano('0.05');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 2000);

        await trainContract.send(
            solverWallet.getSender(),
            { value: amount + reward + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );
        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount + reward + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock: BigInt(randomInt(256)),
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Lock,
            exitCode: Train.errors['Contract Already Exists'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails?.hashlock).toBe(hashlock);
    });

    it('Lock fail Not Future Timelock', async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 1200);
        const amount = toNano('1');
        const reward = toNano('0.05');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 1000);

        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount + reward + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Lock,
            exitCode: Train.errors['Not Future Timelock'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails).toBeNull();
    });

    it('Lock fail Invalid Reward Timelock', async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 1801);
        const amount = toNano('1');
        const reward = toNano('0.05');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) + 1900);
        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount + reward + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Lock,
            exitCode: Train.errors['Invalid Reward Timelock'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails).toBeNull();
    });

    it('Lock fail Invalid Reward Timelock (past)', async () => {
        const contractId = BigInt(Date.now());
        const hashlock = BigInt(randomInt(257));
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 1801);
        const amount = toNano('1');
        const reward = toNano('0.05');
        const rewardTimelock = BigInt(Math.floor(Date.now() / 1000) - 1900);

        const lockTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount + reward + toNano('0.35'), bounce: true },
            {
                $$type: 'Lock',
                id: contractId,
                hashlock,
                timelock,
                amount,
                reward,
                rewardTimelock,
                srcReceiver: userWallet.address,
                srcAsset,
                dstChain,
                dstAddress,
                dstAsset,
            },
        );

        expect(lockTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Lock,
            exitCode: Train.errors['Invalid Reward Timelock'],
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails).toBeNull();
    });

    it('Refund successful', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const timelock = BigInt(blockchain.now! + 3600);

        await trainContract.send(
            userWallet.getSender(),
            { value: amount + toNano('0.35'), bounce: true },
            {
                $$type: 'Commit',
                dstChain,
                dstAsset,
                dstAddress,
                srcAsset,
                id: contractId,
                amount,
                srcReceiver: solverWallet.address,
                timelock,
                senderPubKey,
                hopChains: Dictionary.empty(),
                hopAssets: Dictionary.empty(),
                hopAddresses: Dictionary.empty(),
            },
        );
        const contractsBefore = await trainContract.getGetContractsLength();

        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        blockchain.now = Number(timelock + 10n);
        const refundTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Refund',
                id: contractId,
            },
        );
        expect(refundTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Refund,
            outMessagesCount: 2,
        });

        expect(refundTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
            value: amount,
        });
        expect(contractsBefore - (await trainContract.getGetContractsLength())).toBe(1n);
        console.log('Total Fees for Refund Msg: ', getTotalFees(refundTx.transactions) / 10 ** 9, ' TON');
    });

    it('Refund successful with corect reward distribution', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const rewardAmount = toNano('0.1');
        const hashlock = BigInt(randomInt(256));
        const timelock = BigInt(blockchain.now! + 3600);
        const rewardTimelock = BigInt(blockchain.now! + 1200);
        await lock({
            trainContract,
            senderWallet: solverWallet,
            amount,
            rewardAmount,
            contractId,
            hashlock,
            timelock,
            rewardTimelock,
            srcReceiver: userWallet,
        });

        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        blockchain.now = Number(timelock + 10n);
        const refundTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Refund',
                id: contractId,
            },
        );
        expect(refundTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Refund,
        });
        expect(refundTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solverWallet.address,
            success: true,
            op: 0x0,
            value: amount + rewardAmount,
        });
        expect(refundTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
        });
    });

    it('Refund fails Contract Does Not Exist', async () => {
        const contractId = BigInt(Date.now());
        const refundTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Refund',
                id: contractId,
            },
        );
        expect(refundTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Refund,
            exitCode: Train.errors['Contract Does Not Exist'],
        });
    });

    it('Refund Not Passed Timelock', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const timelock = BigInt(blockchain.now! + 3600);
        await commit({ trainContract, userWallet, amount, contractId, solverWallet, timelock, senderPubKey });
        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        const refundTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Refund',
                id: contractId,
            },
        );
        expect(refundTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Refund,
            exitCode: Train.errors['Not Passed Timelock'],
        });
    });

    it('Redeem successful reward.timelock > now()', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const rewardAmount = toNano('0.1');
        const { secret, hashlock }: { secret: bigint; hashlock: bigint } = createHashlockSecretPair();
        const timelock = BigInt(blockchain.now! + 3600);
        const rewardTimelock = BigInt(blockchain.now! + 1200);
        await lock({
            trainContract,
            senderWallet: solverWallet,
            amount,
            rewardAmount,
            contractId,
            hashlock,
            timelock,
            rewardTimelock,
            srcReceiver: userWallet,
        });
        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        const redeemTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Redeem',
                id: contractId,
                secret: secret,
            },
        );
        expect(redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === Train.opcodes.TokenRedeemed)).toBe(
            true,
        );
        expect(redeemTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Redeem,
            outMessagesCount: 4,
        });
        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
            value: amount,
        });
        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solverWallet.address,
            success: true,
            op: 0x0,
            value: rewardAmount,
        });
        console.log('Total Fees for Redeem Msg: ', getTotalFees(redeemTx.transactions) / 10 ** 9, ' TON');
    });

    it('Redeem successful 0 reward', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const rewardAmount = toNano('0');
        const { secret, hashlock }: { secret: bigint; hashlock: bigint } = createHashlockSecretPair();
        const timelock = BigInt(blockchain.now! + 3600);
        const rewardTimelock = BigInt(blockchain.now! + 1200);
        await lock({
            trainContract,
            senderWallet: solverWallet,
            amount,
            rewardAmount,
            contractId,
            hashlock,
            timelock,
            rewardTimelock,
            srcReceiver: userWallet,
        });
        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        const redeemTx = await trainContract.send(
            solverWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Redeem',
                id: contractId,
                secret: secret,
            },
        );
        expect(redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === Train.opcodes.TokenRedeemed)).toBe(
            true,
        );
        expect(redeemTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Redeem,
            outMessagesCount: 3,
        });
        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
            value: amount,
        });
        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solverWallet.address,
            success: true,
            op: 0x0,
        });
    });

    it('Redeem successful reward.timelock < now(), sender()=srcReceiver', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const rewardAmount = toNano('0.1');
        const { secret, hashlock }: { secret: bigint; hashlock: bigint } = createHashlockSecretPair();
        const timelock = BigInt(blockchain.now! + 3600);
        const rewardTimelock = BigInt(blockchain.now! + 1200);
        await lock({
            trainContract,
            senderWallet: solverWallet,
            amount,
            rewardAmount,
            contractId,
            hashlock,
            timelock,
            rewardTimelock,
            srcReceiver: userWallet,
        });
        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        blockchain.now = Number(rewardTimelock + 100n);
        const redeemTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('1'), bounce: true },
            {
                $$type: 'Redeem',
                id: contractId,
                secret: secret,
            },
        );
        expect(redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === Train.opcodes.TokenRedeemed)).toBe(
            true,
        );
        expect(redeemTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Redeem,
            value: toNano('1'),
        });
        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
        });

        const msg = redeemTx.transactions[1].outMessages.get(2);
        if (msg?.info.type === 'internal') {
            expect(msg.info.src.toString()).toBe(trainContract.address.toString());
            expect(msg.info.dest.toString()).toBe(userWallet.address.toString());
            expect(msg.info.value.coins).toBeGreaterThan(rewardAmount + amount);
        }
    });

    it('Redeem successful reward.timelock < now()', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const rewardAmount = toNano('0.1');
        const { secret, hashlock }: { secret: bigint; hashlock: bigint } = createHashlockSecretPair();
        const timelock = BigInt(blockchain.now! + 3600);
        const rewardTimelock = BigInt(blockchain.now! + 1200);
        await lock({
            trainContract,
            senderWallet: solverWallet,
            amount,
            rewardAmount,
            contractId,
            hashlock,
            timelock,
            rewardTimelock,
            srcReceiver: userWallet,
        });
        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        blockchain.now = Number(rewardTimelock + 100n);
        const redeemTx = await trainContract.send(
            solverWallet.getSender(),
            { value: toNano('1'), bounce: true },
            {
                $$type: 'Redeem',
                id: contractId,
                secret: secret,
            },
        );
        expect(redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === Train.opcodes.TokenRedeemed)).toBe(
            true,
        );
        expect(redeemTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.Redeem,
            value: toNano('1'),
        });
        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: userWallet.address,
            success: true,
            op: 0x0,
            value: amount,
        });
        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solverWallet.address,
            success: true,
            op: 0x0,
        });
        const msg = redeemTx.transactions[1].outMessages.get(2);
        if (msg?.info.type === 'internal') {
            expect(msg.info.src.toString()).toBe(trainContract.address.toString());
            expect(msg.info.dest.toString()).toBe(solverWallet.address.toString());
            expect(msg.info.value.coins).toBeGreaterThan(rewardAmount);
        }
    });

    it('Redeem Contract Does Not Exist', async () => {
        const contractId = BigInt(Date.now());
        const { secret, hashlock }: { secret: bigint; hashlock: bigint } = createHashlockSecretPair();
        expect(await trainContract.getGetHtlcDetails(contractId)).toBeNull();
        const redeemTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Redeem',
                id: contractId,
                secret: secret,
            },
        );

        expect(redeemTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Redeem,
            exitCode: Train.errors['Contract Does Not Exist'],
        });
    });

    it('Redeem Hashlock Not Match', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('0.15');
        const rewardAmount = toNano('0.1');
        const { hashlock } = createHashlockSecretPair();
        const { secret } = createHashlockSecretPair();

        const timelock = BigInt(blockchain.now! + 3600);
        const rewardTimelock = BigInt(blockchain.now! + 1200);
        await lock({
            trainContract,
            senderWallet: solverWallet,
            amount,
            rewardAmount,
            contractId,
            hashlock,
            timelock,
            rewardTimelock,
            srcReceiver: userWallet,
        });
        expect(await trainContract.getGetHtlcDetails(contractId)).toBeTruthy();
        const redeemTx = await trainContract.send(
            userWallet.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Redeem',
                id: contractId,
                secret: secret,
            },
        );

        expect(redeemTx.transactions).toHaveTransaction({
            from: userWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.Redeem,
            exitCode: Train.errors['Hashlock Not Match'],
        });
    });

    it('AddLockSig successful', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 1800);
        const timelock2 = BigInt(blockchain.now! + 2100);
        const hashlock = BigInt(randomInt(256));
        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });
        const dataCell: Cell = beginCell()
            .storeInt(contractId, 257)
            .storeInt(hashlock, 257)
            .storeInt(timelock2, 257)
            .endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: true,
            op: Train.opcodes.AddLockSig,
        });

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solverWallet.address,
            success: true,
            op: 0x0,
        });

        const htlcDetails = await trainContract.getGetHtlcDetails(contractId);
        expect(htlcDetails?.hashlock).toBe(hashlock);
        expect(htlcDetails?.timelock).toBe(timelock2);
        console.log('Total Fees for AddLockSig Msg: ', getTotalFees(addLocSigTx.transactions) / 10 ** 9, ' TON');
    });

    it('AddLockSig fails Contract Does Not Exist', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 1800);
        const timelock2 = BigInt(blockchain.now! + 2100);
        const hashlock = BigInt(randomInt(256));
        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });
        const dataCell: Cell = beginCell()
            .storeInt(contractId + 1n, 257)
            .storeInt(hashlock, 257)
            .storeInt(timelock2, 257)
            .endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );
        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLockSig,
            exitCode: Train.errors['Contract Does Not Exist'],
        });
    });

    it('AddLockSig fails Invalid Signature', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 1800);
        const timelock2 = BigInt(blockchain.now! + 2100);
        const hashlock = BigInt(randomInt(256));
        const wrongPubKey = BigInt('0x' + (await getSecureRandomBytes(32)).toString('hex'));

        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey: wrongPubKey,
        });
        const dataCell: Cell = beginCell()
            .storeInt(contractId, 257)
            .storeInt(hashlock, 257)
            .storeInt(timelock2, 257)
            .endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );
        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLockSig,
            exitCode: Train.errors['Invalid Signature'],
        });
    });

    it('AddLockSig fails Hashlock Already Set', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 1800);
        const timelock2 = BigInt(blockchain.now! + 2100);
        const hashlock = BigInt(randomInt(256));
        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });
        const dataCell: Cell = beginCell()
            .storeInt(contractId, 257)
            .storeInt(hashlock, 257)
            .storeInt(timelock2, 257)
            .endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        await trainContract.send(
            solverWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        const addLocSigTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLockSig,
            exitCode: Train.errors['Hashlock Already Set'],
        });
    });

    it('AddLockSig fails Not Future Timelock', async () => {
        const contractId = BigInt(Date.now());
        const amount = toNano('1');
        const timelock = BigInt(blockchain.now! + 1800);
        const timelock2 = BigInt(blockchain.now!);
        const hashlock = BigInt(randomInt(256));
        await commit({
            trainContract,
            userWallet,
            amount,
            contractId,
            solverWallet,
            timelock,
            senderPubKey,
        });
        const dataCell: Cell = beginCell()
            .storeInt(contractId, 257)
            .storeInt(hashlock, 257)
            .storeInt(timelock2, 257)
            .endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solverWallet.getSender(),
            { value: amount, bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solverWallet.address,
            to: trainContract.address,
            success: false,
            op: Train.opcodes.AddLockSig,
            exitCode: Train.errors['Not Future Timelock'],
        });
    });
});
