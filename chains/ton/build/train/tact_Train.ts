import {
    Cell,
    Slice,
    Address,
    Builder,
    beginCell,
    ComputeError,
    TupleItem,
    TupleReader,
    Dictionary,
    contractAddress,
    address,
    ContractProvider,
    Sender,
    Contract,
    ContractABI,
    ABIType,
    ABIGetter,
    ABIReceiver,
    TupleBuilder,
    DictionaryValue
} from '@ton/core';

export type DataSize = {
    $$type: 'DataSize';
    cells: bigint;
    bits: bigint;
    refs: bigint;
}

export function storeDataSize(src: DataSize) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.cells, 257);
        b_0.storeInt(src.bits, 257);
        b_0.storeInt(src.refs, 257);
    };
}

export function loadDataSize(slice: Slice) {
    const sc_0 = slice;
    const _cells = sc_0.loadIntBig(257);
    const _bits = sc_0.loadIntBig(257);
    const _refs = sc_0.loadIntBig(257);
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadGetterTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function storeTupleDataSize(source: DataSize) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.cells);
    builder.writeNumber(source.bits);
    builder.writeNumber(source.refs);
    return builder.build();
}

export function dictValueParserDataSize(): DictionaryValue<DataSize> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDataSize(src)).endCell());
        },
        parse: (src) => {
            return loadDataSize(src.loadRef().beginParse());
        }
    }
}

export type SignedBundle = {
    $$type: 'SignedBundle';
    signature: Buffer;
    signedData: Slice;
}

export function storeSignedBundle(src: SignedBundle) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBuffer(src.signature);
        b_0.storeBuilder(src.signedData.asBuilder());
    };
}

export function loadSignedBundle(slice: Slice) {
    const sc_0 = slice;
    const _signature = sc_0.loadBuffer(64);
    const _signedData = sc_0;
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadGetterTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function storeTupleSignedBundle(source: SignedBundle) {
    const builder = new TupleBuilder();
    builder.writeBuffer(source.signature);
    builder.writeSlice(source.signedData.asCell());
    return builder.build();
}

export function dictValueParserSignedBundle(): DictionaryValue<SignedBundle> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSignedBundle(src)).endCell());
        },
        parse: (src) => {
            return loadSignedBundle(src.loadRef().beginParse());
        }
    }
}

export type StateInit = {
    $$type: 'StateInit';
    code: Cell;
    data: Cell;
}

export function storeStateInit(src: StateInit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeRef(src.code);
        b_0.storeRef(src.data);
    };
}

export function loadStateInit(slice: Slice) {
    const sc_0 = slice;
    const _code = sc_0.loadRef();
    const _data = sc_0.loadRef();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadGetterTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function storeTupleStateInit(source: StateInit) {
    const builder = new TupleBuilder();
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    return builder.build();
}

export function dictValueParserStateInit(): DictionaryValue<StateInit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStateInit(src)).endCell());
        },
        parse: (src) => {
            return loadStateInit(src.loadRef().beginParse());
        }
    }
}

export type Context = {
    $$type: 'Context';
    bounceable: boolean;
    sender: Address;
    value: bigint;
    raw: Slice;
}

export function storeContext(src: Context) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.bounceable);
        b_0.storeAddress(src.sender);
        b_0.storeInt(src.value, 257);
        b_0.storeRef(src.raw.asCell());
    };
}

export function loadContext(slice: Slice) {
    const sc_0 = slice;
    const _bounceable = sc_0.loadBit();
    const _sender = sc_0.loadAddress();
    const _value = sc_0.loadIntBig(257);
    const _raw = sc_0.loadRef().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadGetterTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function storeTupleContext(source: Context) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.bounceable);
    builder.writeAddress(source.sender);
    builder.writeNumber(source.value);
    builder.writeSlice(source.raw.asCell());
    return builder.build();
}

export function dictValueParserContext(): DictionaryValue<Context> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeContext(src)).endCell());
        },
        parse: (src) => {
            return loadContext(src.loadRef().beginParse());
        }
    }
}

export type SendParameters = {
    $$type: 'SendParameters';
    mode: bigint;
    body: Cell | null;
    code: Cell | null;
    data: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeSendParameters(src: SendParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        if (src.code !== null && src.code !== undefined) { b_0.storeBit(true).storeRef(src.code); } else { b_0.storeBit(false); }
        if (src.data !== null && src.data !== undefined) { b_0.storeBit(true).storeRef(src.data); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadSendParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _code = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _data = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleSendParameters(source: SendParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserSendParameters(): DictionaryValue<SendParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSendParameters(src)).endCell());
        },
        parse: (src) => {
            return loadSendParameters(src.loadRef().beginParse());
        }
    }
}

export type MessageParameters = {
    $$type: 'MessageParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeMessageParameters(src: MessageParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadMessageParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleMessageParameters(source: MessageParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserMessageParameters(): DictionaryValue<MessageParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMessageParameters(src)).endCell());
        },
        parse: (src) => {
            return loadMessageParameters(src.loadRef().beginParse());
        }
    }
}

export type DeployParameters = {
    $$type: 'DeployParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    bounce: boolean;
    init: StateInit;
}

export function storeDeployParameters(src: DeployParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeBit(src.bounce);
        b_0.store(storeStateInit(src.init));
    };
}

export function loadDeployParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _bounce = sc_0.loadBit();
    const _init = loadStateInit(sc_0);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadGetterTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadGetterTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function storeTupleDeployParameters(source: DeployParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeBoolean(source.bounce);
    builder.writeTuple(storeTupleStateInit(source.init));
    return builder.build();
}

export function dictValueParserDeployParameters(): DictionaryValue<DeployParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployParameters(src)).endCell());
        },
        parse: (src) => {
            return loadDeployParameters(src.loadRef().beginParse());
        }
    }
}

export type StdAddress = {
    $$type: 'StdAddress';
    workchain: bigint;
    address: bigint;
}

export function storeStdAddress(src: StdAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 8);
        b_0.storeUint(src.address, 256);
    };
}

export function loadStdAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(8);
    const _address = sc_0.loadUintBig(256);
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleStdAddress(source: StdAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeNumber(source.address);
    return builder.build();
}

export function dictValueParserStdAddress(): DictionaryValue<StdAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStdAddress(src)).endCell());
        },
        parse: (src) => {
            return loadStdAddress(src.loadRef().beginParse());
        }
    }
}

export type VarAddress = {
    $$type: 'VarAddress';
    workchain: bigint;
    address: Slice;
}

export function storeVarAddress(src: VarAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 32);
        b_0.storeRef(src.address.asCell());
    };
}

export function loadVarAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(32);
    const _address = sc_0.loadRef().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleVarAddress(source: VarAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeSlice(source.address.asCell());
    return builder.build();
}

