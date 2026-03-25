export interface HashPair {
  hashlock: string;
  secret: string;
}

export interface Utxo {
  hash: string;
  index: number;
  value: number;
}

export interface TapleafInfo {
  leafVersion: number;
  scriptHex: string;
  controlBlockHex: string;
}
