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

export type ChangeOwner = {
    $$type: 'ChangeOwner';
    queryId: bigint;
    newOwner: Address;
}

export function storeChangeOwner(src: ChangeOwner) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2174598809, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.newOwner);
    };
}

export function loadChangeOwner(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2174598809) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _newOwner = sc_0.loadAddress();
    return { $$type: 'ChangeOwner' as const, queryId: _queryId, newOwner: _newOwner };
}

export function loadTupleChangeOwner(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'ChangeOwner' as const, queryId: _queryId, newOwner: _newOwner };
}

export function loadGetterTupleChangeOwner(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'ChangeOwner' as const, queryId: _queryId, newOwner: _newOwner };
}

export function storeTupleChangeOwner(source: ChangeOwner) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.newOwner);
    return builder.build();
}

export function dictValueParserChangeOwner(): DictionaryValue<ChangeOwner> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeChangeOwner(src)).endCell());
        },
        parse: (src) => {
            return loadChangeOwner(src.loadRef().beginParse());
        }
    }
}

export type ChangeOwnerOk = {
    $$type: 'ChangeOwnerOk';
    queryId: bigint;
    newOwner: Address;
}

export function storeChangeOwnerOk(src: ChangeOwnerOk) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(846932810, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.newOwner);
    };
}

export function loadChangeOwnerOk(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 846932810) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _newOwner = sc_0.loadAddress();
    return { $$type: 'ChangeOwnerOk' as const, queryId: _queryId, newOwner: _newOwner };
}

export function loadTupleChangeOwnerOk(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'ChangeOwnerOk' as const, queryId: _queryId, newOwner: _newOwner };
}

export function loadGetterTupleChangeOwnerOk(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'ChangeOwnerOk' as const, queryId: _queryId, newOwner: _newOwner };
}

export function storeTupleChangeOwnerOk(source: ChangeOwnerOk) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.newOwner);
    return builder.build();
}

export function dictValueParserChangeOwnerOk(): DictionaryValue<ChangeOwnerOk> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeChangeOwnerOk(src)).endCell());
        },
        parse: (src) => {
            return loadChangeOwnerOk(src.loadRef().beginParse());
        }
    }
}

export type TokenTransfer = {
    $$type: 'TokenTransfer';
    queryId: bigint;
    amount: bigint;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell | null;
    forwardTonAmount: bigint;
    forwardPayload: Slice;
}

export function storeTokenTransfer(src: TokenTransfer) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(260734629, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.destination);
        b_0.storeAddress(src.responseDestination);
        if (src.customPayload !== null && src.customPayload !== undefined) { b_0.storeBit(true).storeRef(src.customPayload); } else { b_0.storeBit(false); }
        b_0.storeCoins(src.forwardTonAmount);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadTokenTransfer(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 260734629) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _destination = sc_0.loadAddress();
    const _responseDestination = sc_0.loadAddress();
    const _customPayload = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _forwardTonAmount = sc_0.loadCoins();
    const _forwardPayload = sc_0;
    return { $$type: 'TokenTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadTupleTokenTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _destination = source.readAddress();
    const _responseDestination = source.readAddress();
    const _customPayload = source.readCellOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadGetterTupleTokenTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _destination = source.readAddress();
    const _responseDestination = source.readAddress();
    const _customPayload = source.readCellOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function storeTupleTokenTransfer(source: TokenTransfer) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.destination);
    builder.writeAddress(source.responseDestination);
    builder.writeCell(source.customPayload);
    builder.writeNumber(source.forwardTonAmount);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserTokenTransfer(): DictionaryValue<TokenTransfer> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenTransfer(src)).endCell());
        },
        parse: (src) => {
            return loadTokenTransfer(src.loadRef().beginParse());
        }
    }
}

export type TokenNotification = {
    $$type: 'TokenNotification';
    queryId: bigint;
    amount: bigint;
    from: Address;
    forwardPayload: Slice;
}

export function storeTokenNotification(src: TokenNotification) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1935855772, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.from);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadTokenNotification(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1935855772) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _from = sc_0.loadAddress();
    const _forwardPayload = sc_0;
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function loadTupleTokenNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function loadGetterTupleTokenNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function storeTupleTokenNotification(source: TokenNotification) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.from);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserTokenNotification(): DictionaryValue<TokenNotification> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenNotification(src)).endCell());
        },
        parse: (src) => {
            return loadTokenNotification(src.loadRef().beginParse());
        }
    }
}

export type SupportJetton = {
    $$type: 'SupportJetton';
    jettonMaster: Address;
    htlcJettonWallet: Address;
}

export function storeSupportJetton(src: SupportJetton) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(525905166, 32);
        b_0.storeAddress(src.jettonMaster);
        b_0.storeAddress(src.htlcJettonWallet);
    };
}

export function loadSupportJetton(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 525905166) { throw Error('Invalid prefix'); }
    const _jettonMaster = sc_0.loadAddress();
    const _htlcJettonWallet = sc_0.loadAddress();
    return { $$type: 'SupportJetton' as const, jettonMaster: _jettonMaster, htlcJettonWallet: _htlcJettonWallet };
}

export function loadTupleSupportJetton(source: TupleReader) {
    const _jettonMaster = source.readAddress();
    const _htlcJettonWallet = source.readAddress();
    return { $$type: 'SupportJetton' as const, jettonMaster: _jettonMaster, htlcJettonWallet: _htlcJettonWallet };
}

export function loadGetterTupleSupportJetton(source: TupleReader) {
    const _jettonMaster = source.readAddress();
    const _htlcJettonWallet = source.readAddress();
    return { $$type: 'SupportJetton' as const, jettonMaster: _jettonMaster, htlcJettonWallet: _htlcJettonWallet };
}

