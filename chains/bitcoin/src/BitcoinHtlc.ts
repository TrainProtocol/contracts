const bip65 = require('bip65');

import Bitcoin from './Bitcoin';
import { LockOptions } from './Core';
import { crypto, networks, payments, Psbt, script, opcodes } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';

/**
 * TRAIN Protocol operations on the Bitcoin.
 */
export class BitcoinHtlc extends Bitcoin {
  constructor(network: networks.Network) {
    super(network);
  }

  /**
   * Commit funds to a PreHTLC:
   *   - Early "upgrade" to a specific HTLC script hash (user can spend anytime to that WSH)
   *   - Refund by user after timelock expiry
   *
   * @param sender User's ECPair
   * @param htlcWitnessScriptHex The FULL witness script for the future HTLC (hex)
   * @param amount Amount in satoshis
   * @param delaySeconds How many seconds in the future the timelock should be (recommended: >= 900)
   * @param options Optional: fee, data, etc.
   */
  public async commit(
    sender: ECPairInterface,
    htlcWitnessScriptHex: string,
    amount: number,
    delaySeconds: number,
    options?: LockOptions
  ) {
    const fee = options?.fee || 1800;

    const blockInfo = await this.getCurrentBlockInfo();
    const nowFromChain = blockInfo.timestamp;

    if (delaySeconds < 900) throw new Error('Timelock delay must be at least 900 seconds.');

    const timelock = nowFromChain + delaySeconds;
    if (timelock < 500_000_000)
      throw new Error('Computed timelock is not a valid UNIX timestamp (must be >= 500_000_000).');

    // Compute the hash of the HTLC script (to allow only that as upgrade target)
    const htlcWitnessScript = Buffer.from(htlcWitnessScriptHex, 'hex');
    const htlc_wshash = crypto.sha256(htlcWitnessScript);

    const preHtlcScript = script.compile([
      opcodes.OP_IF,
      opcodes.OP_SHA256,
      htlc_wshash,
      opcodes.OP_EQUALVERIFY,
      sender.publicKey,
      opcodes.OP_CHECKSIG,
      opcodes.OP_ELSE,
      script.number.encode(timelock),
      opcodes.OP_CHECKLOCKTIMEVERIFY,
      opcodes.OP_DROP,
      sender.publicKey,
      opcodes.OP_CHECKSIG,
      opcodes.OP_ENDIF,
    ]);

    const p2wsh = payments.p2wsh({ redeem: { output: preHtlcScript, network: this.network }, network: this.network });

    const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address;
    if (!senderAddress || !p2wsh.address) throw new Error('senderAddress or contractAddress undefined');
    const utxos = await this.getUtxos(senderAddress);
    if (!utxos || utxos.length === 0) throw new Error(`No UTXO for address ${senderAddress}`);

    const txHex = this.buildAndSignTx(sender, senderAddress, p2wsh.address, amount, fee, utxos, options?.data);
    const txid = await this.postTransaction(txHex);

    return {
      txid,
      contractAddress: p2wsh.address,
      preHtlcScript: preHtlcScript.toString('hex'),
      htlc_wshash: htlc_wshash.toString('hex'),
      timelock,
    };
  }

  /**
   * Upgrade ALL PreHTLC UTXOs to a new HTLC contract.
   *
   * @param preHtlcUtxos   Array of { hash, index, value } for all PreHTLC inputs
   * @param preHtlcScriptHex The PreHTLC redeem script hex
   * @param htlcScriptHex    The new HTLC contract script (hex)
   * @param sender           User keypair
   * @param feeInputUtxos    Array of user UTXOs to cover the upgrade fee
   * @param feeAmount        Satoshi amount of upgrade tx fee
   */
  public async addLock(
    preHtlcUtxos: { hash: string; index: number; value: number }[],
    preHtlcScriptHex: string,
    htlcScriptHex: string,
    sender: ECPairInterface,
    feeInputUtxos: { hash: string; index: number; value: number }[],
    feeAmount: number
  ) {
    const preHtlcScript = Buffer.from(preHtlcScriptHex, 'hex');
    const htlcScript = Buffer.from(htlcScriptHex, 'hex');
    const htlcP2wsh = payments.p2wsh({ redeem: { output: htlcScript, network: this.network }, network: this.network });
    if (!htlcP2wsh.address) throw new Error('Failed to compute HTLC address');

    const psbt = new Psbt({ network: this.network });

    // Add ALL PreHTLC inputs
    let preHtlcTotalValue = 0;
    for (const utxo of preHtlcUtxos) {
      psbt.addInput({
        hash: utxo.hash,
        index: utxo.index,
        witnessScript: preHtlcScript,
        witnessUtxo: {
          script: payments.p2wsh({ redeem: { output: preHtlcScript, network: this.network }, network: this.network })
            .output!,
          value: utxo.value,
        },
        sequence: 0xfffffffe,
      });
      preHtlcTotalValue += utxo.value;
    }

    // Add user's extra UTXOs to cover the fee
    let totalFeeInput = 0;
    const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address;
    for (const utxo of feeInputUtxos) {
      psbt.addInput({
        hash: utxo.hash,
        index: utxo.index,
        witnessUtxo: {
          script: payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).output!,
          value: utxo.value,
        },
      });
      totalFeeInput += utxo.value;
    }

