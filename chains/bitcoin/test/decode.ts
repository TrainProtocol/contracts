import mempoolJS from '@mempool/mempool.js';
import {
  decodeAnyOpReturnPayload,
  extractAllPushDatasFromOpReturn,
  type OpReturnDecoded,
  isCsvTimeBased,
  sequenceToSeconds,
} from '../src/utils';

const mempool = mempoolJS({ hostname: 'mempool.space', network: 'testnet' }).bitcoin;

async function decodeFromTxid(txid: string) {
  const tx = await mempool.transactions.getTx({ txid });
  const oprets = (tx.vout as any[])
    .map((v: any, idx: number) => ({ ...v, _idx: idx }))
    .filter((v: any) => v.scriptpubkey_type === 'op_return' || String(v.scriptpubkey || '').startsWith('6a'));
  if (!oprets.length) throw new Error('no OP_RETURN outputs found');

  const results: { vout: number; decoded: OpReturnDecoded[] }[] = [];
  for (const v of oprets) {
    const pushes = extractAllPushDatasFromOpReturn(v.scriptpubkey);
    const decoded = pushes.map((p) => decodeAnyOpReturnPayload(p.toString('hex')));
    results.push({ vout: v._idx, decoded });
  }
  return results;
}

(async () => {
  const txid = process.argv[2] || 'b6a4139c8df6177127ee8e0e4189e53268c0d7ead7eea44674ffa96ad20ed691';
  try {
    const out = await decodeFromTxid(txid);
    console.log(`TX ${txid} OP_RETURN decode (testnet):`);
    for (const r of out) {
      console.log(`\n> vout ${r.vout}`);
      for (const d of r.decoded) {
        switch (d.kind) {
          case 'commitLog':
            console.log('  kind       : commitLog');
            console.log(`  commitId   : ${d.commitId}`);
            console.log(`  timelockSeq: ${d.timelockSequence}`);
            if (isCsvTimeBased(d.timelockSequence)) {
              console.log(`  timelockSec: ${sequenceToSeconds(d.timelockSequence)}`);
            }
            console.log(`  dstChain   : ${d.dstChain}`);
            console.log(`  dstAddress : ${d.dstAddress}`);
            console.log(`  dstAsset   : ${d.dstAsset}`);
            console.log(`  srcReceiver: ${d.srcReceiver}`);
            break;

          case 'lock':
            console.log('  kind       : lock');
            console.log(`  lockId     : ${d.lockId}`);
            console.log(`  hashlock   : ${d.paymentHashlock}`);
            console.log(`  csvSeq     : ${d.csvSequence}`);
            if (isCsvTimeBased(d.csvSequence)) {
              console.log(`  csvSec     : ${sequenceToSeconds(d.csvSequence)}`);
            }
            console.log(`  dstChain   : ${d.dstChain}`);
            console.log(`  dstAsset   : ${d.dstAsset}`);
            break;

          case 'addLock':
            console.log('  kind       : addLock');
            console.log(`  commitId   : ${d.commitId}`);
            console.log(`  hashlock   : ${d.paymentHashlock}`);
            console.log(`  timelockSeq: ${d.timelockSequence}`);
            if (isCsvTimeBased(d.timelockSequence)) {
              console.log(`  timelockSec: ${sequenceToSeconds(d.timelockSequence)}`);
            }
            break;

          case 'refund':
            console.log('  kind       : refund');
            console.log(`  commitId   : ${d.commitId}`);
            break;

          case 'redeem':
            console.log('  kind       : redeem');
            console.log(`  commitId15 : ${d.commitId}`);
            console.log(`  hashlock   : ${d.paymentHashlock}`);
            console.log(`  secret     : ${d.secret}`);
            break;

          default:
            console.log('  kind       : unknown');
            console.log(`  raw(hex)   : ${d._rawHex}`);
            if ((d as any).note) console.log(`  note       : ${(d as any).note}`);
        }
      }
    }
  } catch (e: any) {
    console.error(e?.response?.data || e?.message || e);
    process.exit(1);
  }
})();