export function storeTupleSupportJetton(source: SupportJetton) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.jettonMaster);
    builder.writeAddress(source.htlcJettonWallet);
    return builder.build();
}

export function dictValueParserSupportJetton(): DictionaryValue<SupportJetton> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSupportJetton(src)).endCell());
        },
        parse: (src) => {
            return loadSupportJetton(src.loadRef().beginParse());
        }
    }
}

export type RemoveJetton = {
    $$type: 'RemoveJetton';
    jettonMaster: Address;
}

export function storeRemoveJetton(src: RemoveJetton) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(904613265, 32);
        b_0.storeAddress(src.jettonMaster);
    };
}

export function loadRemoveJetton(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 904613265) { throw Error('Invalid prefix'); }
    const _jettonMaster = sc_0.loadAddress();
    return { $$type: 'RemoveJetton' as const, jettonMaster: _jettonMaster };
}

export function loadTupleRemoveJetton(source: TupleReader) {
    const _jettonMaster = source.readAddress();
    return { $$type: 'RemoveJetton' as const, jettonMaster: _jettonMaster };
}

export function loadGetterTupleRemoveJetton(source: TupleReader) {
    const _jettonMaster = source.readAddress();
    return { $$type: 'RemoveJetton' as const, jettonMaster: _jettonMaster };
}

export function storeTupleRemoveJetton(source: RemoveJetton) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.jettonMaster);
    return builder.build();
}

export function dictValueParserRemoveJetton(): DictionaryValue<RemoveJetton> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRemoveJetton(src)).endCell());
        },
        parse: (src) => {
            return loadRemoveJetton(src.loadRef().beginParse());
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
    jettonMasterAddress: Address;
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
        b_1.storeAddress(src.jettonMasterAddress);
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
    const _jettonMasterAddress = sc_1.loadAddress();
    return { $$type: 'HTLC' as const, sender: _sender, senderPubKey: _senderPubKey, srcReceiver: _srcReceiver, hashlock: _hashlock, amount: _amount, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress };
}

export function loadTupleHTLC(source: TupleReader) {
    const _sender = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _hashlock = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    return { $$type: 'HTLC' as const, sender: _sender, senderPubKey: _senderPubKey, srcReceiver: _srcReceiver, hashlock: _hashlock, amount: _amount, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress };
}

export function loadGetterTupleHTLC(source: TupleReader) {
    const _sender = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _hashlock = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    return { $$type: 'HTLC' as const, sender: _sender, senderPubKey: _senderPubKey, srcReceiver: _srcReceiver, hashlock: _hashlock, amount: _amount, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress };
}

export function storeTupleHTLC(source: HTLC) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.sender);
    builder.writeNumber(source.senderPubKey);
    builder.writeAddress(source.srcReceiver);
    builder.writeNumber(source.hashlock);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.timelock);
    builder.writeAddress(source.jettonMasterAddress);
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

export type CommitData = {
    $$type: 'CommitData';
    dstChain: string;
    dstAsset: string;
    dstAddress: string;
    srcAsset: string;
    id: bigint;
    srcReceiver: Address;
    timelock: bigint;
    jettonMasterAddress: Address;
    senderPubKey: bigint;
    hopChains: Dictionary<bigint, StringImpl>;
    hopAssets: Dictionary<bigint, StringImpl>;
    hopAddresses: Dictionary<bigint, StringImpl>;
}

