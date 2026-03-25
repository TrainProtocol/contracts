export function isCsvTimeBased(seq: number): boolean {
  return (seq & 0x00400000) !== 0;
}

export function sequenceToSeconds(seq: number): number {
  if (!isCsvTimeBased(seq)) throw new Error('CSV sequence is not time-based');
  const units = seq & 0xffff;
  return units * 512;
}

export function extractAllPushDatasFromOpReturn(scriptHex: string): Buffer[] {
  const b = Buffer.from(scriptHex, 'hex');
  if (b.length < 1 || b[0] !== 0x6a) throw new Error('not an OP_RETURN script');
  const out: Buffer[] = [];
  let o = 1;
  while (o < b.length) {
    const op = b[o++];
    let len: number | undefined;
    if (op === 0x00) continue;
    if (op <= 0x4b) {
      len = op;
    } else if (op === 0x4c) {
      if (o + 1 > b.length) break;
      len = b[o++];
    } else if (op === 0x4d) {
      if (o + 2 > b.length) break;
      len = b.readUInt16LE(o);
      o += 2;
    } else if (op === 0x4e) {
      if (o + 4 > b.length) break;
      len = b.readUInt32LE(o);
      o += 4;
    } else {
      break;
    }
    const end = o + (len ?? 0);
    if (end > b.length) break;
    out.push(b.subarray(o, end));
    o = end;
  }
  return out;
}