export function dictValueParserVarAddress(): DictionaryValue<VarAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeVarAddress(src)).endCell());
        },
        parse: (src) => {
            return loadVarAddress(src.loadRef().beginParse());
        }
    }
}

export type BasechainAddress = {
    $$type: 'BasechainAddress';
    hash: bigint | null;
}

export function storeBasechainAddress(src: BasechainAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        if (src.hash !== null && src.hash !== undefined) { b_0.storeBit(true).storeInt(src.hash, 257); } else { b_0.storeBit(false); }
    };
}

export function loadBasechainAddress(slice: Slice) {
    const sc_0 = slice;
    const _hash = sc_0.loadBit() ? sc_0.loadIntBig(257) : null;
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadGetterTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function storeTupleBasechainAddress(source: BasechainAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.hash);
    return builder.build();
}

export function dictValueParserBasechainAddress(): DictionaryValue<BasechainAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBasechainAddress(src)).endCell());
        },
        parse: (src) => {
            return loadBasechainAddress(src.loadRef().beginParse());
        }
    }
}

export type HTLC = {
    $$type: 'HTLC';
    sender: Address;
    senderPubKey: bigint;
    srcReceiver: Address;
    hashlock: bigint;
    amount: bigint;
    timelock: bigint;
}

export function storeHTLC(src: HTLC) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.sender);
        b_0.storeInt(src.senderPubKey, 257);
        b_0.storeAddress(src.srcReceiver);
        const b_1 = new Builder();
        b_1.storeInt(src.hashlock, 257);
        b_1.storeCoins(src.amount);
        b_1.storeInt(src.timelock, 257);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadHTLC(slice: Slice) {
    const sc_0 = slice;
    const _sender = sc_0.loadAddress();
    const _senderPubKey = sc_0.loadIntBig(257);
    const _srcReceiver = sc_0.loadAddress();
    const sc_1 = sc_0.loadRef().beginParse();
    const _hashlock = sc_1.loadIntBig(257);
    const _amount = sc_1.loadCoins();
    const _timelock = sc_1.loadIntBig(257);
    return { $$type: 'HTLC' as const, sender: _sender, senderPubKey: _senderPubKey, srcReceiver: _srcReceiver, hashlock: _hashlock, amount: _amount, timelock: _timelock };
}

export function loadTupleHTLC(source: TupleReader) {
    const _sender = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _hashlock = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    return { $$type: 'HTLC' as const, sender: _sender, senderPubKey: _senderPubKey, srcReceiver: _srcReceiver, hashlock: _hashlock, amount: _amount, timelock: _timelock };
}

export function loadGetterTupleHTLC(source: TupleReader) {
    const _sender = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _hashlock = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    return { $$type: 'HTLC' as const, sender: _sender, senderPubKey: _senderPubKey, srcReceiver: _srcReceiver, hashlock: _hashlock, amount: _amount, timelock: _timelock };
}

export function storeTupleHTLC(source: HTLC) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.sender);
    builder.writeNumber(source.senderPubKey);
    builder.writeAddress(source.srcReceiver);
    builder.writeNumber(source.hashlock);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.timelock);
    return builder.build();
}

export function dictValueParserHTLC(): DictionaryValue<HTLC> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeHTLC(src)).endCell());
        },
        parse: (src) => {
            return loadHTLC(src.loadRef().beginParse());
        }
    }
}

export type Reward = {
    $$type: 'Reward';
    amount: bigint;
    timelock: bigint;
}

export function storeReward(src: Reward) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.amount);
        b_0.storeInt(src.timelock, 257);
    };
}

export function loadReward(slice: Slice) {
    const sc_0 = slice;
    const _amount = sc_0.loadCoins();
    const _timelock = sc_0.loadIntBig(257);
    return { $$type: 'Reward' as const, amount: _amount, timelock: _timelock };
}

export function loadTupleReward(source: TupleReader) {
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    return { $$type: 'Reward' as const, amount: _amount, timelock: _timelock };
}

export function loadGetterTupleReward(source: TupleReader) {
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    return { $$type: 'Reward' as const, amount: _amount, timelock: _timelock };
}

export function storeTupleReward(source: Reward) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.amount);
    builder.writeNumber(source.timelock);
    return builder.build();
}

export function dictValueParserReward(): DictionaryValue<Reward> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeReward(src)).endCell());
        },
        parse: (src) => {
            return loadReward(src.loadRef().beginParse());
        }
    }
}

export type Commit = {
    $$type: 'Commit';
    dstChain: string;
    dstAsset: string;
    dstAddress: string;
    srcAsset: string;
    id: bigint;
    amount: bigint;
    srcReceiver: Address;
    timelock: bigint;
    senderPubKey: bigint;
    hopChains: Dictionary<bigint, StringImpl>;
    hopAssets: Dictionary<bigint, StringImpl>;
    hopAddresses: Dictionary<bigint, StringImpl>;
}