export function storeCommitData(src: CommitData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeStringRefTail(src.dstChain);
        b_0.storeStringRefTail(src.dstAsset);
        const b_1 = new Builder();
        b_1.storeStringRefTail(src.dstAddress);
        b_1.storeStringRefTail(src.srcAsset);
        b_1.storeInt(src.id, 257);
        b_1.storeAddress(src.srcReceiver);
        b_1.storeInt(src.timelock, 257);
        const b_2 = new Builder();
        b_2.storeAddress(src.jettonMasterAddress);
        b_2.storeInt(src.senderPubKey, 257);
        b_2.storeDict(src.hopChains, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_2.storeDict(src.hopAssets, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_2.storeDict(src.hopAddresses, Dictionary.Keys.BigInt(257), dictValueParserStringImpl());
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadCommitData(slice: Slice) {
    const sc_0 = slice;
    const _dstChain = sc_0.loadStringRefTail();
    const _dstAsset = sc_0.loadStringRefTail();
    const sc_1 = sc_0.loadRef().beginParse();
    const _dstAddress = sc_1.loadStringRefTail();
    const _srcAsset = sc_1.loadStringRefTail();
    const _id = sc_1.loadIntBig(257);
    const _srcReceiver = sc_1.loadAddress();
    const _timelock = sc_1.loadIntBig(257);
    const sc_2 = sc_1.loadRef().beginParse();
    const _jettonMasterAddress = sc_2.loadAddress();
    const _senderPubKey = sc_2.loadIntBig(257);
    const _hopChains = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAssets = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAddresses = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    return { $$type: 'CommitData' as const, dstChain: _dstChain, dstAsset: _dstAsset, dstAddress: _dstAddress, srcAsset: _srcAsset, id: _id, srcReceiver: _srcReceiver, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function loadTupleCommitData(source: TupleReader) {
    const _dstChain = source.readString();
    const _dstAsset = source.readString();
    const _dstAddress = source.readString();
    const _srcAsset = source.readString();
    const _id = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _timelock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'CommitData' as const, dstChain: _dstChain, dstAsset: _dstAsset, dstAddress: _dstAddress, srcAsset: _srcAsset, id: _id, srcReceiver: _srcReceiver, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function loadGetterTupleCommitData(source: TupleReader) {
    const _dstChain = source.readString();
    const _dstAsset = source.readString();
    const _dstAddress = source.readString();
    const _srcAsset = source.readString();
    const _id = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _timelock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'CommitData' as const, dstChain: _dstChain, dstAsset: _dstAsset, dstAddress: _dstAddress, srcAsset: _srcAsset, id: _id, srcReceiver: _srcReceiver, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
}

export function storeTupleCommitData(source: CommitData) {
    const builder = new TupleBuilder();
    builder.writeString(source.dstChain);
    builder.writeString(source.dstAsset);
    builder.writeString(source.dstAddress);
    builder.writeString(source.srcAsset);
    builder.writeNumber(source.id);
    builder.writeAddress(source.srcReceiver);
    builder.writeNumber(source.timelock);
    builder.writeAddress(source.jettonMasterAddress);
    builder.writeNumber(source.senderPubKey);
    builder.writeCell(source.hopChains.size > 0 ? beginCell().storeDictDirect(source.hopChains, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    builder.writeCell(source.hopAssets.size > 0 ? beginCell().storeDictDirect(source.hopAssets, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    builder.writeCell(source.hopAddresses.size > 0 ? beginCell().storeDictDirect(source.hopAddresses, Dictionary.Keys.BigInt(257), dictValueParserStringImpl()).endCell() : null);
    return builder.build();
}

export function dictValueParserCommitData(): DictionaryValue<CommitData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCommitData(src)).endCell());
        },
        parse: (src) => {
            return loadCommitData(src.loadRef().beginParse());
        }
    }
}

export type LockData = {
    $$type: 'LockData';
    id: bigint;
    timelock: bigint;
    reward: bigint;
    rewardTimelock: bigint;
    srcReceiver: Address;
    srcAsset: string;
    dstChain: string;
    dstAddress: string;
    dstAsset: string;
    hashlock: bigint;
    jettonMasterAddress: Address;
    htlcJettonWalletAddress: Address;
}

export function storeLockData(src: LockData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.id, 257);
        b_0.storeInt(src.timelock, 257);
        b_0.storeCoins(src.reward);
        b_0.storeInt(src.rewardTimelock, 257);
        const b_1 = new Builder();
        b_1.storeAddress(src.srcReceiver);
        b_1.storeStringRefTail(src.srcAsset);
        b_1.storeStringRefTail(src.dstChain);
        b_1.storeStringRefTail(src.dstAddress);
        const b_2 = new Builder();
        b_2.storeStringRefTail(src.dstAsset);
        b_2.storeInt(src.hashlock, 257);
        b_2.storeAddress(src.jettonMasterAddress);
        b_2.storeAddress(src.htlcJettonWalletAddress);
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadLockData(slice: Slice) {
    const sc_0 = slice;
    const _id = sc_0.loadIntBig(257);
    const _timelock = sc_0.loadIntBig(257);
    const _reward = sc_0.loadCoins();
    const _rewardTimelock = sc_0.loadIntBig(257);
    const sc_1 = sc_0.loadRef().beginParse();
    const _srcReceiver = sc_1.loadAddress();
    const _srcAsset = sc_1.loadStringRefTail();
    const _dstChain = sc_1.loadStringRefTail();
    const _dstAddress = sc_1.loadStringRefTail();
    const sc_2 = sc_1.loadRef().beginParse();
    const _dstAsset = sc_2.loadStringRefTail();
    const _hashlock = sc_2.loadIntBig(257);
    const _jettonMasterAddress = sc_2.loadAddress();
    const _htlcJettonWalletAddress = sc_2.loadAddress();
    return { $$type: 'LockData' as const, id: _id, timelock: _timelock, reward: _reward, rewardTimelock: _rewardTimelock, srcReceiver: _srcReceiver, srcAsset: _srcAsset, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, hashlock: _hashlock, jettonMasterAddress: _jettonMasterAddress, htlcJettonWalletAddress: _htlcJettonWalletAddress };
}

export function loadTupleLockData(source: TupleReader) {
    const _id = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _hashlock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    const _htlcJettonWalletAddress = source.readAddress();
    return { $$type: 'LockData' as const, id: _id, timelock: _timelock, reward: _reward, rewardTimelock: _rewardTimelock, srcReceiver: _srcReceiver, srcAsset: _srcAsset, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, hashlock: _hashlock, jettonMasterAddress: _jettonMasterAddress, htlcJettonWalletAddress: _htlcJettonWalletAddress };
}

export function loadGetterTupleLockData(source: TupleReader) {
    const _id = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _hashlock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    const _htlcJettonWalletAddress = source.readAddress();
    return { $$type: 'LockData' as const, id: _id, timelock: _timelock, reward: _reward, rewardTimelock: _rewardTimelock, srcReceiver: _srcReceiver, srcAsset: _srcAsset, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, hashlock: _hashlock, jettonMasterAddress: _jettonMasterAddress, htlcJettonWalletAddress: _htlcJettonWalletAddress };
}

export function storeTupleLockData(source: LockData) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.id);
    builder.writeNumber(source.timelock);
    builder.writeNumber(source.reward);
    builder.writeNumber(source.rewardTimelock);
    builder.writeAddress(source.srcReceiver);
    builder.writeString(source.srcAsset);
    builder.writeString(source.dstChain);
    builder.writeString(source.dstAddress);
    builder.writeString(source.dstAsset);
    builder.writeNumber(source.hashlock);
    builder.writeAddress(source.jettonMasterAddress);
    builder.writeAddress(source.htlcJettonWalletAddress);
    return builder.build();
}

export function dictValueParserLockData(): DictionaryValue<LockData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeLockData(src)).endCell());
        },
        parse: (src) => {
            return loadLockData(src.loadRef().beginParse());
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
    jettonMasterAddress: Address;
    senderPubKey: bigint;
    hopChains: Dictionary<bigint, StringImpl>;
    hopAssets: Dictionary<bigint, StringImpl>;
    hopAddresses: Dictionary<bigint, StringImpl>;
}

