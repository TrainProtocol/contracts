
import {
    RpcProvider, Contract, shortString, WeierstrassSignatureType,
    Account, Signature, TypedDataRevision, TypedData,
} from "starknet";
import fs from 'fs';

import ETHTokenAbi from "./eth_token_abi.json";

/// Local katana provider
const provider = new RpcProvider({ nodeUrl: 'http://127.0.0.1:5050' })
async function checkKatana() {
    try {
        const chainId = await provider.getChainId();
        console.log(`✅ Connected to Katana: Chain ID ${chainId}`);
    } catch (error) {
        console.error('❌ Cannot connect to Katana:', error);
        process.exit(1);
    }
}

checkKatana();
const local_privateKey = '0x3e3979c1ed728490308054fe357a9f49cf67f80f9721f44cc57235129e090f4';
// const local_publicKey = ec.starkCurve.getStarkKey(local_privateKey);
const local_address = '0x6677fe62ee39c7b07401f754138502bab7fac99d2d3c5d37df7d1c6fab10819';
const account = new Account(provider, local_address, local_privateKey);
const tokenContract = '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
/// Run this to get the ABI of the ETH Token
// const compressedContract = await provider.getClassAt(tokenContract);
// fs.writeFileSync('./eth_token_abi.json', json.stringify(compressedContract.abi, undefined, 2));
const token = new Contract(ETHTokenAbi, tokenContract, provider);
token.connect(account);

const other_privateKey = '0x736adbbcdac7cc600f89051db1abbc16b9996b46f6b58a9752a11c1028a8ec8';
const other_address = '0x4e0b838810cb1a355beb7b3d894ca0e98ee524309c3f8b7cccb15a48e6270e2';
const other_account = new Account(provider, other_address, other_privateKey);

let htlc_contract: Contract;


/// Function for creating PreHTLC.
async function createPreHTLC(Id: any, amount: any, timelock: any) {
    // There is no reason to change this parameters for tests
    const srcReceiver = '0x017b97bbd7a109e5a2caab0cac99d3a775f60f54fa8c61244bae501b3564278a';
    const src_asset = shortString.encodeShortString('ETH');
    const dst_chain = shortString.encodeShortString('ETHEREUM');
    const dst_address = shortString.encodeShortString('0x1');
    const dst_asset = shortString.encodeShortString('ETH');

    const allowanceTx = token.populate('increaseAllowance', [htlc_contract.address, amount]);
    const commitTx = htlc_contract.populate('commit', [
        Id,
        amount,
        dst_chain,
        dst_asset,
        dst_address,
        src_asset,
        srcReceiver,
        timelock,
        token.address
    ]);

    const calls = [allowanceTx, commitTx];

    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(calls);
    const tx = await account.execute(calls, undefined, { maxFee });
}

async function createPreHTLC_with_alowance(Id: any, amount: any, timelock: any, allowance: any) {
    // There is no reason to change this parameters for tests
    const srcReceiver = '0x017b97bbd7a109e5a2caab0cac99d3a775f60f54fa8c61244bae501b3564278a';
    const src_asset = shortString.encodeShortString('ETH');
    const dst_chain = shortString.encodeShortString('ETHEREUM');
    const dst_address = shortString.encodeShortString('0x1');
    const dst_asset = shortString.encodeShortString('ETH');

    const allowanceTx = token.populate('increaseAllowance', [htlc_contract.address, allowance]);
    const commitTx = htlc_contract.populate('commit', [
        Id,
        amount,
        dst_chain,
        dst_asset,
        dst_address,
        src_asset,
        srcReceiver,
        timelock,
        token.address
    ]);

    const calls = [allowanceTx, commitTx];

    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(calls);
    const tx = await account.execute(calls, undefined, { maxFee });
}