export function storeCommit(src: Commit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(458640785, 32);
        b_0.storeStringRefTail(src.dstChain);
        b_0.storeStringRefTail(src.dstAsset);
        const b_1 = new Builder();
        b_1.storeStringRefTail(src.dstAddress);
        b_1.storeStringRefTail(src.srcAsset);
        b_1.storeInt(src.id, 257);
        b_1.storeCoins(src.amount);
        b_1.storeAddress(src.srcReceiver);
        b_1.storeInt(src.timelock, 257);
        const b_2 = new Builder();
        b_2.storeInt(src.senderPubKey, 257);
        b_2.storeDict(src.hopChains, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_2.storeDict(src.hopAssets, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_2.storeDict(src.hopAddresses, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadCommit(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 458640785) { throw Error('Invalid prefix'); }
    const _dstChain = sc_0.loadStringRefTail();
    const _dstAsset = sc_0.loadStringRefTail();
    const sc_1 = sc_0.loadRef().beginParse();
    const _dstAddress = sc_1.loadStringRefTail();
    const _srcAsset = sc_1.loadStringRefTail();
    const _id = sc_1.loadIntBig(257);
    const _amount = sc_1.loadCoins();
    const _srcReceiver = sc_1.loadAddress();
    const _timelock = sc_1.loadIntBig(257);
    const sc_2 = sc_1.loadRef().beginParse();
    const _senderPubKey = sc_2.loadIntBig(257);
    const _hopChains = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAssets = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAddresses = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    return { $$type: 'Commit' as const, dstChain: _dstChain, dstAsset: _dstAsset, dstAddress: _dstAddress, srcAsset: _srcAsset, id: _id, amount: _amount, srcReceiver: _srcReceiver, timelock: _timelock, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function loadTupleCommit(source: TupleReader) {
    const _dstChain = source.readString();
    const _dstAsset = source.readString();
    const _dstAddress = source.readString();
    const _srcAsset = source.readString();
    const _id = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _timelock = source.readBigNumber();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'Commit' as const, dstChain: _dstChain, dstAsset: _dstAsset, dstAddress: _dstAddress, srcAsset: _srcAsset, id: _id, amount: _amount, srcReceiver: _srcReceiver, timelock: _timelock, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function loadGetterTupleCommit(source: TupleReader) {
    const _dstChain = source.readString();
    const _dstAsset = source.readString();
    const _dstAddress = source.readString();
    const _srcAsset = source.readString();
    const _id = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _timelock = source.readBigNumber();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'Commit' as const, dstChain: _dstChain, dstAsset: _dstAsset, dstAddress: _dstAddress, srcAsset: _srcAsset, id: _id, amount: _amount, srcReceiver: _srcReceiver, timelock: _timelock, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function storeTupleCommit(source: Commit) {
    const builder = new TupleBuilder();
    builder.writeString(source.dstChain);
    builder.writeString(source.dstAsset);
    builder.writeString(source.dstAddress);
    builder.writeString(source.srcAsset);
    builder.writeNumber(source.id);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.srcReceiver);
    builder.writeNumber(source.timelock);
    builder.writeNumber(source.senderPubKey);
    builder.writeCell(source.hopChains.size > 0 ? beginCell().storeDictDirect(source.hopChains, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    builder.writeCell(source.hopAssets.size > 0 ? beginCell().storeDictDirect(source.hopAssets, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    builder.writeCell(source.hopAddresses.size > 0 ? beginCell().storeDictDirect(source.hopAddresses, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    return builder.build();
}

export function dictValueParserCommit(): DictionaryValue<Commit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCommit(src)).endCell());
        },
        parse: (src) => {
            return loadCommit(src.loadRef().beginParse());
        }
    }
}

export type AddLock = {
    $$type: 'AddLock';
    id: bigint;
    hashlock: bigint;
    timelock: bigint;
}

export function storeAddLock(src: AddLock) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1558004185, 32);
        b_0.storeInt(src.id, 257);
        b_0.storeInt(src.hashlock, 257);
        b_0.storeInt(src.timelock, 257);
    };
}

export function loadAddLock(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1558004185) { throw Error('Invalid prefix'); }
    const _id = sc_0.loadIntBig(257);
    const _hashlock = sc_0.loadIntBig(257);
    const _timelock = sc_0.loadIntBig(257);
    return { $$type: 'AddLock' as const, id: _id, hashlock: _hashlock, timelock: _timelock };
}

export function loadTupleAddLock(source: TupleReader) {
    const _id = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _timelock = source.readBigNumber();
    return { $$type: 'AddLock' as const, id: _id, hashlock: _hashlock, timelock: _timelock };
}

export function loadGetterTupleAddLock(source: TupleReader) {
    const _id = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _timelock = source.readBigNumber();
    return { $$type: 'AddLock' as const, id: _id, hashlock: _hashlock, timelock: _timelock };
}

export function storeTupleAddLock(source: AddLock) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    builder.writeNumber(source.hashlock);
    builder.writeNumber(source.timelock);
    return builder.build();
}

export function dictValueParserAddLock(): DictionaryValue<AddLock> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAddLock(src)).endCell());
        },
        parse: (src) => {
            return loadAddLock(src.loadRef().beginParse());
        }
    }
}

export type AddLockSig = {
    $$type: 'AddLockSig';
    data: Slice;
    signature: Slice;
}

export function storeAddLockSig(src: AddLockSig) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(3252164863, 32);
        b_0.storeRef(src.data.asCell());
        b_0.storeRef(src.signature.asCell());
    };
}

export function loadAddLockSig(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 3252164863) { throw Error('Invalid prefix'); }
    const _data = sc_0.loadRef().asSlice();
    const _signature = sc_0.loadRef().asSlice();
    return { $$type: 'AddLockSig' as const, data: _data, signature: _signature };
}

export function loadTupleAddLockSig(source: TupleReader) {
    const _data = source.readCell().asSlice();
    const _signature = source.readCell().asSlice();
    return { $$type: 'AddLockSig' as const, data: _data, signature: _signature };
}

export function loadGetterTupleAddLockSig(source: TupleReader) {
    const _data = source.readCell().asSlice();
    const _signature = source.readCell().asSlice();
    return { $$type: 'AddLockSig' as const, data: _data, signature: _signature };
}

export function storeTupleAddLockSig(source: AddLockSig) {
    const builder = new TupleBuilder();
    builder.writeSlice(source.data.asCell());
    builder.writeSlice(source.signature.asCell());
    return builder.build();
}

export function dictValueParserAddLockSig(): DictionaryValue<AddLockSig> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAddLockSig(src)).endCell());
        },
        parse: (src) => {
            return loadAddLockSig(src.loadRef().beginParse());
        }
    }
}

export type Lock = {
    $$type: 'Lock';
    id: bigint;
    hashlock: bigint;
    timelock: bigint;
    amount: bigint;
    reward: bigint;
    rewardTimelock: bigint;
    srcReceiver: Address;
    srcAsset: string;
    dstChain: string;
    dstAddress: string;
    dstAsset: string;
}

export function storeLock(src: Lock) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(317164721, 32);
        b_0.storeInt(src.id, 257);
        b_0.storeInt(src.hashlock, 257);
        b_0.storeInt(src.timelock, 257);
        b_0.storeCoins(src.amount);
        const b_1 = new Builder();
        b_1.storeCoins(src.reward);
        b_1.storeInt(src.rewardTimelock, 257);
        b_1.storeAddress(src.srcReceiver);
        b_1.storeStringRefTail(src.srcAsset);
        b_1.storeStringRefTail(src.dstChain);
        b_1.storeStringRefTail(src.dstAddress);
        b_1.storeStringRefTail(src.dstAsset);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadLock(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 317164721) { throw Error('Invalid prefix'); }
    const _id = sc_0.loadIntBig(257);
    const _hashlock = sc_0.loadIntBig(257);
    const _timelock = sc_0.loadIntBig(257);
    const _amount = sc_0.loadCoins();
    const sc_1 = sc_0.loadRef().beginParse();
    const _reward = sc_1.loadCoins();
    const _rewardTimelock = sc_1.loadIntBig(257);
    const _srcReceiver = sc_1.loadAddress();
    const _srcAsset = sc_1.loadStringRefTail();
    const _dstChain = sc_1.loadStringRefTail();
    const _dstAddress = sc_1.loadStringRefTail();
    const _dstAsset = sc_1.loadStringRefTail();
    return { $$type: 'Lock' as const, id: _id, hashlock: _hashlock, timelock: _timelock, amount: _amount, reward: _reward, rewardTimelock: _rewardTimelock, srcReceiver: _srcReceiver, srcAsset: _srcAsset, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset };
}

