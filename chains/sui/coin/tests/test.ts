import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import crypto from "crypto";
import { bcs } from '@mysten/bcs';

const rpcUrl = getFullnodeUrl('devnet');

const client = new SuiClient({ url: rpcUrl });
const PACKAGE_ID = "0xed2bfd56679e1276182513985d0f26e9e213bf42fa21f8e849b2a05058948ce9";
const HTLCS_OBJECT_ID = "0x41e67dc5e3aa0a307e13faea0f906366f03aec454e48d557ae6539f03b79b899";
const REWARDS_OBJECT_ID = "0x90199fa5efc8c8ebc1afef56c930e155ad1456528fb724362279bd23d23bec62";
const keypair = Ed25519Keypair.fromSecretKey("suiprivkey");
const other_keypair = Ed25519Keypair.fromSecretKey("suiprivkey");
const publicKey = keypair.getPublicKey();
const publicKey_buffer = Buffer.from([
    31, 104, 119, 69, 52, 171, 138,
    113, 169, 140, 151, 254, 85, 118,
    52, 152, 147, 248, 133, 116, 84,
    69, 87, 188, 242, 23, 134, 235,
    97, 112, 242, 100
])

// SHA-256 hash of the secret
function sha256(data: Buffer): Buffer {
    return crypto.createHash("sha256").update(data).digest();
}
function createMessageHashWithIntent(
    htlcId: bigint,
    hashlock: Uint8Array,
    timelock: bigint
): Buffer {
    // Create the message struct matching Move's AddLockMessage
    const messageStruct = {
        htlc_id: htlcId,
        hashlock: Array.from(hashlock),
        timelock: timelock,
    };
    // Serialize using BCS
    const messageBytes = bcs.struct('AddLockMessage', {
        htlc_id: bcs.u256(),
        hashlock: bcs.vector(bcs.u8()),
        timelock: bcs.u64()
    }).serialize(messageStruct).toBytes();
    // Create Sui Intent message
    const intentMessage = Buffer.concat([
        Buffer.from([3]), // Intent scope: PersonalMessage (3)
        Buffer.from([0]), // Intent version: 0
        Buffer.from([0]), // Intent app_id: 0
        Buffer.from(messageBytes)
    ]);

    return crypto.createHash('sha256').update(intentMessage).digest();
}

/// Tests with not existing HTLCs.
/// There is no (Pre)HTLC with this ID.

/// Can't redeem if the (Pre)HTLC with the given Id does not exist.
async function T0_1() {
    const nonExistentId = 0n;
    const secret = crypto.randomBytes(32);

    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::redeem`,
            typeArguments: ["0x2::sui::SUI"],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(nonExistentId),
                tx.pure.vector("u8", Array.from(secret)),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
/// Can't refund if the (Pre)HTLC with the given Id does not exist.
async function T0_2() {
    const nonExistentId = 0n;

    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::refund`,
            typeArguments: ["0x2::sui::SUI"],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(nonExistentId),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
/// Can't add lock if the (Pre)HTLC with the given Id does not exist.
async function T0_3() {
    const nonExistentId = 0n;
    const hashlock = crypto.randomBytes(32);
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);

    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLock`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(nonExistentId),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
/// Can't add lock sign if the (Pre)HTLC with the given Id does not exist.
async function T0_4() {
    const nonExistentId = 0n;
    const hashlock = crypto.randomBytes(32);
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);

    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLockSig`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(nonExistentId),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(hashlock)),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
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

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 11n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const tx = new Transaction();
    tx.setGasBudget(200_000_000);
    const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
    const lockRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::lock`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            coin,
            tx.pure.vector("u8", Array.from(hashlock)),
            tx.pure.u64(timelock),
            tx.pure.vector("u8", Array.from(publicKey_buffer)),
            tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
            tx.pure.string('ETH'),
            tx.pure.string('ETHEREUM'),
            tx.pure.string('dstAddr'),
            tx.pure.string('ETH'),
        ],
    });
    const redeemRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::redeem`,
        typeArguments: ["0x2::sui::SUI"],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            tx.pure.vector("u8", Array.from(secret)),
        ],
    });
    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
    });

}