/// Function for creating HTLC.
async function createHTLC(Id: any, rewardTimelock: any, timelock: any, amount: any) {
    // There is no reason to change this parameters for tests
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };
    const srcReceiver = '0x017b97bbd7a109e5a2caab0cac99d3a775f60f54fa8c61244bae501b3564278a';
    const allowance = { low: 1101, high: 0 };
    const reward = { low: 100, high: 0 };
    const src_asset = shortString.encodeShortString('ETH');
    const dst_chain = shortString.encodeShortString('ETHEREUM');
    const dst_address = shortString.encodeShortString('0x1');
    const dst_asset = shortString.encodeShortString('ETH');

    const allowanceTx = token.populate('increaseAllowance', [htlc_contract.address, allowance]);
    const lockTx = htlc_contract.populate('lock', [
        Id,
        hashlock,
        reward,
        rewardTimelock,
        timelock,
        srcReceiver,
        src_asset,
        dst_chain,
        dst_address,
        dst_asset,
        amount,
        token.address
    ]);

    const calls = [allowanceTx, lockTx];

    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(calls);
    const tx = await account.execute(calls, undefined, { maxFee });
}

async function createHTLC_with_allowance(Id: any, rewardTimelock: any, timelock: any, amount: any, allowance: any) {
    // There is no reason to change this parameters for tests
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };
    const srcReceiver = '0x017b97bbd7a109e5a2caab0cac99d3a775f60f54fa8c61244bae501b3564278a';
    const reward = { low: 100, high: 0 };
    const src_asset = shortString.encodeShortString('ETH');
    const dst_chain = shortString.encodeShortString('ETHEREUM');
    const dst_address = shortString.encodeShortString('0x1');
    const dst_asset = shortString.encodeShortString('ETH');

    const allowanceTx = token.populate('increaseAllowance', [htlc_contract.address, allowance]);
    const lockTx = htlc_contract.populate('lock', [
        Id,
        hashlock,
        reward,
        rewardTimelock,
        timelock,
        srcReceiver,
        src_asset,
        dst_chain,
        dst_address,
        dst_asset,
        amount,
        token.address
    ]);

    const calls = [allowanceTx, lockTx];

    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(calls);
    const tx = await account.execute(calls, undefined, { maxFee });
}

/// Function for signing add_lock data.
async function signHTLC(htlc_signer: any, Id: any, hashlock: any, timelock: any): Promise<any> {
    const lockMessage: TypedData = {
        domain: {
            name: 'Train',
            version: shortString.encodeShortString("v1"),
            chainId: '0x4b4154414e41', // katana
            revision: TypedDataRevision.ACTIVE,
        },
        message: {
            Id: Id,
            hashlock: hashlock,
            timelock: timelock,
        },
        primaryType: 'AddLockMsg',
        types: {
            StarknetDomain: [
                {
                    name: 'name',
                    type: 'shortstring',
                },
                {
                    name: 'version',
                    type: 'shortstring',
                },
                {
                    name: 'chainId',
                    type: 'shortstring',
                },
                {
                    name: 'revision',
                    type: 'shortstring'
                }
            ],
            AddLockMsg: [
                { name: 'Id', type: 'u256' },
                { name: 'hashlock', type: 'u256' },
                { name: 'timelock', type: 'u256' }
            ],
            u256: [
                { name: 'low', type: 'felt' },
                { name: 'high', type: 'felt' }
            ],
        }
    }

    const signature = (await htlc_signer.signMessage(lockMessage) as WeierstrassSignatureType);
    return signature;
}


function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


/// Tests with not existing HTLCs.
/// There is no (Pre)HTLC with this ID.

/// Can't redeem if the (Pre)HTLC with the given Id does not exist.
async function T0_1() {
    const Id = { low: `0x12345`, high: `0x00` };
    const secret = { low: `0x0909d9466347bfe7f3019809cf90e541`, high: `0x00` };
    const redeemTx = htlc_contract.populate('redeem', [Id, secret]);

    await account.estimateInvokeFee([redeemTx]).catch(e => console.log(e));
    // const tx = await account.execute(calls, undefined, { maxFee }).catch(e => console.log(e));
}

/// Can't refund if the (Pre)HTLC with the given Id does not exist.
async function T0_2() {
    const Id = { low: `0x12345`, high: `0x00` };
    const refundTx = htlc_contract.populate('refund', [Id]);

    await account.estimateInvokeFee([refundTx]).catch(e => console.log(e));
}

/// Can't add lock if the (Pre)HTLC with the given Id does not exist.
async function T0_3() {
    const Id = { low: `0x12345`, high: `0x00` };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const addLockTx = htlc_contract.populate('addLock', [Id, hashlock, timelock]);

    await account.estimateInvokeFee([addLockTx]).catch(e => console.log(e));
}

