import Bitcoin, { ChainArg } from './Bitcoin';
import { address, opcodes, payments, Psbt, script, Transaction } from 'bitcoinjs-lib';
import { ECPairInterface, ECPairFactory } from 'ecpair';
import { TapleafInfo } from './Core';
import {
  encodeUserLockedEvent,
  encodeUserRedeemedEvent,
  encodeUserRefundedEvent,
  encodeSolverLockedEvent,
  encodeSolverRedeemedEvent,
  encodeSolverRefundedEvent,
} from './events';
import { createHash } from 'crypto';
import * as varuint from 'varuint-bitcoin';
import { initEccLib } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { taggedHash } from 'bitcoinjs-lib/src/crypto';

initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const TAPLEAF_VER_TAPSCRIPT = 0xc0;
const DUST_P2WPKH = 331;
const DUST_CHANGE = 311;
const MIN_DELAY_SEC = 900;

type Taptree = { output: Buffer; version: number } | [Taptree, Taptree];

/**
 * Train Protocol — Bitcoin implementation
 *
 * 6 protocol operations:
 *   userLock, solverLock, redeemUser, redeemSolver, refundUser, refundSolver
 *
 * Plus Bitcoin-specific cooperative refund (refundUserCooperativeInit/Finalize)
 * and utility helpers (convertP2WPKHtoP2TR, convertP2TRtoP2WPKH).
 */
export class BitcoinTrain extends Bitcoin {
  constructor(chain: ChainArg) {
    super(chain);
  }

  private packWitness(items: Buffer[]): Buffer {
    const parts: Buffer[] = [varuint.encode(items.length)];
    for (const w of items) parts.push(varuint.encode(w.length), w);
    return Buffer.concat(parts);
  }

  // ─── 1. userLock ────────────────────────────────────────────

  /**
   * Create a user lock to initiate a cross-chain swap.
   *
   * Taproot tree (3 leaves):
   *   Leaf 1 (hashlock):     OP_SHA256 <hashlock> OP_EQUALVERIFY <xRecipient> OP_CHECKSIG
   *   Leaf 2 (coop_refund):  <xSender> OP_CHECKSIGVERIFY <xRecipient> OP_CHECKSIG
   *   Leaf 3 (csv_refund):   <csvTimelock> OP_CSV OP_DROP <xSender> OP_CHECKSIG
   */
  public async userLock(
    sender: ECPairInterface,
    recipientPubKey: Buffer,
    params: {
      hashlock: Buffer;
      amount: number;
      timelockDelta: number;
      fee?: number;
      // Event data (logged in OP_RETURN)
      rewardAmount?: bigint;
      rewardTimelockDelta?: number;
      quoteExpiry?: number;
      rewardToken?: string;
      rewardRecipient?: string;
    },
    dst: {
      dstChain: string;
      dstAddress: Buffer;
      dstAmount: bigint;
      dstToken: string;
    },
    userData?: Buffer,
    solverData?: Buffer
  ): Promise<{
    txid: string;
    contractAddress: string;
    timelock: number;
    internalPubkeyHex: string;
    p2trScriptPubKeyHex: string;
    contractVout: number;
    contractValue: number;
    tapleaf_hashlock: TapleafInfo;
    tapleaf_coop_refund: TapleafInfo;
    tapleaf_refund: TapleafInfo;
  }> {
    // Estimate fee: ~150 vbytes for 1-in 3-out P2WPKH → P2TR tx
    const fee = params.fee ?? await this.estimateFee(150, 'halfHour');
    const hashlock = params.hashlock;

    if (params.amount <= 0) throw new Error('Amount must be > 0');
    if (hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
    if (params.timelockDelta < MIN_DELAY_SEC) throw new Error('timelockDelta must be ≥ 900 seconds');

    const xSender = this.toXOnly(sender.publicKey);
    const xRecipient = this.toXOnly(recipientPubKey);
    const csvSeq = this.csvSeconds(params.timelockDelta);

    // Leaf 1: Hashlock redeem
    const leaf_hashlock = script.compile([
      opcodes.OP_SHA256,
      hashlock,
      opcodes.OP_EQUALVERIFY,
      xRecipient,
      opcodes.OP_CHECKSIG,
    ]);

    // Leaf 2: Cooperative refund (recipient can refund anytime)
    const leaf_coop_refund = script.compile([
      xSender,
      opcodes.OP_CHECKSIGVERIFY,
      xRecipient,
      opcodes.OP_CHECKSIG,
    ]);

    // Leaf 3: CSV refund (sender after timelock)
    const leaf_refund = script.compile([
      script.number.encode(csvSeq),
      opcodes.OP_CHECKSEQUENCEVERIFY,
      opcodes.OP_DROP,
      xSender,
      opcodes.OP_CHECKSIG,
    ]);

    // Hashlock at root (shortest proof), two refund paths at equal depth
    const scriptTree: [Taptree, [Taptree, Taptree]] = [
      { output: leaf_hashlock, version: TAPLEAF_VER_TAPSCRIPT },
      [
        { output: leaf_coop_refund, version: TAPLEAF_VER_TAPSCRIPT },
        { output: leaf_refund, version: TAPLEAF_VER_TAPSCRIPT },
      ],
    ];

    const internalPubkey = this.getHiddenUnspendableInternalKey();
    const p2tr = payments.p2tr({ internalPubkey, scriptTree, network: this.network });
    if (!p2tr.address || !p2tr.output) throw new Error('Failed to derive P2TR');

    const deriveCtrl = (leaf: Buffer) => {
      const r = payments.p2tr({
        internalPubkey,
        scriptTree,
        redeem: { output: leaf, redeemVersion: TAPLEAF_VER_TAPSCRIPT },
        network: this.network,
      });
      return r.witness![r.witness!.length - 1];
    };

    const ctrlHashlock = deriveCtrl(leaf_hashlock);
    const ctrlCoopRefund = deriveCtrl(leaf_coop_refund);
    const ctrlRefund = deriveCtrl(leaf_refund);

    // Build transaction — spend from sender's P2WPKH
    const senderP2WPKH = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network });
    if (!senderP2WPKH.address || !senderP2WPKH.output) throw new Error('Failed to derive sender P2WPKH');
    const senderAddress = senderP2WPKH.address;

    const utxos = await this.getUtxos(senderAddress);
    if (!utxos.length) throw new Error(`No UTXOs for ${senderAddress}`);