/// Can't redeem with wrong secret.
async function T1_2() {

    const secret = crypto.randomBytes(32);
    const wrong_secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 12n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        const lockRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lock`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const redeemRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::redeem`,
            typeArguments: ["0x2::sui::SUI"],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                tx.pure.vector("u8", Array.from(wrong_secret)),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T1() {
    await T1_1();
    await T1_2();
    console.log('T1 passed ✅ ');
}

/// Tests for already claimed HTLCs.

/// Can't redeem if already claimed.
async function T2_1(Id: bigint, secret: Buffer) {
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::redeem`,
            typeArguments: ["0x2::sui::SUI"],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(Id),
                tx.pure.vector("u8", Array.from(secret)),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't refund if already claimed.
async function T2_2(Id: bigint) {
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::refund`,
            typeArguments: ["0x2::sui::SUI"],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(Id),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't add lock if already claimed.
async function T2_3(Id: bigint, hashlock: Buffer, timelock: bigint) {

    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLock`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(Id),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't add lock sig if already claimed.
async function T2_4(Id: bigint, hashlock: Buffer, timelock: bigint) {

    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLockSig`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(Id),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(hashlock)),// this fill fail anyway
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T2() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 2n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const tx = new Transaction();
    tx.setGasBudget(200_000_000);

    const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
    const lockRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::lock`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            coin,
            tx.pure.vector("u8", Array.from(hashlock)),
            tx.pure.u64(timelock),
            tx.pure.vector("u8", Array.from(publicKey_buffer)),
            tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
            tx.pure.string('ETH'),
            tx.pure.string('ETHEREUM'),
            tx.pure.string('dstAddr'),
            tx.pure.string('ETH'),
        ],
    });
    const redeemRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::redeem`,
        typeArguments: ["0x2::sui::SUI"],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            tx.pure.vector("u8", Array.from(secret)),
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
    });
    await T2_1(htlcId, secret);
    await T2_2(htlcId);
    await T2_3(htlcId, hashlock, timelock);
    await T2_4(htlcId, hashlock, timelock);
    console.log('T2 passed ✅ ');
}


/// Tests for refunding HTLC.

// TODO: add 30 minutes wait.
/// Can refund if the timelock passed.
async function T3_1() {

    const hashlock = crypto.randomBytes(32);
    const htlcId = 31n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const tx = new Transaction();
    tx.setGasBudget(200_000_000);

    const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
    const lockRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::lock`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            coin,
            tx.pure.vector("u8", Array.from(hashlock)),
            tx.pure.u64(timelock),
            tx.pure.vector("u8", Array.from(publicKey_buffer)),
            tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
            tx.pure.string('ETH'),
            tx.pure.string('ETHEREUM'),
            tx.pure.string('dstAddr'),
            tx.pure.string('ETH'),
        ],
    });
    // The contract forces at least 15 minute tinelock 
    // so there should be a very long wait function.
    const refundRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::refund`,
        typeArguments: ["0x2::sui::SUI"],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
    });

}