export function loadTupleLock(source: TupleReader) {
    const _id = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    return { $$type: 'Lock' as const, id: _id, hashlock: _hashlock, timelock: _timelock, amount: _amount, reward: _reward, rewardTimelock: _rewardTimelock, srcReceiver: _srcReceiver, srcAsset: _srcAsset, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset };
}

export function loadGetterTupleLock(source: TupleReader) {
    const _id = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    return { $$type: 'Lock' as const, id: _id, hashlock: _hashlock, timelock: _timelock, amount: _amount, reward: _reward, rewardTimelock: _rewardTimelock, srcReceiver: _srcReceiver, srcAsset: _srcAsset, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset };
}

export function storeTupleLock(source: Lock) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    builder.writeNumber(source.hashlock);
    builder.writeNumber(source.timelock);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.reward);
    builder.writeNumber(source.rewardTimelock);
    builder.writeAddress(source.srcReceiver);
    builder.writeString(source.srcAsset);
    builder.writeString(source.dstChain);
    builder.writeString(source.dstAddress);
    builder.writeString(source.dstAsset);
    return builder.build();
}

export function dictValueParserLock(): DictionaryValue<Lock> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeLock(src)).endCell());
        },
        parse: (src) => {
            return loadLock(src.loadRef().beginParse());
        }
    }
}

export type Redeem = {
    $$type: 'Redeem';
    id: bigint;
    secret: bigint;
}

export function storeRedeem(src: Redeem) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1972220037, 32);
        b_0.storeInt(src.id, 257);
        b_0.storeInt(src.secret, 257);
    };
}

export function loadRedeem(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1972220037) { throw Error('Invalid prefix'); }
    const _id = sc_0.loadIntBig(257);
    const _secret = sc_0.loadIntBig(257);
    return { $$type: 'Redeem' as const, id: _id, secret: _secret };
}

export function loadTupleRedeem(source: TupleReader) {
    const _id = source.readBigNumber();
    const _secret = source.readBigNumber();
    return { $$type: 'Redeem' as const, id: _id, secret: _secret };
}

export function loadGetterTupleRedeem(source: TupleReader) {
    const _id = source.readBigNumber();
    const _secret = source.readBigNumber();
    return { $$type: 'Redeem' as const, id: _id, secret: _secret };
}

export function storeTupleRedeem(source: Redeem) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    builder.writeNumber(source.secret);
    return builder.build();
}

export function dictValueParserRedeem(): DictionaryValue<Redeem> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRedeem(src)).endCell());
        },
        parse: (src) => {
            return loadRedeem(src.loadRef().beginParse());
        }
    }
}

export type Refund = {
    $$type: 'Refund';
    id: bigint;
}

export function storeRefund(src: Refund) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2910985977, 32);
        b_0.storeInt(src.id, 257);
    };
}

export function loadRefund(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2910985977) { throw Error('Invalid prefix'); }
    const _id = sc_0.loadIntBig(257);
    return { $$type: 'Refund' as const, id: _id };
}

export function loadTupleRefund(source: TupleReader) {
    const _id = source.readBigNumber();
    return { $$type: 'Refund' as const, id: _id };
}

export function loadGetterTupleRefund(source: TupleReader) {
    const _id = source.readBigNumber();
    return { $$type: 'Refund' as const, id: _id };
}

export function storeTupleRefund(source: Refund) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    return builder.build();
}

export function dictValueParserRefund(): DictionaryValue<Refund> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRefund(src)).endCell());
        },
        parse: (src) => {
            return loadRefund(src.loadRef().beginParse());
        }
    }
}

export type TokenCommitted = {
    $$type: 'TokenCommitted';
    id: bigint;
    dstChain: string;
    dstAddress: string;
    dstAsset: string;
    sender: Address;
    srcReceiver: Address;
    srcAsset: string;
    amount: bigint;
    timelock: bigint;
    senderPubKey: bigint;
    hopChains: Dictionary<bigint, StringImpl>;
    hopAssets: Dictionary<bigint, StringImpl>;
    hopAddresses: Dictionary<bigint, StringImpl>;
}

