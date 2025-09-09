import mempoolJS from '@mempool/mempool.js';
import { decodeCommitLogHex } from '../src/utils';

const mempool = mempoolJS({ hostname: 'mempool.space', network: 'testnet' }).bitcoin;

function extractOpReturnDataHex(scriptHex: string): string {
  const b = Buffer.from(scriptHex, 'hex');
  if (b.length < 2 || b[0] !== 0x6a) throw new Error('not an OP_RETURN script');

  let o = 1; // after OP_RETURN (0x6a)
  let len: number;

  const op = b[o++];
  if (op <= 0x4b) {
    // direct push: 0..75 bytes
    len = op;
  } else if (op === 0x4c) {
    // OP_PUSHDATA1
    len = b[o++];
  } else if (op === 0x4d) {
    // OP_PUSHDATA2 (LE)
    len = b.readUInt16LE(o);
    o += 2;
  } else if (op === 0x4e) {
    // OP_PUSHDATA4 (LE)
    len = b.readUInt32LE(o);
    o += 4;
  } else {
    throw new Error(`unsupported push opcode: 0x${op.toString(16)}`);
  }

  const end = o + len;
  if (end > b.length) throw new Error('push length exceeds script size');

  return b.subarray(o, end).toString('hex');
}

async function decodeFromTxid(txid: string) {
  const tx = await mempool.transactions.getTx({ txid });

  const opret = tx.vout.find(
    (v: any) =>
      v.scriptpubkey_type === 'op_return' || (typeof v.scriptpubkey === 'string' && v.scriptpubkey.startsWith('6a'))
  );
  if (!opret) throw new Error('no OP_RETURN output found');

  const dataHex = extractOpReturnDataHex(opret.scriptpubkey);
  return decodeCommitLogHex(dataHex);
}

(async () => {
  const txid = 'a1768c54b44c4da0f5fd0cb83f9905d70a506bb756b6fe7c7c18dadfc34900c9';
  const decoded = await decodeFromTxid(txid);
  console.log(JSON.stringify(decoded, null, 2));
})();