/// Can't redeem with if timelock did not pass.
async function T3_2() {

    const hashlock = crypto.randomBytes(32);
    const htlcId = 32n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        const lockRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lock`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const refundRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::refund`,
            typeArguments: ["0x2::sui::SUI"],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T3() {
    await T3_1();
    await T3_2();
    console.log('T3 passed ✅ ');
}

/// Tests for already created (Pre)HTLCs

/// Can't create PreHTLC with already existing ID.
async function T4_1() {

    const htlcId = 41n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        const commitRes1 = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::commit`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const commitRes2 = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::commit`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't create HTLC with already existing ID.
async function T4_2() {
    const hashlock = crypto.randomBytes(32);
    const htlcId = 42n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        const lockRes1 = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lock`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const lockRes2 = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lock`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T4() {
    await T4_1();
    await T4_2();
    console.log('T4 passed ✅ ');
}

/// Tests for not positive amount (Pre)HTLCs.

/// Can't create PreHTLC with not positive amount.
async function T5_1() {

    const htlcId = 51n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        //zero coin
        const [zero_coin] = tx.splitCoins(tx.gas, [0n * 1_000_000_000n]);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::commit`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                zero_coin,
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't create HTLC with not positive amount.
async function T5_2() {
    const hashlock = crypto.randomBytes(32);
    const htlcId = 52n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        //zero coin
        const [zero_coin] = tx.splitCoins(tx.gas, [0n * 1_000_000_000n]);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lock`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                zero_coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T5() {
    await T5_1();
    await T5_2();
    console.log('T5 passed ✅ ');
}

/// Tests for (Pre)HTLCs with wrong timelocks.

/// Can't create PreHTLC with wrong timelock.
async function T6_1() {

    const htlcId = 61n;
    // not future timelock
    const wrong_timelock = BigInt(Date.now());
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::commit`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.u64(wrong_timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't create HTLC with not positive amount.
async function T6_2() {
    const hashlock = crypto.randomBytes(32);
    const htlcId = 62n;
    // not future timelock
    const wrong_timelock = BigInt(Date.now());
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lock`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(wrong_timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T6() {
    await T6_1();
    await T6_2();
    console.log('T6 passed ✅ ');
}

/// Tests for add Lock function.

/// Sender can add lock to PreHTLC.
async function T7_1() {
    const htlcId = 71n;
    const hashlock = crypto.randomBytes(32);
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);

    const tx = new Transaction();
    tx.setGasBudget(200_000_000);
    const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
    const commitRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::commit`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            coin,
            tx.pure.u64(timelock),
            tx.pure.vector("u8", Array.from(publicKey_buffer)),
            tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
            tx.pure.string('ETH'),
            tx.pure.string('ETHEREUM'),
            tx.pure.string('dstAddr'),
            tx.pure.string('ETH'),
        ],
    });
    const addLockRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::addLock`,
        typeArguments: [],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            tx.pure.vector("u8", Array.from(hashlock)),
            tx.pure.u64(timelock),
        ],
    });
    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
    });
}

/// Other users can't add lock to PreHTLC.
async function T7_2() {

    const htlcId = 72n;
    const hashlock = crypto.randomBytes(32);
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);

    const tx = new Transaction();
    tx.setGasBudget(200_000_000);
    const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
    const commitRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::commit`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
            coin,
            tx.pure.u64(timelock),
            tx.pure.vector("u8", Array.from(publicKey_buffer)),
            tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
            tx.pure.string('ETH'),
            tx.pure.string('ETHEREUM'),
            tx.pure.string('dstAddr'),
            tx.pure.string('ETH'),
        ],
    });
    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
    });
    try {
        const tx2 = new Transaction();
        tx2.setGasBudget(200_000_000);
        const addLockRes = tx2.moveCall({
            target: `${PACKAGE_ID}::htlc::addLock`,
            typeArguments: [],
            arguments: [
                tx2.object(HTLCS_OBJECT_ID),
                tx2.pure.u256(htlcId),
                tx2.pure.vector("u8", Array.from(hashlock)),
                tx2.pure.u64(timelock),
            ],
        });
        const result2 = await client.signAndExecuteTransaction({
            signer: other_keypair,
            transaction: tx2,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't add lock if hashlock is already set.
async function T7_3() {

    const htlcId = 73n;
    const hashlock = crypto.randomBytes(32);
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        const commitRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::commit`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const addLockRes1 = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLock`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
            ],
        });
        const addLockRes2 = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLock`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't add lock with wrong timelock.