export function storeTokenCommitted(src: TokenCommitted) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(3208455377, 32);
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
        b_2.storeAddress(src.jettonMasterAddress);
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
    if (sc_0.loadUint(32) !== 3208455377) { throw Error('Invalid prefix'); }
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
    const _jettonMasterAddress = sc_2.loadAddress();
    const _senderPubKey = sc_2.loadIntBig(257);
    const _hopChains = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAssets = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    const _hopAddresses = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), sc_2);
    return { $$type: 'TokenCommitted' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
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
    const _jettonMasterAddress = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'TokenCommitted' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
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
    const _jettonMasterAddress = source.readAddress();
    const _senderPubKey = source.readBigNumber();
    const _hopChains = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAssets = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    const _hopAddresses = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserStringImpl(), source.readCellOpt());
    return { $$type: 'TokenCommitted' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, jettonMasterAddress: _jettonMasterAddress, senderPubKey: _senderPubKey, hopChains: _hopChains, hopAssets: _hopAssets, hopAddresses: _hopAddresses };
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
    builder.writeAddress(source.jettonMasterAddress);
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
    dstChain: string;
    dstAddress: string;
    dstAsset: string;
    sender: Address;
    srcReceiver: Address;
    srcAsset: string;
    amount: bigint;
    timelock: bigint;
    hashlock: bigint;
    reward: bigint;
    rewardTimelock: bigint;
    jettonMasterAddress: Address;
}

export function storeTokenLocked(src: TokenLocked) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(256369080, 32);
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
        b_2.storeInt(src.hashlock, 257);
        b_2.storeCoins(src.reward);
        b_2.storeInt(src.rewardTimelock, 257);
        b_2.storeAddress(src.jettonMasterAddress);
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadTokenLocked(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 256369080) { throw Error('Invalid prefix'); }
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
    const _hashlock = sc_2.loadIntBig(257);
    const _reward = sc_2.loadCoins();
    const _rewardTimelock = sc_2.loadIntBig(257);
    const _jettonMasterAddress = sc_2.loadAddress();
    return { $$type: 'TokenLocked' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, hashlock: _hashlock, reward: _reward, rewardTimelock: _rewardTimelock, jettonMasterAddress: _jettonMasterAddress };
}

export function loadTupleTokenLocked(source: TupleReader) {
    const _id = source.readBigNumber();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _sender = source.readAddress();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    return { $$type: 'TokenLocked' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, hashlock: _hashlock, reward: _reward, rewardTimelock: _rewardTimelock, jettonMasterAddress: _jettonMasterAddress };
}

export function loadGetterTupleTokenLocked(source: TupleReader) {
    const _id = source.readBigNumber();
    const _dstChain = source.readString();
    const _dstAddress = source.readString();
    const _dstAsset = source.readString();
    const _sender = source.readAddress();
    const _srcReceiver = source.readAddress();
    const _srcAsset = source.readString();
    const _amount = source.readBigNumber();
    const _timelock = source.readBigNumber();
    const _hashlock = source.readBigNumber();
    const _reward = source.readBigNumber();
    const _rewardTimelock = source.readBigNumber();
    const _jettonMasterAddress = source.readAddress();
    return { $$type: 'TokenLocked' as const, id: _id, dstChain: _dstChain, dstAddress: _dstAddress, dstAsset: _dstAsset, sender: _sender, srcReceiver: _srcReceiver, srcAsset: _srcAsset, amount: _amount, timelock: _timelock, hashlock: _hashlock, reward: _reward, rewardTimelock: _rewardTimelock, jettonMasterAddress: _jettonMasterAddress };
}

export function storeTupleTokenLocked(source: TokenLocked) {
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
    builder.writeNumber(source.hashlock);
    builder.writeNumber(source.reward);
    builder.writeNumber(source.rewardTimelock);
    builder.writeAddress(source.jettonMasterAddress);
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

export type TrainJetton$Data = {
    $$type: 'TrainJetton$Data';
    owner: Address;
    contracts: Dictionary<bigint, HTLC>;
    rewards: Dictionary<bigint, Reward>;
    jettonMasterToWallet: Dictionary<Address, Address>;
}

export function storeTrainJetton$Data(src: TrainJetton$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.owner);
        b_0.storeDict(src.contracts, Dictionary.Keys.BigInt(257), dictValueParserHTLC());
        b_0.storeDict(src.rewards, Dictionary.Keys.BigInt(257), dictValueParserReward());
        b_0.storeDict(src.jettonMasterToWallet, Dictionary.Keys.Address(), Dictionary.Values.Address());
    };
}

export function loadTrainJetton$Data(slice: Slice) {
    const sc_0 = slice;
    const _owner = sc_0.loadAddress();
    const _contracts = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserHTLC(), sc_0);
    const _rewards = Dictionary.load(Dictionary.Keys.BigInt(257), dictValueParserReward(), sc_0);
    const _jettonMasterToWallet = Dictionary.load(Dictionary.Keys.Address(), Dictionary.Values.Address(), sc_0);
    return { $$type: 'TrainJetton$Data' as const, owner: _owner, contracts: _contracts, rewards: _rewards, jettonMasterToWallet: _jettonMasterToWallet };
}