export function storeTokenCommitted(src: TokenCommitted) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1912207274, 32);
        b_0.storeInt(src.id, 257);
        b_0.storeStringRefTail(src.dstChain);
        b_0.storeStringRefTail(src.dstAddress);
        const b_1 = new Builder();
        b_1.storeStringRefTail(src.dstAsset);
        b_1.storeAddress(src.sender);
        b_1.storeAddress(src.srcReceiver);
        b_1.storeStringRefTail(src.srcAsset);
        b_1.storeCoins(src.amount);
        b_1.storeInt(src.timelock, 257);
        const b_2 = new Builder();
        b_2.storeInt(src.senderPubKey, 257);
        b_2.storeDict(src.hopChains, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_2.storeDict(src.hopAssets, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_2.storeDict(src.hopAddresses, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadTokenCommitted(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1912207274) { throw Error('Invalid prefix'); }
    const _id = sc_0.loadIntBig(257);
    const _dstChain = sc_0.loadStringRefTail();
    const _dstAddress = sc_0.loadStringRefTail();
    const sc_1 = sc_0.loadRef().beginParse();
    const _dstAsset = sc_1.loadStringRefTail();
    const _sender = sc_1.loadAddress();
    const _srcReceiver = sc_1.loadAddress();
    const _srcAsset = sc_1.loadStringRefTail();
    const _amount = sc_1.loadCoins();
    const _timelock = sc_1.loadIntBig(257);
    const sc_2 = sc_1.loadRef().beginParse();
    const _senderPubKey = sc_2.loadIntBig(257);
    const _hopChains = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAssets = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAddresses = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    return { $$type: 'TokenCommitted' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function loadTupleTokenCommitted(source: TupleReader) {
    const _id = source.readBigNumber();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _sender = source.readAddress();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'TokenCommitted' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function loadGetterTupleTokenCommitted(source: TupleReader) {
    const _id = source.readBigNumber();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _sender = source.readAddress();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'TokenCommitted' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function storeTupleTokenCommitted(source: TokenCommitted) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    builder.writeString(source.dstChain);
    builder.writeString(source.dstAddress);
    builder.writeString(source.dstAsset);
    builder.writeAddress(source.sender);
    builder.writeAddress(source.srcReceiver);
    builder.writeString(source.srcAsset);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.timelock);
    builder.writeNumber(source.senderPubKey);
    builder.writeCell(source.hopChains.size > 0 ? beginCell().storeDictDirect(source.hopChains, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    builder.writeCell(source.hopAssets.size > 0 ? beginCell().storeDictDirect(source.hopAssets, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    builder.writeCell(source.hopAddresses.size > 0 ? beginCell().storeDictDirect(source.hopAddresses, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    return builder.build();
}

export function dictValueParserTokenCommitted(): DictionaryValue<TokenCommitted> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenCommitted(src)).endCell());
        },
        parse: (src) => {
            return loadTokenCommitted(src.loadRef().beginParse());
        }
    }
}

export type TokenLocked = {
    $$type: 'TokenLocked';
    id: bigint;
    hashlock: bigint;
    dstChain: string;
    dstAddress: string;
    dstAsset: string;
    sender: Address;
    srcReceiver: Address;
    srcAsset: string;
    amount: bigint;
    timelock: bigint;
    reward: bigint;
    rewardTimelock: bigint;
}

export function storeTokenLocked(src: TokenLocked) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2511348125, 32);
        b_0.storeInt(src.id, 257);
        b_0.storeInt(src.hashlock, 257);
        b_0.storeStringRefTail(src.dstChain);
        b_0.storeStringRefTail(src.dstAddress);
        const b_1 = new Builder();
        b_1.storeStringRefTail(src.dstAsset);
        b_1.storeAddress(src.sender);
        b_1.storeAddress(src.srcReceiver);
        b_1.storeStringRefTail(src.srcAsset);
        b_1.storeCoins(src.amount);
        b_1.storeInt(src.timelock, 257);
        const b_2 = new Builder();
        b_2.storeCoins(src.reward);
        b_2.storeInt(src.rewardTimelock, 257);
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadTokenLocked(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2511348125) { throw Error('Invalid prefix'); }
    const _id = sc_0.loadIntBig(257);
    const _hashlock = sc_0.loadIntBig(257);
    const _dstChain = sc_0.loadStringRefTail();
    const _dstAddress = sc_0.loadStringRefTail();
    const sc_1 = sc_0.loadRef().beginParse();
    const _dstAsset = sc_1.loadStringRefTail();
    const _sender = sc_1.loadAddress();
    const _srcReceiver = sc_1.loadAddress();
    const _srcAsset = sc_1.loadStringRefTail();
    const _amount = sc_1.loadCoins();
    const _timelock = sc_1.loadIntBig(257);
    const sc_2 = sc_1.loadRef().beginParse();
    const _reward = sc_2.loadCoins();
    const _rewardTimelock = sc_2.loadIntBig(257);
    return { $$type: 'TokenLocked' as const, id: _id, hashlock: _hashlock, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, reward: _reward, rewardTimelock: _rewardTimelock };
}

export function loadTupleTokenLocked(source: TupleReader) {
    const _id = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _sender = source.readAddress();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    return { $$type: 'TokenLocked' as const, id: _id, hashlock: _hashlock, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, reward: _reward, rewardTimelock: _rewardTimelock };
}

export function loadGetterTupleTokenLocked(source: TupleReader) {
    const _id = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _sender = source.readAddress();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    return { $$type: 'TokenLocked' as const, id: _id, hashlock: _hashlock, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, reward: _reward, rewardTimelock: _rewardTimelock };
}

export function storeTupleTokenLocked(source: TokenLocked) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    builder.writeNumber(source.hashlock);
    builder.writeString(source.dstChain);
    builder.writeString(source.dstAddress);
    builder.writeString(source.dstAsset);
    builder.writeAddress(source.sender);
    builder.writeAddress(source.srcReceiver);
    builder.writeString(source.srcAsset);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.timelock);
    builder.writeNumber(source.reward);
    builder.writeNumber(source.rewardTimelock);
    return builder.build();
}

export function dictValueParserTokenLocked(): DictionaryValue<TokenLocked> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenLocked(src)).endCell());
        },
        parse: (src) => {
            return loadTokenLocked(src.loadRef().beginParse());
        }
    }
}

export type TokenRedeemed = {
    $$type: 'TokenRedeemed';
    id: bigint;
    redeemAddress: Address;
    secret: bigint;
    hashlock: bigint;
}

export function storeTokenRedeemed(src: TokenRedeemed) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1701105609, 32);
        b_0.storeInt(src.id, 257);
        b_0.storeAddress(src.redeemAddress);
        b_0.storeInt(src.secret, 257);
        const b_1 = new Builder();
        b_1.storeInt(src.hashlock, 257);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadTokenRedeemed(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1701105609) { throw Error('Invalid prefix'); }
    const _id = sc_0.loadIntBig(257);
    const _redeemAddress = sc_0.loadAddress();
    const _secret = sc_0.loadIntBig(257);
    const sc_1 = sc_0.loadRef().beginParse();
    const _hashlock = sc_1.loadIntBig(257);
    return { $$type: 'TokenRedeemed' as const, id: _id, redeemAddress: _redeemAddress, secret: _secret, hashlock: _hashlock };
}

export function loadTupleTokenRedeemed(source: TupleReader) {
    const _id = source.readBigNumber();
    const _redeemAddress = source.readAddress();
    const _secret = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    return { $$type: 'TokenRedeemed' as const, id: _id, redeemAddress: _redeemAddress, secret: _secret, hashlock: _hashlock };
}

export function loadGetterTupleTokenRedeemed(source: TupleReader) {
    const _id = source.readBigNumber();
    const _redeemAddress = source.readAddress();
    const _secret = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    return { $$type: 'TokenRedeemed' as const, id: _id, redeemAddress: _redeemAddress, secret: _secret, hashlock: _hashlock };
}

export function storeTupleTokenRedeemed(source: TokenRedeemed) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    builder.writeAddress(source.redeemAddress);
    builder.writeNumber(source.secret);
    builder.writeNumber(source.hashlock);
    return builder.build();
}

export function dictValueParserTokenRedeemed(): DictionaryValue<TokenRedeemed> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenRedeemed(src)).endCell());
        },
        parse: (src) => {
            return loadTokenRedeemed(src.loadRef().beginParse());
        }
    }
}

export type StringImpl = {
    $$type: 'StringImpl';
    data: string;
}

export function storeStringImpl(src: StringImpl) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeStringRefTail(src.data);
    };
}

export function loadStringImpl(slice: Slice) {
    const sc_0 = slice;
    const _data = sc_0.loadStringRefTail();
    return { $$type: 'StringImpl' as const, data: _data };
}

export function loadTupleStringImpl(source: TupleReader) {
    const _data = source.readString();
    return { $$type: 'StringImpl' as const, data: _data };
}

export function loadGetterTupleStringImpl(source: TupleReader) {
    const _data = source.readString();
    return { $$type: 'StringImpl' as const, data: _data };
}

export function storeTupleStringImpl(source: StringImpl) {
    const builder = new TupleBuilder();
    builder.writeString(source.data);
    return builder.build();
}

