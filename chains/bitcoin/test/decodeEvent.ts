import 'dotenv/config';
import axios from 'axios';
import { decodeTrainEvent, EventType } from '../src/events';
import { extractAllPushDatasFromOpReturn } from '../src/utils';

const BASE = 'https://mempool.space/testnet4/api';

async function fetchTx(txid: string) {
  const { data } = await axios.get(`${BASE}/tx/${txid}`);
  return data;
}

function formatEvent(event: ReturnType<typeof decodeTrainEvent>): Record<string, any> {
  const fmt: Record<string, any> = {};

  switch (event.type) {
    case EventType.UserLocked:
      fmt.event = 'UserLocked';
      fmt.hashlock = event.hashlock.toString('hex');
      fmt.timelockDelta = `${event.timelockDelta}s`;
      fmt.rewardTimelockDelta = `${event.rewardTimelockDelta}s`;
      fmt.quoteExpiry = event.quoteExpiry ? new Date(event.quoteExpiry * 1000).toISOString() : 'none';
      fmt.dstAmount = event.dstAmount.toString();
      fmt.rewardAmount = event.rewardAmount.toString();
      fmt.dstChain = event.dstChain;
      fmt.dstAddress = event.dstAddress.toString('hex');
      fmt.dstToken = event.dstToken;
      fmt.rewardToken = event.rewardToken || '(none)';
      fmt.rewardRecipient = event.rewardRecipient || '(none)';
      if (event.userData.length) fmt.userData = event.userData.toString('hex');
      if (event.solverData.length) fmt.solverData = event.solverData.toString('hex');
      break;

    case EventType.SolverLocked:
      fmt.event = 'SolverLocked';
      fmt.hashlock = event.hashlock.toString('hex');
      fmt.index = event.index;
      fmt.timelockDelta = `${event.timelockDelta}s`;
      fmt.rewardTimelockDelta = `${event.rewardTimelockDelta}s`;
      fmt.reward = event.reward.toString();
      fmt.dstAmount = event.dstAmount.toString();
      fmt.dstChain = event.dstChain;
      fmt.dstAddress = event.dstAddress.toString('hex');
      fmt.dstToken = event.dstToken;
      if (event.data.length) fmt.data = event.data.toString('hex');
      break;

    case EventType.UserRedeemed:
      fmt.event = 'UserRedeemed';
      fmt.hashlock = event.hashlock.toString('hex');
      fmt.secret = event.secret.toString('hex');
      break;

    case EventType.SolverRedeemed:
      fmt.event = 'SolverRedeemed';
      fmt.hashlock = event.hashlock.toString('hex');
      fmt.index = event.index;
      fmt.secret = event.secret.toString('hex');
      break;

    case EventType.UserRefunded:
      fmt.event = 'UserRefunded';
      fmt.hashlock = event.hashlock.toString('hex');
      break;

    case EventType.SolverRefunded:
      fmt.event = 'SolverRefunded';
      fmt.hashlock = event.hashlock.toString('hex');
      fmt.index = event.index;
      break;
  }

  return fmt;
}

(async () => {
  const txid = process.argv[2];
  if (!txid) {
    console.log('Usage: npx ts-node test/decodeEvent.ts <txid>');
    console.log('       npx ts-node test/decodeEvent.ts <raw-hex-payload>');
    process.exit(1);
  }

  // If it looks like a raw hex payload (starts with 01-06 event type), decode directly
  if (/^(0[1-6])/.test(txid) && txid.length > 64) {
    const buf = Buffer.from(txid, 'hex');
    const event = decodeTrainEvent(buf);
    console.log(formatEvent(event));
    process.exit(0);
  }

  // Otherwise treat as txid — fetch from mempool.space
  console.log(`Fetching tx ${txid}...`);
  const tx = await fetchTx(txid);

  let found = false;
  for (let i = 0; i < tx.vout.length; i++) {
    const out = tx.vout[i];
    const spk: string = out.scriptpubkey;

    // OP_RETURN starts with 6a
    if (!spk.startsWith('6a')) continue;

    console.log(`\n── Output ${i} (OP_RETURN) ──`);
    console.log(`  scriptPubKey: ${spk}`);

    try {
      const pushDatas = extractAllPushDatasFromOpReturn(spk);
      if (!pushDatas.length) {
        console.log('  (no push data found)');
        continue;
      }

      for (const payload of pushDatas) {
        const typeByte = payload[0];
        if (typeByte >= 0x01 && typeByte <= 0x06) {
          const event = decodeTrainEvent(payload);
          const formatted = formatEvent(event);
          console.log('  Decoded Train event:');
          for (const [k, v] of Object.entries(formatted)) {
            console.log(`    ${k}: ${v}`);
          }
          found = true;
        } else {
          console.log(`  Raw data (${payload.length} bytes): ${payload.toString('hex')}`);
        }
      }
    } catch (e: any) {
      console.log(`  Could not decode: ${e.message}`);
    }
  }

  if (!found) {
    console.log('\nNo Train Protocol events found in this transaction.');
    console.log('OP_RETURN outputs checked:', tx.vout.filter((o: any) => o.scriptpubkey.startsWith('6a')).length);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