export function loadTupleTrainJetton$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _contracts = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserHTLC(), source.readCellOpt());
    const _rewards = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserReward(), source.readCellOpt());
    const _jettonMasterToWallet = Dictionary.loadDirect(Dictionary.Keys.Address(), Dictionary.Values.Address(), source.readCellOpt());
    return { $$type: 'TrainJetton$Data' as const, owner: _owner, contracts: _contracts, rewards: _rewards, jettonMasterToWallet: _jettonMasterToWallet };
}

export function loadGetterTupleTrainJetton$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _contracts = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserHTLC(), source.readCellOpt());
    const _rewards = Dictionary.loadDirect(Dictionary.Keys.BigInt(257), dictValueParserReward(), source.readCellOpt());
    const _jettonMasterToWallet = Dictionary.loadDirect(Dictionary.Keys.Address(), Dictionary.Values.Address(), source.readCellOpt());
    return { $$type: 'TrainJetton$Data' as const, owner: _owner, contracts: _contracts, rewards: _rewards, jettonMasterToWallet: _jettonMasterToWallet };
}

export function storeTupleTrainJetton$Data(source: TrainJetton$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeCell(source.contracts.size > 0 ? beginCell().storeDictDirect(source.contracts, Dictionary.Keys.BigInt(257), dictValueParserHTLC()).endCell() : null);
    builder.writeCell(source.rewards.size > 0 ? beginCell().storeDictDirect(source.rewards, Dictionary.Keys.BigInt(257), dictValueParserReward()).endCell() : null);
    builder.writeCell(source.jettonMasterToWallet.size > 0 ? beginCell().storeDictDirect(source.jettonMasterToWallet, Dictionary.Keys.Address(), Dictionary.Values.Address()).endCell() : null);
    return builder.build();
}

export function dictValueParserTrainJetton$Data(): DictionaryValue<TrainJetton$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTrainJetton$Data(src)).endCell());
        },
        parse: (src) => {
            return loadTrainJetton$Data(src.loadRef().beginParse());
        }
    }
}

 type TrainJetton_init_args = {
    $$type: 'TrainJetton_init_args';
}

function initTrainJetton_init_args(src: TrainJetton_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
    };
}

