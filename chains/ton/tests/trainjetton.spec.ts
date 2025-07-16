import {
    Blockchain,
    prettyLogTransactions,
    printTransactionFees,
    SandboxContract,
    toSandboxContract,
    TreasuryContract,
} from '@ton/sandbox';
import {
    toNano,
    beginCell,
    Builder,
    Dictionary,
    internal,
    Message,
    CommonMessageInfoInternal,
    CurrencyCollection,
} from '@ton/core';
import {
    jettonContentToInternal,
    JettonMinter,
    JettonMinterConfig,
    jettonMinterConfigToCell,
    JettonWallet,
    parseTransferTransaction,
    storeJettonMinterContent,
} from '@ton-community/assets-sdk';
import {
    CommitData,
    TokenTransfer,
    TrainJetton,
    storeCommitData,
    storeTokenTransfer,
} from '../build/jetton_train/tact_TrainJetton';
import '@ton/test-utils';
import { randomAddress } from '@ton/test-utils';
import { createStrMap, getTotalFees } from '../utils/utils';
import { Address } from '@ton/core';
import { compile, createNetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from '../utils/jettonHelpers';

describe('TrainJetton', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let solver: SandboxContract<TreasuryContract>;
    let trainContract: SandboxContract<TrainJetton>;
    let jettonMaster: SandboxContract<JettonMinter>;
    let userJettonWallet: SandboxContract<JettonWallet>;
    let solverJettonWallet: SandboxContract<JettonWallet>;
    let flag = true;

    const dstChain = 'ARBITRUM_SEPOLIA';
    const dstAsset = 'USDC';
    const dstAddress = '0xF6517026847B4c166AAA176fe0C5baD1A245778D';
    const srcAsset = 'TESTJ';
    const senderPubKey = 12345n;
    const hopChains = createStrMap([[0n, { $$type: 'StringImpl', data: 'ARBITRUM_SEPOLIA' }]]);
    const hopAssets = createStrMap([[0n, { $$type: 'StringImpl', data: 'USDC' }]]);
    const hopAddresses = createStrMap([
        [0n, { $$type: 'StringImpl', data: '0xF6517026847B4c166AAA176fe0C5baD1A245778D' }],
    ]);

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = Number(Math.floor(Date.now() / 1000));
        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('user');
        solver = await blockchain.treasury('solver');
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
});
