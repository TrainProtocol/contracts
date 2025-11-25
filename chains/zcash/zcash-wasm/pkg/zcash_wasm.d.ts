/* tslint:disable */
/* eslint-disable */
/**
 * Initialize panic hook for better error messages in WASM
 */
export function init(): void;
/**
 * Creates a SHA256 hash of the input data
 * Useful for generating hashlocks
 */
export function createHashlock(secret: Uint8Array): Uint8Array;
/**
 * WASM wrapper for the HTLC struct
 */
export class WasmHTLC {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Checks if the timelock has expired
   */
  isExpired(current_time: bigint): boolean;
  /**
   * Verifies if the provided secret matches the hashlock
   */
  verifySecret(secret: Uint8Array): boolean;
  /**
   * Creates a new HTLC
   * 
   * # Arguments
   * * `sender` - The sender's address
   * * `receiver` - The receiver's address
   * * `amount` - The amount in zatoshis
   * * `hashlock` - The 32-byte hash of the secret (as Uint8Array)
   * * `timelock` - The timelock (block height or timestamp)
   */
  constructor(sender: string, receiver: string, amount: bigint, hashlock: Uint8Array, timelock: bigint);
  /**
   * Attempts to redeem the HTLC with the given secret
   */
  redeem(secret: Uint8Array): void;
  /**
   * Attempts to refund the HTLC after the timelock has expired
   */
  refund(current_time: bigint): void;
  /**
   * Gets the amount in zatoshis
   */
  readonly amount: bigint;
  /**
   * Gets the sender's address
   */
  readonly sender: string;
  /**
   * Gets the hashlock as a byte array
   */
  readonly hashlock: Uint8Array;
  /**
   * Gets the receiver's address
   */
  readonly receiver: string;
  /**
   * Checks if the HTLC has been redeemed
   */
  readonly redeemed: boolean;
  /**
   * Checks if the HTLC has been refunded
   */
  readonly refunded: boolean;
  /**
   * Gets the timelock
   */
  readonly timelock: bigint;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_wasmhtlc_free: (a: number, b: number) => void;
  readonly createHashlock: (a: number, b: number) => [number, number];
  readonly init: () => void;
  readonly wasmhtlc_amount: (a: number) => bigint;
  readonly wasmhtlc_hashlock: (a: number) => [number, number];
  readonly wasmhtlc_isExpired: (a: number, b: bigint) => number;
  readonly wasmhtlc_new: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: bigint) => [number, number, number];
  readonly wasmhtlc_receiver: (a: number) => [number, number];
  readonly wasmhtlc_redeem: (a: number, b: number, c: number) => [number, number];
  readonly wasmhtlc_redeemed: (a: number) => number;
  readonly wasmhtlc_refund: (a: number, b: bigint) => [number, number];
  readonly wasmhtlc_refunded: (a: number) => number;
  readonly wasmhtlc_sender: (a: number) => [number, number];
  readonly wasmhtlc_timelock: (a: number) => bigint;
  readonly wasmhtlc_verifySecret: (a: number, b: number, c: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