async function TrainJetton_init() {
    const __code = Cell.fromHex('b5ee9c724102500100146600022cff008e88f4a413f4bcf2c80bed53208e8130e1ed43d90115020271020d020120030802012004060155b5071da89a1a400031c25f481e809a803a1e809e8086020482046d8293060dadadbf084aa41c5b678d883005004e702181010bf4826fa520911295316d326d01e231909f01a481010b54431359f4746fa51231e8300185b6373da89a1a400031c25f481e809a803a1e809e8086020482046d8293060dadadbf084aa41c4aa07b678d88240dd2460db3240dde5a100de44de05c440dd2460dbbd0070044810101230259f40d6fa192306ddf206e92306d9dd0fa00810101d700596c126f02e202039450090b0153a3fbb51343480006384be903d013500743d013d010c04090408db05260c1b5b5b7e10954838b6cf1b1060a00667022810101f4856fa520911295316d326d01e2908e1b3001a481010154441359f4786fa5209402d4305895316d326d01e2e85b0153a077b51343480006384be903d013500743d013d010c04090408db05260c1b5b5b7e10954838b6cf1b1060c0002230201200e130201200f110155b40d3da89a1a400031c25f481e809a803a1e809e8086020482046d8293060dadadbf084aa41c5b678d88301000667023810101f4856fa520911295316d326d01e2908e1b3001a481010154451359f4786fa5209402d4305895316d326d01e2e85b0185b7eedda89a1a400031c25f481e809a803a1e809e8086020482046d8293060dadadbf084aa41c4aa07b678d88240dd2460db3240dde5a100de4ede0fc440dd2460dbbd0120078810101240259f40d6fa192306ddf206e92306d8e26d0fa40810101d700fa40d401d0810101d700fa00810101d700fa40301047104610456c176f07e20159bad6ded44d0d200018e12fa40f404d401d0f404f40430102410236c1498306d6d6df8425520e25503db3c6c41814001c81010b220259f40a6fa192306ddf04d8eda2edfb01d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e12fa40f404d401d0f404f40430102410236c1498306d6d6df8425520e205925f05e07024d74920c21f9135e30d20c00025c121b0e302c0009133e30d820186a074fb02f8427070810082164a4c4e04f03124d70b1f2082107362d09cba8fe05b038020d721d33ffa00fa40513343303333f8416f24303203c801cf16c9d0d30031d430d0d31f820186a08014fb022182106769fafeba8f0a01821012e78cb1bae30fe30d4003c87f01ca0055305034cef40001c8f40012f400cdc9ed54db31e02082105cdd41d9ba171f202703bcdb3c30322e8101012b59f40c6fa131b39353b7bc9170e298f823810708a029b99170e2935368b99170e295f8235270bc9170e2960a820186a0bc923a70e28e19561081010b2259f40a6fa192306ddf2c216e925b7092c705e29170e2e30f181a1e010cdb3c0cd1550a190076810101d700810101d700fa00810101d700d401d0fa40d401d001d401d001d401d001d430d0d401d001810101d700fa40fa4030108c108b108a108901fc3b8101017153b7a12e595467d02c5611c855605067ce14810101cf0012ce01c8810101cf0058fa0212810101cf0012cecdc929103f01206e953059f45a30944133f415e2258e258101015365c85959fa02810101cf00c9021110025290206e953059f45a30944133f415e20ede5195a1107a54190c519c109e08105710461b0288451440130e4330c855c0db3cc9c88258c000000000000000000000000101cb67ccc970fb007070810082884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb001c1d008a82100f47e1b8500ecb1f1c810101cf000ac8ce1acd08c8ce18cdc807c8ce17cd15ce13ce01c8cecd01fa02810101cf0002c8810101cf005003fa0213810101cf0013cecdcd002600000000545241494e4c6f636b45786365737300e65f0a7070810082821012e78cb16d71c85260cb1f8bf545241494e4c6f636b4661696c65648cf16c9c85220cb00ccc9d02910461058040a5520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec91344404343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0000f25b70708100828210319abd7c6d71c85260cb1f8d05551490525393dc10dbd919539bdd105b1b1bddd95920cf16c9c85220cb00ccc9d02910461058040a5520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec91344404343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00039e31db3c2dc30099f823810384a05260bc9170e29d56108101012959f40c6fa131b39170e2960c820186a0bc923c70e28e19561281010b2559f40a6fa192306ddf2e216e925b7092c705e29170e2e30f212326010cdb3c0cd1550a220068d401d001d401d001d401d0d401d001d401d001810101d700fa40810101d700d430d0fa40810101d700f404f404f4043010ac10ab03fe3d810101547e257156105398c855605067ce14810101cf0012ce01c8810101cf0058fa0212810101cf0012cecdc9021110025270206e953059f45a30944133f415e2105c109b5e272d091058061045103410234f0fc855d0db3cc9c88258c000000000000000000000000101cb67ccc970fb007070810082884343c8cf8580242538008a8210bf3d24d1500fcb1f1d810101cf000bc8ce1bcd09c8ce19cdc808c8ce18cd16ce14ce02c8ce12cd01fa02810101cf0001c8ce13810101cf0013f40013f40013f400cdcd002a00000000545241494e436f6d6d697445786365737300ec5f0c707081008282106769fafe6d71c85260cb1f8d04551490525390dbdb5b5a5d11985a5b195920cf16c9c85220cb00ccc9d02910461058040a5520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec91344404343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00043ce302208210c1d818ffbae302208210758db085bae302208210ad821ef9ba282c314001fe5b038020d721810101d700810101d700810101d7005520338200c53ef8416f24135f03820186a0bcf2f4820186a08014fb028200e431248101012459f40c6fa131f2f4238101012359f40d6fa192306ddf206e92306d8e26d0fa40810101d700fa40d401d0810101d700fa00810101d700fa40301047104610456c176f07e22902fc206ef2d0806f2731817bc7f84227c705f2f48121ca03c00113f2f48154b3f823810384a05290bcf2f410451034430781010108c855605067ce14810101cf0012ce01c8810101cf0058fa0212810101cf0012cecdc9206e953059f45a30944133f415e2f8427070810082884343c8cf8580ca00cf8440ce01fa02806acf402a2b002c00000000545241494e4164644c6f636b4578636573730042f400c901fb004003c87f01ca0055305034cef40001c8f40012f400cdc9ed54db3101fe5b038020d721d401d001d401d012328200c53ef8416f24135f03820186a0bcf2f4820186a08014fb028200e4318101015320d702255959f40c6fa131c0fff2f48101015cd702245959f40d6fa192306ddf206e92306d8e26d0fa40810101d700fa40d401d0810101d700fa00810101d700fa40301047104610456c176f07e22d02fe206ef2d0806f273181256927f901541096f91018f2f405810101d700810101d700810101d700308154b3f823810384a05220bcf2f48121ca04c00114f2f4506281010108c855605067ce14810101cf0012ce01c8810101cf0058fa0212810101cf0012cecdc9206e953059f45a30944133f415e2f8427070810082884343c82e2f003200000000545241494e4164644c6f636b536967457863657373016289cf16ca00cf8440ce01fa02806acf40f400c901fb004003c87f01ca0055305034cef40001c8f40012f400cdc9ed54db313000016001fe5b038020d721810101d700810101d7005932f8416f2430328200e431258101012559f40c6fa131c0fff2f48200c53e22820186a0bcf2f4248101012459f40d6fa192306ddf206e92306d8e26d0fa40810101d700fa40d401d0810101d700fa00810101d700fa40301047104610456c176f07e2206ef2d0806f273134c852903203e2cbffc9d09b9320d74a91d5e868f90400da11228200c6e602baf2f4f8422841a3c8553082106564cfc95005cb1f13810101cf00ce810101cf0001c8810101cf00cdc9c88258c000000000000000000000000101cb67ccc970fb00298101012759f40c6fa131e30f5033810101f45a304003333d3f038e298101012759f40d6fa192306ddf206e92306d9dd0fa00810101d700596c126f02e2206ef2d0806f22820186a08014fb02f823bc8f07335330c705e30fe30d5204810101f45a3034363901fe3481010b2a0259f40a6fa192306ddf206ef2d0807070810082088210758db08505a06d71c85250cb1f8d05151490525394995919595b505b9914995dd85c9920cf16c9c85220cb00ccc9d01067103510491038c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec95e21154343c8cf8580ca00cf844035001cce01fa02806acf40f400c901fb0001fc2a81010b2359f40a6fa192306ddf206ef2d08005820186a0a1ab0070728210758db0856d71c87001cb1f8bb545241494e52656465656d8cf16c9c85220cb00ccc9d02a1046105e10485520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec9104613184343c8cf8580ca00cf8440ce01fa02806a3701fccf40f400c901fb0081010b54481559f40a6fa192306ddf206ef2d08070708100828210758db0856d71c85260cb1f8d04551490525394995919595b54995dd85c9920cf16c9c85220cb00ccc9d02a10461059040b5520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec9443010254343c8cf8580380026ca00cf8440ce01fa02806acf40f400c901fb0001fe2b81010b2459f40a6fa192306ddf206ef2d08006820186a0a1ab0070728210758db0856d71c87001cb1f8bb545241494e52656465656d8cf16c9c85220cb00ccc9d02b1046105f10495520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec910474330194343c8cf8580ca00cf8440ce01fa02806a3a01fecf40f400c901fb0081010b54491459f40a6fa192306ddf206ef2d080707081008282100758db906d71c85260cb1f8d04551490525394995dd85c9914995d1d5c9ba0cf16c9c85220cb00ccc9d01036105b10491038c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec95e2145504343c8cf8580ca003b012289cf16ce01fa02806acf40f400c901fb003c00011001fe3233820186a08014fb0281010b54491459f40a6fa192306ddf206ef2d08070708100828210758db0856d71c85260cb1f8bb545241494e52656465656d8cf16c9c85220cb00ccc9d01036105b10491038c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec95e2145504343c8cf8580ca00cf8440ce013e001afa02806acf40f400c901fb00030032c87f01ca0055305034cef40001c8f40012f400cdc9ed54db3102fe8efd5b038020d721810101d7000131f8416f24308200c53e33820186a0bc12f2f4820186a08014fb028200e431238101012459f40c6fa131f2f4228101012359f40d6fa192306ddf206e92306d8e26d0fa40810101d700fa40d401d0810101d700fa00810101d700fa40301047104610456c176f07e2206ef2d0806f276c33414301fc8200955ff82313b912f2f4278101012659f40c6fa1318e2d278101012659f40d6fa192306ddf206e92306d9dd0fa00810101d700596c126f02e2206ef2d0806f223012a001de81010b290259f40a6fa192306ddf206ef2d08070708100828210ad821ef96d71c85260cb1f8bb545241494e526566756e648cf16c9c852204200fccb00ccc9d0103610581049103ac8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec914134343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00238101012259f40c6fa131995204810101f45a3003de01810101f45a304003c87f01ca0055305034cef40001c8f40012f400cdc9ed54db3104fee02082101f58ad0ebae30220821035eb4d91ba8f695b038020d721fa400131820186a074fb024134db3c8200edb12181010b2759f40a6fa131f2f41481010bf45930f8427070810082884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb004130c87f01ca0055305034cef40001c8f40012f400cdc9ed54db31e04448464702f65b038020d721fa40fa405932820186a074fb025045db3c82009d962181010b2859f40a6fa131b3f2f40281010b4065206e953059f4593096c8ce4133f441e2f8427070810082884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb004330c87f01ca0055305034cef40001c8f40012f400cdc9ed54db314845003800000000545241494e537570706f72744a6574746f6e457863657373003600000000545241494e52656d6f76654a6574746f6e4578636573730266208210819dbe99ba8f265b038020d721d33ffa4059325045db3c335143c8598210327b2b4a5003cb1fcb3fcec9134440e0350448490010f84224c705f2e08400f4f8427ff8276f10f8416f24135f03a1820186a0b98e28820186a070fb0270500381008201503304c8cf8580ca00cf8440ce01fa02806acf40f400c901fb008e20705003804201503304c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00e2c87f01ca0055305034cef40001c8f40012f400cdc9ed54db3101863033820186a074fb02f8427070810082884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb004003c87f01ca0055305034cef40001c8f40012f400cdc9ed544b003e00000000545241494e456d7074794d6573736167654e6f74416c6c6f776564019203c21f8ec3820186a074fb02f8427070810082884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb004003c87f01ca0055305034cef40001c8f40012f400cdc9ed54db31e04d003c00000000545241494e546578744d6573736167654e6f74416c6c6f7765640166884343c8cf8580ca00cf8440ce01fa02806acf40f400c901fb004003c87f01ca0055305034cef40001c8f40012f400cdc9ed544f003e00000000545241494e536c6963654d6573736167654e6f74416c6c6f77656403cb572b');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initTrainJetton_init_args({ $$type: 'TrainJetton_init_args' })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const TrainJetton_errors = {
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
    8650: { message: "Hashlock Already Set" },
    9577: { message: "Invalid Signature" },
    21683: { message: "Not Future Timelock" },
    31687: { message: "No Allowance" },
    38239: { message: "Not Passed Timelock" },
    40342: { message: "Jetton Already Supported" },
    50494: { message: "Storage Fee Required" },
    50918: { message: "Hashlock Not Match" },
    58417: { message: "Contract Does Not Exist" },
    60849: { message: "Jetton Not Supported" },
} as const

export const TrainJetton_errors_backward = {
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
    "Hashlock Already Set": 8650,
    "Invalid Signature": 9577,
    "Not Future Timelock": 21683,
    "No Allowance": 31687,
    "Not Passed Timelock": 38239,
    "Jetton Already Supported": 40342,
    "Storage Fee Required": 50494,
    "Hashlock Not Match": 50918,
    "Contract Does Not Exist": 58417,
    "Jetton Not Supported": 60849,
} as const

const TrainJetton_types: ABIType[] = [
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
    {"name":"ChangeOwner","header":2174598809,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"ChangeOwnerOk","header":846932810,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"TokenTransfer","header":260734629,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"destination","type":{"kind":"simple","type":"address","optional":false}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":false}},{"name":"customPayload","type":{"kind":"simple","type":"cell","optional":true}},{"name":"forwardTonAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"TokenNotification","header":1935855772,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"from","type":{"kind":"simple","type":"address","optional":false}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"SupportJetton","header":525905166,"fields":[{"name":"jettonMaster","type":{"kind":"simple","type":"address","optional":false}},{"name":"htlcJettonWallet","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"RemoveJetton","header":904613265,"fields":[{"name":"jettonMaster","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"HTLC","header":null,"fields":[{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"senderPubKey","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"jettonMasterAddress","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"Reward","header":null,"fields":[{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"CommitData","header":null,"fields":[{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"jettonMasterAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"senderPubKey","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hopChains","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAssets","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAddresses","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}}]},
    {"name":"LockData","header":null,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"reward","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"rewardTimelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"jettonMasterAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"htlcJettonWalletAddress","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"AddLock","header":1558004185,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"Redeem","header":1972220037,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"secret","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"Refund","header":2910985977,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"AddLockSig","header":3252164863,"fields":[{"name":"data","type":{"kind":"simple","type":"slice","optional":false}},{"name":"signature","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"TokenCommitted","header":3208455377,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"jettonMasterAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"senderPubKey","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hopChains","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAssets","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}},{"name":"hopAddresses","type":{"kind":"dict","key":"int","value":"StringImpl","valueFormat":"ref"}}]},
    {"name":"TokenLocked","header":256369080,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"dstChain","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAddress","type":{"kind":"simple","type":"string","optional":false}},{"name":"dstAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcReceiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"srcAsset","type":{"kind":"simple","type":"string","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"timelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"reward","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"rewardTimelock","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"jettonMasterAddress","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"TokenRedeemed","header":1701105609,"fields":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"redeemAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"secret","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hashlock","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"StringImpl","header":null,"fields":[{"name":"data","type":{"kind":"simple","type":"string","optional":false}}]},
    {"name":"TrainJetton$Data","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"contracts","type":{"kind":"dict","key":"int","value":"HTLC","valueFormat":"ref"}},{"name":"rewards","type":{"kind":"dict","key":"int","value":"Reward","valueFormat":"ref"}},{"name":"jettonMasterToWallet","type":{"kind":"dict","key":"address","value":"address"}}]},
]

const TrainJetton_opcodes = {
    "ChangeOwner": 2174598809,
    "ChangeOwnerOk": 846932810,
    "TokenTransfer": 260734629,
    "TokenNotification": 1935855772,
    "SupportJetton": 525905166,
    "RemoveJetton": 904613265,
    "AddLock": 1558004185,
    "Redeem": 1972220037,
    "Refund": 2910985977,
    "AddLockSig": 3252164863,
    "TokenCommitted": 3208455377,
    "TokenLocked": 256369080,
    "TokenRedeemed": 1701105609,
}

const TrainJetton_getters: ABIGetter[] = [
    {"name":"getHTLCDetails","methodId":114550,"arguments":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"HTLC","optional":true}},
    {"name":"getContractsLength","methodId":98409,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"getRewardDetails","methodId":78265,"arguments":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"Reward","optional":true}},
    {"name":"getRewardsLength","methodId":83198,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"getHTLCJettonWalletForMaster","methodId":126317,"arguments":[{"name":"jettonMaster","type":{"kind":"simple","type":"address","optional":false}}],"returnType":{"kind":"simple","type":"address","optional":true}},
    {"name":"getSupportedJettonsLength","methodId":67640,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"owner","methodId":83229,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":false}},
]

export const TrainJetton_getterMapping: { [key: string]: string } = {
    'getHTLCDetails': 'getGetHtlcDetails',
    'getContractsLength': 'getGetContractsLength',
    'getRewardDetails': 'getGetRewardDetails',
    'getRewardsLength': 'getGetRewardsLength',
    'getHTLCJettonWalletForMaster': 'getGetHtlcJettonWalletForMaster',
    'getSupportedJettonsLength': 'getGetSupportedJettonsLength',
    'owner': 'getOwner',
}

const TrainJetton_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"typed","type":"TokenNotification"}},
    {"receiver":"internal","message":{"kind":"typed","type":"AddLock"}},
    {"receiver":"internal","message":{"kind":"typed","type":"AddLockSig"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Redeem"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Refund"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SupportJetton"}},
    {"receiver":"internal","message":{"kind":"typed","type":"RemoveJetton"}},
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"text"}},
    {"receiver":"internal","message":{"kind":"any"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ChangeOwner"}},
]


export class TrainJetton implements Contract {
    
    public static readonly storageReserve = 100000n;
    public static readonly errors = TrainJetton_errors_backward;
    public static readonly opcodes = TrainJetton_opcodes;
    
    static async init() {
        return await TrainJetton_init();
    }
    
    static async fromInit() {
        const __gen_init = await TrainJetton_init();
        const address = contractAddress(0, __gen_init);
        return new TrainJetton(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new TrainJetton(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  TrainJetton_types,
        getters: TrainJetton_getters,
        receivers: TrainJetton_receivers,
        errors: TrainJetton_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: TokenNotification | AddLock | AddLockSig | Redeem | Refund | SupportJetton | RemoveJetton | null | string | Slice | ChangeOwner) {
        
        let body: Cell | null = null;
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'TokenNotification') {
            body = beginCell().store(storeTokenNotification(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'AddLock') {
            body = beginCell().store(storeAddLock(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'AddLockSig') {
            body = beginCell().store(storeAddLockSig(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Redeem') {
            body = beginCell().store(storeRedeem(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Refund') {
            body = beginCell().store(storeRefund(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SupportJetton') {
            body = beginCell().store(storeSupportJetton(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'RemoveJetton') {
            body = beginCell().store(storeRemoveJetton(message)).endCell();
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
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ChangeOwner') {
            body = beginCell().store(storeChangeOwner(message)).endCell();
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
    
    async getGetHtlcJettonWalletForMaster(provider: ContractProvider, jettonMaster: Address) {
        const builder = new TupleBuilder();
        builder.writeAddress(jettonMaster);
        const source = (await provider.get('getHTLCJettonWalletForMaster', builder.build())).stack;
        const result = source.readAddressOpt();
        return result;
    }
    
    async getGetSupportedJettonsLength(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('getSupportedJettonsLength', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getOwner(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('owner', builder.build())).stack;
        const result = source.readAddress();
        return result;
    }
    
}