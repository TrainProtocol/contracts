/**
 * Train Protocol Bitcoin Event Encoding/Decoding
 *
 * Type-prefixed binary format for OP_RETURN event data.
 * Leverages Bitcoin Core v29+ extended OP_RETURN support.
 *
 * Format: [1B type][fixed fields][variable fields]
 * Variable fields use 1-byte length prefix (max 255B) or 2-byte (max 65535B).
 */

// ─── Event Type Constants ─────────────────────────────────────

export const EventType = {
  UserLocked: 0x01,
  SolverLocked: 0x02,
  UserRedeemed: 0x03,
  SolverRedeemed: 0x04,
  UserRefunded: 0x05,
  SolverRefunded: 0x06,
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

// ─── Event Interfaces ─────────────────────────────────────────

export interface UserLockedEvent {
  type: typeof EventType.UserLocked;
  hashlock: Buffer;
  timelockDelta: number;
  rewardTimelockDelta: number;
  quoteExpiry: number;
  dstAmount: bigint;
  rewardAmount: bigint;
  dstChain: string;
  dstAddress: Buffer;
  dstToken: string;
  rewardToken: string;
  rewardRecipient: string;
  userData: Buffer;
  solverData: Buffer;
}

export interface SolverLockedEvent {
  type: typeof EventType.SolverLocked;
  hashlock: Buffer;
  index: number;
  timelockDelta: number;
  rewardTimelockDelta: number;
  reward: bigint;
  dstAmount: bigint;
  dstChain: string;
  dstAddress: Buffer;
  dstToken: string;
  data: Buffer;
}

export interface UserRedeemedEvent {
  type: typeof EventType.UserRedeemed;
  hashlock: Buffer;
  secret: Buffer;
}

export interface SolverRedeemedEvent {
  type: typeof EventType.SolverRedeemed;
  hashlock: Buffer;
  index: number;
  secret: Buffer;
}

export interface UserRefundedEvent {
  type: typeof EventType.UserRefunded;
  hashlock: Buffer;
}

export interface SolverRefundedEvent {
  type: typeof EventType.SolverRefunded;
  hashlock: Buffer;
  index: number;
}

export type TrainEvent =
  | UserLockedEvent
  | SolverLockedEvent
  | UserRedeemedEvent
  | SolverRedeemedEvent
  | UserRefundedEvent
  | SolverRefundedEvent;

// ─── Internal Helpers ─────────────────────────────────────────

function writeVar1(buf: Buffer, offset: number, data: Buffer): number {
  if (data.length > 255) throw new Error('Var1 field exceeds 255 bytes');
  buf.writeUInt8(data.length, offset);
  data.copy(buf, offset + 1);
  return offset + 1 + data.length;
}

function readVar1(buf: Buffer, offset: number): { data: Buffer; end: number } {
  const len = buf.readUInt8(offset);
  return { data: buf.subarray(offset + 1, offset + 1 + len), end: offset + 1 + len };
}

function writeVar2(buf: Buffer, offset: number, data: Buffer): number {
  if (data.length > 65535) throw new Error('Var2 field exceeds 65535 bytes');
  buf.writeUInt16BE(data.length, offset);
  data.copy(buf, offset + 2);
  return offset + 2 + data.length;
}

function readVar2(buf: Buffer, offset: number): { data: Buffer; end: number } {
  const len = buf.readUInt16BE(offset);
  return { data: buf.subarray(offset + 2, offset + 2 + len), end: offset + 2 + len };
}

function strBuf(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

// ─── Encoders ─────────────────────────────────────────────────

/**
 * Encode a UserLocked event for OP_RETURN.
 *
 * Layout (61B fixed + variable):
 *   [1B type] [32B hashlock] [4B timelockDelta] [4B rewardTimelockDelta]
 *   [4B quoteExpiry] [8B dstAmount] [8B rewardAmount]
 *   [var1 dstChain] [var1 dstAddress] [var1 dstToken]
 *   [var1 rewardToken] [var1 rewardRecipient]
 *   [var2 userData] [var2 solverData]
 */
export function encodeUserLockedEvent(e: Omit<UserLockedEvent, 'type'>): Buffer {
  if (e.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');

  const dstChainBuf = strBuf(e.dstChain);
  const dstTokenBuf = strBuf(e.dstToken);
  const rewardTokenBuf = strBuf(e.rewardToken);
  const rewardRecipientBuf = strBuf(e.rewardRecipient);
  const userData = e.userData ?? Buffer.alloc(0);
  const solverData = e.solverData ?? Buffer.alloc(0);

  const size =
    1 +
    32 +
    4 +
    4 +
    4 +
    8 +
    8 +
    (1 + dstChainBuf.length) +
    (1 + e.dstAddress.length) +
    (1 + dstTokenBuf.length) +
    (1 + rewardTokenBuf.length) +
    (1 + rewardRecipientBuf.length) +
    (2 + userData.length) +
    (2 + solverData.length);

  const buf = Buffer.alloc(size);
  let o = 0;

  buf.writeUInt8(EventType.UserLocked, o);
  o += 1;
  e.hashlock.copy(buf, o);
  o += 32;
  buf.writeUInt32BE(e.timelockDelta >>> 0, o);
  o += 4;
  buf.writeUInt32BE(e.rewardTimelockDelta >>> 0, o);
  o += 4;
  buf.writeUInt32BE(e.quoteExpiry >>> 0, o);
  o += 4;
  buf.writeBigUInt64BE(e.dstAmount, o);
  o += 8;
  buf.writeBigUInt64BE(e.rewardAmount, o);
  o += 8;

  o = writeVar1(buf, o, dstChainBuf);
  o = writeVar1(buf, o, e.dstAddress);
  o = writeVar1(buf, o, dstTokenBuf);
  o = writeVar1(buf, o, rewardTokenBuf);
  o = writeVar1(buf, o, rewardRecipientBuf);
  o = writeVar2(buf, o, userData);
  o = writeVar2(buf, o, solverData);

  return buf;
}

/**
 * Encode a SolverLocked event for OP_RETURN.
 *
 * Layout (61B fixed + variable):
 *   [1B type] [32B hashlock] [4B index] [4B timelockDelta]
 *   [4B rewardTimelockDelta] [8B reward] [8B dstAmount]
 *   [var1 dstChain] [var1 dstAddress] [var1 dstToken]
 *   [var2 data]
 */
export function encodeSolverLockedEvent(e: Omit<SolverLockedEvent, 'type'>): Buffer {
  if (e.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');

  const dstChainBuf = strBuf(e.dstChain);
  const dstTokenBuf = strBuf(e.dstToken);
  const data = e.data ?? Buffer.alloc(0);

  const size =
    1 +
    32 +
    4 +
    4 +
    4 +
    8 +
    8 +
    (1 + dstChainBuf.length) +
    (1 + e.dstAddress.length) +
    (1 + dstTokenBuf.length) +
    (2 + data.length);

  const buf = Buffer.alloc(size);
  let o = 0;

  buf.writeUInt8(EventType.SolverLocked, o);
  o += 1;
  e.hashlock.copy(buf, o);
  o += 32;
  buf.writeUInt32BE(e.index >>> 0, o);
  o += 4;
  buf.writeUInt32BE(e.timelockDelta >>> 0, o);
  o += 4;
  buf.writeUInt32BE(e.rewardTimelockDelta >>> 0, o);
  o += 4;
  buf.writeBigUInt64BE(e.reward, o);
  o += 8;
  buf.writeBigUInt64BE(e.dstAmount, o);
  o += 8;

  o = writeVar1(buf, o, dstChainBuf);
  o = writeVar1(buf, o, e.dstAddress);
  o = writeVar1(buf, o, dstTokenBuf);
  o = writeVar2(buf, o, data);

  return buf;
}

/** Encode UserRedeemed: [0x03][32B hashlock][32B secret] = 65 bytes */
export function encodeUserRedeemedEvent(hashlock: Buffer, secret: Buffer): Buffer {
  if (hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
  if (secret.length !== 32) throw new Error('secret must be 32 bytes');
  return Buffer.concat([Buffer.from([EventType.UserRedeemed]), hashlock, secret]);
}

/** Encode SolverRedeemed: [0x04][32B hashlock][4B index][32B secret] = 69 bytes */
export function encodeSolverRedeemedEvent(hashlock: Buffer, index: number, secret: Buffer): Buffer {
  if (hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
  if (secret.length !== 32) throw new Error('secret must be 32 bytes');
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32BE(index >>> 0, 0);
  return Buffer.concat([Buffer.from([EventType.SolverRedeemed]), hashlock, indexBuf, secret]);
}

/** Encode UserRefunded: [0x05][32B hashlock] = 33 bytes */
export function encodeUserRefundedEvent(hashlock: Buffer): Buffer {
  if (hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
  return Buffer.concat([Buffer.from([EventType.UserRefunded]), hashlock]);
}

/** Encode SolverRefunded: [0x06][32B hashlock][4B index] = 37 bytes */
export function encodeSolverRefundedEvent(hashlock: Buffer, index: number): Buffer {
  if (hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32BE(index >>> 0, 0);
  return Buffer.concat([Buffer.from([EventType.SolverRefunded]), hashlock, indexBuf]);
}

// ─── Decoders ─────────────────────────────────────────────────

/** Decode any Train event from an OP_RETURN payload buffer. */
export function decodeTrainEvent(buf: Buffer): TrainEvent {
  if (buf.length < 1) throw new Error('Empty event buffer');
  const type = buf.readUInt8(0);

  switch (type) {
    case EventType.UserLocked:
      return decodeUserLockedEvent(buf);
    case EventType.SolverLocked:
      return decodeSolverLockedEvent(buf);
    case EventType.UserRedeemed:
      return decodeUserRedeemedEvent(buf);
    case EventType.SolverRedeemed:
      return decodeSolverRedeemedEvent(buf);
    case EventType.UserRefunded:
      return decodeUserRefundedEvent(buf);
    case EventType.SolverRefunded:
      return decodeSolverRefundedEvent(buf);
    default:
      throw new Error(`Unknown event type: 0x${type.toString(16)}`);
  }
}

function decodeUserLockedEvent(buf: Buffer): UserLockedEvent {
  let o = 1;
  const hashlock = Buffer.from(buf.subarray(o, o + 32));
  o += 32;
  const timelockDelta = buf.readUInt32BE(o);
  o += 4;
  const rewardTimelockDelta = buf.readUInt32BE(o);
  o += 4;
  const quoteExpiry = buf.readUInt32BE(o);
  o += 4;
  const dstAmount = buf.readBigUInt64BE(o);
  o += 8;
  const rewardAmount = buf.readBigUInt64BE(o);
  o += 8;

  const r1 = readVar1(buf, o);
  const dstChain = r1.data.toString('utf8');
  o = r1.end;
  const r2 = readVar1(buf, o);
  const dstAddress = Buffer.from(r2.data);
  o = r2.end;
  const r3 = readVar1(buf, o);
  const dstToken = r3.data.toString('utf8');
  o = r3.end;
  const r4 = readVar1(buf, o);
  const rewardToken = r4.data.toString('utf8');
  o = r4.end;
  const r5 = readVar1(buf, o);
  const rewardRecipient = r5.data.toString('utf8');
  o = r5.end;
  const r6 = readVar2(buf, o);
  const userData = Buffer.from(r6.data);
  o = r6.end;
  const r7 = readVar2(buf, o);
  const solverData = Buffer.from(r7.data);

  return {
    type: EventType.UserLocked,
    hashlock,
    timelockDelta,
    rewardTimelockDelta,
    quoteExpiry,
    dstAmount,
    rewardAmount,
    dstChain,
    dstAddress,
    dstToken,
    rewardToken,
    rewardRecipient,
    userData,
    solverData,
  };
}

function decodeSolverLockedEvent(buf: Buffer): SolverLockedEvent {
  let o = 1;
  const hashlock = Buffer.from(buf.subarray(o, o + 32));
  o += 32;
  const index = buf.readUInt32BE(o);
  o += 4;
  const timelockDelta = buf.readUInt32BE(o);
  o += 4;
  const rewardTimelockDelta = buf.readUInt32BE(o);
  o += 4;
  const reward = buf.readBigUInt64BE(o);
  o += 8;
  const dstAmount = buf.readBigUInt64BE(o);
  o += 8;

  const r1 = readVar1(buf, o);
  const dstChain = r1.data.toString('utf8');
  o = r1.end;
  const r2 = readVar1(buf, o);
  const dstAddress = Buffer.from(r2.data);
  o = r2.end;
  const r3 = readVar1(buf, o);
  const dstToken = r3.data.toString('utf8');
  o = r3.end;
  const r4 = readVar2(buf, o);
  const data = Buffer.from(r4.data);

  return {
    type: EventType.SolverLocked,
    hashlock,
    index,
    timelockDelta,
    rewardTimelockDelta,
    reward,
    dstAmount,
    dstChain,
    dstAddress,
    dstToken,
    data,
  };
}

function decodeUserRedeemedEvent(buf: Buffer): UserRedeemedEvent {
  if (buf.length !== 65) throw new Error(`UserRedeemed event must be 65 bytes, got ${buf.length}`);
  return {
    type: EventType.UserRedeemed,
    hashlock: Buffer.from(buf.subarray(1, 33)),
    secret: Buffer.from(buf.subarray(33, 65)),
  };
}

function decodeSolverRedeemedEvent(buf: Buffer): SolverRedeemedEvent {
  if (buf.length !== 69) throw new Error(`SolverRedeemed event must be 69 bytes, got ${buf.length}`);
  return {
    type: EventType.SolverRedeemed,
    hashlock: Buffer.from(buf.subarray(1, 33)),
    index: buf.readUInt32BE(33),
    secret: Buffer.from(buf.subarray(37, 69)),
  };
}

function decodeUserRefundedEvent(buf: Buffer): UserRefundedEvent {
  if (buf.length !== 33) throw new Error(`UserRefunded event must be 33 bytes, got ${buf.length}`);
  return {
    type: EventType.UserRefunded,
    hashlock: Buffer.from(buf.subarray(1, 33)),
  };
}

function decodeSolverRefundedEvent(buf: Buffer): SolverRefundedEvent {
  if (buf.length !== 37) throw new Error(`SolverRefunded event must be 37 bytes, got ${buf.length}`);
  return {
    type: EventType.SolverRefunded,
    hashlock: Buffer.from(buf.subarray(1, 33)),
    index: buf.readUInt32BE(33),
  };
}