/// Can't add lock sig if the (Pre)HTLC with the given Id does not exist.
async function T0_4() {
    const Id = { low: `0x12345`, high: `0x00` };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const signature = await signHTLC(account, Id, hashlock, timelock);
    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);

    await account.estimateInvokeFee([addLockSignTx]).catch(e => console.log(e));
}

async function T0() {
    await T0_1();
    await T0_2();
    await T0_3();
    await T0_4();
    console.log('T0 passed ✅ ');
}


/// Tests for redeeming HTLC.

/// Can redeem with the correct secret.
async function T1_1() {

    const Id = { low: `0x11`, high: `0x1000441` };
    const amount = { low: 1000, high: 0 };
    const secret = { low: `0x0909d9466347bfe7f3019809cf90e541`, high: `0x00` };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };

    await createHTLC(Id, rewardTimelock, timelock, amount);

    await wait(20000);
    const htlcDetails = await htlc_contract.getHTLCDetails(Id);
    console.log(`the details`, htlcDetails);
    const redeemTx = await htlc_contract.redeem(Id, secret);
    await provider.waitForTransaction(redeemTx.transaction_hash);
}

/// Can't redeem with wrong secret.
async function T1_2() {

    const Id = { low: `0x1`, high: `0x10004402` };
    const amount = { low: 1000, high: 0 };
    //this is not the right secret
    const wrong_secret = { low: `0x0909d9466347bfe7f3019809cf90e541`, high: `0x01` };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };

    await createHTLC(Id, rewardTimelock, timelock, amount);
    await wait(20000);

    const redeemTx = htlc_contract.populate('redeem', [Id, wrong_secret]);

    await account.estimateInvokeFee([redeemTx]).catch(e => console.log(e));
}
async function T1() {
    await T1_1();
    await T1_2();
    console.log('T1 passed ✅ ');
}

/// Tests for already redeemed HTLCs.

/// Can't redeem if already redeemed.
async function T2_1(Id: any, secret: any) {
    const redeemTx = htlc_contract.populate('redeem', [Id, secret]);
    await account.estimateInvokeFee([redeemTx]).catch(e => console.log(e));
}

/// Can't refund if already redeemed.
async function T2_2(Id: any) {

    const refundTx = htlc_contract.populate('refund', [Id]);

    await account.estimateInvokeFee([refundTx]).catch(e => console.log(e));
}

/// Can't add lock if already redeemed.
async function T2_3(Id: any, hashlock: any, timelock: any) {
    const addLockTx = htlc_contract.populate('addLock', [Id, hashlock, timelock]);
    await account.estimateInvokeFee([addLockTx]).catch(e => console.log(e));
}

/// Can't add lock sig if already redeemed.
async function T2_4(Id: any, hashlock: any, timelock: any, signature: any) {
    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);
    await account.estimateInvokeFee([addLockSignTx]).catch(e => console.log(e));
}

async function T2() {
    const Id = { low: `0x2`, high: `0x0110` };
    const amount = { low: 1000, high: 0 };
    const secret = { low: `0x0909d9466347bfe7f3019809cf90e541`, high: `0x00` };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };
    const signature: Signature = await signHTLC(account, Id, hashlock, timelock);

    await createHTLC(Id, rewardTimelock, timelock, amount);
    await wait(20000);
    const htlcDetails = await htlc_contract.getHTLCDetails(Id);
    console.log(`the details`, htlcDetails);

    const redeemTx = await htlc_contract.redeem(Id, secret);
    await provider.waitForTransaction(redeemTx.transaction_hash);
    await wait(20000);

    await T2_1(Id, secret);
    await T2_2(Id);
    await T2_3(Id, hashlock, timelock);
    await T2_4(Id, hashlock, timelock, signature);
    console.log('T2 passed ✅ ');
}


/// Tests for refunding HTLC.

// TODO: add 30 minutes wait.
/// Can refund if the timelock passed.
async function T3_1() {

    const Id = { low: `0x31`, high: `0x31` };
    const amount = { low: 1000, high: 0 };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };

    await createHTLC(Id, rewardTimelock, timelock, amount);
    // The contract forces at least 15 minute tinelock 
    // so there should be a very long wait function.
    const refundTx = await htlc_contract.refund(Id);
    await provider.waitForTransaction(refundTx.transaction_hash);
}