    // Output: (1) all PreHTLC value to new HTLC, (2) change for fee if any
    psbt.addOutput({
      address: htlcP2wsh.address,
      value: preHtlcTotalValue,
    });

    const change = totalFeeInput - feeAmount;
    if (change < 0) throw new Error('Fee UTXOs do not cover the fee amount');
    if (change > 0 && senderAddress) {
      psbt.addOutput({
        address: senderAddress,
        value: change,
      });
    }

    psbt.signAllInputs(sender);

    // Finalize all PreHTLC inputs for upgrade
    for (let i = 0; i < preHtlcUtxos.length; ++i) {
      psbt.finalizeInput(i, (inputIndex, input, script) => {
        const sig = input.partialSig.find((sigObj) => sigObj && sigObj.pubkey.equals(sender.publicKey))!.signature;
        const witness = [sig, htlcScript, Buffer.from([1])];
        return {
          finalScriptWitness: this.witnessStackToScriptWitness(witness),
        };
      });
    }

    // Finalize all fee inputs (P2WPKH)
    for (let i = preHtlcUtxos.length; i < preHtlcUtxos.length + feeInputUtxos.length; ++i) {
      psbt.finalizeInput(i);
    }

    const tx = psbt.extractTransaction();
    const txid = await this.postTransaction(tx.toHex());