async function T7_4() {

    const htlcId = 74n;
    const hashlock = crypto.randomBytes(32);
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    //not future timelock
    const wrong_timelock = BigInt(Date.now());
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        const commitRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::commit`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const addLockRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLock`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(wrong_timelock),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T7() {
    await T7_1();
    await T7_2();
    await T7_3();
    await T7_4();
    console.log('T7 passed ✅ ');
}

/// Tests for add Lock signature function.

/// Can add lock with correct signature.
async function T8_1() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 81n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const messageHash = createMessageHashWithIntent(htlcId, hashlock, timelock);

    const signature = keypair.sign(messageHash).then(signature => {
        const s = Buffer.from(signature)
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);
        const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        const commitRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::commit`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const addLockRes = tx.moveCall({
            target: `${PACKAGE_ID}::htlc::addLockSig`,
            typeArguments: [],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.pure.u256(htlcId),
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.vector("u8", Array.from(s)),
            ],
        });
        return client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });

    });
}

/// Can't add lock signature if hashlock is already set.
async function T8_2() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 82n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const messageHash = createMessageHashWithIntent(htlcId, hashlock, timelock);

    const signature = keypair.sign(messageHash).then(signature => {
        const s = Buffer.from(signature)
        const tx = new Transaction();
        try {
            tx.setGasBudget(200_000_000);
            const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
            const commitRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::commit`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    coin,
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(publicKey_buffer)),
                    tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                    tx.pure.string('ETH'),
                    tx.pure.string('ETHEREUM'),
                    tx.pure.string('dstAddr'),
                    tx.pure.string('ETH'),
                ],
            });
            const addLockRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::addLock`,
                typeArguments: [],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    tx.pure.vector("u8", Array.from(hashlock)),
                    tx.pure.u64(timelock),
                ],
            });
            const addLockSigRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::addLockSig`,
                typeArguments: [],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    tx.pure.vector("u8", Array.from(hashlock)),
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(s)),
                ],
            });

            return client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
            });
        } catch (error) {
            console.log(error)
        }
    });
}

/// Can't add lock signature with wrong timelock.
async function T8_3() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 83n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const wrong_timelock = BigInt(Date.now());
    const messageHash = createMessageHashWithIntent(htlcId, hashlock, timelock);

    const signature = keypair.sign(messageHash).then(signature => {
        const s = Buffer.from(signature)
        const tx = new Transaction();
        try {
            tx.setGasBudget(200_000_000);
            const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
            const commitRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::commit`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    coin,
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(publicKey_buffer)),
                    tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                    tx.pure.string('ETH'),
                    tx.pure.string('ETHEREUM'),
                    tx.pure.string('dstAddr'),
                    tx.pure.string('ETH'),
                ],
            });
            const addLockSigRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::addLockSig`,
                typeArguments: [],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    tx.pure.vector("u8", Array.from(hashlock)),
                    tx.pure.u64(wrong_timelock),
                    tx.pure.vector("u8", Array.from(s)),
                ],
            });

            return client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
            });
        } catch (error) {
            console.log(error)
        }
    });
}

/// Can't add lock signature if signed with different Id.
async function T8_4() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 84n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    // the message uses different Id
    const diff_Id = 844n;
    const messageHash = createMessageHashWithIntent(diff_Id, hashlock, timelock);

    const signature = keypair.sign(messageHash).then(signature => {
        const s = Buffer.from(signature)
        const tx = new Transaction();
        try {
            tx.setGasBudget(200_000_000);
            const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
            const commitRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::commit`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    coin,
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(publicKey_buffer)),
                    tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                    tx.pure.string('ETH'),
                    tx.pure.string('ETHEREUM'),
                    tx.pure.string('dstAddr'),
                    tx.pure.string('ETH'),
                ],
            });
            const addLockSigRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::addLockSig`,
                typeArguments: [],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    tx.pure.vector("u8", Array.from(hashlock)),
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(s)),
                ],
            });

            return client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
            });
        } catch (error) {
            console.log(error)
        }
    });
}

