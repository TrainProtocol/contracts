export interface LockOptions {
  fee?: number;
  lockHeight?: number;
  data?: string;
}

export interface HashPair {
  hashlock: string;
  secret: string;
}

export interface Utxo {
  hash: string;
  index: number;
  value: number;
}

export type CommitLog = {
  commitId: Buffer; // 32 bytes
  timelock: number; // unix timestamp, uint48
  dstChain: string; // e.g. "ETH"
  dstAddress: string; // hex, base58, or raw buffer
  dstAsset: string; // e.g. "BTC"
  srcReceiver: string; // hex/base58/utf8
};