    return {
      txid,
      htlcAddress: htlcP2wsh.address,
      htlcScript: htlcScriptHex,
    };
  }

  /**
   * Issue HTLC and obtain the key at the time of issue
   */
  public async lock(
    sender: ECPairInterface,
    receiver: ECPairInterface,
    secret: string,
    amount: number,
    options?: LockOptions
  ) {
    // set option paramater
    const fee = options?.fee || 1800;
    const lockHeight = options?.lockHeight || 2;
    const blockHeight = await this.getCurrentBlockInfo();
    const timelock = bip65.encode({ blocks: blockHeight.height + lockHeight });

    // generate contract
    const witnessScript = this.generateSwapWitnessScript(receiver.publicKey, sender.publicKey, secret, timelock);
    const p2wsh = payments.p2wsh({
      redeem: { output: witnessScript, network: this.network },
      network: this.network,
    });

    // get addresses
    const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address;
    if (senderAddress == undefined || p2wsh.address == undefined) {
      throw new Error('senderAddress or contractAddress is undefined');
    }

    // get balance
    const utxos = await this.getUtxos(senderAddress);
    if (!utxos || utxos.length <= 0) {
      throw new Error(`There was no UTXO currently available at the specified address ${senderAddress}.`);
    }

    // create transaction & announce
    const txHex: string = this.buildAndSignTx(sender, senderAddress, p2wsh.address, amount, fee, utxos, options?.data);
    const hash: string = await this.postTransaction(txHex);

    return {
      hash,
      contractAddress: p2wsh.address,
      witnessScript: witnessScript.toString('hex'),
    };
  }

  async withdraw(
    hash: string,
    contractAddress: string,
    witnessScript: string,
    receiver: ECPairInterface,
    proof: string,
    option?: { fee?: number }
  ): Promise<string> {
    // set option paramater
    const fee = option?.fee || 1800;
    const witnessUtxoValue = await this.getInputData(hash, contractAddress);
    const p2wpkh = payments.p2wpkh({ pubkey: receiver.publicKey, network: this.network });
    if (p2wpkh.address === undefined) throw new Error(`recieverAddress is undefined`);

    // transaction process
    const transaction = new Psbt({ network: this.network })
      .addInput({
        hash,
        index: witnessUtxoValue.index,
        sequence: 0xfffffffe,
        witnessScript: Buffer.from(witnessScript, 'hex'),
        witnessUtxo: {
          script: Buffer.from('0020' + crypto.sha256(Buffer.from(witnessScript, 'hex')).toString('hex'), 'hex'),
          value: witnessUtxoValue.value,
        },
      })
      .addOutput({
        address: p2wpkh.address,
        value: witnessUtxoValue.value - fee,
      })
      .signInput(0, receiver)
      .finalizeInput(0, (inputIndex: number, input: any, tapLeafHashToFinalize: Buffer | (number | Buffer)[]) => {
        const decompiled = script.decompile(tapLeafHashToFinalize);
        if (!decompiled || decompiled[0] !== opcodes.OP_HASH256) {
          throw new Error(`Can not finalize input #${inputIndex}`);
        }
        const witnessStackClaimBranch = payments.p2wsh({
          redeem: {
            input: script.compile([input.partialSig[0].signature, Buffer.from(proof, 'hex')]),
            output: Buffer.from(witnessScript, 'hex'),
          },
        });
        return {
          finalScriptSig: undefined,
          finalScriptWitness: this.witnessStackToScriptWitness(witnessStackClaimBranch.witness),
        };
      })
      .extractTransaction();

    console.log(`transaction id: ${transaction.getId()}`);
    await new Promise((ok) => {
      setTimeout(() => {
        ok('');
      }, 10000);
    });
    return await this.postTransaction(transaction.toHex());
  }

  /**
   * Called by the sender if there was no withdraw AND the time lock has
   * expired. This will refund the contract amount.
   * @returns transaction hash
   */
  async refund(
    hash: string,
    contractAddress: string,
    witnessScript: string,
    sender: ECPairInterface,
    option?: { fee?: number }
  ): Promise<string> {
    // set option paramater
    const fee = option?.fee || 1800;
    const decompiled = script.decompile(Buffer.from(witnessScript, 'hex'));
    const witnessUtxoValue = await this.getInputData(hash, contractAddress);
    const p2wpkh = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network });
    if (decompiled == null || decompiled[6] == null) throw new Error("script hasn't lock time");
    if (p2wpkh.address === undefined) throw new Error(`recieverAddress is undefined`);
    const timelock = bip65.encode({ blocks: script.number.decode(decompiled[6] as Buffer) });

    // transaction process
    const transaction = new Psbt({ network: this.network })
      .setLocktime(timelock)
      .addInput({
        hash,
        index: witnessUtxoValue.index,
        sequence: 0xfffffffe,
        witnessScript: Buffer.from(witnessScript, 'hex'),
        witnessUtxo: {
          script: Buffer.from('0020' + crypto.sha256(Buffer.from(witnessScript, 'hex')).toString('hex'), 'hex'),
          value: witnessUtxoValue.value,
        },
      })
      .addOutput({
        address: p2wpkh.address,
        value: witnessUtxoValue.value - fee,
      })
      .signInput(0, sender)
      .finalizeInput(0, (inputIndex: number, input: any, tapLeafHashToFinalize: Buffer | (number | Buffer)[]) => {
        const decompiled = script.decompile(tapLeafHashToFinalize);
        if (!decompiled || decompiled[0] !== opcodes.OP_HASH256) {
          throw new Error(`Can not finalize input #${inputIndex}`);
        }
        const witnessStackRefundBranch = payments.p2wsh({
          redeem: {
            input: script.compile([input.partialSig[0].signature, Buffer.from('', 'hex')]),
            output: Buffer.from(witnessScript, 'hex'),
          },
        });
        return {
          finalScriptSig: undefined,
          finalScriptWitness: this.witnessStackToScriptWitness(witnessStackRefundBranch.witness),
        };
      })
      .extractTransaction();

    return await this.postTransaction(transaction.toHex());
  }
}