    const needed = params.amount + fee;
    const selected: typeof utxos = [];
    let totalIn = 0;
    for (const u of utxos) {
      selected.push(u);
      totalIn += u.value;
      if (totalIn >= needed) break;
    }
    if (totalIn < needed) throw new Error(`Insufficient funds: need ${needed}, have ${totalIn}`);

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    for (const u of selected) {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        witnessUtxo: { script: senderP2WPKH.output, value: u.value },
        sequence: 0xfffffffd,
      });
    }

    const change = totalIn - needed;
    const contractVout = 0;
    const contractValue = params.amount + (change > 0 && change < DUST_P2WPKH ? change : 0);
    psbt.addOutput({ address: p2tr.address, value: contractValue });

    if (change >= DUST_P2WPKH) psbt.addOutput({ address: senderAddress, value: change });

    // OP_RETURN: UserLocked event
    const eventPayload = encodeUserLockedEvent({
      hashlock,
      timelockDelta: params.timelockDelta,
      rewardTimelockDelta: params.rewardTimelockDelta ?? 0,
      quoteExpiry: params.quoteExpiry ?? 0,
      dstAmount: dst.dstAmount,
      rewardAmount: params.rewardAmount ?? 0n,
      dstChain: dst.dstChain,
      dstAddress: dst.dstAddress,
      dstToken: dst.dstToken,
      rewardToken: params.rewardToken ?? '',
      rewardRecipient: params.rewardRecipient ?? '',
      userData: userData ?? Buffer.alloc(0),
      solverData: solverData ?? Buffer.alloc(0),
    });
    const { script: opret, value: opretVal } = this.createOpReturnOutput(eventPayload);
    psbt.addOutput({ script: opret, value: opretVal });

    for (let i = 0; i < selected.length; i++) psbt.signInput(i, sender);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txid = await this.postTransaction(tx.toHex());

    const mkTapleaf = (leaf: Buffer, ctrl: Buffer): TapleafInfo => ({
      leafVersion: TAPLEAF_VER_TAPSCRIPT,
      scriptHex: leaf.toString('hex'),
      controlBlockHex: Buffer.from(ctrl).toString('hex'),
    });

    return {
      txid,
      contractAddress: p2tr.address,
      timelock: csvSeq,
      internalPubkeyHex: Buffer.from(internalPubkey).toString('hex'),
      p2trScriptPubKeyHex: p2tr.output.toString('hex'),
      contractVout,
      contractValue,
      tapleaf_hashlock: mkTapleaf(leaf_hashlock, ctrlHashlock),
      tapleaf_coop_refund: mkTapleaf(leaf_coop_refund, ctrlCoopRefund),
      tapleaf_refund: mkTapleaf(leaf_refund, ctrlRefund),
    };
  }

  // ─── 2. solverLock ──────────────────────────────────────────

  /**
   * Create a solver lock with two UTXOs: one for amount, one for reward.
   *
   * Amount UTXO Taproot tree:
   *   Leaf 1 (hashlock):  OP_SHA256 <hashlock> OP_EQUALVERIFY <xRecipient> OP_CHECKSIG
   *   Leaf 2 (refund):    <timelockCSV> OP_CSV OP_DROP <xSender> OP_CHECKSIG
   *
   * Reward UTXO Taproot tree (if reward > 0):
   *   Leaf 1 (priority):  OP_SHA256 <hashlock> OP_EQUALVERIFY <xRewardRecipient> OP_CHECKSIG
   *   Leaf 2 (delayed):   <rewardCSV> OP_CSV OP_DROP OP_SHA256 <hashlock> OP_EQUALVERIFY <xRecipient> OP_CHECKSIG
   *   Leaf 3 (refund):    <timelockCSV> OP_CSV OP_DROP <xSender> OP_CHECKSIG
   */
  public async solverLock(
    sender: ECPairInterface,
    recipientPubKey: Buffer,
    rewardRecipientPubKey: Buffer,
    params: {
      hashlock: Buffer;
      amount: number;
      reward: number;
      timelockDelta: number;
      rewardTimelockDelta: number;
      index: number;
      fee?: number;
    },
    dst: {
      dstChain: string;
      dstAddress: Buffer;
      dstAmount: bigint;
      dstToken: string;
    },
    data?: Buffer
  ): Promise<{
    txid: string;
    index: number;
    timelock: number;
    rewardTimelock: number;
    amountContractAddress: string;
    amountContractVout: number;
    amountValue: number;
    amountInternalPubkeyHex: string;
    amountP2trScriptPubKeyHex: string;
    amountTapleafHashlock: TapleafInfo;
    amountTapleafRefund: TapleafInfo;
    rewardContractAddress?: string;
    rewardContractVout?: number;
    rewardValue?: number;
    rewardInternalPubkeyHex?: string;
    rewardP2trScriptPubKeyHex?: string;
    rewardTapleafPriority?: TapleafInfo;
    rewardTapleafDelayed?: TapleafInfo;
    rewardTapleafRefund?: TapleafInfo;
  }> {
    // Estimate fee: ~200 vbytes for 1-in 4-out P2TR tx (amount + reward + opreturn + change)
    const fee = params.fee ?? await this.estimateFee(200, 'halfHour');
    const hashlock = params.hashlock;

    if (params.amount <= 0) throw new Error('Amount must be > 0');
    if (hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
    if (params.timelockDelta < MIN_DELAY_SEC) throw new Error('Timelock must be ≥ 900 seconds');
    if (params.reward > 0 && params.rewardTimelockDelta >= params.timelockDelta)
      throw new Error('rewardTimelockDelta must be < timelockDelta');
    if (params.reward > 0 && params.rewardTimelockDelta < MIN_DELAY_SEC)
      throw new Error('rewardTimelockDelta must be ≥ 900 seconds');

    const xSender = this.toXOnly(sender.publicKey);
    const xRecipient = this.toXOnly(recipientPubKey);
    const xRewardRecipient = this.toXOnly(rewardRecipientPubKey);

    const csvTimelock = this.csvSeconds(params.timelockDelta);
    const csvRewardTimelock = params.reward > 0 ? this.csvSeconds(params.rewardTimelockDelta) : 0;

    // Amount UTXO
    const amountLeafHashlock = script.compile([
      opcodes.OP_SHA256, hashlock, opcodes.OP_EQUALVERIFY, xRecipient, opcodes.OP_CHECKSIG,
    ]);
    const amountLeafRefund = script.compile([
      script.number.encode(csvTimelock), opcodes.OP_CHECKSEQUENCEVERIFY, opcodes.OP_DROP, xSender, opcodes.OP_CHECKSIG,
    ]);
    const amountTree: [Taptree, Taptree] = [
      { output: amountLeafHashlock, version: TAPLEAF_VER_TAPSCRIPT },
      { output: amountLeafRefund, version: TAPLEAF_VER_TAPSCRIPT },
    ];

    const amountInternalPubkey = this.getHiddenUnspendableInternalKey();
    const amountP2tr = payments.p2tr({ internalPubkey: amountInternalPubkey, scriptTree: amountTree, network: this.network });
    if (!amountP2tr.address || !amountP2tr.output) throw new Error('Failed to derive amount P2TR');

    const amountDeriveCtrl = (leaf: Buffer) => {
      const r = payments.p2tr({ internalPubkey: amountInternalPubkey, scriptTree: amountTree, redeem: { output: leaf, redeemVersion: TAPLEAF_VER_TAPSCRIPT }, network: this.network });
      return r.witness![r.witness!.length - 1];
    };
    const amountCtrlHashlock = amountDeriveCtrl(amountLeafHashlock);
    const amountCtrlRefund = amountDeriveCtrl(amountLeafRefund);

    // Reward UTXO (if reward > 0)
    let rewardP2tr: ReturnType<typeof payments.p2tr> | undefined;
    let rewardInternalPubkey: Buffer | undefined;
    let rewardLeafPriority: Buffer | undefined;
    let rewardLeafDelayed: Buffer | undefined;
    let rewardLeafRefund: Buffer | undefined;
    let rewardCtrlPriority: Buffer | undefined;
    let rewardCtrlDelayed: Buffer | undefined;
    let rewardCtrlRefund: Buffer | undefined;

    if (params.reward > 0) {
      rewardLeafPriority = script.compile([
        opcodes.OP_SHA256, hashlock, opcodes.OP_EQUALVERIFY, xRewardRecipient, opcodes.OP_CHECKSIG,
      ]);
      rewardLeafDelayed = script.compile([
        script.number.encode(csvRewardTimelock), opcodes.OP_CHECKSEQUENCEVERIFY, opcodes.OP_DROP,
        opcodes.OP_SHA256, hashlock, opcodes.OP_EQUALVERIFY, xRecipient, opcodes.OP_CHECKSIG,
      ]);
      rewardLeafRefund = script.compile([
        script.number.encode(csvTimelock), opcodes.OP_CHECKSEQUENCEVERIFY, opcodes.OP_DROP, xSender, opcodes.OP_CHECKSIG,
      ]);

      const rewardTree: [Taptree, [Taptree, Taptree]] = [
        { output: rewardLeafPriority, version: TAPLEAF_VER_TAPSCRIPT },
        [
          { output: rewardLeafDelayed, version: TAPLEAF_VER_TAPSCRIPT },
          { output: rewardLeafRefund, version: TAPLEAF_VER_TAPSCRIPT },
        ],
      ];

      rewardInternalPubkey = this.getHiddenUnspendableInternalKey();
      rewardP2tr = payments.p2tr({ internalPubkey: rewardInternalPubkey, scriptTree: rewardTree, network: this.network });
      if (!rewardP2tr.address || !rewardP2tr.output) throw new Error('Failed to derive reward P2TR');

      const rewardDeriveCtrl = (leaf: Buffer) => {
        const r = payments.p2tr({ internalPubkey: rewardInternalPubkey!, scriptTree: rewardTree, redeem: { output: leaf, redeemVersion: TAPLEAF_VER_TAPSCRIPT }, network: this.network });
        return r.witness![r.witness!.length - 1];
      };
      rewardCtrlPriority = rewardDeriveCtrl(rewardLeafPriority);
      rewardCtrlDelayed = rewardDeriveCtrl(rewardLeafDelayed);
      rewardCtrlRefund = rewardDeriveCtrl(rewardLeafRefund);
    }

    // Build transaction
    const senderP2tr = payments.p2tr({ internalPubkey: xSender, network: this.network });
    if (!senderP2tr.address || !senderP2tr.output) throw new Error('Failed to derive sender P2TR');

    const utxos = await this.getUtxos(senderP2tr.address);
    if (!utxos.length) throw new Error(`No UTXOs for ${senderP2tr.address}`);

    const totalNeeded = params.amount + params.reward + fee;
    const selected: typeof utxos = [];
    let totalIn = 0;
    for (const u of utxos) { selected.push(u); totalIn += u.value; if (totalIn >= totalNeeded) break; }
    if (totalIn < totalNeeded) throw new Error(`Insufficient funds: need ${totalNeeded}, have ${totalIn}`);

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);
    for (const u of selected) {
      psbt.addInput({ hash: u.hash, index: u.index, witnessUtxo: { script: senderP2tr.output, value: u.value }, tapInternalKey: xSender, sequence: 0xfffffffd });
    }

    const change = totalIn - totalNeeded;
    const amountVout = 0;
    const amountValue = params.amount + (change > 0 && change < DUST_P2WPKH && params.reward === 0 ? change : 0);
    psbt.addOutput({ address: amountP2tr.address, value: amountValue });

    let rewardVout: number | undefined;
    if (rewardP2tr && params.reward > 0) {
      rewardVout = psbt.txOutputs.length;
      psbt.addOutput({ address: rewardP2tr.address!, value: params.reward });
    }

    const eventPayload = encodeSolverLockedEvent({
      hashlock, index: params.index, timelockDelta: params.timelockDelta, rewardTimelockDelta: params.rewardTimelockDelta,
      reward: BigInt(params.reward), dstAmount: dst.dstAmount, dstChain: dst.dstChain, dstAddress: dst.dstAddress, dstToken: dst.dstToken, data: data ?? Buffer.alloc(0),
    });
    const { script: opret, value: opretVal } = this.createOpReturnOutput(eventPayload);
    psbt.addOutput({ script: opret, value: opretVal });

    if (change >= DUST_P2WPKH) {
      const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address!;
      psbt.addOutput({ address: senderAddress, value: change });
    }

    const tweakedSigner = sender.tweak(taggedHash('TapTweak', xSender));
    for (let i = 0; i < selected.length; i++) psbt.signInput(i, tweakedSigner);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txid = await this.postTransaction(tx.toHex());

    const mkTapleaf = (leaf: Buffer, ctrl: Buffer): TapleafInfo => ({
      leafVersion: TAPLEAF_VER_TAPSCRIPT, scriptHex: leaf.toString('hex'), controlBlockHex: Buffer.from(ctrl).toString('hex'),
    });

    const result: any = {
      txid, index: params.index, timelock: csvTimelock, rewardTimelock: csvRewardTimelock,
      amountContractAddress: amountP2tr.address, amountContractVout: amountVout, amountValue,
      amountInternalPubkeyHex: Buffer.from(amountInternalPubkey).toString('hex'),
      amountP2trScriptPubKeyHex: amountP2tr.output.toString('hex'),
      amountTapleafHashlock: mkTapleaf(amountLeafHashlock, amountCtrlHashlock),
      amountTapleafRefund: mkTapleaf(amountLeafRefund, amountCtrlRefund),
    };

    if (rewardP2tr && rewardInternalPubkey && rewardLeafPriority && rewardLeafDelayed && rewardLeafRefund && rewardCtrlPriority && rewardCtrlDelayed && rewardCtrlRefund) {
      result.rewardContractAddress = rewardP2tr.address!;
      result.rewardContractVout = rewardVout;
      result.rewardValue = params.reward;
      result.rewardInternalPubkeyHex = Buffer.from(rewardInternalPubkey).toString('hex');
      result.rewardP2trScriptPubKeyHex = rewardP2tr.output!.toString('hex');
      result.rewardTapleafPriority = mkTapleaf(rewardLeafPriority, rewardCtrlPriority);
      result.rewardTapleafDelayed = mkTapleaf(rewardLeafDelayed, rewardCtrlDelayed);
      result.rewardTapleafRefund = mkTapleaf(rewardLeafRefund, rewardCtrlRefund);
    }

    return result;
  }

  // ─── 3. redeemUser ──────────────────────────────────────────

  /**
   * Redeem a user lock with the secret preimage. Single call.
   *
   * Spends the hashlock leaf: OP_SHA256 <hashlock> OP_EQUALVERIFY <xRecipient> OP_CHECKSIG
   * Witness: [recipientSig, secret, leafScript, controlBlock]
   */
  public async redeemUser(
    prev: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_hashlock: TapleafInfo;
    },
    params: {
      recipient: ECPairInterface;
      secret: Buffer;
      hashlock: Buffer;
      feeSat: number;
      feeUtxos: { hash: string; index: number; value: number }[];
    }
  ): Promise<{ txid: string; hex: string }> {
    if (!params.hashlock || params.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
    if (!params.secret || params.secret.length !== 32) throw new Error('secret must be 32 bytes');
    const feeSat = params.feeSat >>> 0;
    if (!Number.isFinite(feeSat) || feeSat <= 0) throw new Error('feeSat must be > 0');
    if (!params.feeUtxos?.length) throw new Error('feeUtxos required');

    const leafScript = Buffer.from(prev.tapleaf_hashlock.scriptHex, 'hex');
    const controlBlock = Buffer.from(prev.tapleaf_hashlock.controlBlockHex, 'hex');

    // Validate leaf shape
    const d = script.decompile(leafScript) || [];
    if (!(d.length === 5 && d[0] === opcodes.OP_SHA256 && Buffer.isBuffer(d[1]) && (d[1] as Buffer).length === 32 && d[2] === opcodes.OP_EQUALVERIFY && Buffer.isBuffer(d[3]) && (d[3] as Buffer).length === 32 && d[4] === opcodes.OP_CHECKSIG)) {
      throw new Error('hashlock leaf shape mismatch');
    }

    const hashlockInLeaf = d[1] as Buffer;
    const h = createHash('sha256').update(params.secret).digest();
    if (!h.equals(hashlockInLeaf)) throw new Error('secret does not match hashlock in leaf');

    const xRecipient = this.toXOnly(params.recipient.publicKey);
    const xRecvInLeaf = d[3] as Buffer;
    if (!xRecipient.equals(xRecvInLeaf)) throw new Error('recipient key does not match leaf');

    const recipientP2WPKH = payments.p2wpkh({ pubkey: params.recipient.publicKey, network: this.network });
    if (!recipientP2WPKH.address || !recipientP2WPKH.output) throw new Error('Could not derive recipient P2WPKH');

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    // Input 0: Contract UTXO (tapscript hashlock leaf)
    psbt.addInput({
      hash: prev.txid,
      index: prev.contractVout,
      sequence: 0xfffffffd,
      witnessUtxo: { script: Buffer.from(prev.p2trScriptPubKeyHex, 'hex'), value: prev.value },
      tapLeafScript: [{ leafVersion: prev.tapleaf_hashlock.leafVersion, script: leafScript, controlBlock }],
    });

    // Fee inputs
    let totalFeeInput = 0;
    for (const u of params.feeUtxos) {
      psbt.addInput({ hash: u.hash, index: u.index, sequence: 0xfffffffd, witnessUtxo: { script: recipientP2WPKH.output, value: u.value } });
      totalFeeInput += u.value >>> 0;
    }
    if (totalFeeInput < feeSat) throw new Error(`Insufficient fee inputs: need ${feeSat}, have ${totalFeeInput}`);

    // Output: funds to recipient
    psbt.addOutput({ address: recipientP2WPKH.address, value: prev.value });

    // OP_RETURN: UserRedeemed event
    const eventPayload = encodeUserRedeemedEvent(hashlockInLeaf, params.secret);
    const { script: opretScript, value: opretValue } = this.createOpReturnOutput(eventPayload);
    psbt.addOutput({ script: opretScript, value: opretValue });

    // Fee change
    const feeChange = totalFeeInput - feeSat;
    if (feeChange >= DUST_CHANGE) psbt.addOutput({ address: recipientP2WPKH.address, value: feeChange });

    // Sign tapscript input
    psbt.signInput(0, params.recipient);
    // Sign fee inputs
    for (let i = 0; i < params.feeUtxos.length; i++) psbt.signInput(1 + i, params.recipient);

    // Normalize Schnorr sigs
    {
      const t = psbt.data.inputs[0].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64);
        if (e.signature.length !== 64) throw new Error('unexpected Schnorr length on hashlock input');
      }
      if (!t.some((e) => Buffer.from(e.pubkey).equals(xRecipient))) throw new Error('missing recipient tapscript sig');
    }

    // Finalize fee inputs
    for (let i = 1; i < psbt.data.inputs.length; i++) psbt.finalizeInput(i);

    // Finalize hashlock input: witness = [sig, secret, leafScript, controlBlock]
    psbt.finalizeInput(0, () => {
      const sig = (psbt.data.inputs[0].tapScriptSig || [])[0]?.signature;
      if (!sig || sig.length !== 64) throw new Error('missing/invalid recipient signature');
      return { finalScriptWitness: this.packWitness([sig, params.secret, leafScript, controlBlock]) };
    });

    const tx = psbt.extractTransaction();
    const hex = tx.toHex();
    const txid = await this.postTransaction(hex);
    return { txid, hex };
  }

  // ─── 4. redeemSolver ────────────────────────────────────────

  /**
   * Redeem a solver lock. Single call that handles amount and/or reward UTXOs.
   *
   * Reward timing logic:
   *   Before rewardTimelock: recipient redeems amount, rewardRecipient claims reward separately (priority leaf)
   *   After rewardTimelock:  recipient redeems amount + reward atomically (delayed leaf)
   *
   * Pass amountUtxo and/or rewardUtxo depending on the scenario:
   *   - Recipient redeems amount only:         amountUtxo only
   *   - Recipient redeems amount + reward:     amountUtxo + rewardUtxo (delayed leaf + csvSequence)
   *   - RewardRecipient claims reward:         rewardUtxo only (priority leaf)
   */
  public async redeemSolver(
    amountUtxo: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_hashlock: TapleafInfo;
    } | null,
    rewardUtxo: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf: TapleafInfo;
      csvSequence?: number;
    } | null,
    params: {
      redeemer: ECPairInterface;
      secret: Buffer;
      hashlock: Buffer;
      index: number;
      feeSat: number;
      feeUtxos: { hash: string; index: number; value: number }[];
    }
  ): Promise<{ txid: string; hex: string }> {
    if (!amountUtxo && !rewardUtxo) throw new Error('At least one of amountUtxo or rewardUtxo must be provided');
    if (!params.secret || params.secret.length !== 32) throw new Error('secret must be 32 bytes');
    if (!params.hashlock || params.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
    const feeSat = params.feeSat >>> 0;
    if (!Number.isFinite(feeSat) || feeSat <= 0) throw new Error('feeSat must be > 0');
    if (!params.feeUtxos?.length) throw new Error('feeUtxos required');

    const redeemerP2WPKH = payments.p2wpkh({ pubkey: params.redeemer.publicKey, network: this.network });
    if (!redeemerP2WPKH.address || !redeemerP2WPKH.output) throw new Error('Could not derive redeemer P2WPKH');

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    const tapscriptInputs: { leafScript: Buffer; controlBlock: Buffer }[] = [];
    let totalRedeemValue = 0;

    // Add amount UTXO input (hashlock leaf)
    if (amountUtxo) {
      const ls = Buffer.from(amountUtxo.tapleaf_hashlock.scriptHex, 'hex');
      const cb = Buffer.from(amountUtxo.tapleaf_hashlock.controlBlockHex, 'hex');
      psbt.addInput({
        hash: amountUtxo.txid, index: amountUtxo.contractVout, sequence: 0xfffffffd,
        witnessUtxo: { script: Buffer.from(amountUtxo.p2trScriptPubKeyHex, 'hex'), value: amountUtxo.value },
        tapLeafScript: [{ leafVersion: amountUtxo.tapleaf_hashlock.leafVersion, script: ls, controlBlock: cb }],
      });
      tapscriptInputs.push({ leafScript: ls, controlBlock: cb });
      totalRedeemValue += amountUtxo.value;
    }

    // Add reward UTXO input (priority or delayed leaf)
    if (rewardUtxo) {
      const ls = Buffer.from(rewardUtxo.tapleaf.scriptHex, 'hex');
      const cb = Buffer.from(rewardUtxo.tapleaf.controlBlockHex, 'hex');
      psbt.addInput({
        hash: rewardUtxo.txid, index: rewardUtxo.contractVout,
        sequence: rewardUtxo.csvSequence ?? 0xfffffffd,
        witnessUtxo: { script: Buffer.from(rewardUtxo.p2trScriptPubKeyHex, 'hex'), value: rewardUtxo.value },
        tapLeafScript: [{ leafVersion: rewardUtxo.tapleaf.leafVersion, script: ls, controlBlock: cb }],
      });
      tapscriptInputs.push({ leafScript: ls, controlBlock: cb });
      totalRedeemValue += rewardUtxo.value;
    }

    const tapscriptCount = tapscriptInputs.length;

    // Fee inputs
    let totalFeeInput = 0;
    for (const u of params.feeUtxos) {
      psbt.addInput({ hash: u.hash, index: u.index, sequence: 0xfffffffd, witnessUtxo: { script: redeemerP2WPKH.output, value: u.value } });
      totalFeeInput += u.value >>> 0;
    }
    if (totalFeeInput < feeSat) throw new Error(`Insufficient fee inputs: need ${feeSat}, have ${totalFeeInput}`);

    // Output: all redeemed funds to redeemer
    psbt.addOutput({ address: redeemerP2WPKH.address, value: totalRedeemValue });

    // OP_RETURN: SolverRedeemed event
    const eventPayload = encodeSolverRedeemedEvent(params.hashlock, params.index, params.secret);
    const { script: opretScript, value: opretValue } = this.createOpReturnOutput(eventPayload);
    psbt.addOutput({ script: opretScript, value: opretValue });

    // Fee change
    const feeChange = totalFeeInput - feeSat;
    if (feeChange >= DUST_CHANGE) psbt.addOutput({ address: redeemerP2WPKH.address, value: feeChange });

    // Sign all tapscript inputs
    for (let i = 0; i < tapscriptCount; i++) psbt.signInput(i, params.redeemer);
    // Sign fee inputs
    for (let i = 0; i < params.feeUtxos.length; i++) psbt.signInput(tapscriptCount + i, params.redeemer);

    // Normalize Schnorr sigs on tapscript inputs
    const xRedeemer = this.toXOnly(params.redeemer.publicKey);
    for (let i = 0; i < tapscriptCount; i++) {
      const t = psbt.data.inputs[i].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64);
        if (e.signature.length !== 64) throw new Error('unexpected Schnorr length');
      }
      if (!t.some((e) => Buffer.from(e.pubkey).equals(xRedeemer))) throw new Error('missing redeemer tapscript sig');
    }

    // Finalize fee inputs
    for (let i = tapscriptCount; i < psbt.data.inputs.length; i++) psbt.finalizeInput(i);

    // Finalize tapscript inputs: witness = [sig, secret, leafScript, controlBlock]
    for (let i = 0; i < tapscriptCount; i++) {
      const { leafScript, controlBlock } = tapscriptInputs[i];
      psbt.finalizeInput(i, () => {
        const sig = (psbt.data.inputs[i].tapScriptSig || [])[0]?.signature;
        if (!sig || sig.length !== 64) throw new Error(`missing/invalid signature on input ${i}`);
        return { finalScriptWitness: this.packWitness([sig, params.secret, leafScript, controlBlock]) };
      });
    }

    const tx = psbt.extractTransaction();
    const hex = tx.toHex();
    const txid = await this.postTransaction(hex);
    return { txid, hex };
  }

  // ─── 5. refundUser ──────────────────────────────────────────

  /**
   * Refund a user lock back to the sender (CSV path — after timelock expires).
   *
   * For cooperative refund (recipient-initiated, anytime), use
   * refundUserCooperativeInit + refundUserCooperativeFinalize.
   */
  public async refundUser(
    prev: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_refund: TapleafInfo;
    },
    params: {
      sender: ECPairInterface;
      hashlock: Buffer;
      feeSat: number;
      feeUtxos: { hash: string; index: number; value: number }[];
      refundAddress?: string;
    }
  ): Promise<{ txid: string; hex: string }> {
    if (!params.hashlock || params.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
    const feeSat = params.feeSat >>> 0;
    if (!Number.isFinite(feeSat) || feeSat <= 0) throw new Error('feeSat must be > 0');
    if (!params.feeUtxos?.length) throw new Error('feeUtxos required');

    const leafScript = Buffer.from(prev.tapleaf_refund.scriptHex, 'hex');
    const controlBlock = Buffer.from(prev.tapleaf_refund.controlBlockHex, 'hex');

    const d = script.decompile(leafScript) || [];
    const csvBuf = d[0] as Buffer;
    if (!(Buffer.isBuffer(csvBuf) && d[1] === opcodes.OP_CHECKSEQUENCEVERIFY && d[2] === opcodes.OP_DROP && Buffer.isBuffer(d[3]) && (d[3] as Buffer).length === 32 && d[4] === opcodes.OP_CHECKSIG)) {
      throw new Error('refund leaf shape mismatch (expected CSV path)');
    }
    const requiredSequence = script.number.decode(csvBuf) >>> 0;

    const senderP2WPKH = payments.p2wpkh({ pubkey: params.sender.publicKey, network: this.network });
    if (!senderP2WPKH.address || !senderP2WPKH.output) throw new Error('Could not derive sender P2WPKH');

    const refundScript = params.refundAddress
      ? address.toOutputScript(params.refundAddress, this.network)
      : senderP2WPKH.output;

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    psbt.addInput({
      hash: prev.txid, index: prev.contractVout, sequence: requiredSequence,
      witnessUtxo: { script: Buffer.from(prev.p2trScriptPubKeyHex, 'hex'), value: prev.value },
      tapLeafScript: [{ leafVersion: prev.tapleaf_refund.leafVersion, script: leafScript, controlBlock }],
    });

    let totalFeeInput = 0;
    for (const u of params.feeUtxos) {
      psbt.addInput({ hash: u.hash, index: u.index, sequence: 0xfffffffd, witnessUtxo: { script: senderP2WPKH.output, value: u.value } });
      totalFeeInput += u.value >>> 0;
    }
    if (totalFeeInput < feeSat) throw new Error(`Insufficient fee inputs: need ${feeSat}, have ${totalFeeInput}`);

    psbt.addOutput({ script: refundScript, value: prev.value });

    const eventPayload = encodeUserRefundedEvent(params.hashlock);
    const { script: opretScript, value: opretValue } = this.createOpReturnOutput(eventPayload);
    psbt.addOutput({ script: opretScript, value: opretValue });

    const feeChange = totalFeeInput - feeSat;
    if (feeChange >= DUST_CHANGE) psbt.addOutput({ script: refundScript, value: feeChange });

    psbt.signInput(0, params.sender);
    for (let i = 0; i < params.feeUtxos.length; i++) psbt.signInput(1 + i, params.sender);

    {
      const t = psbt.data.inputs[0].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64);
        if (e.signature.length !== 64) throw new Error('unexpected Schnorr length');
      }
      const xSender = this.toXOnly(params.sender.publicKey);
      if (!t.some((e) => Buffer.from(e.pubkey).equals(xSender))) throw new Error('missing refund tapscript sig');
    }

    for (let i = 1; i < psbt.data.inputs.length; i++) psbt.finalizeInput(i);

    psbt.finalizeInput(0, () => {
      const sig = (psbt.data.inputs[0].tapScriptSig || [])[0]?.signature;
      if (!sig || sig.length !== 64) throw new Error('missing/invalid refund signature');
      return { finalScriptWitness: this.packWitness([sig, leafScript, controlBlock]) };
    });

    const tx = psbt.extractTransaction();
    const hex = tx.toHex();
    const txid = await this.postTransaction(hex);
    return { txid, hex };
  }

  /**
   * Cooperative refund Phase 1: Recipient initiates (recipient can refund anytime).
   * Recipient signs with SIGHASH_SINGLE|ANYONECANPAY, returns PSBT for sender to finalize.
   */
  public async refundUserCooperativeInit(
    prev: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_coop_refund: TapleafInfo;
    },
    params: {
      recipient: ECPairInterface;
      hashlock: Buffer;
      refundAddress: string;
    }
  ): Promise<string> {
    if (!params.hashlock || params.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');

    const leafScript = Buffer.from(prev.tapleaf_coop_refund.scriptHex, 'hex');
    const controlBlock = Buffer.from(prev.tapleaf_coop_refund.controlBlockHex, 'hex');
    const COOP_SIGHASH = Transaction.SIGHASH_SINGLE | Transaction.SIGHASH_ANYONECANPAY;

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    psbt.addInput({
      hash: prev.txid, index: prev.contractVout, sequence: 0xfffffffd,
      witnessUtxo: { script: Buffer.from(prev.p2trScriptPubKeyHex, 'hex'), value: prev.value },
      tapLeafScript: [{ leafVersion: prev.tapleaf_coop_refund.leafVersion, script: leafScript, controlBlock }],
      sighashType: COOP_SIGHASH,
    });

    psbt.addOutput({ address: params.refundAddress, value: prev.value });

    const eventPayload = encodeUserRefundedEvent(params.hashlock);
    const { script: opretScript, value: opretValue } = this.createOpReturnOutput(eventPayload);
    psbt.addOutput({ script: opretScript, value: opretValue });

    psbt.signInput(0, params.recipient, [COOP_SIGHASH]);

    const t = psbt.data.inputs[0].tapScriptSig || [];
    for (const e of t) {
      if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64);
    }
    const xRecipient = this.toXOnly(params.recipient.publicKey);
    if (!t.some((e) => Buffer.from(e.pubkey).equals(xRecipient))) throw new Error('missing recipient tapscript sig');

    return psbt.toBase64();
  }

  /**
   * Cooperative refund Phase 2: Sender finalizes and broadcasts.
   */
  public async refundUserCooperativeFinalize(
    psbtBase64: string,
    sender: ECPairInterface,
    feeSat: number,
    feeUtxos: { hash: string; index: number; value: number }[]
  ): Promise<{ txid: string; hex: string }> {
    const fee = feeSat >>> 0;
    if (!Number.isFinite(fee) || fee <= 0) throw new Error('feeSat must be > 0');
    if (!feeUtxos?.length) throw new Error('feeUtxos required');

    const psbt = Psbt.fromBase64(psbtBase64, { network: this.network });
    const in0 = psbt.data.inputs[0];
    if (!in0?.tapLeafScript?.length) throw new Error('Input 0 missing tapLeafScript');

    const senderP2WPKH = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network });
    const senderOut = senderP2WPKH.output!;
    const senderAddr = senderP2WPKH.address!;

    let totalFeeInput = 0;
    for (const u of feeUtxos) {
      psbt.addInput({ hash: u.hash, index: u.index, sequence: 0xfffffffd, witnessUtxo: { script: senderOut, value: u.value } });
      totalFeeInput += u.value >>> 0;
    }
    if (totalFeeInput < fee) throw new Error(`Insufficient fee inputs: need ${fee}, have ${totalFeeInput}`);

    const change = totalFeeInput - fee;
    if (change >= DUST_CHANGE) psbt.addOutput({ address: senderAddr, value: change });

    psbt.signInput(0, sender, [Transaction.SIGHASH_SINGLE | Transaction.SIGHASH_ANYONECANPAY]);
    for (let i = 0; i < feeUtxos.length; i++) psbt.signInput(1 + i, sender);

    { const t = psbt.data.inputs[0].tapScriptSig || []; for (const e of t) { if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64); } }

    for (let i = 1; i < psbt.data.inputs.length; i++) psbt.finalizeInput(i);

    const leafPack = in0.tapLeafScript[0];
    const leafScript = leafPack.script;
    const controlBlock = leafPack.controlBlock;
    const d = script.decompile(leafScript) || [];
    const pk1 = (d[0] as Buffer) || Buffer.alloc(0);
    const pk2 = (d[2] as Buffer) || Buffer.alloc(0);
    if (pk1.length !== 32 || pk2.length !== 32) throw new Error('Leaf does not look like [xSender, CHECKSIGVERIFY, xRecipient, CHECKSIG]');

    const tss = psbt.data.inputs[0].tapScriptSig || [];
    const byPk = new Map<string, Buffer>();
    for (const e of tss) byPk.set(Buffer.from(e.pubkey).toString('hex'), e.signature);

    const senderSig = byPk.get(pk1.toString('hex'));
    const recipientSig = byPk.get(pk2.toString('hex'));
    if (!senderSig || !recipientSig) throw new Error('Missing schnorr sigs for cooperative refund leaf');

    psbt.finalizeInput(0, () => {
      return { finalScriptWitness: this.packWitness([recipientSig, senderSig, leafScript, controlBlock]) };
    });

    const tx = psbt.extractTransaction();
    const hex = tx.toHex();
    const txid = await this.postTransaction(hex);
    return { txid, hex };
  }

  // ─── 6. refundSolver ────────────────────────────────────────

  /**
   * Refund a solver lock (amount + reward UTXOs) after timelock expires.
   * Atomic: spends both UTXOs in a single transaction.
   */
  public async refundSolver(
    amountUtxo: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_refund: TapleafInfo;
    },
    rewardUtxo: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_refund: TapleafInfo;
    } | null,
    params: {
      sender: ECPairInterface;
      hashlock: Buffer;
      index: number;
      feeSat: number;
      feeUtxos: { hash: string; index: number; value: number }[];
      refundAddress?: string;
    }
  ): Promise<{ txid: string; hex: string }> {
    if (!params.hashlock || params.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
    const feeSat = params.feeSat >>> 0;
    if (!Number.isFinite(feeSat) || feeSat <= 0) throw new Error('feeSat must be > 0');
    if (!params.feeUtxos?.length) throw new Error('feeUtxos required');

    const senderP2WPKH = payments.p2wpkh({ pubkey: params.sender.publicKey, network: this.network });
    if (!senderP2WPKH.address || !senderP2WPKH.output) throw new Error('Could not derive sender P2WPKH');

    const refundScript = params.refundAddress
      ? address.toOutputScript(params.refundAddress, this.network)
      : senderP2WPKH.output;

    const parseCSV = (tapleaf: TapleafInfo): number => {
      const leaf = Buffer.from(tapleaf.scriptHex, 'hex');
      const d = script.decompile(leaf) || [];
      if (!Buffer.isBuffer(d[0])) throw new Error('refund leaf: expected CSV buffer at position 0');
      return script.number.decode(d[0] as Buffer) >>> 0;
    };

    const amountCSV = parseCSV(amountUtxo.tapleaf_refund);
    const rewardCSV = rewardUtxo ? parseCSV(rewardUtxo.tapleaf_refund) : 0;

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    const tapscriptInputs: { leafScript: Buffer; controlBlock: Buffer }[] = [];

    const amountLeafScript = Buffer.from(amountUtxo.tapleaf_refund.scriptHex, 'hex');
    const amountControlBlock = Buffer.from(amountUtxo.tapleaf_refund.controlBlockHex, 'hex');
    psbt.addInput({
      hash: amountUtxo.txid, index: amountUtxo.contractVout, sequence: amountCSV,
      witnessUtxo: { script: Buffer.from(amountUtxo.p2trScriptPubKeyHex, 'hex'), value: amountUtxo.value },
      tapLeafScript: [{ leafVersion: amountUtxo.tapleaf_refund.leafVersion, script: amountLeafScript, controlBlock: amountControlBlock }],
    });
    tapscriptInputs.push({ leafScript: amountLeafScript, controlBlock: amountControlBlock });

    if (rewardUtxo) {
      const rLeaf = Buffer.from(rewardUtxo.tapleaf_refund.scriptHex, 'hex');
      const rCtrl = Buffer.from(rewardUtxo.tapleaf_refund.controlBlockHex, 'hex');
      psbt.addInput({
        hash: rewardUtxo.txid, index: rewardUtxo.contractVout, sequence: rewardCSV,
        witnessUtxo: { script: Buffer.from(rewardUtxo.p2trScriptPubKeyHex, 'hex'), value: rewardUtxo.value },
        tapLeafScript: [{ leafVersion: rewardUtxo.tapleaf_refund.leafVersion, script: rLeaf, controlBlock: rCtrl }],
      });
      tapscriptInputs.push({ leafScript: rLeaf, controlBlock: rCtrl });
    }

    const tapscriptCount = tapscriptInputs.length;

    let totalFeeInput = 0;
    for (const u of params.feeUtxos) {
      psbt.addInput({ hash: u.hash, index: u.index, sequence: 0xfffffffd, witnessUtxo: { script: senderP2WPKH.output, value: u.value } });
      totalFeeInput += u.value >>> 0;
    }
    if (totalFeeInput < feeSat) throw new Error(`Insufficient fee inputs: need ${feeSat}, have ${totalFeeInput}`);

    const totalRefund = amountUtxo.value + (rewardUtxo?.value ?? 0);
    psbt.addOutput({ script: refundScript, value: totalRefund });

    const eventPayload = encodeSolverRefundedEvent(params.hashlock, params.index);
    const { script: opretScript, value: opretValue } = this.createOpReturnOutput(eventPayload);
    psbt.addOutput({ script: opretScript, value: opretValue });

    const feeChange = totalFeeInput - feeSat;
    if (feeChange >= DUST_CHANGE) psbt.addOutput({ script: refundScript, value: feeChange });

    for (let i = 0; i < tapscriptCount; i++) psbt.signInput(i, params.sender);
    for (let i = 0; i < params.feeUtxos.length; i++) psbt.signInput(tapscriptCount + i, params.sender);

    const xSenderKey = this.toXOnly(params.sender.publicKey);
    for (let i = 0; i < tapscriptCount; i++) {
      const t = psbt.data.inputs[i].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64);
        if (e.signature.length !== 64) throw new Error('unexpected Schnorr length');
      }
      if (!t.some((e) => Buffer.from(e.pubkey).equals(xSenderKey))) throw new Error('missing sender tapscript sig');
    }

    for (let i = tapscriptCount; i < psbt.data.inputs.length; i++) psbt.finalizeInput(i);

    for (let i = 0; i < tapscriptCount; i++) {
      const { leafScript, controlBlock } = tapscriptInputs[i];
      psbt.finalizeInput(i, () => {
        const sig = (psbt.data.inputs[i].tapScriptSig || [])[0]?.signature;
        if (!sig || sig.length !== 64) throw new Error(`missing/invalid refund signature on input ${i}`);
        return { finalScriptWitness: this.packWitness([sig, leafScript, controlBlock]) };
      });
    }

    const tx = psbt.extractTransaction();
    const hex = tx.toHex();
    const txid = await this.postTransaction(hex);
    return { txid, hex };
  }

  // ─── Utility Helpers ────────────────────────────────────────

  public async convertP2WPKHtoP2TR(
    sender: ECPairInterface,
    amount: number,
    opts?: { fee?: number }
  ): Promise<{ txid: string; contractAddress: string; value: number; contractVout: number; internalPubkeyHex: string; p2trScriptPubKeyHex: string }> {
    const fee = opts?.fee ?? 311;
    const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address!;
    const utxos = await this.getUtxos(senderAddress);
    if (!utxos.length) throw new Error(`No UTXOs for ${senderAddress}`);

    const xOnly = this.toXOnly(sender.publicKey);
    const p2tr = payments.p2tr({ internalPubkey: xOnly, network: this.network });
    if (!p2tr.address || !p2tr.output) throw new Error('Failed to derive P2TR');
    const target = amount >>> 0;

    const selected: typeof utxos = [];
    let totalIn = 0;
    for (const u of utxos) { selected.push(u); totalIn += u.value >>> 0; if (target > 0 && totalIn >= target + fee) break; }
    if (target > 0 && totalIn < target + fee) throw new Error(`Insufficient funds: need ${target + fee}, have ${totalIn}`);

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);
    const senderOut = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).output!;
    for (const u of selected) {
      psbt.addInput({ hash: u.hash, index: u.index, witnessUtxo: { script: senderOut, value: u.value }, sequence: 0xfffffffd });
    }

    let sendValue = target > 0 ? target : Math.max(0, totalIn - fee);
    let change = totalIn - sendValue - fee;
    if (change > 0 && change < DUST_P2WPKH) { sendValue += change; change = 0; }

    psbt.addOutput({ address: p2tr.address, value: sendValue });
    if (change >= DUST_P2WPKH) psbt.addOutput({ address: senderAddress, value: change });

    for (let i = 0; i < selected.length; i++) psbt.signInput(i, sender);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txid = await this.postTransaction(tx.toHex());

    return { txid, contractAddress: p2tr.address, value: sendValue, contractVout: 0, internalPubkeyHex: Buffer.from(xOnly).toString('hex'), p2trScriptPubKeyHex: p2tr.output.toString('hex') };
  }

  public async convertP2TRtoP2WPKH(
    sender: ECPairInterface,
    opts?: { fee?: number; utxo?: { hash: string; index: number; value: number } }
  ): Promise<{ txid: string; toAddress: string; value: number; vout: number }> {
    const fee = opts?.fee ?? 311;
    const xOnly = this.toXOnly(sender.publicKey);
    const p2trKey = payments.p2tr({ internalPubkey: xOnly, network: this.network });
    if (!p2trKey.address || !p2trKey.output) throw new Error('Failed to derive key-path P2TR');
    const expectScriptHex = p2trKey.output.toString('hex');

    let utxo = opts?.utxo;
    if (!utxo) {
      const addrUtxos = await this.getUtxos(p2trKey.address);
      if (!addrUtxos.length) throw new Error(`No P2TR UTXOs for ${p2trKey.address}`);
      const verified: typeof addrUtxos = [];
      for (const u of addrUtxos) {
        const tx = await (this.mempool as any).transactions.getTx({ txid: u.hash });
        if (tx.vout[u.index].scriptpubkey?.toLowerCase() === expectScriptHex) verified.push(u);
      }
      if (!verified.length) throw new Error('Found P2TR UTXOs but none match key-path scriptPubKey');
      utxo = verified.sort((a, b) => b.value - a.value)[0];
    }

    if (utxo.value <= fee) throw new Error(`UTXO too small: value=${utxo.value}, fee=${fee}`);
    const to = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network });
    if (!to.address) throw new Error('Failed to derive destination P2WPKH');

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);
    psbt.addInput({ hash: utxo.hash, index: utxo.index, witnessUtxo: { script: p2trKey.output, value: utxo.value }, tapInternalKey: xOnly, sequence: 0xfffffffd });

    const sendValue = utxo.value - fee;
    psbt.addOutput({ address: to.address, value: sendValue });
    psbt.signInput(0, sender.tweak(taggedHash('TapTweak', xOnly)));
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txid = await this.postTransaction(tx.toHex());
    return { txid, toAddress: to.address, value: sendValue, vout: 0 };
  }
}
