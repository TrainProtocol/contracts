import axios from 'axios';
import mempoolJS from '@mempool/mempool.js';
import varuint from 'varuint-bitcoin';
import { MempoolReturn } from '@mempool/mempool.js/lib/interfaces/index';
import { networks, payments, script } from 'bitcoinjs-lib';
import { randomBytes, createHash } from 'crypto';
import { HashPair } from './Core';
import { Point, utils } from '@noble/secp256k1';

type ChainArg = networks.Network | 'testnet4';
export type { ChainArg };

function makeTestnet4Adapter() {
  const BASE = 'https://mempool.space/testnet4/api';
  const get = async <T = any>(p: string): Promise<T> => {
    const { data } = await axios.get<T>(`${BASE}${p}`);
    return data;
  };

  return {
    blocks: {
      async getBlocksTipHeight(): Promise<number> {
        const tip = await get<string | number>('/blocks/tip/height');
        return typeof tip === 'string' ? Number(tip) : tip;
      },
      async getBlocksTipHash(): Promise<string> {
        return get<string>('/blocks/tip/hash');
      },
      async getBlock({ hash }: { hash: string }): Promise<any> {
        return get<any>(`/block/${hash}`);
      },
    },
    addresses: {
      async getAddressTxsUtxo({ address }: { address: string }): Promise<any[]> {
        return get<any[]>(`/address/${address}/utxo`);
      },
    },
    transactions: {
      async getTx({ txid }: { txid: string }): Promise<any> {
        return get<any>(`/tx/${txid}`);
      },
    },
  };
}

/**
 * TRAIN Protocol Bitcoin
 */
export default abstract class Bitcoin {
  readonly mempool: MempoolReturn['bitcoin'] | ReturnType<typeof makeTestnet4Adapter>;
  readonly network: networks.Network;
  readonly baseUrl: string;

  constructor(networkOrChain: ChainArg) {
    if (networkOrChain === 'testnet4') {
      this.network = networks.testnet;
      this.mempool = makeTestnet4Adapter();
      // this.baseUrl = 'https://mempool.space/testnet4';
      this.baseUrl = 'https://bitcoin-testnet-rpc.publicnode.com';
      return;
    }

    this.network = networkOrChain;
    const networkStr = networkOrChain === networks.bitcoin ? 'bitcoin' : 'testnet';
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
        .then((res) => resolve(res.data))
        .catch((error) => reject(error));
    });
  }

  protected async getInputData(txid: string, contractAddress: string): Promise<{ value: number; index: number }> {
    const txInfo = await (this.mempool as any).transactions.getTx({ txid });
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
    const utxosData = await (this.mempool as any).addresses.getAddressTxsUtxo({ address });
    const utxos: { hash: string; index: number; value: number }[] = [];
    for (let i = 0; i < utxosData.length; i++) {
      const hash = utxosData[i].txid;
      const index = utxosData[i].vout;
      const value = utxosData[i].value;
      utxos.push({ hash, index, value });
    }
    return utxos;
  }

  protected toXOnly(pubkey: Buffer): Buffer {
    if (pubkey.length !== 33) throw new Error('Expected 33-byte compressed pubkey');
    const first = pubkey[0];
    if (first !== 0x02 && first !== 0x03) throw new Error('Pubkey must be compressed (02/03)');
    return Buffer.from(pubkey.subarray(1, 33));
  }

  protected csvSeconds(seconds: number): number {
    const units = Math.floor(seconds / 512);
    if (!Number.isFinite(units) || units <= 0 || units > 0xffff) {
      throw new Error('CSV seconds out of range (must fit 16-bit units of 512s)');
    }
    return (units & 0xffff) | 0x00400000; // SEQUENCE_TYPE_FLAG
  }

  /**
   * Generate a hidden, unspendable Taproot internal key (H + rG)
   */
  protected getHiddenUnspendableInternalKey() {
    const H_x = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
    let H: Point | undefined = undefined;
    for (const prefix of ['02', '03']) {
      try {
        H = Point.fromHex(prefix + H_x);
        break;
      } catch {}
    }
    if (!H) throw new Error('Could not lift NUMS x to a secp256k1 point');
    H.assertValidity();

    const r = utils.randomPrivateKey();
    const rG = Point.fromPrivateKey(r);
    rG.assertValidity();

    const internalPoint = H.add(rG);
    internalPoint.assertValidity();

    const x = internalPoint.toAffine().x;
    const hex = x.toString(16).padStart(64, '0');
    return Buffer.from(hex, 'hex');
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

  protected createOpReturnOutput(data: string | Buffer) {
    const buf = Buffer.isBuffer(data)
      ? data
      : (() => {
          const hex = data.startsWith('0x') ? data.slice(2) : data;
          const looksHex = /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0;
          return looksHex ? Buffer.from(hex, 'hex') : Buffer.from(data, 'utf8');
        })();

    if (buf.length > 80) throw new Error('OP_RETURN data exceeds 80 bytes');

    const opretScript = payments.embed({ data: [buf] }).output!;
    return { script: opretScript, value: 0 };
  }
}
