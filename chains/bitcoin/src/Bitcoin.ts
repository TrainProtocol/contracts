import { Address, Signer, Tap, Tx } from '@cmdcode/tapscript';
import axios from 'axios';
import mempoolJS from '@mempool/mempool.js';
import varuint from 'varuint-bitcoin';
import { MempoolReturn } from '@mempool/mempool.js/lib/interfaces/index';
import { networks, payments, script } from 'bitcoinjs-lib';
import { randomBytes, createHash } from 'crypto';
import { HashPair } from './Core';

/**
 * TRAIN Protocol Bitcoin
 */
export default abstract class Bitcoin {
  readonly mempool: MempoolReturn['bitcoin'];
  readonly network: networks.Network;
  readonly baseUrl: string;

  constructor(network: networks.Network) {
    this.network = network;
    const networkStr = network === networks.bitcoin ? 'bitcoin' : 'testnet';
    this.mempool = mempoolJS({
      hostname: 'mempool.space',
      network: networkStr,
    }).bitcoin;
    this.baseUrl = `https://mempool.space/${networkStr}`;
  }

  public createHashPair(): HashPair {
    const secret = randomBytes(32);
    const hashlock = createHash('sha256').update(secret).digest();
    return {
      hashlock: hashlock.toString('hex'),
      secret: secret.toString('hex'),
    };
  }

  protected async getCurrentBlockInfo(): Promise<{ height: number; timestamp: number }> {
    const height = await this.mempool.blocks.getBlocksTipHeight();
    const hash = await this.mempool.blocks.getBlocksTipHash();
    const block = await this.mempool.blocks.getBlock({ hash });

    return {
      height,
      timestamp: block.timestamp,
    };
  }