export function dictValueParserStringImpl(): DictionaryValue<StringImpl> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStringImpl(src)).endCell());
        },
        parse: (src) => {
            return loadStringImpl(src.loadRef().beginParse());
        }
    }
}

export type Train$Data = {
    $$type: 'Train$Data';
    contracts: Dictionary<bigint, HTLC>;
    rewards: Dictionary<bigint, Reward>;
}

export function storeTrain$Data(src: Train$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeDict(src.contracts, Dictionary.Keys.BigInt(257), dictValueParserHTLC());
        b_0.storeDict(src.rewards, Dictionary.Keys.BigInt(257), dictValueParserReward());
    };
}

export function loadTrain$Data(slice: Slice) {
    const sc_0 = slice;
    const _contracts = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserHTLC(), sc_0);
    const _rewards = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserReward(), sc_0);
    return { $$type: 'Train$Data' as const, contracts: _contracts, rewards: _rewards };
}

export function loadTupleTrain$Data(source: TupleReader) {
    const _contracts = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserHTLC(), source.readCellOpt());
    const _rewards = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserReward(), source.readCellOpt());
    return { $$type: 'Train$Data' as const, contracts: _contracts, rewards: _rewards };
}

export function loadGetterTupleTrain$Data(source: TupleReader) {
    const _contracts = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserHTLC(), source.readCellOpt());
    const _rewards = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserReward(), source.readCellOpt());
    return { $$type: 'Train$Data' as const, contracts: _contracts, rewards: _rewards };
}

export function storeTupleTrain$Data(source: Train$Data) {
    const builder = new TupleBuilder();
    builder.writeCell(source.contracts.size > 0 ? beginCell().storeDictDirect(source.contracts, Dictionary.Keys.BigInt(257), dictValueParserHTLC()).endCell() : null);
    builder.writeCell(source.rewards.size > 0 ? beginCell().storeDictDirect(source.rewards, Dictionary.Keys.BigInt(257), dictValueParserReward()).endCell() : null);
    return builder.build();
}

export function dictValueParserTrain$Data(): DictionaryValue<Train$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTrain$Data(src)).endCell());
        },
        parse: (src) => {
            return loadTrain$Data(src.loadRef().beginParse());
        }
    }
}

 type Train_init_args = {
    $$type: 'Train_init_args';
}

function initTrain_init_args(src: Train_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
    };
}

