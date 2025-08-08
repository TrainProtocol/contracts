import Bitcoin from './Bitcoin';
import { networks, opcodes, payments, Psbt, script } from 'bitcoinjs-lib';
import { Taptree } from 'bitcoinjs-lib/src/types';
import { ECPairInterface, ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

/**
 * TRAIN Protocol operations on the Bitcoin.
 */
export class BitcoinTrain extends Bitcoin {
  constructor(network: networks.Network) {
    super(network);
  }

  public async commit(
    sender: ECPairInterface,
    srcReceiverPubKey: Buffer,
    amount: number,
    delaySeconds: number,
    options?: { fee?: number; data?: Uint8Array | string }
  ): Promise<{
    txid: string;
    contractAddress: string;
    timelock: number;
    // store this to rebuild P2TR output/witnessUtxo later
    internalPubkeyHex: string;
    p2trScriptPubKeyHex: string;
    contractVout: number;

    // raw leaves (as hex) — keep exact bytes & order
    leaf_multisig_hex: string;
    leaf_refund_hex: string;

    // control blocks (hex) for each leaf, precomputed
    ctrlblock_multisig_hex: string;
    ctrlblock_refund_hex: string;

    // ready-to-use tapLeafScript hex packs for PSBT.addInput
    tapleaf_multisig: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
  }> {
    const fee = options?.fee ?? 1800;

    const { timestamp: now } = await this.getCurrentBlockInfo();
    if (delaySeconds < 900) throw new Error('Timelock must be ≥ 900 seconds');
    const timelock = now + delaySeconds;
    if (timelock < 500_000_000) throw new Error('Timelock must be a UNIX timestamp');

    // leaves
    const leaf_multisig = script.compile([
      this.toXOnly(sender.publicKey),
      opcodes.OP_CHECKSIG,
      this.toXOnly(srcReceiverPubKey),
      opcodes.OP_CHECKSIG,
      opcodes.OP_BOOLAND,
    ]);

    const leaf_refund = script.compile([
      script.number.encode(timelock),
      opcodes.OP_CHECKLOCKTIMEVERIFY,
      opcodes.OP_DROP,
      this.toXOnly(sender.publicKey),
      opcodes.OP_CHECKSIG,
    ]);

    const tapLeaf1 = { output: leaf_multisig, version: 0xc0 as number };
    const tapLeaf2 = { output: leaf_refund, version: 0xc0 as number };
    const scriptTree: [Taptree, Taptree] = [tapLeaf1, tapLeaf2];

    const internalPubkey = this.getHiddenUnspendableInternalKey(); // 32-byte x-only Buffer/Uint8Array
    const p2tr = payments.p2tr({ internalPubkey, scriptTree, network: this.network });
    if (!p2tr.address || !p2tr.output) throw new Error('Failed to derive P2TR');

    const contractAddress = p2tr.address;

    // precompute control blocks
    const redeemMultisig = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_multisig, redeemVersion: 0xc0 },
      network: this.network,
    });
    const ctrlblock_multisig = redeemMultisig.witness![redeemMultisig.witness!.length - 1];

    const redeemRefund = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_refund, redeemVersion: 0xc0 },
      network: this.network,
    });
    const ctrlblock_refund = redeemRefund.witness![redeemRefund.witness!.length - 1];

    // UTXO selection & PSBT
    const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address;
    if (!senderAddress) throw new Error('Failed to derive sender P2WPKH address');

    const utxos = await this.getUtxos(senderAddress);
    if (!utxos.length) throw new Error(`No UTXOs for ${senderAddress}`);

    const needed = amount + fee;
    const selected: typeof utxos = [];
    let totalIn = 0;
    for (const u of utxos) {
      selected.push(u);
      totalIn += u.value;
      if (totalIn >= needed) break;
    }
    if (totalIn < needed) throw new Error(`Insufficient funds: need ${needed}, have ${totalIn}`);

    const psbt = new Psbt({ network: this.network });
    const senderOut = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).output!;
    for (const u of selected) {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        witnessUtxo: { script: senderOut, value: u.value },
      });
    }

    // contract at vout 0 for determinism
    const contractVout = 0;
    psbt.addOutput({ address: contractAddress, value: amount });

    const change = totalIn - needed;
    if (change > 0) {
      psbt.addOutput({ address: senderAddress, value: change });
    }

    if (options?.data !== undefined) {
      const { script: opretScript, value } = this.createOpReturnOutput(
        typeof options.data === 'string' ? options.data : Buffer.from(options.data).toString('utf8')
      );
      psbt.addOutput({ script: opretScript, value });
    }

    for (let i = 0; i < selected.length; i++) psbt.signInput(i, sender);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txhex = tx.toHex();
    const txid = await this.postTransaction(txhex);

    // return everything needed for future script-path spends
    const internalPubkeyHex = Buffer.from(internalPubkey).toString('hex');
    const p2trScriptPubKeyHex = p2tr.output.toString('hex');
    const leaf_multisig_hex = leaf_multisig.toString('hex');
    const leaf_refund_hex = leaf_refund.toString('hex');
    const ctrlblock_multisig_hex = Buffer.from(ctrlblock_multisig).toString('hex');
    const ctrlblock_refund_hex = Buffer.from(ctrlblock_refund).toString('hex');

    return {
      txid,
      contractAddress,
      timelock,

      internalPubkeyHex,
      p2trScriptPubKeyHex,
      contractVout,

      leaf_multisig_hex,
      leaf_refund_hex,

      ctrlblock_multisig_hex,
      ctrlblock_refund_hex,

      tapleaf_multisig: { leafVersion: 0xc0, scriptHex: leaf_multisig_hex, controlBlockHex: ctrlblock_multisig_hex },
      tapleaf_refund: { leafVersion: 0xc0, scriptHex: leaf_refund_hex, controlBlockHex: ctrlblock_refund_hex },
    };
  }

  // /**
  //  * Commit funds to a PreHTLC:
  //  *   - Early "upgrade" to a specific HTLC script hash (user can spend anytime to that WSH)
  //  *   - Refund by user after timelock expiry
  //  *
  //  * @param sender User's ECPair
  //  * @param htlcWitnessScriptHex The FULL witness script for the future HTLC (hex)
  //  * @param amount Amount in satoshis
  //  * @param delaySeconds How many seconds in the future the timelock should be (recommended: >= 900)
  //  * @param options Optional: fee, data, etc.
  //  */
  // public async commit(
  //   sender: ECPairInterface,
  //   htlcWitnessScriptHex: string,
  //   amount: number,
  //   delaySeconds: number,
  //   options?: { fee?: number; data?: Uint8Array | string }
  // ): Promise<{
  //   txid: string;
  //   contractAddress: string;
  //   preHtlcScript: string;
  //   htlc_wshash: string;
  //   timelock: number;
  // }> {
  //   const fee = options?.fee ?? 1800;

  //   // 1) Timelock validation
  //   const { timestamp: now } = await this.getCurrentBlockInfo();
  //   if (delaySeconds < 900) throw new Error('Timelock must be ≥ 900 seconds');
  //   const timelock = now + delaySeconds;
  //   if (timelock < 500_000_000) throw new Error('Computed timelock is not a valid UNIX timestamp');

  //   // 2) Build & hash the PreHTLC script
  //   const htlcScript = Buffer.from(htlcWitnessScriptHex, 'hex');
  //   const htlc_wshash = createHash('sha256').update(htlcScript).digest();
  //   const preHtlcScript = script.compile([
  //     opcodes.OP_IF,
  //     opcodes.OP_SHA256,
  //     htlc_wshash,
  //     opcodes.OP_EQUALVERIFY,
  //     sender.publicKey,
  //     opcodes.OP_CHECKSIG,
  //     opcodes.OP_ELSE,
  //     script.number.encode(timelock),
  //     opcodes.OP_CHECKLOCKTIMEVERIFY,
  //     opcodes.OP_DROP,
  //     sender.publicKey,
  //     opcodes.OP_CHECKSIG,
  //     opcodes.OP_ENDIF,
  //   ]);

  //   const taptreeLeaf = { output: preHtlcScript, version: 0xc0 };
  //   const scriptLeavesParam = [{ script: preHtlcScript, leafVersion: 0xc0 }];

  //   const p2trPayment = payments.p2tr({
  //     internalPubkey: this.UNSPENDABLE_KEY,
  //     scriptTree: taptreeLeaf,
  //     network: this.network,
  //   });
  //   const contractAddress = p2trPayment.address!;
  //   if (!contractAddress) throw new Error('Failed to derive Taproot address');

  //   const senderAddress = payments.p2wpkh({
  //     pubkey: sender.publicKey,
  //     network: this.network,
  //   }).address!;
  //   const rawUtxos = await this.getUtxos(senderAddress);
  //   if (rawUtxos.length === 0) {
  //     throw new Error(`No UTXOs found for ${senderAddress}`);
  //   }
  //   const utxos = rawUtxos.map((u) => ({
  //     txid: u.hash,
  //     vout: u.index,
  //     value: u.value,
  //   }));

  //   const txHex = this.buildTaprootTx(
  //     { publicKey: sender.publicKey, privateKey: sender.privateKey! },
  //     utxos,
  //     contractAddress, // recipient = new Taproot HTLC address
  //     amount, // amount to lock
  //     fee, // fee
  //     'script',
  //     scriptLeavesParam, // your singleleaf tapscript entry
  //     options?.data, // optional OP_RETURN
  //     senderAddress // change → sender
  //   );

  //   const txid = await this.postTransaction(txHex);
  //   return {
  //     txid,
  //     contractAddress,
  //     preHtlcScript: preHtlcScript.toString('hex'),
  //     htlc_wshash: htlc_wshash.toString('hex'),
  //     timelock,
  //   };
  // }

  // /**
  //  * Upgrade ALL PreHTLC UTXOs to a new HTLC contract.
  //  *
  //  * @param preHtlcUtxos   Array of { hash, index, value } for all PreHTLC inputs
  //  * @param preHtlcScriptHex The PreHTLC redeem script hex
  //  * @param htlcScriptHex    The new HTLC contract script (hex)
  //  * @param sender           User keypair
  //  * @param feeInputUtxos    Array of user UTXOs to cover the upgrade fee
  //  * @param feeAmount        Satoshi amount of upgrade tx fee
  //  */
  // public async addLock(
  //   preHtlcUtxos: { hash: string; index: number; value: number }[],
  //   preHtlcScriptHex: string,
  //   htlcScriptHex: string,
  //   sender: ECPairInterface,
  //   feeInputUtxos: { hash: string; index: number; value: number }[],
  //   feeAmount: number
  // ) {
  //   const preHtlcScript = Buffer.from(preHtlcScriptHex, 'hex');
  //   const htlcScript = Buffer.from(htlcScriptHex, 'hex');
  //   const htlcP2wsh = payments.p2wsh({ redeem: { output: htlcScript, network: this.network }, network: this.network });
  //   if (!htlcP2wsh.address) throw new Error('Failed to compute HTLC address');

  //   const psbt = new Psbt({ network: this.network });

  //   // Add ALL PreHTLC inputs
  //   let preHtlcTotalValue = 0;
  //   for (const utxo of preHtlcUtxos) {
  //     psbt.addInput({
  //       hash: utxo.hash,
  //       index: utxo.index,
  //       witnessScript: preHtlcScript,
  //       witnessUtxo: {
  //         script: payments.p2wsh({ redeem: { output: preHtlcScript, network: this.network }, network: this.network })
  //           .output!,
  //         value: utxo.value,
  //       },
  //       sequence: 0xfffffffe,
  //     });
  //     preHtlcTotalValue += utxo.value;
  //   }

  //   // Add user's extra UTXOs to cover the fee
  //   let totalFeeInput = 0;
  //   const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address;
  //   for (const utxo of feeInputUtxos) {
  //     psbt.addInput({
  //       hash: utxo.hash,
  //       index: utxo.index,
  //       witnessUtxo: {
  //         script: payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).output!,
  //         value: utxo.value,
  //       },
  //     });
  //     totalFeeInput += utxo.value;
  //   }

  //   // Output: (1) all PreHTLC value to new HTLC, (2) change for fee if any
  //   psbt.addOutput({
  //     address: htlcP2wsh.address,
  //     value: preHtlcTotalValue,
  //   });

  //   const change = totalFeeInput - feeAmount;
  //   if (change < 0) throw new Error('Fee UTXOs do not cover the fee amount');
  //   if (change > 0 && senderAddress) {
  //     psbt.addOutput({
  //       address: senderAddress,
  //       value: change,
  //     });
  //   }

  //   psbt.signAllInputs(sender);

  //   // Finalize all PreHTLC inputs for upgrade
  //   for (let i = 0; i < preHtlcUtxos.length; ++i) {
  //     psbt.finalizeInput(i, (inputIndex, input, script) => {
  //       const sig = input.partialSig.find((sigObj) => sigObj && sigObj.pubkey.equals(sender.publicKey))!.signature;
  //       const witness = [sig, htlcScript, Buffer.from([1])];
  //       return {
  //         finalScriptWitness: this.witnessStackToScriptWitness(witness),
  //       };
  //     });
  //   }

  //   // Finalize all fee inputs (P2WPKH)
  //   for (let i = preHtlcUtxos.length; i < preHtlcUtxos.length + feeInputUtxos.length; ++i) {
  //     psbt.finalizeInput(i);
  //   }

  //   const tx = psbt.extractTransaction();
  //   const txid = await this.postTransaction(tx.toHex());

  //   return {
  //     txid,
  //     htlcAddress: htlcP2wsh.address,
  //     htlcScript: htlcScriptHex,
  //   };
  // }

  // /**
  //  * Issue HTLC and obtain the key at the time of issue
  //  */
  // public async lock(
  //   sender: ECPairInterface,
  //   receiver: ECPairInterface,
  //   secret: string,
  //   amount: number,
  //   options?: LockOptions
  // ) {
  //   // set option paramater
  //   const fee = options?.fee || 1800;
  //   const lockHeight = options?.lockHeight || 2;
  //   const blockHeight = await this.getCurrentBlockInfo();
  //   const timelock = bip65.encode({ blocks: blockHeight.height + lockHeight });

  //   // generate contract
  //   const witnessScript = this.generateSwapWitnessScript(receiver.publicKey, sender.publicKey, secret, timelock);
  //   const p2wsh = payments.p2wsh({
  //     redeem: { output: witnessScript, network: this.network },
  //     network: this.network,
  //   });

  //   // get addresses
  //   const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address;
  //   if (senderAddress == undefined || p2wsh.address == undefined) {
  //     throw new Error('senderAddress or contractAddress is undefined');
  //   }

  //   // get balance
  //   const utxos = await this.getUtxos(senderAddress);
  //   if (!utxos || utxos.length <= 0) {
  //     throw new Error(`There was no UTXO currently available at the specified address ${senderAddress}.`);
  //   }

  //   // create transaction & announce
  //   const txHex: string = this.buildAndSignTx(sender, senderAddress, p2wsh.address, amount, fee, utxos, options?.data);
  //   const hash: string = await this.postTransaction(txHex);

  //   return {
  //     hash,
  //     contractAddress: p2wsh.address,
  //     witnessScript: witnessScript.toString('hex'),
  //   };
  // }

  // async withdraw(
  //   hash: string,
  //   contractAddress: string,
  //   witnessScript: string,
  //   receiver: ECPairInterface,
  //   proof: string,
  //   option?: { fee?: number }
  // ): Promise<string> {
  //   // set option paramater
  //   const fee = option?.fee || 1800;
  //   const witnessUtxoValue = await this.getInputData(hash, contractAddress);
  //   const p2wpkh = payments.p2wpkh({ pubkey: receiver.publicKey, network: this.network });
  //   if (p2wpkh.address === undefined) throw new Error(`recieverAddress is undefined`);

  //   // transaction process
  //   const transaction = new Psbt({ network: this.network })
  //     .addInput({
  //       hash,
  //       index: witnessUtxoValue.index,
  //       sequence: 0xfffffffe,
  //       witnessScript: Buffer.from(witnessScript, 'hex'),
  //       witnessUtxo: {
  //         script: Buffer.from('0020' + crypto.sha256(Buffer.from(witnessScript, 'hex')).toString('hex'), 'hex'),
  //         value: witnessUtxoValue.value,
  //       },
  //     })
  //     .addOutput({
  //       address: p2wpkh.address,
  //       value: witnessUtxoValue.value - fee,
  //     })
  //     .signInput(0, receiver)
  //     .finalizeInput(0, (inputIndex: number, input: any, tapLeafHashToFinalize: Buffer | (number | Buffer)[]) => {
  //       const decompiled = script.decompile(tapLeafHashToFinalize);
  //       if (!decompiled || decompiled[0] !== opcodes.OP_HASH256) {
  //         throw new Error(`Can not finalize input #${inputIndex}`);
  //       }
  //       const witnessStackClaimBranch = payments.p2wsh({
  //         redeem: {
  //           input: script.compile([input.partialSig[0].signature, Buffer.from(proof, 'hex')]),
  //           output: Buffer.from(witnessScript, 'hex'),
  //         },
  //       });
  //       return {
  //         finalScriptSig: undefined,
  //         finalScriptWitness: this.witnessStackToScriptWitness(witnessStackClaimBranch.witness),
  //       };
  //     })
  //     .extractTransaction();

  //   console.log(`transaction id: ${transaction.getId()}`);
  //   await new Promise((ok) => {
  //     setTimeout(() => {
  //       ok('');
  //     }, 10000);
  //   });
  //   return await this.postTransaction(transaction.toHex());
  // }

  /**
   * Called by the sender if there was no withdraw AND the time lock has
   * expired. This will refund the contract amount.
   * @returns transaction hash
   */
  // async refund(
  //   hash: string,
  //   contractAddress: string,
  //   witnessScript: string,
  //   sender: ECPairInterface,
  //   option?: { fee?: number }
  // ): Promise<string> {
  //   // set option paramater
  //   const fee = option?.fee || 1800;
  //   const decompiled = script.decompile(Buffer.from(witnessScript, 'hex'));
  //   const witnessUtxoValue = await this.getInputData(hash, contractAddress);
  //   const p2wpkh = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network });
  //   if (decompiled == null || decompiled[6] == null) throw new Error("script hasn't lock time");
  //   if (p2wpkh.address === undefined) throw new Error(`recieverAddress is undefined`);
  //   const timelock = bip65.encode({ blocks: script.number.decode(decompiled[6] as Buffer) });

  //   // transaction process
  //   const transaction = new Psbt({ network: this.network })
  //     .setLocktime(timelock)
  //     .addInput({
  //       hash,
  //       index: witnessUtxoValue.index,
  //       sequence: 0xfffffffe,
  //       witnessScript: Buffer.from(witnessScript, 'hex'),
  //       witnessUtxo: {
  //         script: Buffer.from('0020' + crypto.sha256(Buffer.from(witnessScript, 'hex')).toString('hex'), 'hex'),
  //         value: witnessUtxoValue.value,
  //       },
  //     })
  //     .addOutput({
  //       address: p2wpkh.address,
  //       value: witnessUtxoValue.value - fee,
  //     })
  //     .signInput(0, sender)
  //     .finalizeInput(0, (inputIndex: number, input: any, tapLeafHashToFinalize: Buffer | (number | Buffer)[]) => {
  //       const decompiled = script.decompile(tapLeafHashToFinalize);
  //       if (!decompiled || decompiled[0] !== opcodes.OP_HASH256) {
  //         throw new Error(`Can not finalize input #${inputIndex}`);
  //       }
  //       const witnessStackRefundBranch = payments.p2wsh({
  //         redeem: {
  //           input: script.compile([input.partialSig[0].signature, Buffer.from('', 'hex')]),
  //           output: Buffer.from(witnessScript, 'hex'),
  //         },
  //       });
  //       return {
  //         finalScriptSig: undefined,
  //         finalScriptWitness: this.witnessStackToScriptWitness(witnessStackRefundBranch.witness),
  //       };
  //     })
  //     .extractTransaction();

  //   return await this.postTransaction(transaction.toHex());
  // }
}