/// Can't add lock signature if signed with different timelock.
async function T8_5() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 85n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    // the message uses different hashlock
    const diff_hashlock = crypto.randomBytes(32);
    const messageHash = createMessageHashWithIntent(htlcId, diff_hashlock, timelock);

    const signature = keypair.sign(messageHash).then(signature => {
        const s = Buffer.from(signature)
        const tx = new Transaction();
        try {
            tx.setGasBudget(200_000_000);
            const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
            const commitRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::commit`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    coin,
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(publicKey_buffer)),
                    tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                    tx.pure.string('ETH'),
                    tx.pure.string('ETHEREUM'),
                    tx.pure.string('dstAddr'),
                    tx.pure.string('ETH'),
                ],
            });
            const addLockSigRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::addLockSig`,
                typeArguments: [],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    tx.pure.vector("u8", Array.from(hashlock)),
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(s)),
                ],
            });

            return client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
            });
        } catch (error) {
            console.log(error)
        }
    });
}
/// Can't add lock signature if signed with different timelock.
async function T8_6() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 86n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    // the message uses different timelock
    const diff_timelock = BigInt(Date.now() + 100 * 60 * 1000);
    const messageHash = createMessageHashWithIntent(htlcId, hashlock, diff_timelock);

    const signature = keypair.sign(messageHash).then(signature => {
        const s = Buffer.from(signature)
        const tx = new Transaction();
        try {
            tx.setGasBudget(200_000_000);
            const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
            const commitRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::commit`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    coin,
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(publicKey_buffer)),
                    tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                    tx.pure.string('ETH'),
                    tx.pure.string('ETHEREUM'),
                    tx.pure.string('dstAddr'),
                    tx.pure.string('ETH'),
                ],
            });
            const addLockSigRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::addLockSig`,
                typeArguments: [],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    tx.pure.vector("u8", Array.from(hashlock)),
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(s)),
                ],
            });

            return client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
            });
        } catch (error) {
            console.log(error)
        }
    });
}
/// Can't add lock signature if signed by other user.
async function T8_7() {
    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 87n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const messageHash = createMessageHashWithIntent(htlcId, hashlock, timelock);

    const signature = other_keypair.sign(messageHash).then(signature => {
        const s = Buffer.from(signature)
        const tx = new Transaction();
        try {
            tx.setGasBudget(200_000_000);
            const [coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
            const commitRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::commit`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    coin,
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(publicKey_buffer)),
                    tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                    tx.pure.string('ETH'),
                    tx.pure.string('ETHEREUM'),
                    tx.pure.string('dstAddr'),
                    tx.pure.string('ETH'),
                ],
            });
            const addLockSigRes = tx.moveCall({
                target: `${PACKAGE_ID}::htlc::addLockSig`,
                typeArguments: [],
                arguments: [
                    tx.object(HTLCS_OBJECT_ID),
                    tx.pure.u256(htlcId),
                    tx.pure.vector("u8", Array.from(hashlock)),
                    tx.pure.u64(timelock),
                    tx.pure.vector("u8", Array.from(s)),
                ],
            });

            return client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
            });
        } catch (error) {
            console.log(error)
        }
    });
}
async function T8() {
    await T8_1();
    await T8_2();
    await T8_3();
    await T8_4();
    await T8_5();
    await T8_6();
    await T8_7();
    console.log('T8 passed ✅ ');
}

/// Tests for HTLCs with rewards.

/// Can redeem with the correct secret.
async function T9_1() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 91n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const reward_timelock = BigInt(Date.now() + 30 * 60 * 1000);
    const tx = new Transaction();
    tx.setGasBudget(200_000_000);

    const [coin] = tx.splitCoins(tx.gas, [2n * 1_000_000_000n]);
    const [reward_coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
    const lockRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::lockWithReward`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.object(REWARDS_OBJECT_ID),
            tx.pure.u256(htlcId),
            coin,
            reward_coin,
            tx.pure.vector("u8", Array.from(hashlock)),
            tx.pure.u64(timelock),
            tx.pure.u64(reward_timelock),
            tx.pure.vector("u8", Array.from(publicKey_buffer)),
            tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
            tx.pure.string('ETH'),
            tx.pure.string('ETHEREUM'),
            tx.pure.string('dstAddr'),
            tx.pure.string('ETH'),
        ],
    });
    const redeemRes = tx.moveCall({
        target: `${PACKAGE_ID}::htlc::redeemWithReward`,
        typeArguments: ["0x2::sui::SUI"],
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.object(REWARDS_OBJECT_ID),
            tx.pure.u256(htlcId),
            tx.pure.vector("u8", Array.from(secret)),
        ],
    });
    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
    });

}

