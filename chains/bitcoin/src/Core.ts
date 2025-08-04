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
