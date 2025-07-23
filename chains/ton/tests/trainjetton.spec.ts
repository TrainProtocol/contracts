import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, beginCell, Builder, Cell } from '@ton/core';
import { JettonMinter, JettonMinterConfig, JettonWallet } from '@ton-community/assets-sdk';
import {
    AddLock,
    CommitData,
    LockData,
    TokenTransfer,
    TrainJetton,
    storeCommitData,
    storeLockData,
    storeTokenTransfer,
} from '../build/jetton_train/tact_TrainJetton';
import '@ton/test-utils';
import { randomAddress } from '@ton/test-utils';
import { commitJetton, createHashlockSecretPair, createStrMap, getTotalFees, lockJetton } from '../utils/utils';
import { buildOnchainMetadata } from '../utils/jettonHelpers';
import { keyPairFromSeed, getSecureRandomBytes, sign } from '@ton/crypto';

describe('TrainJetton', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let solver: SandboxContract<TreasuryContract>;
    let trainContract: SandboxContract<TrainJetton>;
    let jettonMaster: SandboxContract<JettonMinter>;
    let userJettonWallet: SandboxContract<JettonWallet>;
    let solverJettonWallet: SandboxContract<JettonWallet>;
    let deployerJettonWallet: SandboxContract<JettonWallet>;
    let flag = true;

    const dstChain = 'ARBITRUM_SEPOLIA';
    const dstAsset = 'USDC';
    const dstAddress = '0xF6517026847B4c166AAA176fe0C5baD1A245778D';
    const srcAsset = 'TESTJ';
    const hopChains = createStrMap([[0n, { $$type: 'StringImpl', data: 'ARBITRUM_SEPOLIA' }]]);
    const hopAssets = createStrMap([[0n, { $$type: 'StringImpl', data: 'USDC' }]]);
    const hopAddresses = createStrMap([
        [0n, { $$type: 'StringImpl', data: '0xF6517026847B4c166AAA176fe0C5baD1A245778D' }],
    ]);
    let userSeed;
    let kp: { publicKey: any; secretKey: any };
    let senderPubKey: bigint;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = Number(Math.floor(Date.now() / 1000));
        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('user');
        solver = await blockchain.treasury('solver');
        userSeed = await getSecureRandomBytes(32);
        kp = keyPairFromSeed(userSeed);
        senderPubKey = BigInt('0x' + kp.publicKey.toString('hex'));
        const walletCode = JettonWallet.code;
        const minterCode = JettonMinter.code;

        const jettonParams = {
            name: 'TRAIN Protocol',
            description: 'Test Jetton for TRAIN Protocol',
            symbol: 'TRN',
            image: 'https://play-lh.googleusercontent.com/ahJtMe0vfOlAu1XJVQ6rcaGrQBgtrEZQefHy7SXB7jpijKhu1Kkox90XDuH8RmcBOXNn',
        };
        let content = buildOnchainMetadata(jettonParams);

        const jettonMinterconfig: JettonMinterConfig = {
            admin: deployer.address,
            content: content,
            jettonWalletCode: walletCode,
        };

        jettonMaster = blockchain.openContract(JettonMinter.createFromConfig(jettonMinterconfig, minterCode));

        const jettonMinterDeployResult = await jettonMaster.sendDeploy(deployer.getSender(), toNano('0.05'));
        expect(jettonMinterDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMaster.address,
            deploy: true,
            success: true,
        });

        trainContract = blockchain.openContract(await TrainJetton.fromInit());
        const trainContractDeployResult = await trainContract.send(deployer.getSender(), { value: toNano('1') }, null);
        expect(trainContractDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: trainContract.address,
            deploy: true,
            success: true,
        });

        const supportJettonResult = await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'SupportJetton',
                jettonMaster: jettonMaster.address,
                htlcJettonWallet: await jettonMaster.getWalletAddress(trainContract.address),
            },
        );
        expect(supportJettonResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.SupportJetton,
        });

        expect(await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)).toEqualAddress(
            await jettonMaster.getWalletAddress(trainContract.address),
        );

        if (flag) {
            console.log(
                'Total Fees for JettonSupport Msg: ',
                getTotalFees(supportJettonResult.transactions) / 10 ** 9,
                ' TON',
            );
            flag = false;
        }
        await jettonMaster.sendMint(deployer.getSender(), user.address, toNano('10'));
        await jettonMaster.sendMint(deployer.getSender(), solver.address, toNano('10'));
        await jettonMaster.sendMint(deployer.getSender(), deployer.address, toNano('10'));
        deployerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMaster.getWalletAddress(deployer.address)),
        );
        userJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMaster.getWalletAddress(user.address)),
        );
        const userJettonData = await userJettonWallet.getData();
        expect(userJettonData.balance).toBe(toNano('10'));
        expect(userJettonData.jettonMaster.toString()).toBe(jettonMaster.address.toString());
        expect(userJettonData.owner.toString()).toBe(user.address.toString());
        solverJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMaster.getWalletAddress(solver.address)),
        );
        const solverJettonData = await solverJettonWallet.getData();
        expect(solverJettonData.balance).toBe(toNano('10'));
        expect(solverJettonData.jettonMaster.toString()).toBe(jettonMaster.address.toString());
        expect(solverJettonData.owner.toString()).toBe(solver.address.toString());
    });

    it('Deploy TrainJetton with correct initial state', async () => {
        expect((await trainContract.getOwner()).equals(deployer.address)).toBe(true);
        expect(await trainContract.getGetSupportedJettonsLength()).toBe(1n);
        expect(await trainContract.getGetContractsLength()).toBe(0n);
        expect(await trainContract.getGetRewardsLength()).toBe(0n);
    });

    it('JettonSupport fails Jetton Already Supported', async () => {
        const supportJettonResult = await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'SupportJetton',
                jettonMaster: jettonMaster.address,
                htlcJettonWallet: await jettonMaster.getWalletAddress(trainContract.address),
            },
        );
        expect(supportJettonResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.SupportJetton,
            exitCode: TrainJetton.errors['Jetton Already Supported'],
        });
    });

    it('RemoveJetton successful', async () => {
        const removeJettonResult = await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'RemoveJetton',
                jettonMaster: jettonMaster.address,
            },
        );
        expect(removeJettonResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.RemoveJetton,
        });

        expect(removeJettonResult.transactions).toHaveTransaction({
            from: trainContract.address,
            to: deployer.address,
            success: true,
            op: 0x0,
        });

        expect(await trainContract.getGetSupportedJettonsLength()).toBe(0n);
        expect(await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)).toBeNull();
        console.log(
            'Total Fees for RemoveJetton Msg: ',
            getTotalFees(removeJettonResult.transactions) / 10 ** 9,
            ' TON',
        );
    });

    it('RemoveJetton fails Jetton Not Supported', async () => {
        const removeJettonResult = await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'RemoveJetton',
                jettonMaster: randomAddress(),
            },
        );
        expect(removeJettonResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.RemoveJetton,
            exitCode: TrainJetton.errors['Jetton Not Supported'],
        });
    });

    it('RemoveJetton fails Not Owner', async () => {
        const removeJettonResult = await trainContract.send(
            user.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'RemoveJetton',
                jettonMaster: jettonMaster.address,
            },
        );
        expect(removeJettonResult.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.RemoveJetton,
            exitCode: 132,
        });
    });

    it('Commit successful', async () => {
        const commitId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1800);
        const commitData: CommitData = {
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            id: commitId,
            srcReceiver: user.address,
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
        const amount = 1n;
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
        const contractsLengthBefore = await trainContract.getGetContractsLength();
        const commitTx = await user.send({
            value: toNano('0.5'),
            to: userJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: user.address,
            success: true,
            op: 0x0,
        });

        expect(
            commitTx.externals.some((x) => x.body.beginParse().loadUint(32) === TrainJetton.opcodes.TokenCommitted),
        ).toBe(true);

        const details = await trainContract.getGetHtlcDetails(commitId);
        expect(details).toBeTruthy();
        expect(details?.sender.equals(user.address)).toBe(true);
        expect(details?.amount).toBe(amount);
        expect(details?.timelock).toBe(timelock);
        expect(details?.srcReceiver.equals(user.address)).toBe(true);
        expect(details?.senderPubKey).toBe(senderPubKey);
        expect(details?.hashlock).toBe(1n);
        expect(details?.jettonMasterAddress.equals(jettonMaster.address)).toBe(true);
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(1n);
        console.log('Total Fees for Commit Msg: ', getTotalFees(commitTx.transactions) / 10 ** 9, ' TON');
    });

    it('Commit fails with 0 amount', async () => {
        const commitId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1800);
        const commitData: CommitData = {
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            id: commitId,
            srcReceiver: user.address,
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
        const amount = 0n;
        const tokenTransferMessage: TokenTransfer = {
            $$type: 'TokenTransfer',
            queryId,
            amount,
            destination: trainContract.address,
            responseDestination: user.address,
            customPayload: beginCell().storeInt(0, 32).storeStringTail('Success').endCell(),
            forwardTonAmount: toNano('0.3'),
            forwardPayload: finalForwardPayload,
        };

        const writeTokenTransfer = storeTokenTransfer(tokenTransferMessage);
        const body = new Builder();
        writeTokenTransfer(body);
        const contractsLengthBefore = await trainContract.getGetContractsLength();
        const balanceBefore = (await userJettonWallet.getData()).balance;
        const commitTx = await user.send({
            value: toNano('0.5'),
            to: userJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });
        expect(commitTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(commitId);
        expect(details).toBeFalsy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);
        expect((await userJettonWallet.getData()).balance - balanceBefore).toBe(0n);
    });

    it('Commit fails not future timelock', async () => {
        const commitId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 899);
        const commitData: CommitData = {
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            id: commitId,
            srcReceiver: user.address,
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
        const amount = 1n;
        const tokenTransferMessage: TokenTransfer = {
            $$type: 'TokenTransfer',
            queryId,
            amount,
            destination: trainContract.address,
            responseDestination: user.address,
            customPayload: beginCell().storeInt(0, 32).storeStringTail('Success').endCell(),
            forwardTonAmount: toNano('0.3'),
            forwardPayload: finalForwardPayload,
        };

        const writeTokenTransfer = storeTokenTransfer(tokenTransferMessage);
        const body = new Builder();
        writeTokenTransfer(body);
        const contractsLengthBefore = await trainContract.getGetContractsLength();
        const balanceBefore = (await userJettonWallet.getData()).balance;
        const commitTx = await user.send({
            value: toNano('0.5'),
            to: userJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });
        expect(commitTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(commitId);
        expect(details).toBeFalsy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);
        expect((await userJettonWallet.getData()).balance - balanceBefore).toBe(0n);
    });

    it('Commit fails with existing Id', async () => {
        const commitId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 901);
        const commitData: CommitData = {
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            id: commitId,
            srcReceiver: user.address,
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
        const amount = 1n;
        const tokenTransferMessage: TokenTransfer = {
            $$type: 'TokenTransfer',
            queryId,
            amount,
            destination: trainContract.address,
            responseDestination: user.address,
            customPayload: beginCell().storeInt(0, 32).storeStringTail('Success').endCell(),
            forwardTonAmount: toNano('0.3'),
            forwardPayload: finalForwardPayload,
        };

        const writeTokenTransfer = storeTokenTransfer(tokenTransferMessage);
        const body = new Builder();
        writeTokenTransfer(body);
        await user.send({
            value: toNano('0.5'),
            to: userJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });
        const contractsLengthBefore = await trainContract.getGetContractsLength();
        const balanceBefore = (await userJettonWallet.getData()).balance;
        const commitTx = await user.send({
            value: toNano('0.5'),
            to: userJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });
        expect(commitTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);
        expect((await userJettonWallet.getData()).balance - balanceBefore).toBe(0n);
    });

    it('Deposit fails wrong opcode', async () => {
        const commitId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 901);
        const commitData: CommitData = {
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            id: commitId,
            srcReceiver: user.address,
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
            .storeRef(beginCell().storeUint(1111111, 32).storeBuilder(forwardPayload).endCell())
            .endCell()
            .asSlice();

        const queryId = BigInt(Date.now());
        const amount = 1n;
        const tokenTransferMessage: TokenTransfer = {
            $$type: 'TokenTransfer',
            queryId,
            amount,
            destination: trainContract.address,
            responseDestination: user.address,
            customPayload: beginCell().storeInt(0, 32).storeStringTail('Success').endCell(),
            forwardTonAmount: toNano('0.3'),
            forwardPayload: finalForwardPayload,
        };

        const writeTokenTransfer = storeTokenTransfer(tokenTransferMessage);
        const body = new Builder();
        writeTokenTransfer(body);
        await user.send({
            value: toNano('0.5'),
            to: userJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });
        const contractsLengthBefore = await trainContract.getGetContractsLength();
        const balanceBefore = (await userJettonWallet.getData()).balance;
        const commitTx = await user.send({
            value: toNano('0.5'),
            to: userJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: (await jettonMaster.getWalletAddress(trainContract.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await jettonMaster.getWalletAddress(trainContract.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(commitTx.transactions).toHaveTransaction({
            from: (await jettonMaster.getWalletAddress(trainContract.address)) ?? undefined,
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);
        expect((await userJettonWallet.getData()).balance - balanceBefore).toBe(0n);
    });

    it('Lock successful', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1801);
        const rewardTimelock = BigInt(blockchain.now! + 1700);
        const rewardAmount = 1n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 3n;
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
        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solver.address,
            success: true,
            op: 0x0,
        });

        expect(lockTx.externals.some((x) => x.body.beginParse().loadUint(32) === TrainJetton.opcodes.TokenLocked)).toBe(
            true,
        );

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeTruthy();
        expect(details?.sender.equals(solver.address)).toBe(true);
        expect(details?.amount).toBe(amount - rewardAmount);
        expect(details?.timelock).toBe(timelock);
        expect(details?.srcReceiver.equals(user.address)).toBe(true);
        expect(details?.senderPubKey).toBe(1n);
        expect(details?.hashlock).toBe(hashlock);
        expect(details?.jettonMasterAddress.equals(jettonMaster.address)).toBe(true);
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(1n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeTruthy();
        expect(rewardDetails?.amount).toBe(rewardAmount);
        expect(rewardDetails?.timelock).toBe(rewardTimelock);
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(1n);
        console.log('Total Fees for Lock Msg: ', getTotalFees(lockTx.transactions) / 10 ** 9, ' TON');
    });

    it('Lock successful with 0 reward', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1801);
        const rewardTimelock = BigInt(blockchain.now! + 1700);
        const rewardAmount = 0n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 3n;
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
        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solver.address,
            success: true,
            op: 0x0,
        });

        expect(lockTx.externals.some((x) => x.body.beginParse().loadUint(32) === TrainJetton.opcodes.TokenLocked)).toBe(
            true,
        );

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeTruthy();
        expect(details?.sender.equals(solver.address)).toBe(true);
        expect(details?.amount).toBe(amount - rewardAmount);
        expect(details?.timelock).toBe(timelock);
        expect(details?.srcReceiver.equals(user.address)).toBe(true);
        expect(details?.senderPubKey).toBe(1n);
        expect(details?.hashlock).toBe(hashlock);
        expect(details?.jettonMasterAddress.equals(jettonMaster.address)).toBe(true);
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(1n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeFalsy();
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(0n);
    });

    it('Lock fails existing Id', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1801);
        const rewardTimelock = BigInt(blockchain.now! + 1700);
        const rewardAmount = 1n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 3n;
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

        await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        const contractsLengthBefore = await trainContract.getGetContractsLength();
        const rewardsLengthBefore = await trainContract.getGetRewardsLength();

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: solverJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeTruthy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeTruthy();
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(0n);
    });

    it('Lock fails msg.amount <= reward', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1801);
        const rewardTimelock = BigInt(blockchain.now! + 1700);
        const rewardAmount = 1n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 1n;
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

        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: solverJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeFalsy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeFalsy();
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(0n);
    });

    it('Lock fails not future timelock', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1800);
        const rewardTimelock = BigInt(blockchain.now! + 1700);
        const rewardAmount = 1n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 3n;
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

        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: solverJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeFalsy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeFalsy();
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(0n);
    });

    it('Lock fails invalid reward timelock', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1801);
        const rewardTimelock = BigInt(blockchain.now! + 1900);
        const rewardAmount = 1n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 3n;
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

        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: solverJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeFalsy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeFalsy();
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(0n);
    });

    it('Lock fails reward timelock not future', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1801);
        const rewardTimelock = BigInt(blockchain.now! - 1900);
        const rewardAmount = 1n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 3n;
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

        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await trainContract.getGetHtlcJettonWalletForMaster(jettonMaster.address)) ?? undefined,
            to: solverJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeFalsy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeFalsy();
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(0n);
    });

    it('Lock fails not jetton wallet sender', async () => {
        const lockId = BigInt(Date.now());
        const timelock = BigInt(blockchain.now! + 1801);
        const rewardTimelock = BigInt(blockchain.now! + 1700);
        const rewardAmount = 1n;
        const hashlock = createHashlockSecretPair().hashlock;

        const lockData: LockData = {
            $$type: 'LockData',
            id: lockId,
            hashlock: hashlock,
            timelock: timelock,
            srcReceiver: user.address,
            srcAsset: srcAsset,
            dstChain: dstChain,
            dstAddress: dstAddress,
            dstAsset: dstAsset,
            reward: rewardAmount,
            rewardTimelock: rewardTimelock,
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
        const amount = 3n;
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

        await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'RemoveJetton',
                jettonMaster: jettonMaster.address,
            },
        );

        const lockTx = await solver.send({
            value: toNano('0.5'),
            to: solverJettonWallet.address,
            sendMode: 1,
            body: body.asCell(),
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await jettonMaster.getWalletAddress(trainContract.address)) ?? undefined,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.TokenNotification,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: (await jettonMaster.getWalletAddress(trainContract.address)) ?? undefined,
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(lockTx.transactions).toHaveTransaction({
            from: (await jettonMaster.getWalletAddress(trainContract.address)) ?? undefined,
            to: solverJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        const details = await trainContract.getGetHtlcDetails(lockId);
        expect(details).toBeFalsy();
        expect((await trainContract.getGetContractsLength()) - contractsLengthBefore).toBe(0n);

        const rewardDetails = await trainContract.getGetRewardDetails(lockId);
        expect(rewardDetails).toBeFalsy();
        expect((await trainContract.getGetRewardsLength()) - rewardsLengthBefore).toBe(0n);
    });

    it('AddLock successful', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster);
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 930);
        const addLockMessage: AddLock = {
            $$type: 'AddLock',
            id: id,
            hashlock: hashlock,
            timelock: timelock,
        };

        const addLockTx = await trainContract.send(user.getSender(), { value: toNano('0.1') }, addLockMessage);

        expect(addLockTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.AddLock,
        });

        expect(addLockTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: user.address,
            success: true,
            op: 0x0,
        });

        const details = await trainContract.getGetHtlcDetails(id);
        expect(details).toBeTruthy();
        expect(details?.hashlock).toBe(hashlock);
        expect(details?.timelock).toBe(timelock);

        console.log('Total Fees for AddLock Msg: ', getTotalFees(addLockTx.transactions) / 10 ** 9, ' TON');
    });

    it('AddLock fails Contract Does Not Exist', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster);
        const id = BigInt(commitTx.commitId + 1n);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 930);
        const addLockMessage: AddLock = {
            $$type: 'AddLock',
            id: id,
            hashlock: hashlock,
            timelock: timelock,
        };

        const addLockTx = await trainContract.send(user.getSender(), { value: toNano('0.1') }, addLockMessage);

        expect(addLockTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.AddLock,
            exitCode: TrainJetton.errors['Contract Does Not Exist'],
        });

        const details = await trainContract.getGetHtlcDetails(commitTx.commitId);
        expect(details).toBeTruthy();
        expect(details?.hashlock).toBe(1n);
    });

    it('AddLock fails No Allowance', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster);
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 930);
        const addLockMessage: AddLock = {
            $$type: 'AddLock',
            id: id,
            hashlock: hashlock,
            timelock: timelock,
        };

        const addLockTx = await trainContract.send(solver.getSender(), { value: toNano('0.1') }, addLockMessage);

        expect(addLockTx.transactions).toHaveTransaction({
            from: solver.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.AddLock,
            exitCode: TrainJetton.errors['No Allowance'],
        });

        const details = await trainContract.getGetHtlcDetails(commitTx.commitId);
        expect(details).toBeTruthy();
        expect(details?.hashlock).toBe(1n);
    });

    it('AddLock fails Hashlock Already Set', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster);
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 930);
        const addLockMessage: AddLock = {
            $$type: 'AddLock',
            id: id,
            hashlock: hashlock,
            timelock: timelock,
        };

        await trainContract.send(user.getSender(), { value: toNano('0.1') }, addLockMessage);

        const addLockTx = await trainContract.send(user.getSender(), { value: toNano('0.1') }, addLockMessage);

        expect(addLockTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.AddLock,
            exitCode: TrainJetton.errors['Hashlock Already Set'],
        });
    });

    it('AddLock fails Not Future Timelock', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster);
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 890);
        const addLockMessage: AddLock = {
            $$type: 'AddLock',
            id: id,
            hashlock: hashlock,
            timelock: timelock,
        };

        const addLockTx = await trainContract.send(user.getSender(), { value: toNano('0.1') }, addLockMessage);

        expect(addLockTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.AddLock,
            exitCode: TrainJetton.errors['Not Future Timelock'],
        });
    });

    it('AddLockSig successful', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster, {
            senderPubKey,
        });
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 930);
        const dataCell: Cell = beginCell().storeInt(id, 257).storeInt(hashlock, 257).storeInt(timelock, 257).endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solver.getSender(),
            { value: toNano('0.1'), bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solver.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.AddLockSig,
        });

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: solver.address,
            success: true,
            op: 0x0,
        });

        const details = await trainContract.getGetHtlcDetails(id);
        expect(details).toBeTruthy();
        expect(details?.hashlock).toBe(hashlock);
        expect(details?.timelock).toBe(timelock);

        console.log('Total Fees for AddLockSig Msg: ', getTotalFees(addLocSigTx.transactions) / 10 ** 9, ' TON');
    });

    it('AddLockSig fails Contract Does Not Exist', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster, {
            senderPubKey,
        });
        const id = BigInt(commitTx.commitId + 1n);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 930);
        const dataCell: Cell = beginCell().storeInt(id, 257).storeInt(hashlock, 257).storeInt(timelock, 257).endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solver.getSender(),
            { value: toNano('0.1'), bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solver.address,
            to: trainContract.address,
            success: false,
            exitCode: TrainJetton.errors['Contract Does Not Exist'],
            op: TrainJetton.opcodes.AddLockSig,
        });
    });

    it('AddLockSig fails Invalid Signature', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster, {
            senderPubKey,
        });
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 930);
        const dataCell: Cell = beginCell().storeInt(id, 257).storeInt(hashlock, 257).storeInt(timelock, 257).endCell();

        const signatureBuffer = sign(dataCell.hash(), keyPairFromSeed(await getSecureRandomBytes(32)).secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solver.getSender(),
            { value: toNano('0.1'), bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solver.address,
            to: trainContract.address,
            success: false,
            exitCode: TrainJetton.errors['Invalid Signature'],
            op: TrainJetton.opcodes.AddLockSig,
        });
    });

    it('AddLockSig fails Not Future Timelock', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster, {
            senderPubKey,
        });
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 890);
        const dataCell: Cell = beginCell().storeInt(id, 257).storeInt(hashlock, 257).storeInt(timelock, 257).endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        const addLocSigTx = await trainContract.send(
            solver.getSender(),
            { value: toNano('0.1'), bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );
        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solver.address,
            to: trainContract.address,
            success: false,
            exitCode: TrainJetton.errors['Not Future Timelock'],
            op: TrainJetton.opcodes.AddLockSig,
        });
    });

    it('AddLockSig fails Hashlock Already Set', async () => {
        const commitTx = await commitJetton(blockchain, trainContract, user, solver, userJettonWallet, jettonMaster, {
            senderPubKey,
        });
        const id = BigInt(commitTx.commitId);
        const hashlock = BigInt(createHashlockSecretPair().hashlock);
        const timelock = BigInt(Math.floor(Date.now() / 1000) + 901);
        const dataCell: Cell = beginCell().storeInt(id, 257).storeInt(hashlock, 257).storeInt(timelock, 257).endCell();

        const signatureBuffer = sign(dataCell.hash(), kp.secretKey);
        const signatureCell = beginCell().storeBuffer(signatureBuffer).endCell();

        await trainContract.send(
            solver.getSender(),
            { value: toNano('0.1'), bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        const addLocSigTx = await trainContract.send(
            solver.getSender(),
            { value: toNano('0.1'), bounce: true },
            {
                $$type: 'AddLockSig',
                data: dataCell.beginParse(),
                signature: signatureCell.beginParse(),
            },
        );

        expect(addLocSigTx.transactions).toHaveTransaction({
            from: solver.address,
            to: trainContract.address,
            success: false,
            exitCode: TrainJetton.errors['Hashlock Already Set'],
            op: TrainJetton.opcodes.AddLockSig,
        });
    });

    it('Refund successful', async () => {
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster);
        blockchain.now = Number(lockTx.timelock + 1n);
        const contractsBefore = await trainContract.getGetContractsLength();
        const rewardsLength = await trainContract.getGetRewardsLength();
        const refundTx = await trainContract.send(
            user.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Refund',
                id: lockTx.lockId,
            },
        );

        expect(refundTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: await jettonMaster.getWalletAddress(trainContract.address),
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(contractsBefore - (await trainContract.getGetContractsLength())).toBe(1n);
        expect(rewardsLength - (await trainContract.getGetRewardsLength())).toBe(1n);
        expect(await trainContract.getGetHtlcDetails(lockTx.lockId)).toBeFalsy();
        expect(await trainContract.getGetRewardDetails(lockTx.lockId)).toBeFalsy();
        console.log('Total Fees for Refund Msg: ', getTotalFees(refundTx.transactions) / 10 ** 9, ' TON');
    });

    it('Refund fails Contract Does Not Exist', async () => {
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster);
        blockchain.now = Number(lockTx.timelock + 10n);
        const contractsBefore = await trainContract.getGetContractsLength();
        const rewardsLength = await trainContract.getGetRewardsLength();
        const refundTx = await trainContract.send(
            user.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Refund',
                id: lockTx.lockId + 1n,
            },
        );

        expect(refundTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.Refund,
            exitCode: TrainJetton.errors['Contract Does Not Exist'],
        });

        expect(contractsBefore - (await trainContract.getGetContractsLength())).toBe(0n);
        expect(rewardsLength - (await trainContract.getGetRewardsLength())).toBe(0n);
        expect(await trainContract.getGetHtlcDetails(lockTx.lockId)).toBeTruthy();
        expect(await trainContract.getGetRewardDetails(lockTx.lockId)).toBeTruthy();
    });

    it('Refund fails Not Passed Timelock', async () => {
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster);
        const contractsBefore = await trainContract.getGetContractsLength();
        const rewardsLength = await trainContract.getGetRewardsLength();
        const refundTx = await trainContract.send(
            user.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Refund',
                id: lockTx.lockId,
            },
        );

        expect(refundTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.Refund,
            exitCode: TrainJetton.errors['Not Passed Timelock'],
        });

        expect(contractsBefore - (await trainContract.getGetContractsLength())).toBe(0n);
        expect(rewardsLength - (await trainContract.getGetRewardsLength())).toBe(0n);
        expect(await trainContract.getGetHtlcDetails(lockTx.lockId)).toBeTruthy();
        expect(await trainContract.getGetRewardDetails(lockTx.lockId)).toBeTruthy();
    });

    it('Redeem fails Contract Does Not Exist', async () => {
        const pair = createHashlockSecretPair();
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster, {
            hashlock: pair.hashlock,
        });

        const redeemTx = await trainContract.send(
            user.getSender(),
            { value: toNano('0.35'), bounce: true },
            {
                $$type: 'Redeem',
                id: lockTx.lockId + 1n,
                secret: pair.secret,
            },
        );

        expect(redeemTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.Redeem,
            exitCode: TrainJetton.errors['Contract Does Not Exist'],
        });
    });

    it('Redeem fails Hashlock Not Match', async () => {
        const pair = createHashlockSecretPair();
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster, {
            hashlock: pair.hashlock,
        });

        const redeemTx = await trainContract.send(
            user.getSender(),
            { value: toNano('0.3'), bounce: true },
            {
                $$type: 'Redeem',
                id: lockTx.lockId,
                secret: pair.secret + 1n,
            },
        );

        expect(redeemTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: false,
            op: TrainJetton.opcodes.Redeem,
            exitCode: TrainJetton.errors['Hashlock Not Match'],
        });
    });

    it('Redeem successful with 0 reward', async () => {
        const pair = createHashlockSecretPair();
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster, {
            amount: 3n,
            hashlock: pair.hashlock,
            rewardAmount: 0n,
        });
        const trainJettonwallet = await jettonMaster.getWallet(trainContract.address);
        const balanceOfTrainBefore = (await trainJettonwallet.getData()).balance;
        const redeemTx = await trainContract.send(
            user.getSender(),
            { value: toNano('0.3'), bounce: true },
            {
                $$type: 'Redeem',
                id: lockTx.lockId,
                secret: pair.secret,
            },
        );

        expect(redeemTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.Redeem,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: await jettonMaster.getWalletAddress(trainContract.address),
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: await jettonMaster.getWalletAddress(trainContract.address),
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect(
            redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === TrainJetton.opcodes.TokenRedeemed),
        ).toBe(true);

        expect(await trainContract.getGetHtlcDetails(lockTx.lockId)).toBeFalsy();
        expect(balanceOfTrainBefore - (await trainJettonwallet.getData()).balance).toBe(3n);
    });

    it('Redeem successful with reward.timelock > now()', async () => {
        const pair = createHashlockSecretPair();
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster, {
            amount: 3n,
            hashlock: pair.hashlock,
            rewardAmount: 1n,
            rewardTimelockOffset: 1700,
        });
        const trainJettonwallet = await jettonMaster.getWallet(trainContract.address);
        const balanceOfTrainBefore = (await trainJettonwallet.getData()).balance;
        const balanceOfUserBefore = (await userJettonWallet.getData()).balance;
        const balanceOfSolverBefore = (await solverJettonWallet.getData()).balance;
        const redeemTx = await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.3'), bounce: true },
            {
                $$type: 'Redeem',
                id: lockTx.lockId,
                secret: pair.secret,
            },
        );
        expect(redeemTx.transactions).toHaveTransaction({
            from: deployer.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.Redeem,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: await jettonMaster.getWalletAddress(trainContract.address),
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: await jettonMaster.getWalletAddress(trainContract.address),
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: await jettonMaster.getWalletAddress(trainContract.address),
            to: solverJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect(
            redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === TrainJetton.opcodes.TokenRedeemed),
        ).toBe(true);

        expect(await trainContract.getGetHtlcDetails(lockTx.lockId)).toBeFalsy();
        expect(await trainContract.getGetRewardDetails(lockTx.lockId)).toBeFalsy();
        expect(balanceOfTrainBefore - (await trainJettonwallet.getData()).balance).toBe(3n);
        expect((await userJettonWallet.getData()).balance - balanceOfUserBefore).toBe(2n);
        expect((await solverJettonWallet.getData()).balance - balanceOfSolverBefore).toBe(1n);
    });

    it('Redeem successful with reward.timelock <= now() & ctx.sender == htlc.srcReceiver', async () => {
        const pair = createHashlockSecretPair();
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster, {
            amount: 3n,
            hashlock: pair.hashlock,
            rewardAmount: 1n,
            rewardTimelockOffset: 1200,
        });
        const rewardDetails = await trainContract.getGetRewardDetails(lockTx.lockId);
        expect(rewardDetails).toBeTruthy();
        const trainJettonwallet = await jettonMaster.getWallet(trainContract.address);
        const balanceOfTrainBefore = (await trainJettonwallet.getData()).balance;
        const balanceOfUserBefore = (await userJettonWallet.getData()).balance;
        const balanceOfSolverBefore = (await solverJettonWallet.getData()).balance;
        blockchain.now = Number((rewardDetails?.timelock ?? 0n) + 10n);
        const redeemTx = await trainContract.send(
            user.getSender(),
            { value: toNano('0.3'), bounce: true },
            {
                $$type: 'Redeem',
                id: lockTx.lockId,
                secret: pair.secret,
            },
        );
        expect(redeemTx.transactions).toHaveTransaction({
            from: user.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.Redeem,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: await jettonMaster.getWalletAddress(trainContract.address),
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: await jettonMaster.getWalletAddress(trainContract.address),
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect(
            redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === TrainJetton.opcodes.TokenRedeemed),
        ).toBe(true);

        expect(await trainContract.getGetHtlcDetails(lockTx.lockId)).toBeFalsy();
        expect(await trainContract.getGetRewardDetails(lockTx.lockId)).toBeFalsy();
        expect(balanceOfTrainBefore - (await trainJettonwallet.getData()).balance).toBe(3n);
        expect((await userJettonWallet.getData()).balance - balanceOfUserBefore).toBe(3n);
        expect((await solverJettonWallet.getData()).balance - balanceOfSolverBefore).toBe(0n);
    });

    it('Redeem successful with reward.timelock <= now() & ctx.sender != htlc.srcReceiver', async () => {
        const pair = createHashlockSecretPair();
        const lockTx = await lockJetton(blockchain, trainContract, user, solver, solverJettonWallet, jettonMaster, {
            amount: 3n,
            hashlock: pair.hashlock,
            rewardAmount: 1n,
            rewardTimelockOffset: 1700,
        });
        const rewardDetails = await trainContract.getGetRewardDetails(lockTx.lockId);
        expect(rewardDetails).toBeTruthy();
        const trainJettonwallet = await jettonMaster.getWallet(trainContract.address);
        const balanceOfTrainBefore = (await trainJettonwallet.getData()).balance;
        const balanceOfUserBefore = (await userJettonWallet.getData()).balance;
        const balanceOfSolverBefore = (await solverJettonWallet.getData()).balance;
        const balanceOfDeployerBefore = (await deployerJettonWallet.getData()).balance;
        blockchain.now = Number((rewardDetails?.timelock ?? 0n) + 10n);
        const redeemTx = await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.3'), bounce: true },
            {
                $$type: 'Redeem',
                id: lockTx.lockId,
                secret: pair.secret,
            },
        );
        expect(redeemTx.transactions).toHaveTransaction({
            from: deployer.address,
            to: trainContract.address,
            success: true,
            op: TrainJetton.opcodes.Redeem,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: await jettonMaster.getWalletAddress(trainContract.address),
            success: true,
            op: TrainJetton.opcodes.TokenTransfer,
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: await jettonMaster.getWalletAddress(trainContract.address),
            to: userJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect(redeemTx.transactions).toHaveTransaction({
            from: await jettonMaster.getWalletAddress(trainContract.address),
            to: deployerJettonWallet.address,
            success: true,
            op: 0x178d4519, // internal transfer
        });

        expect(
            redeemTx.externals.some((x) => x.body.beginParse().loadUint(32) === TrainJetton.opcodes.TokenRedeemed),
        ).toBe(true);

        expect(await trainContract.getGetHtlcDetails(lockTx.lockId)).toBeFalsy();
        expect(await trainContract.getGetRewardDetails(lockTx.lockId)).toBeFalsy();
        expect(balanceOfTrainBefore - (await trainJettonwallet.getData()).balance).toBe(3n);
        expect((await userJettonWallet.getData()).balance - balanceOfUserBefore).toBe(2n);
        expect((await solverJettonWallet.getData()).balance - balanceOfSolverBefore).toBe(0n);
        expect((await deployerJettonWallet.getData()).balance - balanceOfDeployerBefore).toBe(1n);
        console.log('Total Fees for Redeem Msg: ', getTotalFees(redeemTx.transactions) / 10 ** 9, ' TON');
    });

    it('returns funds when msg is empty', async () => {
        const tx = await trainContract.send(
            deployer.getSender(),
            { value: toNano('0.5'), bounce: true },
            beginCell().endCell().asSlice(),
        );

        expect(tx.transactions).toHaveTransaction({
            from: trainContract.address,
            to: deployer.address,
            success: true,
            op: 0x0,
        });
    });
});
