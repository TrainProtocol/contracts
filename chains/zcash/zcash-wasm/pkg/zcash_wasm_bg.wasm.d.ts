/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const __wbg_wasmhtlc_free: (a: number, b: number) => void;
export const createHashlock: (a: number, b: number) => [number, number];
export const init: () => void;
export const wasmhtlc_amount: (a: number) => bigint;
export const wasmhtlc_hashlock: (a: number) => [number, number];
export const wasmhtlc_isExpired: (a: number, b: bigint) => number;
export const wasmhtlc_new: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: bigint) => [number, number, number];
export const wasmhtlc_receiver: (a: number) => [number, number];
export const wasmhtlc_redeem: (a: number, b: number, c: number) => [number, number];
export const wasmhtlc_redeemed: (a: number) => number;
export const wasmhtlc_refund: (a: number, b: bigint) => [number, number];
export const wasmhtlc_refunded: (a: number) => number;
export const wasmhtlc_sender: (a: number) => [number, number];
export const wasmhtlc_timelock: (a: number) => bigint;
export const wasmhtlc_verifySecret: (a: number, b: number, c: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_start: () => void;
