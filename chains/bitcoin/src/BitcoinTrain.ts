import Bitcoin, { ChainArg } from './Bitcoin';
import { opcodes, payments, Psbt, script } from 'bitcoinjs-lib';
import { ECPairInterface, ECPairFactory } from 'ecpair';
import { CommitLog } from './Core';
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
 * TRAIN Protocol operations on the Bitcoin
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

  public async commit(
    sender: ECPairInterface,
    srcReceiverPubKey: Buffer,
    amount: number,
    delaySeconds: number,
    options?: { fee?: number; memo?: CommitLog | Buffer | string; data?: Uint8Array | string }
  ): Promise<{
    commitId: string;
    txid: string;
    contractAddress: string;
    timelock: number;
    internalPubkeyHex: string;
    p2trScriptPubKeyHex: string;
    contractVout: number;
    leaf_multisig_hex: string;
    leaf_refund_hex: string;
    ctrlblock_multisig_hex: string;
    ctrlblock_refund_hex: string;
    tapleaf_multisig: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
  }> {
    const fee = options?.fee ?? 311;

    if (delaySeconds < MIN_DELAY_SEC) throw new Error('Timelock must be ≥ 900 seconds');
    const csvDelay = this.csvSeconds(delaySeconds);

    const leaf_multisig = script.compile([
      this.toXOnly(sender.publicKey),
      opcodes.OP_CHECKSIGVERIFY,
      this.toXOnly(srcReceiverPubKey),
      opcodes.OP_CHECKSIG,
    ]);

    const leaf_refund = script.compile([
      script.number.encode(csvDelay),
      opcodes.OP_CHECKSEQUENCEVERIFY,
      opcodes.OP_DROP,
      this.toXOnly(sender.publicKey),
      opcodes.OP_CHECKSIG,
    ]);

    const tapLeaf1 = { output: leaf_multisig, version: TAPLEAF_VER_TAPSCRIPT };
    const tapLeaf2 = { output: leaf_refund, version: TAPLEAF_VER_TAPSCRIPT };
    const scriptTree: [Taptree, Taptree] = [tapLeaf1, tapLeaf2];

    const internalPubkey = this.getHiddenUnspendableInternalKey();
    const p2tr = payments.p2tr({ internalPubkey, scriptTree, network: this.network });
    if (!p2tr.address || !p2tr.output) throw new Error('Failed to derive P2TR');

    const contractAddress = p2tr.address;

    const redeemMultisig = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_multisig, redeemVersion: TAPLEAF_VER_TAPSCRIPT },
      network: this.network,
    });
    const ctrlblock_multisig = redeemMultisig.witness![redeemMultisig.witness!.length - 1];

    const redeemRefund = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_refund, redeemVersion: TAPLEAF_VER_TAPSCRIPT },
      network: this.network,
    });
    const ctrlblock_refund = redeemRefund.witness![redeemRefund.witness!.length - 1];

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
    psbt.setVersion(2);
    const senderOut = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).output!;
    for (const u of selected) {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        witnessUtxo: { script: senderOut, value: u.value },
      });
    }

    const change = totalIn - needed;

    const contractVout = 0;
    const contractValue = amount + (change > 0 && change < DUST_P2WPKH ? change : 0);
    psbt.addOutput({ address: contractAddress, value: contractValue });

    if (change >= DUST_P2WPKH) {
      psbt.addOutput({ address: senderAddress, value: change });
    }

    let commitId: string = '0x00';
    if (options?.memo !== undefined) {
      let memoBuf: Buffer;

      if (Buffer.isBuffer(options.memo)) {
        memoBuf = options.memo;
      } else if (typeof options.memo === 'string') {
        const hex = options.memo.replace(/^0x/i, '');
        memoBuf =
          /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0
            ? Buffer.from(hex, 'hex')
            : Buffer.from(options.memo, 'utf8');
      } else {
        commitId = options.memo.commitId.toString('hex');
        const memo: CommitLog = { ...options.memo, timelock: csvDelay };
        memoBuf = this.encodeCommitLog(memo);
      }

      const { script: opretScript, value } = this.createOpReturnOutput(memoBuf);
      psbt.addOutput({ script: opretScript, value });
    } else if (options?.data !== undefined) {
      const memoBuf =
        typeof options.data === 'string'
          ? (() => {
              const hex = options.data.replace(/^0x/i, '');
              return /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0
                ? Buffer.from(hex, 'hex')
                : Buffer.from(options.data, 'utf8');
            })()
          : Buffer.from(options.data);
      const { script: opretScript, value } = this.createOpReturnOutput(memoBuf);
      psbt.addOutput({ script: opretScript, value });
    }

    for (let i = 0; i < selected.length; i++) psbt.signInput(i, sender);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txhex = tx.toHex();
    const txid = await this.postTransaction(txhex);

    const internalPubkeyHex = Buffer.from(internalPubkey).toString('hex');
    const p2trScriptPubKeyHex = p2tr.output.toString('hex');
    const leaf_multisig_hex = leaf_multisig.toString('hex');
    const leaf_refund_hex = leaf_refund.toString('hex');
    const ctrlblock_multisig_hex = Buffer.from(ctrlblock_multisig).toString('hex');
    const ctrlblock_refund_hex = Buffer.from(ctrlblock_refund).toString('hex');

    return {
      commitId,
      txid,
      contractAddress,
      timelock: csvDelay,
      internalPubkeyHex,
      p2trScriptPubKeyHex,
      contractVout,
      leaf_multisig_hex,
      leaf_refund_hex,
      ctrlblock_multisig_hex,
      ctrlblock_refund_hex,
      tapleaf_multisig: {
        leafVersion: TAPLEAF_VER_TAPSCRIPT,
        scriptHex: leaf_multisig_hex,
        controlBlockHex: ctrlblock_multisig_hex,
      },
      tapleaf_refund: {
        leafVersion: TAPLEAF_VER_TAPSCRIPT,
        scriptHex: leaf_refund_hex,
        controlBlockHex: ctrlblock_refund_hex,
      },
    };
  }

  public encodeCommitLog(m: CommitLog): Buffer {
    if (!m.commitId || m.commitId.length !== 32) throw new Error('commitId must be 32 bytes');

    const tl6 = Buffer.alloc(6);
    const seq = BigInt(m.timelock);
    if (seq < 0n || seq > 0xffffffffffffn) throw new Error('timelock (sequence) out of uint48 range');
    tl6.writeUIntBE(Number(seq), 0, 6);

    const dstChain = (() => {
      const b = Buffer.from(m.dstChain ?? '', 'utf8');
      const out = Buffer.alloc(4);
      b.copy(out, 0, 0, Math.min(4, b.length));
      return out;
    })();

    const dstAddress = (() => {
      let b: Buffer;
      try {
        b = Buffer.from((m.dstAddress || '').replace(/^0x/, '').toLowerCase(), 'hex');
      } catch {
        b = Buffer.from(m.dstAddress || '', 'utf8');
      }
      return b.length === 20 ? b : createHash('sha256').update(b).digest().subarray(0, 20);
    })();

    const dstAsset = (() => {
      const b = Buffer.from(m.dstAsset ?? '', 'utf8');
      const out = Buffer.alloc(4);
      b.copy(out, 0, 0, Math.min(4, b.length));
      return out;
    })();

    const srcReceiver = (() => {
      const raw = m.srcReceiver ?? '';
      const b = Buffer.from(raw, 'utf8');
      if (b.length >= 12) return b.subarray(0, 12);
      const out = Buffer.alloc(12);
      b.copy(out, 0);
      return out;
    })();

    return Buffer.concat([m.commitId, tl6, dstChain, dstAddress, dstAsset, srcReceiver]);
  }

  public async addLockInit(
    prev: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_multisig: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    },
    params: {
      sender: ECPairInterface;
      srcReceiverPubKey: Buffer;
      commitId: Buffer;
      paymentHashlockHex: string;
      delaySeconds: number;
      feeSat: number;
      feeUtxos: { hash: string; index: number; value: number }[];
      refundTo?: string;
    }
  ): Promise<{
    psbtBase64: string;
    memoHex: string;
    new: {
      contractAddress: string;
      value: number;
      timelock: number;
      internalPubkeyHex: string;
      p2trScriptPubKeyHex: string;
      contractVout: number;
      leaf_hashlock_hex: string;
      leaf_refund_hex: string;
      ctrlblock_hashlock_hex: string;
      ctrlblock_refund_hex: string;
      tapleaf_hashlock: { leafVersion: number; scriptHex: string; controlBlockHex: string };
      tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    };
  }> {
    if (params.delaySeconds < MIN_DELAY_SEC) throw new Error('Timelock must be ≥ 900 seconds');
    const csvDelay = this.csvSeconds(params.delaySeconds);
    const xSender = this.toXOnly(params.sender.publicKey);
    const xRecv = this.toXOnly(params.srcReceiverPubKey);

    const hashlock = Buffer.from(params.paymentHashlockHex.replace(/^0x/i, ''), 'hex');
    if (hashlock.length !== 32) throw new Error('hashlock must be 32 bytes hex');

    const leaf_hashlock = script.compile([
      opcodes.OP_SHA256,
      hashlock,
      opcodes.OP_EQUALVERIFY,
      xRecv,
      opcodes.OP_CHECKSIG,
    ]);

    const leaf_refund = script.compile([
      script.number.encode(csvDelay),
      opcodes.OP_CHECKSEQUENCEVERIFY,
      opcodes.OP_DROP,
      xSender,
      opcodes.OP_CHECKSIG,
    ]);

    const tapLeafHash = { output: leaf_hashlock, version: TAPLEAF_VER_TAPSCRIPT };
    const tapLeafRefund = { output: leaf_refund, version: TAPLEAF_VER_TAPSCRIPT };
    const scriptTree: [Taptree, Taptree] = [tapLeafHash, tapLeafRefund];

    const internalPubkey = this.getHiddenUnspendableInternalKey();
    const p2trNew = payments.p2tr({ internalPubkey, scriptTree, network: this.network });
    if (!p2trNew.address || !p2trNew.output) throw new Error('Failed to derive new P2TR');

    const redeemHash = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_hashlock, redeemVersion: TAPLEAF_VER_TAPSCRIPT },
      network: this.network,
    });
    const ctrlblock_hash = redeemHash.witness![redeemHash.witness!.length - 1];

    const redeemRefund = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_refund, redeemVersion: TAPLEAF_VER_TAPSCRIPT },
      network: this.network,
    });
    const ctrlblock_ref = redeemRefund.witness![redeemRefund.witness!.length - 1];

    if (!params.commitId || params.commitId.length !== 32) throw new Error('commitId must be 32 bytes');

    const tl6 = Buffer.alloc(6);
    tl6.writeUIntBE(csvDelay >>> 0, 0, 6);
    const memoBuf = Buffer.concat([params.commitId, hashlock, tl6]);
    const memoHex = memoBuf.toString('hex');

    const feeSat = params.feeSat >>> 0;
    if (!Number.isFinite(feeSat) || feeSat <= 0) throw new Error('feeSat must be > 0');

    const feeUtxos = params.feeUtxos || [];
    if (!feeUtxos.length) throw new Error('feeUtxos required to fund the fee');

    const totalFeeInput = feeUtxos.reduce((s, u) => s + (u.value >>> 0), 0);
    if (totalFeeInput < feeSat) throw new Error(`Insufficient fee inputs: need ${feeSat}, have ${totalFeeInput}`);

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    psbt.addInput({
      hash: prev.txid,
      index: prev.contractVout,
      sequence: 0xfffffffd,
      witnessUtxo: { script: Buffer.from(prev.p2trScriptPubKeyHex, 'hex'), value: prev.value },
      tapLeafScript: [
        {
          leafVersion: prev.tapleaf_multisig.leafVersion,
          script: Buffer.from(prev.tapleaf_multisig.scriptHex, 'hex'),
          controlBlock: Buffer.from(prev.tapleaf_multisig.controlBlockHex, 'hex'),
        },
      ],
    });

    const senderP2WPKH = payments.p2wpkh({ pubkey: params.sender.publicKey, network: this.network });
    const senderAddr = senderP2WPKH.address!;
    const senderOut = senderP2WPKH.output!;
    feeUtxos.forEach((u) => {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        witnessUtxo: { script: senderOut, value: u.value },
        sequence: 0xfffffffd,
      });
    });

    psbt.addOutput({ address: p2trNew.address, value: prev.value });

    const { script: opretScript, value: opretValue } = this.createOpReturnOutput(memoBuf);
    psbt.addOutput({ script: opretScript, value: opretValue });

    const change = totalFeeInput - feeSat;
    if (change >= DUST_CHANGE) {
      psbt.addOutput({ address: senderAddr, value: change });
    }

    psbt.signInput(0, params.sender);
    for (let i = 0; i < feeUtxos.length; i++) psbt.signInput(1 + i, params.sender);

    {
      const t = psbt.data.inputs[0].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) {
          e.signature = e.signature.subarray(0, 64);
        }
      }
      const xSenderPk = this.toXOnly(params.sender.publicKey);
      const hasSenderSig = t.some((e) => Buffer.from(e.pubkey).equals(xSenderPk) && e.signature.length === 64);
      if (!hasSenderSig) throw new Error('Taproot: sender did not produce a 64B Schnorr tapScriptSig on input 0');
    }

    return {
      psbtBase64: psbt.toBase64(),
      memoHex,
      new: {
        contractAddress: p2trNew.address,
        value: prev.value,
        timelock: csvDelay,
        internalPubkeyHex: Buffer.from(internalPubkey).toString('hex'),
        p2trScriptPubKeyHex: p2trNew.output.toString('hex'),
        contractVout: 0,
        leaf_hashlock_hex: leaf_hashlock.toString('hex'),
        leaf_refund_hex: leaf_refund.toString('hex'),
        ctrlblock_hashlock_hex: Buffer.from(ctrlblock_hash).toString('hex'),
        ctrlblock_refund_hex: Buffer.from(ctrlblock_ref).toString('hex'),
        tapleaf_hashlock: {
          leafVersion: TAPLEAF_VER_TAPSCRIPT,
          scriptHex: leaf_hashlock.toString('hex'),
          controlBlockHex: Buffer.from(ctrlblock_hash).toString('hex'),
        },
        tapleaf_refund: {
          leafVersion: TAPLEAF_VER_TAPSCRIPT,
          scriptHex: leaf_refund.toString('hex'),
          controlBlockHex: Buffer.from(ctrlblock_ref).toString('hex'),
        },
      },
    };
  }

  public async addLockFinalize(psbtBase64: string, receiver: ECPairInterface): Promise<{ txid: string; hex: string }> {
    const psbt = Psbt.fromBase64(psbtBase64, { network: this.network });

    const in0 = psbt.data.inputs[0];
    if (!in0 || !in0.tapLeafScript || in0.tapLeafScript.length === 0) {
      throw new Error('Input 0 missing tapLeafScript');
    }

    psbt.signInput(0, receiver);

    {
      const t = psbt.data.inputs[0].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) {
          e.signature = e.signature.subarray(0, 64);
        }
        if (e.signature.length !== 64) {
          throw new Error(`Unexpected Schnorr length ${e.signature.length} on tapscript sig`);
        }
      }
    }

    const leafPack = in0.tapLeafScript[0];
    const leafScript = leafPack.script;
    const controlBlock = leafPack.controlBlock;

    const d = script.decompile(leafScript) || [];
    const pk1 = (d[0] as Buffer) || Buffer.alloc(0);
    const pk2 = (d[2] as Buffer) || Buffer.alloc(0);

    if (pk1.length !== 32 || pk2.length !== 32) {
      throw new Error('Leaf does not look like [xSender, CHECKSIGVERIFY, xRecv, CHECKSIG]');
    }

    const tss = psbt.data.inputs[0].tapScriptSig || [];
    const byPk = new Map<string, Buffer>();
    for (const e of tss) byPk.set(Buffer.from(e.pubkey).toString('hex'), e.signature);

    const s1 = byPk.get(pk1.toString('hex'));
    const s2 = byPk.get(pk2.toString('hex'));
    if (!s1 || !s2) {
      const have = [...byPk.keys()];
      throw new Error(
        `Missing schnorr sigs for leaf pubkeys. Need ${pk1.toString('hex')}, ${pk2.toString('hex')}. Have ${have.join(',')}`
      );
    }
    if (s1.length !== 64 || s2.length !== 64) {
      throw new Error('Schnorr signatures must be 64 bytes after trimming');
    }

    for (let i = 1; i < psbt.data.inputs.length; i++) {
      psbt.finalizeInput(i);
    }

    psbt.finalizeInput(0, () => {
      const witness = this.packWitness([s2, s1, leafScript, controlBlock]);
      return { finalScriptWitness: witness };
    });

    const tx = psbt.extractTransaction();
    const hex = tx.toHex();
    const txid = await this.postTransaction(hex);
    return { txid, hex };
  }

  public async refund(
    prev: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    },
    params: {
      sender: ECPairInterface;
      commitId: Buffer;
      feeSat: number;
      feeUtxos: { hash: string; index: number; value: number }[];
    }
  ): Promise<{ txid: string; hex: string }> {
    if (!params.commitId || params.commitId.length !== 32) throw new Error('commitId must be 32 bytes');
    const feeSat = params.feeSat >>> 0;
    if (!Number.isFinite(feeSat) || feeSat <= 0) throw new Error('feeSat must be > 0');
    if (!params.feeUtxos?.length) throw new Error('feeUtxos required');

    const leafScript = Buffer.from(prev.tapleaf_refund.scriptHex, 'hex');
    const controlBlock = Buffer.from(prev.tapleaf_refund.controlBlockHex, 'hex');

    const d = script.decompile(leafScript) || [];
    const csvBuf = (d[0] as Buffer) || Buffer.alloc(0);
    const op1 = d[1],
      op2 = d[2],
      xSender = (d[3] as Buffer) || Buffer.alloc(0),
      op3 = d[4];

    if (
      !(
        Buffer.isBuffer(csvBuf) &&
        xSender.length === 32 &&
        op1 === opcodes.OP_CHECKSEQUENCEVERIFY &&
        op2 === opcodes.OP_DROP &&
        op3 === opcodes.OP_CHECKSIG
      )
    ) {
      throw new Error('refund leaf shape mismatch (expected CSV path)');
    }

    const requiredSequence = script.number.decode(csvBuf) >>> 0;

    const senderP2WPKH = payments.p2wpkh({ pubkey: params.sender.publicKey, network: this.network });
    if (!senderP2WPKH.address || !senderP2WPKH.output) throw new Error('Could not derive sender P2WPKH');
    const refundTo = senderP2WPKH.address;
    const senderOut = senderP2WPKH.output;

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    psbt.addInput({
      hash: prev.txid,
      index: prev.contractVout,
      sequence: requiredSequence,
      witnessUtxo: { script: Buffer.from(prev.p2trScriptPubKeyHex, 'hex'), value: prev.value },
      tapLeafScript: [{ leafVersion: prev.tapleaf_refund.leafVersion, script: leafScript, controlBlock }],
    });

    let totalFeeInput = 0;
    for (const u of params.feeUtxos) {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        sequence: 0xfffffffd,
        witnessUtxo: { script: senderOut, value: u.value },
      });
      totalFeeInput += u.value >>> 0;
    }
    if (totalFeeInput < feeSat) throw new Error(`Insufficient fee inputs: need ${feeSat}, have ${totalFeeInput}`);

    psbt.addOutput({ address: refundTo, value: prev.value });

    {
      const { script: opretScript, value } = this.createOpReturnOutput(params.commitId);
      psbt.addOutput({ script: opretScript, value });
    }

    const feeChange = totalFeeInput - feeSat;
    if (feeChange >= DUST_CHANGE) {
      psbt.addOutput({ address: refundTo, value: feeChange });
    }

    psbt.signInput(0, params.sender);
    for (let i = 0; i < params.feeUtxos.length; i++) psbt.signInput(1 + i, params.sender);

    {
      const t = psbt.data.inputs[0].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64);
        if (e.signature.length !== 64) throw new Error('unexpected Schnorr length');
      }
      const xFromKey = this.toXOnly(params.sender.publicKey);
      if (!t.some((e) => Buffer.from(e.pubkey).equals(xFromKey))) throw new Error('missing refund tapscript sig');
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

  public async redeemSolver(
    prev: {
      txid: string;
      contractVout: number;
      value: number;
      p2trScriptPubKeyHex: string;
      tapleaf_hashlock: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    },
    params: {
      receiver: ECPairInterface;
      secret: Buffer;
      commitId: Buffer;
      feeSat: number;
      feeUtxos: { hash: string; index: number; value: number }[];
    }
  ): Promise<{ txid: string; hex: string }> {
    if (!params.commitId || params.commitId.length !== 32) throw new Error('commitId must be 32 bytes');
    if (!params.secret || params.secret.length !== 32) throw new Error('secret must be 32 bytes');
    const feeSat = params.feeSat >>> 0;
    if (!Number.isFinite(feeSat) || feeSat <= 0) throw new Error('feeSat must be > 0');
    if (!params.feeUtxos?.length) throw new Error('feeUtxos required (receiver pays fees)');

    const leafScript = Buffer.from(prev.tapleaf_hashlock.scriptHex, 'hex');
    const controlBlock = Buffer.from(prev.tapleaf_hashlock.controlBlockHex, 'hex');

    const d = script.decompile(leafScript) || [];
    if (
      !(
        d.length === 5 &&
        d[0] === opcodes.OP_SHA256 &&
        Buffer.isBuffer(d[1]) &&
        (d[1] as Buffer).length === 32 &&
        d[2] === opcodes.OP_EQUALVERIFY &&
        Buffer.isBuffer(d[3]) &&
        (d[3] as Buffer).length === 32 &&
        d[4] === opcodes.OP_CHECKSIG
      )
    ) {
      throw new Error('hashlock leaf shape mismatch');
    }
    const hashlockInLeaf = d[1] as Buffer;
    const xRecvInLeaf = d[3] as Buffer;

    const h = createHash('sha256').update(params.secret).digest();
    if (!h.equals(hashlockInLeaf)) throw new Error('secret does not match hashlock in leaf');

    const xRecvFromKey = this.toXOnly(params.receiver.publicKey);
    if (!xRecvFromKey.equals(xRecvInLeaf)) throw new Error('receiver key does not match leaf xRecv');

    const recvP2WPKH = payments.p2wpkh({ pubkey: params.receiver.publicKey, network: this.network });
    if (!recvP2WPKH.address || !recvP2WPKH.output) throw new Error('Could not derive receiver P2WPKH');
    const fundsTo = recvP2WPKH.address;
    const changeTo = recvP2WPKH.address;
    const recvOutScript = recvP2WPKH.output;

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    psbt.addInput({
      hash: prev.txid,
      index: prev.contractVout,
      sequence: 0xfffffffd,
      witnessUtxo: { script: Buffer.from(prev.p2trScriptPubKeyHex, 'hex'), value: prev.value },
      tapLeafScript: [
        {
          leafVersion: prev.tapleaf_hashlock.leafVersion,
          script: leafScript,
          controlBlock,
        },
      ],
    });

    if (prev.value < feeSat) throw new Error(`Insufficient fee inputs: need ${feeSat}, have ${prev.value}`);

    psbt.addOutput({ address: fundsTo, value: prev.value - feeSat });

    {
      const MAX_OPRET = 79;
      const HASHLOCK_SIZE = 32;
      const SECRET_SIZE = 32;
      const commitIdSize = MAX_OPRET - HASHLOCK_SIZE - SECRET_SIZE;
      if (hashlockInLeaf.length !== HASHLOCK_SIZE) throw new Error('hashlock must be 32 bytes');
      if (params.secret.length !== SECRET_SIZE) throw new Error('secret must be 32 bytes');
      const commitIdTrunc = params.commitId.subarray(0, commitIdSize);
      const payload = Buffer.concat([commitIdTrunc, hashlockInLeaf, params.secret]);
      if (payload.length > 80) throw new Error('OP_RETURN payload too large');
      const { script: opretScript, value: opretValue } = this.createOpReturnOutput(payload);
      psbt.addOutput({ script: opretScript, value: opretValue });
    }

    psbt.signInput(0, params.receiver);

    {
      const t = psbt.data.inputs[0].tapScriptSig || [];
      for (const e of t) {
        if (e.signature.length === 65 && e.signature[64] === 0x00) e.signature = e.signature.subarray(0, 64);
        if (e.signature.length !== 64) throw new Error('unexpected Schnorr length on hashlock input');
      }
      if (!t.some((e) => Buffer.from(e.pubkey).equals(xRecvFromKey))) {
        throw new Error('missing receiver tapscript sig on hashlock input');
      }
    }

    psbt.finalizeInput(0, () => {
      const sig = (psbt.data.inputs[0].tapScriptSig || [])[0]?.signature;
      if (!sig || sig.length !== 64) throw new Error('missing/invalid receiver signature');
      return { finalScriptWitness: this.packWitness([sig, params.secret, leafScript, controlBlock]) };
    });

    const tx = psbt.extractTransaction();
    const hex = tx.toHex();
    const txid = await this.postTransaction(hex);
    return { txid, hex };
  }

  public async lock(
    sender: ECPairInterface,
    srcReceiverPubKey: Buffer,
    amount: number,
    csvDelaySeconds: number,
    opts?: {
      fee?: number;
      lockId: Buffer;
      paymentHashlockHex: string;
      dstChain?: string;
      dstAsset?: string;
    }
  ): Promise<{
    lockIdHex: string;
    txid: string;
    contractAddress: string;
    csvDelaySeconds: number;
    internalPubkeyHex: string;
    p2trScriptPubKeyHex: string;
    contractVout: number;
    leaf_hashlock_hex: string;
    leaf_refund_hex: string;
    ctrlblock_hashlock_hex: string;
    ctrlblock_refund_hex: string;
    tapleaf_hashlock: { leafVersion: number; scriptHex: string; controlBlockHex: string };
    tapleaf_refund: { leafVersion: number; scriptHex: string; controlBlockHex: string };
  }> {
    const fee = opts?.fee ?? 311;
    if (!opts?.lockId || opts.lockId.length !== 32) throw new Error('lockId must be 32 bytes');
    const hashlock = Buffer.from((opts.paymentHashlockHex || '').replace(/^0x/i, ''), 'hex');
    if (hashlock.length !== 32) throw new Error('paymentHashlockHex must be 32 bytes hex');
    if (csvDelaySeconds < MIN_DELAY_SEC) throw new Error('CSV delay must be ≥ 900 seconds');

    const xSender = this.toXOnly(sender.publicKey);
    const xRecv = this.toXOnly(srcReceiverPubKey);

    const csvSeq = this.csvSeconds(csvDelaySeconds);

    const leaf_hashlock = script.compile([
      opcodes.OP_SHA256,
      hashlock,
      opcodes.OP_EQUALVERIFY,
      xRecv,
      opcodes.OP_CHECKSIG,
    ]);

    const leaf_refund = script.compile([
      script.number.encode(csvSeq),
      opcodes.OP_CHECKSEQUENCEVERIFY,
      opcodes.OP_DROP,
      xSender,
      opcodes.OP_CHECKSIG,
    ]);

    const tapLeafHash = { output: leaf_hashlock, version: TAPLEAF_VER_TAPSCRIPT };
    const tapLeafRefund = { output: leaf_refund, version: TAPLEAF_VER_TAPSCRIPT };
    const scriptTree: [Taptree, Taptree] = [tapLeafHash, tapLeafRefund];

    const internalPubkey = this.getHiddenUnspendableInternalKey();
    const p2tr = payments.p2tr({ internalPubkey, scriptTree, network: this.network });
    if (!p2tr.address || !p2tr.output) throw new Error('Failed to derive P2TR');
    const contractAddress = p2tr.address;

    const redeemHash = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_hashlock, redeemVersion: TAPLEAF_VER_TAPSCRIPT },
      network: this.network,
    });
    const ctrlblock_hash = redeemHash.witness![redeemHash.witness!.length - 1];

    const redeemRefund = payments.p2tr({
      internalPubkey,
      scriptTree,
      redeem: { output: leaf_refund, redeemVersion: TAPLEAF_VER_TAPSCRIPT },
      network: this.network,
    });
    const ctrlblock_ref = redeemRefund.witness![redeemRefund.witness!.length - 1];

    const senderAddress = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).address;
    if (!senderAddress) throw new Error('Failed to derive sender P2WPKH address');

    const senderP2tr = payments.p2tr({ internalPubkey: xSender, network: this.network });
    if (!senderP2tr.address) throw new Error('Failed to derive sender P2TR address');

    const utxos = await this.getUtxos(senderP2tr.address);
    if (!utxos.length) throw new Error(`No UTXOs for ${senderP2tr.address}`);

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
    psbt.setVersion(2);

    for (const u of selected) {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        witnessUtxo: { script: senderP2tr.output!, value: u.value },
        tapInternalKey: xSender,
        sequence: 0xfffffffd,
      });
    }

    const change = totalIn - needed;
    const contractVout = 0;
    const contractValue = amount + (change > 0 && change < DUST_P2WPKH ? change : 0);
    psbt.addOutput({ address: contractAddress, value: contractValue });
    if (change >= DUST_P2WPKH) psbt.addOutput({ address: senderAddress, value: change });

    const seq5 = Buffer.alloc(5);
    {
      const tmp6 = Buffer.alloc(6);
      tmp6.writeUIntBE(csvSeq >>> 0, 0, 6);
      tmp6.subarray(1).copy(seq5);
    }
    const packFixed = (s: string | undefined, len: number) => {
      const b = Buffer.from(s ?? '', 'utf8');
      const out = Buffer.alloc(len);
      b.copy(out, 0, 0, Math.min(len, b.length));
      return out;
    };
    const dstChain4 = packFixed(opts?.dstChain, 4);
    const dstAsset4 = packFixed(opts?.dstAsset, 4);
    const payload77 = Buffer.concat([opts.lockId, hashlock, seq5, dstChain4, dstAsset4]);

    const { script: opret, value: v } = this.createOpReturnOutput(payload77);
    psbt.addOutput({ script: opret, value: v });

    const tweakedSigner = sender.tweak(taggedHash('TapTweak', xSender));
    for (let i = 0; i < selected.length; i++) psbt.signInput(i, tweakedSigner);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txhex = tx.toHex();
    const txid = await this.postTransaction(txhex);

    const internalPubkeyHex = Buffer.from(internalPubkey).toString('hex');
    const p2trScriptPubKeyHex = p2tr.output.toString('hex');
    const leaf_hashlock_hex = leaf_hashlock.toString('hex');
    const leaf_refund_hex = leaf_refund.toString('hex');
    const ctrlblock_hashlock_hex = Buffer.from(ctrlblock_hash).toString('hex');
    const ctrlblock_refund_hex = Buffer.from(ctrlblock_ref).toString('hex');

    return {
      lockIdHex: '0x' + opts.lockId.toString('hex'),
      txid,
      contractAddress,
      csvDelaySeconds,
      internalPubkeyHex,
      p2trScriptPubKeyHex,
      contractVout,
      leaf_hashlock_hex,
      leaf_refund_hex,
      ctrlblock_hashlock_hex,
      ctrlblock_refund_hex,
      tapleaf_hashlock: {
        leafVersion: TAPLEAF_VER_TAPSCRIPT,
        scriptHex: leaf_hashlock_hex,
        controlBlockHex: ctrlblock_hashlock_hex,
      },
      tapleaf_refund: {
        leafVersion: TAPLEAF_VER_TAPSCRIPT,
        scriptHex: leaf_refund_hex,
        controlBlockHex: ctrlblock_refund_hex,
      },
    };
  }

  public async convertP2WPKHtoP2TR(
    sender: ECPairInterface,
    amount: number,
    opts?: { fee?: number }
  ): Promise<{
    txid: string;
    contractAddress: string;
    value: number;
    contractVout: number;
    internalPubkeyHex: string;
    p2trScriptPubKeyHex: string;
  }> {
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
    for (const u of utxos) {
      selected.push(u);
      totalIn += u.value >>> 0;
      if (target > 0 && totalIn >= target + fee) break;
    }
    if (target > 0 && totalIn < target + fee)
      throw new Error(`Insufficient funds: need ${target + fee}, have ${totalIn}`);

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);
    const senderOut = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network }).output!;
    for (const u of selected) {
      psbt.addInput({
        hash: u.hash,
        index: u.index,
        witnessUtxo: { script: senderOut, value: u.value },
        sequence: 0xfffffffd,
      });
    }

    let sendValue = target > 0 ? target : Math.max(0, totalIn - fee);
    let change = totalIn - sendValue - fee;
    if (change > 0 && change < DUST_P2WPKH) {
      sendValue += change;
      change = 0;
    }

    const contractVout = 0;
    psbt.addOutput({ address: p2tr.address, value: sendValue });
    if (change >= DUST_P2WPKH) psbt.addOutput({ address: senderAddress, value: change });

    for (let i = 0; i < selected.length; i++) psbt.signInput(i, sender);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txhex = tx.toHex();
    const txid = await this.postTransaction(txhex);

    return {
      txid,
      contractAddress: p2tr.address,
      value: sendValue,
      contractVout,
      internalPubkeyHex: Buffer.from(xOnly).toString('hex'),
      p2trScriptPubKeyHex: p2tr.output.toString('hex'),
    };
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
        const vout = tx.vout[u.index];
        const spkHex: string = vout.scriptpubkey;
        if (spkHex?.toLowerCase() === expectScriptHex) verified.push(u);
      }
      if (!verified.length) throw new Error('Found P2TR UTXOs for address, but none match our key-path scriptPubKey.');
      utxo = verified.sort((a, b) => b.value - a.value)[0];
    }

    if (utxo.value <= fee) throw new Error(`UTXO too small: value=${utxo.value}, fee=${fee}`);

    const to = payments.p2wpkh({ pubkey: sender.publicKey, network: this.network });
    if (!to.address) throw new Error('Failed to derive destination P2WPKH');

    const psbt = new Psbt({ network: this.network });
    psbt.setVersion(2);

    psbt.addInput({
      hash: utxo.hash,
      index: utxo.index,
      witnessUtxo: { script: p2trKey.output, value: utxo.value },
      tapInternalKey: xOnly,
      sequence: 0xfffffffd,
    });

    const sendValue = utxo.value - fee;
    const vout = 0;
    psbt.addOutput({ address: to.address, value: sendValue });
    const tweaked = sender.tweak(taggedHash('TapTweak', xOnly));

    psbt.signInput(0, tweaked);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txhex = tx.toHex();
    const txid = await this.postTransaction(txhex);

    return { txid, toAddress: to.address, value: sendValue, vout };
  }
}