async function Train_init() {
    const __code = Cell.fromHex('b5ee9c7241023701000d5900022cff008e88f4a413f4bcf2c80bed53208e8130e1ed43d9010c020271020702012003050161bb1b9ed44d0d2000197f404f404596c1293306d6de258db3c6c21206e92306d99206ef2d0806f226f02e2206e92306dde8040044810101220259f40d6fa192306ddf206e92306d9dd0fa00810101d700596c126f02e20133b84feed44d0d2000197f404f404596c1293306d6de2db3c6c2180600667021810101f4856fa520911295316d326d01e2908e1b3001a481010154431359f4786fa5209402d4305895316d326d01e2e85b020148080a0133b40d3da89a1a400032fe809e808b2d8252660dadbc5b678d84300900667022810101f4856fa520911295316d326d01e2908e1b3001a481010154441359f4786fa5209402d4305895316d326d01e2e85b0161b7eedda89a1a400032fe809e808b2d8252660dadbc4b1b678d84240dd2460db3240dde5a100de4cde0dc440dd2460dbbd00b0074810101230259f40d6fa192306ddf206e92306d8e24d0fa40810101d700fa40d401d0810101d700fa00810101d700301036103510346c166f06e204b4eda2edfb01d072d721d200d200fa4021103450666f04f86102f862ed44d0d2000197f404f404596c1293306d6de203925f03e07022d74920c21f9133e30d20c00023c121b0e302c0009131e30d820186a074fb02f842707083060d31333504563122d70b1f2082101b564d91bae3022082105cdd41d9bae302208210c1d818ffbae30220821012e78cb1ba0e13171b01fa5b018020d721d401d001d401d001d430d0d401d001d401d001810101d700fa00fa40810101d700d430d0810101d700f404f404f40430f8416f24303281123e29820186a0a013bc9328c3009170e212f2f427820186a0a08014fb028154b3f823810384a05270bcf2f4812ce52e8101012b59f40c6fa131b3f2f48101010f03fe5471577153cac855505056ce13810101cf00ce01c8810101cf0058fa0212810101cf00cdc9102f52a0206e953059f45a30944133f415e22d109c10bd10ad08106d05104d4d330dc855c0db3cc9c88258c000000000000000000000000101cb67ccc970fb00707083068810454343c8cf8580ca00cf8440ce01fa02806acf401011120084821071f9f7aa500ecb1f1c810101cf000ac8ce1acd08c8ce18cdc807c8ce17cd15ce13ce01c8cecd01fa02810101cf0002c8810101cf0013f40013f40013f400cdcd002a00000000545241494e436f6d6d6974457863657373002ef400c901fb0001c87f01ca005902f400f400c9ed54db3101f65b018020d721810101d700810101d700810101d700308200c53ef8416f24135f03820186a0bcf2f4820186a08014fb028200e431248101012559f40c6fa131f2f4238101012459f40d6fa192306ddf206e92306d8e24d0fa40810101d700fa40d401d0810101d700fa00810101d700301036103510346c166f06e21402fc206ef2d0806f2630817bc7f84226c705f2f48121ca02c00112f2f48154b3f823810384a05260bcf2f4103441301581010106c855505056ce13810101cf00ce01c8810101cf0058fa0212810101cf00cdc912206e953059f45a30944133f415e2f84270708306884343c8cf8580ca00cf8440ce01fa02806acf40f400c9011516002c00000000545241494e4164644c6f636b4578636573730026fb0001c87f01ca005902f400f400c9ed54db3101f85b018020d721d401d001d430d08200c53ef8416f24135f03820186a0bcf2f4820186a08014fb028200e4318101015330d702255959f40c6fa131c0fff2f48101015320d702245959f40d6fa192306ddf206e92306d8e24d0fa40810101d700fa40d401d0810101d700fa00810101d700301036103510346c166f06e21802fc206ef2d0806f263081256927f901541075f91016f2f405810101d700810101d700810101d700308121ca08c00118f2f48154b3f823810384a05280bcf2f4500581010107c855505056ce13810101cf00ce01c8810101cf0058fa0212810101cf00cdc9206e953059f45a30944133f415e2f84270708306884343c8cf8580191a003200000000545241494e4164644c6f636b5369674578636573730048ca00cf8440ce01fa02806acf40f400c901fb0001c87f01ca005902f400f400c9ed54db310330e302208210758db085bae302208210ad821ef9bae30233021c212c01fe5b018020d721810101d700810101d700810101d700fa00d430d0fa00810101d700fa40d401d001d401d001d401d001d430d0f8416f24303281123e53a9a0820186a0a013bc9329c3009170e212f2f45387a0820186a0a08014fb02812ce52d8101012e59f40c6fa131b3f2f48154b3f823810708a02bb9f2f4815531537ab91d01f895f8235280bc9170e2f2f481010121715478db2fc855505056ce13810101cf00ce01c8810101cf0058fa0212810101cf00cdc92d103f01206e953059f45a30944133f415e2278e238101015387c85959fa02810101cf00c9102f52d0206e953059f45a30944133f415e20dde10ab109b103847602c0605044c330cc81e029c55b0db3cc9c88258c000000000000000000000000101cb67ccc970fb00707083068810454343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0001c87f01ca005902f400f400c9ed54db311f200088821095b0219d500dcb1f1b810101cf0019810101cf0007c8ce17cd05c8ce15cdc804c8ce14cd12cece02c8ce12cd58fa0212810101cf00c85003fa0213810101cf00cdcd002600000000545241494e4c6f636b45786365737301fe5b018020d721810101d700810101d700308200e431238101012459f40c6fa131f2f4228101012359f40d6fa192306ddf206e92306d8e24d0fa40810101d700fa40d401d0810101d700fa00810101d700301036103510346c166f06e2206ef2d0806f263033c85250cbffc9d09b9320d74a91d5e868f90400da11218200c6e62202d202baf2f4f84226034166c8553082106564cfc95005cb1f13810101cf00ce810101cf0001c8810101cf00cdc9c88258c000000000000000000000000101cb67ccc970fb00258101012559f40c6fa131e30f59810101f45a3001c87f01ca005902f400f400c9ed54db312329029e258101012559f40d6fa192306ddf206e92306d9dd0fa00810101d700596c126f02e2206ef2d0806f22f8276f10820186a0a0f8416f24135f03a123a122a18010fb02f823bce30f5203810101f45a30242603c07071881046102310265043c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0070718810344343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00f84270708306884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb002a252b002a00000000545241494e52657761726452657475726e03d632f84223c7058e9f7002a08306885043c8cf8580ca00cf8440ce01fa02806acf40f400c901fb008f41707188104510235043c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00f8427083068810344343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00e2272a28003000000000545241494e52656465656d416e64526577617264002a00000000545241494e52656465656d52657761726402ae31f8276f10820186a0a0f8416f24135f03a121a18010fb0270718810235043c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00f84270708306884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00022a2b001e00000000545241494e52656465656d002a00000000545241494e52656465656d45786365737301fe5b018020d721810101d70030f8416f2430328200c53e22820186a0bcf2f48200e431248101012559f40c6fa131f2f4238101012459f40d6fa192306ddf206e92306d8e24d0fa40810101d700fa40d401d0810101d700fa00810101d700301036103510346c166f06e2206ef2d0806f266c22328200955ff82313b912f2f4262d03f68101012659f40c6fa1318eb5f8276f10820186a0a05004a123a18010fb027071881034102310255043c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0003e30d707083068810474343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0001810101f45a3001c87f01ca005902f400f400c9ed54db312f2e3001d0268101012659f40d6fa192306ddf206e92306d9dd0fa00810101d700596c126f02e2206ef2d0806f2230f8276f10820186a0a05005a121a124a18010fb027004a07188103410355043c8cf8580ca00cf8440ce01fa02806acf40f400c901fb005214810101f45a302f001e00000000545241494e526566756e64002a00000000545241494e526566756e6445786365737301703031820186a074fb02f84270708306884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0001c87f01ca005902f400f400c9ed5432003e00000000545241494e456d7074794d6573736167654e6f74416c6c6f776564017c01c21f8eb8820186a074fb02f84270708306884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0001c87f01ca005902f400f400c9ed54db31e034003c00000000545241494e546578744d6573736167654e6f74416c6c6f7765640152884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0001c87f01ca005902f400f400c9ed5436003e00000000545241494e536c6963654d6573736167654e6f74416c6c6f7765649587866c');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initTrain_init_args({ $$type: 'Train_init_args' })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const Train_errors = {
    2: { message: "Stack underflow" },
    3: { message: "Stack overflow" },
    4: { message: "Integer overflow" },
    5: { message: "Integer out of expected range" },
    6: { message: "Invalid opcode" },
    7: { message: "Type check error" },
    8: { message: "Cell overflow" },
    9: { message: "Cell underflow" },
    10: { message: "Dictionary error" },
    11: { message: "'Unknown' error" },
    12: { message: "Fatal error" },
    13: { message: "Out of gas error" },
    14: { message: "Virtualization error" },
    32: { message: "Action list is invalid" },
    33: { message: "Action list is too long" },
    34: { message: "Action is invalid or not supported" },
    35: { message: "Invalid source address in outbound message" },
    36: { message: "Invalid destination address in outbound message" },
    37: { message: "Not enough Toncoin" },
    38: { message: "Not enough extra currencies" },
    39: { message: "Outbound message does not fit into a cell after rewriting" },
    40: { message: "Cannot process a message" },
    41: { message: "Library reference is null" },
    42: { message: "Library change action error" },
    43: { message: "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree" },
    50: { message: "Account state size exceeded limits" },
    128: { message: "Null reference exception" },
    129: { message: "Invalid serialization prefix" },
    130: { message: "Invalid incoming message" },
    131: { message: "Constraints error" },
    132: { message: "Access denied" },
    133: { message: "Contract stopped" },
    134: { message: "Invalid argument" },
    135: { message: "Code of a contract was not found" },
    136: { message: "Invalid standard address" },
    138: { message: "Not a basechain address" },
    4670: { message: "Funds Not Sent" },
    8650: { message: "Hashlock Already Set" },
    9577: { message: "Invalid Signature" },
    11493: { message: "Contract Already Exists" },
    21683: { message: "Not Future Timelock" },
    21809: { message: "Invalid Reward Timelock" },
    31687: { message: "No Allowance" },
    38239: { message: "Not Passed Timelock" },
    50494: { message: "Storage Fee Required" },
    50918: { message: "Hashlock Not Match" },
    58417: { message: "Contract Does Not Exist" },
} as const

export const Train_errors_backward = {
    "Stack underflow": 2,
    "Stack overflow": 3,
    "Integer overflow": 4,
    "Integer out of expected range": 5,
    "Invalid opcode": 6,
    "Type check error": 7,
    "Cell overflow": 8,
    "Cell underflow": 9,
    "Dictionary error": 10,
    "'Unknown' error": 11,
    "Fatal error": 12,
    "Out of gas error": 13,
    "Virtualization error": 14,
    "Action list is invalid": 32,
    "Action list is too long": 33,
    "Action is invalid or not supported": 34,
    "Invalid source address in outbound message": 35,
    "Invalid destination address in outbound message": 36,
    "Not enough Toncoin": 37,
    "Not enough extra currencies": 38,
    "Outbound message does not fit into a cell after rewriting": 39,
    "Cannot process a message": 40,
    "Library reference is null": 41,
    "Library change action error": 42,
    "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree": 43,
    "Account state size exceeded limits": 50,
    "Null reference exception": 128,
    "Invalid serialization prefix": 129,
    "Invalid incoming message": 130,
    "Constraints error": 131,
    "Access denied": 132,
    "Contract stopped": 133,
    "Invalid argument": 134,
    "Code of a contract was not found": 135,
    "Invalid standard address": 136,
    "Not a basechain address": 138,
    "Funds Not Sent": 4670,
    "Hashlock Already Set": 8650,
    "Invalid Signature": 9577,
    "Contract Already Exists": 11493,
    "Not Future Timelock": 21683,
    "Invalid Reward Timelock": 21809,
    "No Allowance": 31687,
    "Not Passed Timelock": 38239,
    "Storage Fee Required": 50494,
    "Hashlock Not Match": 50918,
    "Contract Does Not Exist": 58417,
} as const

const Train_types: ABIType[] = [
    {"name":"DataSize","header":null,"fields":[{"name":"cells","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bits","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"refs","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"SignedBundle","header":null,"fields":[{"name":"signature","type":{"kind":"simple","type":"fixed-bytes","optional":false,"format":64}},{"name":"signedData","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"StateInit","header":null,"fields":[{"name":"code","type":{"kind":"simple","type":"cell","optional":false}},{"name":"data","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"Context","header":null,"fields":[{"name":"bounceable","type":{"kind":"simple","type":"bool","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"raw","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"SendParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"code","type":{"kind":"simple","type":"cell","optional":true}},{"name":"data","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"MessageParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"DeployParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}},{"name":"init","type":{"kind":"simple","type":"StateInit","optional":false}}]},
    {"name":"StdAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":8}},{"name":"address","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"VarAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":32}},{"name":"address","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"BasechainAddress","header":null,"fields":[{"name":"hash","type":{"kind":"simple","type":"int","optional":true,"format":257}}]},
    {"name":"HTLC","header":null,"fields":[{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"senderPubKey","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"Reward","header":null,"fields":[{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"Commit","header":458640785,"fields":[{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"senderPubKey","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hopChains","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAssets","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAddresses","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}}]},
    {"name":"AddLock","header":1558004185,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"AddLockSig","header":3252164863,"fields":[{"name":"data","type":{"kind":"simple","type":"slice","optional":false}},{"name":"signature","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"Lock","header":317164721,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"reward","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"rewardTimelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}}]},
    {"name":"Redeem","header":1972220037,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"secret","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"Refund","header":2910985977,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"TokenCommitted","header":1912207274,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"senderPubKey","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hopChains","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAssets","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAddresses","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}}]},
    {"name":"TokenLocked","header":2511348125,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"reward","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"rewardTimelock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"TokenRedeemed","header":1701105609,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"redeemAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"secret","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"StringImpl","header":null,"fields":[{"name":"data","type":{"kind":"simple","type":"string","optional":false}}]},
    {"name":"Train$Data","header":null,"fields":[{"name":"contracts","type":{"kind":"dict","key":"int","value":"HTLC","valueFormat":"ref"}},{"name":"rewards","type":{"kind":"dict","key":"int","value":"Reward","valueFormat":"ref"}}]},
]

const Train_opcodes = {
    "Commit": 458640785,
    "AddLock": 1558004185,
    "AddLockSig": 3252164863,
    "Lock": 317164721,
    "Redeem": 1972220037,
    "Refund": 2910985977,
    "TokenCommitted": 1912207274,
    "TokenLocked": 2511348125,
    "TokenRedeemed": 1701105609,
}

const Train_getters: ABIGetter[] = [
    {"name":"getHTLCDetails","methodId":114550,"arguments":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"HTLC","optional":true}},
    {"name":"getContractsLength","methodId":98409,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"getRewardDetails","methodId":78265,"arguments":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"Reward","optional":true}},
    {"name":"getRewardsLength","methodId":83198,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
]

export const Train_getterMapping: { [key: string]: string } = {
    'getHTLCDetails': 'getGetHtlcDetails',
    'getContractsLength': 'getGetContractsLength',
    'getRewardDetails': 'getGetRewardDetails',
    'getRewardsLength': 'getGetRewardsLength',
}

const Train_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"typed","type":"Commit"}},
    {"receiver":"internal","message":{"kind":"typed","type":"AddLock"}},
    {"receiver":"internal","message":{"kind":"typed","type":"AddLockSig"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Lock"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Redeem"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Refund"}},
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"text"}},
    {"receiver":"internal","message":{"kind":"any"}},
]