/// Can't refund if timelock did not pass.
async function T3_2() {

    const Id = { low: `0x32`, high: `0x00012` };
    const amount = { low: 1000, high: 0 };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };

    await createHTLC(Id, rewardTimelock, timelock, amount);
    await wait(20000);

    const refundTx = htlc_contract.populate('refund', [Id]);

    await account.estimateInvokeFee([refundTx]).catch(e => console.log(e));
}

async function T3() {
    await T3_1();
    await T3_2();
    console.log('T3 passed ✅ ');
}


/// Tests for already refunded HTLCs.
/// Uses the same test from T2.

async function T4() {
    const Id = { low: `0x4`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const secret = { low: `0x0909d9466347bfe7f3019809cf90e541`, high: `0x00` };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };
    const signature: Signature = await signHTLC(account, Id, hashlock, timelock);

    await createHTLC(Id, rewardTimelock, timelock, amount);
    // The contract forces at least 15 minute tinelock 
    // so there should be a very long wait function.
    const refundTx = await htlc_contract.refund(Id);
    await provider.waitForTransaction(refundTx.transaction_hash);
    await wait(20000);

    await T2_1(Id, secret);
    await T2_2(Id);
    await T2_3(Id, hashlock, timelock);
    await T2_4(Id, hashlock, timelock, signature);
    console.log('T4 passed ✅ ');
}


/// Tests for already created (Pre)HTLCs