  protected async postTransaction(txhex: string): Promise<any> {
    const endpoint = `${this.baseUrl}/api/tx`;
    return new Promise((resolve, reject) => {
      axios
        .post(endpoint, txhex)
        .then((res) => {
          resolve(res.data);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  protected async getInputData(txid: string, contractAddress: string): Promise<{ value: number; index: number }> {
    const txInfo = await this.mempool.transactions.getTx({ txid });
    let value = 0;
    let index = 0;
    for (let i = 0; i < txInfo.vout.length; i++) {
      if (txInfo.vout[i].scriptpubkey_address == contractAddress) {
        value = txInfo.vout[i].value;
        index = i;
      }
    }
    return { value, index };
  }

  public async getUtxos(address: string): Promise<{ hash: string; index: number; value: number }[]> {
    const utxosData = await this.mempool.addresses.getAddressTxsUtxo({ address });
    const utxos: { hash: string; index: number; value: number }[] = [];
    for (let i = 0; i < utxosData.length; i++) {
      const hash = utxosData[i].txid;
      const index = utxosData[i].vout;
      const value = utxosData[i].value;
      utxos.push({
        hash,
        index,
        value,
      });
    }
    return utxos;
  }

  /**
   * Build and sign a Taproot (P2TR) transaction with key, script, or both spending modes.
   * @param senderKey   An ECPair (containing private and public key) for the Taproot internal key.
   * @param utxos       Array of UTXOs to spend, each with { txid, vout, value, address? or scriptPubKey? }.
   * @param recipient   Recipient address to send funds to.
   * @param amountSat   Amount in satoshis to send to the recipient.
   * @param feeSat      Fee in satoshis for the transaction.
   * @param mode        Signing mode: 'key' | 'script' | 'both'.
   * @param scriptLeaves  Optional array of tapleaf scripts (Buffers), each with an optional `leafVersion` (default 0xc0).
   * @param opReturnData Optional Buffer or string for OP_RETURN output data (will be hex-encoded if string).
   * @param changeAddr   Optional change address (if not provided, change is sent back to sender's Taproot address).
   * @returns Hex string of the fully signed transaction.
   */
  protected buildTaprootTx(
    senderKey: { publicKey: Uint8Array; privateKey: Uint8Array },
    utxos: Array<{
      txid: string;
      vout: number;
      value: number;
    }>,
    recipient: string,
    amountSat: number,
    feeSat: number,
    mode: 'key' | 'script' | 'both',
    scriptLeaves: Array<Uint8Array | { script: Uint8Array; leafVersion?: number }> = [],
    opReturnData?: Uint8Array | string,
    changeAddr?: string
  ): string {
    const UNSPENDABLE_INTERNAL = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');
    const internalPub = mode === 'script' ? UNSPENDABLE_INTERNAL : senderKey.publicKey;
    const internalPriv = mode === 'script' ? Buffer.alloc(32, 0) : senderKey.privateKey;

    let tweakedPub: string;
    let controlBlock: string | undefined;
    let targetLeaf: string | undefined;
    let tweakedPriv: Uint8Array;
    let tapTree: string[] | undefined;

    if (mode === 'key' || scriptLeaves.length === 0) {
      // key-path only
      [tweakedPub] = Tap.getPubKey(internalPub);
      const sec = Tap.getSecKey(internalPriv);
      tweakedPriv = Buffer.from(sec as any);
    } else {
      // build tapleaf hashes array
      tapTree = scriptLeaves.map((obj) => {
        const scriptBuf = obj instanceof Uint8Array ? obj : obj.script;
        const version = obj instanceof Uint8Array ? 0xc0 : (obj.leafVersion ?? 0xc0);
        return Tap.tree.getLeaf(scriptBuf, version);
      });

      if (mode === 'script') {
        // script-path: reveal first leaf
        targetLeaf = tapTree[0];
        [tweakedPub, controlBlock] = Tap.getPubKey(internalPub, {
          tree: tapTree,
          target: targetLeaf,
        });
        // use original privkey for script-path (extension-based)
        tweakedPriv = Buffer.from(internalPriv);
      } else {
        // both: commit scripts, spend via key-path
        [tweakedPub] = Tap.getPubKey(internalPub, { tree: tapTree });
        const sec = Tap.getSecKey(internalPriv, { tree: tapTree });
        tweakedPriv = Buffer.from(sec as any);
      }
    }

    // Build inputs & outputs
    const vin = utxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      prevout: {
        value: u.value,
        scriptPubKey: payments.p2wpkh({
          pubkey: payments.p2wpkh({ pubkey: Buffer.from(senderKey.publicKey), network: this.network }).output!,
          network: this.network,
        }).output!,
      },
    }));
    const totalIn = utxos.reduce((sum, u) => sum + u.value, 0);

    const vout: Array<{ value: number; scriptPubKey: any }> = [
      { value: amountSat, scriptPubKey: Address.toScriptPubKey(recipient) },
    ];
    if (opReturnData !== undefined) {
      const dataBuf = opReturnData instanceof Uint8Array ? opReturnData : Buffer.from(opReturnData, 'utf8');
      vout.push({ value: 0, scriptPubKey: ['OP_RETURN', dataBuf] });
    }
    const changeAmt = totalIn - amountSat - feeSat;
    if (changeAmt < 0) {
      throw new Error(`Insufficient funds: have ${totalIn}, need ${amountSat + feeSat}`);
    }
    if (changeAmt > 0) {
      const ca = changeAddr ?? Address.p2tr.fromPubKey(tweakedPub);
      vout.push({
        value: changeAmt,
        scriptPubKey: Address.toScriptPubKey(ca),
      });
    }

    const tx = Tx.create({ vin, vout });

    // Sign each input
    for (let i = 0; i < vin.length; i++) {
      if (mode === 'script') {
        // script-path: sign with original priv + extension
        const sig = Signer.taproot.sign(tweakedPriv, tx, i, {
          extension: targetLeaf!,
        });
        // witness: [sig, script, controlBlock]
        const origScript = scriptLeaves[0] instanceof Uint8Array ? scriptLeaves[0] : scriptLeaves[0].script;
        tx.vin[i].witness = [sig.hex, origScript, controlBlock!];
      } else {
        // key-path (key or both)
        const sig = Signer.taproot.sign(tweakedPriv, tx, i);
        tx.vin[i].witness = [sig.hex];
      }
    }

    return Tx.encode(tx).hex;
  }

  protected witnessStackToScriptWitness(witness: any): Buffer {
    let buffer = Buffer.allocUnsafe(0);
    function writeSlice(slice: any) {
      buffer = Buffer.concat([buffer, Buffer.from(slice)]);
    }

    function writeVarInt(i: any) {
      const currentLen = buffer.length;
      const varintLen = varuint.encodingLength(i);

      buffer = Buffer.concat([buffer, Buffer.allocUnsafe(varintLen)]);
      varuint.encode(i, buffer, currentLen);
    }

    function writeVarSlice(slice: any) {
      writeVarInt(slice.length);
      writeSlice(slice);
    }

    function writeVector(vector: any) {
      writeVarInt(vector.length);
      vector.forEach(writeVarSlice);
    }

    writeVector(witness);

    return buffer;
  }

  /**
   * Generate HTLC Contract Script for Bitcoin
   */
  protected generateSwapWitnessScript(
    receiverPublicKey: Buffer,
    userRefundPublicKey: Buffer,
    paymentHash: string,
    timelock: number
  ): Buffer {
    return script.fromASM(
      `
      OP_SHA256
      ${paymentHash}
      OP_EQUAL
      OP_IF
        ${receiverPublicKey.toString('hex')}
      OP_ELSE
        ${script.number.encode(timelock).toString('hex')}
        OP_CHECKLOCKTIMEVERIFY
        OP_DROP
        ${userRefundPublicKey.toString('hex')}
      OP_ENDIF
      OP_CHECKSIG
    `
        .trim()
        .replace(/\s+/g, ' ')
    );
  }

  protected createOpReturnOutput(data: string) {
    const opReturnBuffer = Buffer.from(data, 'utf8');

    if (opReturnBuffer.length > 80) {
      throw new Error('OP_RETURN data exceeds 80 bytes');
    }

    const opReturnOutput = payments.embed({ data: [opReturnBuffer] }).output;

    return {
      script: opReturnOutput!,
      // OP_RETURN outputs have a value of 0
      value: 0,
    };
  }
}