export class Train implements Contract {
    
    public static readonly storageReserve = 100000n;
    public static readonly errors = Train_errors_backward;
    public static readonly opcodes = Train_opcodes;
    
    static async init() {
        return await Train_init();
    }
    
    static async fromInit() {
        const __gen_init = await Train_init();
        const address = contractAddress(0, __gen_init);
        return new Train(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new Train(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  Train_types,
        getters: Train_getters,
        receivers: Train_receivers,
        errors: Train_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: Commit | AddLock | AddLockSig | Lock | Redeem | Refund | null | string | Slice) {
        
        let body: Cell | null = null;
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Commit') {
            body = beginCell().store(storeCommit(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'AddLock') {
            body = beginCell().store(storeAddLock(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'AddLockSig') {
            body = beginCell().store(storeAddLockSig(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Lock') {
            body = beginCell().store(storeLock(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Redeem') {
            body = beginCell().store(storeRedeem(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Refund') {
            body = beginCell().store(storeRefund(message)).endCell();
        }
        if (message === null) {
            body = new Cell();
        }
        if (typeof message === 'string') {
            body = beginCell().storeUint(0, 32).storeStringTail(message).endCell();
        }
        if (message && typeof message === 'object' && message instanceof Slice) {
            body = message.asCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
    async getGetHtlcDetails(provider: ContractProvider, id: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(id);
        const source = (await provider.get('getHTLCDetails', builder.build())).stack;
        const result_p = source.readTupleOpt();
        const result = result_p ? loadTupleHTLC(result_p) : null;
        return result;
    }
    
    async getGetContractsLength(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('getContractsLength', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getGetRewardDetails(provider: ContractProvider, id: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(id);
        const source = (await provider.get('getRewardDetails', builder.build())).stack;
        const result_p = source.readTupleOpt();
        const result = result_p ? loadTupleReward(result_p) : null;
        return result;
    }
    
    async getGetRewardsLength(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('getRewardsLength', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
}