/// Can't create PreHTLC with already existing ID.
//TODO: should we add check for preHTLC + HTLC??
async function T5_1() {

    const Id = { low: `0x51`, high: `0x15` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const amount = { low: 1000, high: 0 };

    await createPreHTLC(Id, amount, timelock);
    await wait(20000);
    await createPreHTLC(Id, amount, timelock).catch(e => console.log(e));
}

/// Can't create HTLC with already existing ID.
//TODO: should we add check for HTLC + PreHTLC??
async function T5_2() {

    const Id = { low: `0x52`, high: `0x25` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const amount = { low: 1000, high: 0 };
    await createHTLC(Id, rewardTimelock, timelock, amount);
    await wait(20000);
    await createHTLC(Id, rewardTimelock, timelock, amount).catch(e => console.log(e));
}

async function T5() {
    await T5_1();
    await T5_2();
    console.log('T5 passed ✅ ');
}


/// Tests for not positive amount (Pre)HTLCs.

/// Can't create PreHTLC with not positive amount.
async function T6_1() {

    const Id = { low: `0x61`, high: `0x16` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    // amount is set to zero
    const amount = { low: 0, high: 0 };
    await createPreHTLC(Id, amount, timelock).catch(e => console.log(e));
}

/// Can't create HTLC with not positive amount.
async function T6_2() {

    const Id = { low: `0x62`, high: `0x26` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    // amount is set to zero
    const amount = { low: 0, high: 0 };
    await createHTLC(Id, rewardTimelock, timelock, amount).catch(e => console.log(e));
}

async function T6() {
    await T6_1();
    await T6_2();
    console.log('T6 passed ✅ ');
}


/// Tests for (Pre)HTLCs without enough balance.

/// Can't create PreHTLC without enough balance.
async function T7_1() {

    const Id = { low: `0x71`, high: `0x00` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    // account does not have this much balance
    const amount = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x064a62282e241f27696c475a0fbece39` };
    await createPreHTLC(Id, amount, timelock).catch(e => console.log(e));
}

/// Can't create HTLC without enough balance.
async function T7_2() {

    const Id = { low: `0x72`, high: `0x00` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    // account does not this much balance 
    const amount = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x064a62282e241f27696c475a0fbece39` };

    await createHTLC(Id, rewardTimelock, timelock, amount).catch(e => console.log(e));

}

async function T7() {
    await T7_1();
    await T7_2();
    console.log('T7 passed ✅ ');
}


/// Tests for (Pre)HTLCs without enough allowance.

/// Can't create PreHTLC without enough allowance.
async function T8_1() {

    const Id = { low: `0x81`, high: `0x18` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const allowance = { low: 1, high: 0 };
    const amount = { low: 1000, high: 0 };

    await createPreHTLC_with_alowance(Id, amount, timelock, allowance).catch(e => console.log(e));
}

/// Can't create HTLC without enough allownace.
async function T8_2() {

    const Id = { low: `0x82`, high: `0x28` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const allowance = { low: 1, high: 0 };
    const amount = { low: 1000, high: 0 };

    await createHTLC_with_allowance(Id, rewardTimelock, timelock, amount, allowance).catch(e => console.log(e));
}

async function T8() {
    await T8_1();
    await T8_2();
    console.log('T8 passed ✅ ');
}


/// Tests for (Pre)HTLCs with wrong timelocks.

/// Can't create PreHTLC with wrong timelock.
async function T9_1() {

    const Id = { low: `0x91`, high: `0x19` };
    // not future timelock
    const timelock = { low: Math.floor(Date.now() / 1000) - 1000, high: 0 };
    const amount = { low: 1000, high: 0 };

    await createPreHTLC(Id, amount, timelock).catch(e => console.log(e));
}

/// Can't create HTLC with wrong timelock.
async function T9_2() {

    const Id = { low: `0x92`, high: `0x29` };
    // not future timelock
    const timelock = { low: Math.floor(Date.now() / 1000) - 1000, high: 0 };
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 500, high: 0 };
    const amount = { low: 1000, high: 0 };

    await createHTLC(Id, rewardTimelock, timelock, amount).catch(e => console.log(e));
}

async function T9() {
    await T9_1();
    await T9_2();
    console.log('T9 passed ✅ ');
}


/// Tests for HTLCs with wrong reward timelocks.

/// Can't create HTLC with not future reward timelock.
async function T10_1() {

    const Id = { low: `0x101`, high: `0x101` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    // not future reward timelock
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) - 500, high: 0 };
    const amount = { low: 1000, high: 0 };

    await createHTLC(Id, rewardTimelock, timelock, amount).catch(e => console.log(e));
}

/// Can't create HTLC with bigger reward timelock.
async function T10_2() {

    const Id = { low: `0x102`, high: `0x201` };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    // Reward timelock is bigger than HTLC timelock
    const rewardTimelock = { low: Math.floor(Date.now() / 1000) + 1500, high: 0 };
    const amount = { low: 1000, high: 0 };

    await createHTLC(Id, rewardTimelock, timelock, amount).catch(e => console.log(e));
}

async function T10() {
    await T10_1();
    await T10_2();
    console.log('T10 passed ✅ ');
}


/// Tests for add Lock function.

/// Sender can add lock to PreHTLC.
async function T11_1() {
    const Id = { low: `0x111`, high: `0x01` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);

    const addLockTx = htlc_contract.populate('addLock', [Id, hashlock, timelock]);
    const call = [addLockTx]
    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(call);
    const tx = await account.execute(call, undefined, { maxFee });
}

/// Other users can't add lock to PreHTLC.
async function T11_2() {
    const Id = { low: `0x112`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);

    const addLockTx = htlc_contract.populate('addLock', [Id, hashlock, timelock]);
    const call = [addLockTx]
    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(call);
    // calling with other account
    const tx = await other_account.execute(call, undefined, { maxFee }).catch(e => console.log(e));
}

/// Can't add lock if hashlock is already set.
async function T11_3() {
    const Id = { low: `0x113`, high: `0x311` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);

    const addLockTx1 = htlc_contract.populate('addLock', [Id, hashlock, timelock]);
    const call1 = [addLockTx1]
    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(call1);
    const tx1 = await account.execute(call1, undefined, { maxFee });
    await wait(20000);
    const addLockTx2 = htlc_contract.populate('addLock', [Id, hashlock, timelock]);
    const call2 = [addLockTx2]
    const tx2 = await account.execute(call2, undefined, { maxFee }).catch(e => console.log(e));
}

/// Can't add lock with wrong timelock.
async function T11_4() {
    const Id = { low: `0x114`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);
    // not future timelock
    const wrong_timelock = { low: Math.floor(Date.now() / 1000) - 1000, high: 0 };
    const addLockTx = htlc_contract.populate('addLock', [Id, hashlock, wrong_timelock]);
    const call = [addLockTx]
    await account.estimateInvokeFee(call).catch(e => console.log(e));
}

async function T11() {
    await T11_1();
    await T11_2();
    await T11_3();
    await T11_4();
    console.log('T11 passed ✅ ');
}


/// Tests for add Lock signature function.

/// Can add lock with correct signature.
async function T12_1() {
    const Id = { low: `0x121`, high: `0x0231` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);
    const signature = await signHTLC(account, Id, hashlock, timelock);

    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);
    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee([addLockSignTx]);
    const tx = await account.execute([addLockSignTx], undefined, { maxFee });
}


/// Can't add lock signature if hashlock is already set.
async function T12_2() {
    const Id = { low: `0x122`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);

    const addLockTx1 = htlc_contract.populate('addLock', [Id, hashlock, timelock]);
    const call1 = [addLockTx1]
    const { suggestedMaxFee: maxFee } = await account.estimateInvokeFee(call1);
    const tx1 = await account.execute(call1, undefined, { maxFee });
    await wait(20000);

    const signature = await signHTLC(account, Id, hashlock, timelock);
    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);
    const tx2 = await account.execute([addLockSignTx], undefined, { maxFee }).catch(e => console.log(e));
}

/// Can't add lock signature with wrong timelock.
async function T12_3() {
    const Id = { low: `0x123`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);
    //not future timelock
    const wrong_timelock = { low: Math.floor(Date.now() / 1000) - 1000, high: 0 };

    const signature = await signHTLC(account, Id, hashlock, wrong_timelock);
    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, wrong_timelock, [signature.r, signature.s]]);
    await account.estimateInvokeFee([addLockSignTx]).catch(e => console.log(e));
}

