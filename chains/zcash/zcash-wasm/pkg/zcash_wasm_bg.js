let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}


let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}
/**
 * Initialize panic hook for better error messages in WASM
 */
export function init() {
    wasm.init();
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
/**
 * Creates a SHA256 hash of the input data
 * Useful for generating hashlocks
 * @param {Uint8Array} secret
 * @returns {Uint8Array}
 */
export function createHashlock(secret) {
    const ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.createHashlock(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

const WasmHTLCFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmhtlc_free(ptr >>> 0, 1));
/**
 * WASM wrapper for the HTLC struct
 */
export class WasmHTLC {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHTLCFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmhtlc_free(ptr, 0);
    }
    /**
     * Checks if the timelock has expired
     * @param {bigint} current_time
     * @returns {boolean}
     */
    isExpired(current_time) {
        const ret = wasm.wasmhtlc_isExpired(this.__wbg_ptr, current_time);
        return ret !== 0;
    }
    /**
     * Verifies if the provided secret matches the hashlock
     * @param {Uint8Array} secret
     * @returns {boolean}
     */
    verifySecret(secret) {
        const ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhtlc_verifySecret(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Creates a new HTLC
     *
     * # Arguments
     * * `sender` - The sender's address
     * * `receiver` - The receiver's address
     * * `amount` - The amount in zatoshis
     * * `hashlock` - The 32-byte hash of the secret (as Uint8Array)
     * * `timelock` - The timelock (block height or timestamp)
     * @param {string} sender
     * @param {string} receiver
     * @param {bigint} amount
     * @param {Uint8Array} hashlock
     * @param {bigint} timelock
     */
    constructor(sender, receiver, amount, hashlock, timelock) {
        const ptr0 = passStringToWasm0(sender, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(receiver, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(hashlock, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhtlc_new(ptr0, len0, ptr1, len1, amount, ptr2, len2, timelock);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmHTLCFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Gets the amount in zatoshis
     * @returns {bigint}
     */
    get amount() {
        const ret = wasm.wasmhtlc_amount(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Attempts to redeem the HTLC with the given secret
     * @param {Uint8Array} secret
     */
    redeem(secret) {
        const ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhtlc_redeem(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Attempts to refund the HTLC after the timelock has expired
     * @param {bigint} current_time
     */
    refund(current_time) {
        const ret = wasm.wasmhtlc_refund(this.__wbg_ptr, current_time);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Gets the sender's address
     * @returns {string}
     */
    get sender() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmhtlc_sender(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Gets the hashlock as a byte array
     * @returns {Uint8Array}
     */
    get hashlock() {
        const ret = wasm.wasmhtlc_hashlock(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Gets the receiver's address
     * @returns {string}
     */
    get receiver() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmhtlc_receiver(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Checks if the HTLC has been redeemed
     * @returns {boolean}
     */
    get redeemed() {
        const ret = wasm.wasmhtlc_redeemed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Checks if the HTLC has been refunded
     * @returns {boolean}
     */
    get refunded() {
        const ret = wasm.wasmhtlc_refunded(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Gets the timelock
     * @returns {bigint}
     */
    get timelock() {
        const ret = wasm.wasmhtlc_timelock(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
}
if (Symbol.dispose) WasmHTLC.prototype[Symbol.dispose] = WasmHTLC.prototype.free;

export function __wbg___wbindgen_throw_b855445ff6a94295(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};

export function __wbg_error_7534b8e9a36f1ab4(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
    } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
    }
};

export function __wbg_new_8a6f238a6ece86ea() {
    const ret = new Error();
    return ret;
};

export function __wbg_stack_0ed75d68575b0f3c(arg0, arg1) {
    const ret = arg1.stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

export function __wbindgen_cast_2241b6af4c4b2941(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
};

export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
    ;
};

