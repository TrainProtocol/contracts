function readU48BE(buf: Buffer, offset = 0): number {
  return Number(BigInt.asUintN(48, BigInt('0x' + buf.subarray(offset, offset + 6).toString('hex'))));
}

function readU40BE(buf: Buffer, offset = 0): number {
  return Number(BigInt.asUintN(40, BigInt('0x' + buf.subarray(offset, offset + 5).toString('hex'))));
}

function isAsciiWord(b: Buffer) {
  const s = b.toString('utf8').replace(/\x00+$/g, '');
  return /^[ -~]*$/.test(s);
}

export type OpReturnDecoded =
  | {
      kind: 'commitLog';
      commitId: `0x${string}`;
      timelock: number;
      dstChain: string;
      dstAddress: `0x${string}`;
      dstAsset: string;
      srcReceiver: string;
      _rawHex: string;
    }
  | {
      kind: 'lock';
      lockId: `0x${string}`;
      paymentHashlock: `0x${string}`;
      delayCsvSeconds: number;
      dstChain: string;
      dstAsset: string;
      _rawHex: string;
    }
  | {
      kind: 'addLock';
      commitId: `0x${string}`;
      paymentHashlock: `0x${string}`;
      timelock: number;
      _rawHex: string;
    }
  | {
      kind: 'refund';
      commitId: `0x${string}`;
      _rawHex: string;
    }
  | {
      kind: 'redeem';
      commitId: `0x${string}`;
      paymentHashlock: `0x${string}`;
      secret: `0x${string}`;
      truncated?: { perFieldBytes: number; originalEachWas32: true };
      _rawHex: string;
    }
  | {
      kind: 'unknown';
      _rawHex: string;
      note?: string;
    };

export function decodeCommitLogPayload(buf: Buffer): OpReturnDecoded {
  if (buf.length !== 78) return { kind: 'unknown', _rawHex: '0x' + buf.toString('hex'), note: 'not 78 bytes' };
  let o = 0;
  const commitId = buf.subarray(o, (o += 32));
  const timelock = readU48BE(buf, o);
  o += 6;
  const trimUtf8 = (b: Buffer) => b.toString('utf8').replace(/\x00+$/g, '');
  const dstChain = trimUtf8(buf.subarray(o, (o += 4)));
  const dstAddress = '0x' + buf.subarray(o, (o += 20)).toString('hex');
  const dstAsset = trimUtf8(buf.subarray(o, (o += 4)));
  const srcReceiver = trimUtf8(buf.subarray(o, (o += 12)));
  return {
    kind: 'commitLog',
    commitId: ('0x' + commitId.toString('hex')) as `0x${string}`,
    timelock,
    dstChain,
    dstAddress: dstAddress as `0x${string}`,
    dstAsset,
    srcReceiver,
    _rawHex: '0x' + buf.toString('hex'),
  };
}

export function decodeLockPayload(buf: Buffer): OpReturnDecoded {
  if (buf.length !== 77) return { kind: 'unknown', _rawHex: '0x' + buf.toString('hex'), note: 'not 77 bytes' };
  const lockId = buf.subarray(0, 32);
  const hashlock = buf.subarray(32, 64);
  const delayCsvSeconds = readU40BE(buf, 64);
  const dstChainB = buf.subarray(69, 73);
  const dstAssetB = buf.subarray(73, 77);
  return {
    kind: 'lock',
    lockId: ('0x' + lockId.toString('hex')) as `0x${string}`,
    paymentHashlock: ('0x' + hashlock.toString('hex')) as `0x${string}`,
    delayCsvSeconds,
    dstChain: dstChainB.toString('utf8').replace(/\x00+$/g, ''),
    dstAsset: dstAssetB.toString('utf8').replace(/\x00+$/g, ''),
    _rawHex: '0x' + buf.toString('hex'),
  };
}


export function decodeAddLockPayload(buf: Buffer): OpReturnDecoded {
  if (buf.length !== 70) return { kind: 'unknown', _rawHex: '0x' + buf.toString('hex'), note: 'not 70 bytes' };
  const commitId = buf.subarray(0, 32);
  const hashlock = buf.subarray(32, 64);
  const timelock = readU48BE(buf, 64);
  return {
    kind: 'addLock',
    commitId: ('0x' + commitId.toString('hex')) as `0x${string}`,
    paymentHashlock: ('0x' + hashlock.toString('hex')) as `0x${string}`,
    timelock,
    _rawHex: '0x' + buf.toString('hex'),
  };
}

export function decodeRefundPayload(buf: Buffer): OpReturnDecoded {
  if (buf.length !== 32) return { kind: 'unknown', _rawHex: '0x' + buf.toString('hex'), note: 'not 32 bytes' };
  return {
    kind: 'refund',
    commitId: ('0x' + buf.toString('hex')) as `0x${string}`,
    _rawHex: '0x' + buf.toString('hex'),
  };
}

export function decodeRedeemPayload(buf: Buffer): OpReturnDecoded {
  if (buf.length !== 79) {
    return { kind: 'unknown', _rawHex: '0x' + buf.toString('hex'), note: 'expected 79 bytes (15|32|32)' };
  }
  const commitId15 = buf.subarray(0, 15);
  const hashlock = buf.subarray(15, 47);
  const secret = buf.subarray(47, 79);
  return {
    kind: 'redeem',
    commitId: ('0x' + commitId15.toString('hex')) as `0x${string}`,
    paymentHashlock: ('0x' + hashlock.toString('hex')) as `0x${string}`,
    secret: ('0x' + secret.toString('hex')) as `0x${string}`,
    truncated: { perFieldBytes: 15, originalEachWas32: true },
    _rawHex: '0x' + buf.toString('hex'),
  };
}


export function decodeAnyOpReturnPayload(hex: string): OpReturnDecoded {
  const buf = Buffer.from(hex.replace(/^0x/i, ''), 'hex');

  if (buf.length === 32) return decodeRefundPayload(buf);
  if (buf.length === 70) return decodeAddLockPayload(buf);
  if (buf.length === 77) return decodeLockPayload(buf);
  if (buf.length === 78) return decodeCommitLogPayload(buf);
  if (buf.length === 79) return decodeRedeemPayload(buf);

  return { kind: 'unknown', _rawHex: '0x' + buf.toString('hex') };
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

export function decodeCommitLogHex(hex: string) {
  const dec = decodeAnyOpReturnPayload(hex);
  if (dec.kind !== 'commitLog') {
    throw new Error(`invalid memo: expected commitLog(78B), got ${dec.kind} (${dec._rawHex.length / 2} bytes)`);
  }
  const { commitId, timelock, dstChain, dstAddress, dstAsset, srcReceiver } = dec;
  return { commitId, timelock, dstChain, dstAddress, dstAsset, srcReceiver };
}