/// Can't add lock signature if signed with different ID.
async function T12_4() {
    const Id = { low: `0x124`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);
    // differnt Id
    const dif_Id = { low: `0x124`, high: `0x01` };
    const signature = await signHTLC(account, dif_Id, hashlock, timelock);
    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);
    await account.estimateInvokeFee([addLockSignTx]).catch(e => console.log(e));
}

/// Can't add lock signature if signed with different hashlock.
async function T12_5() {
    const Id = { low: `0x125`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);
    // differnt hashlock
    const dif_hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x00` };

    const signature = await signHTLC(account, Id, dif_hashlock, timelock);
    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);
    await account.estimateInvokeFee([addLockSignTx]).catch(e => console.log(e));
}

/// Can't add lock signature if signed with different timelock.
async function T12_6() {
    const Id = { low: `0x126`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);
    // differnt timelock
    const dif_timelock = { low: Math.floor(Date.now() / 1000) + 900, high: 0 };

    const signature = await signHTLC(account, Id, hashlock, dif_timelock);
    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);
    await account.estimateInvokeFee([addLockSignTx]).catch(e => console.log(e));
}

/// Can't add lock signature if signed by other user.
async function T12_7() {
    const Id = { low: `0x127`, high: `0x00` };
    const amount = { low: 1000, high: 0 };
    const timelock = { low: Math.floor(Date.now() / 1000) + 1000, high: 0 };
    const hashlock = { low: `0x064a62282e241f27696c475a0fbece39`, high: `0x0eaa55cd755940d5fd1466fcbd515999` };

    createPreHTLC(Id, amount, timelock)
    await wait(20000);

    const signature = await signHTLC(other_account, Id, hashlock, timelock);

    const addLockSignTx = htlc_contract.populate('addLockSig', [Id, hashlock, timelock, [signature.r, signature.s]]);
    await account.estimateInvokeFee([addLockSignTx]).catch(e => console.log(e));
}

async function T12() {
    await T12_1();
    await T12_2();
    await T12_3();
    await T12_4();
    await T12_5();
    await T12_6();
    await T12_7();
    console.log('T12 passed ✅ ');
}


async function main() {

    const sierraHTLC = JSON.parse(
        fs.readFileSync("./htlc_compiled.sierra.json").toString("ascii")
    );
    const casmHTLC = JSON.parse(
        fs.readFileSync("./htlc_compiled.casm.json").toString("ascii")
    );
    // Declare and deploy the HTLC contract on the localnet
    const deployResponse = await account.declareAndDeploy({
        contract: sierraHTLC,
        casm: casmHTLC,
    });
    htlc_contract = new Contract(
        sierraHTLC.abi,
        deployResponse.deploy.contract_address,
        provider
    );
    htlc_contract.connect(account);

    console.log('HTLC Contract Class Hash =', deployResponse.declare.class_hash);
    console.log('✅ HTLC Contract =', htlc_contract.address);


    await T0();
    await T1();
    await T2();
    // await T3();
    // await T4();
    await T5();
    await T6();
    await T7();
    await T8();
    await T9();
    await T10();
    await T11();
    await T12();
}
main()