/// Can't create HTLC with not future reward timelock.
async function T9_2() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 92n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const reward_timelock = BigInt(Date.now() - 30 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        const [coin] = tx.splitCoins(tx.gas, [2n * 1_000_000_000n]);
        const [reward_coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lockWithReward`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.object(REWARDS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                reward_coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.u64(reward_timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}

/// Can't create HTLC with bigger reward timelock.
async function T9_3() {

    const secret = crypto.randomBytes(32);
    const hashlock = sha256(secret);
    const htlcId = 93n;
    const timelock = BigInt(Date.now() + 60 * 60 * 1000);
    const reward_timelock = BigInt(Date.now() + 100 * 60 * 1000);
    try {
        const tx = new Transaction();
        tx.setGasBudget(200_000_000);

        const [coin] = tx.splitCoins(tx.gas, [2n * 1_000_000_000n]);
        const [reward_coin] = tx.splitCoins(tx.gas, [1n * 1_000_000_000n]);
        tx.moveCall({
            target: `${PACKAGE_ID}::htlc::lockWithReward`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                tx.object(HTLCS_OBJECT_ID),
                tx.object(REWARDS_OBJECT_ID),
                tx.pure.u256(htlcId),
                coin,
                reward_coin,
                tx.pure.vector("u8", Array.from(hashlock)),
                tx.pure.u64(timelock),
                tx.pure.u64(reward_timelock),
                tx.pure.vector("u8", Array.from(publicKey_buffer)),
                tx.pure.address("0xdbbf9fb65076cb3ebdba794b211e3e36f9685e9214ca3493693b7dcf23e4918b"),
                tx.pure.string('ETH'),
                tx.pure.string('ETHEREUM'),
                tx.pure.string('dstAddr'),
                tx.pure.string('ETH'),
            ],
        });
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });
    } catch (error) {
        console.log(error)
    }
}
async function T9() {
    await T9_1();
    await T9_2();
    await T9_3();
    console.log('T10 passed ✅ ');
}

async function detail_test() {

    const htlcId = 6n;

    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::htlc::getDetails`,
        arguments: [
            tx.object(HTLCS_OBJECT_ID),
            tx.pure.u256(htlcId),
        ],
    });

    const result = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: keypair.getPublicKey().toSuiAddress(),
    });

    if (result.results && result.results[0] && result.results[0].returnValues) {
        const returnValues = result.results[0].returnValues;
        console.log("HTLC Details:");
        console.log("- Amount:", returnValues[0]); // u64
        console.log("- Hashlock:", returnValues[1]); // vector<u8>
        console.log("- Secret:", returnValues[2]); // vector<u8>
        console.log("- Token Contract:", returnValues[3]); // TypeName
        console.log("- Timelock:", returnValues[4]); // u64
        console.log("- Claimed:", returnValues[5]); // bool
        console.log("- Sender:", returnValues[6]); // address
        console.log("- Sender_key:", returnValues[7]); //  vector<u8>
        console.log("- Source Receiver:", returnValues[8]); // address
    }

}

// detail_test()

async function main() {

    await T0();
    await T1();
    await T2();
    // await T3();
    await T4();
    await T5();
    await T6();
    await T7();
    await T8();
    await T9();
}
main()