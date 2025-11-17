//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

import "@stdlib/ownable";

//Jetton's messages
message(0xf8a7ea5) TokenTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}
message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    forwardPayload: Slice as remaining;
}

message(0x1f58ad0e) SupportJetton {
    jettonMaster: Address;
    htlcJettonWallet: Address;
}

message(0x35eb4d91) RemoveJetton {
    jettonMaster: Address;
}

// Lock object
struct HTLC {
    sender: Address;
    senderPubKey: Int;
    srcReceiver: Address;
    hashlock: Int;
    amount: Int as coins;
    timelock: Int;
    jettonMasterAddress: Address;
}
// Reward object
struct Reward {
    amount: Int as coins;
    timelock: Int;
}
struct CommitData {
    dstChain: String;
    dstAsset: String;
    dstAddress: String;
    srcAsset: String;
    id: Int;
    srcReceiver: Address;
    timelock: Int;
    jettonMasterAddress: Address;
    senderPubKey: Int;
    hopChains: map<Int, StringImpl>;
    hopAssets: map<Int, StringImpl>;
    hopAddresses: map<Int, StringImpl>;
}
struct LockData {
    id: Int;
    timelock: Int;
    reward: Int as coins;
    rewardTimelock: Int;
    srcReceiver: Address;
    srcAsset: String;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
    hashlock: Int;
    jettonMasterAddress: Address;
}
// Messages received by contract
message(0x5cdd41d9) AddLock {
    id: Int;
    hashlock: Int;
    timelock: Int;
}
message(0x758db085) Redeem {
    id: Int;
    secret: Int;
}
message(0xad821ef9) Refund {
    id: Int;
}
message(0xc1d818ff) AddLockSig {
    data: Slice;
    signature: Slice;
}
// Emitted message
message(0xbf3d24d1) TokenCommitted {
    id: Int;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
    sender: Address;
    srcReceiver: Address;
    srcAsset: String;
    amount: Int as coins;
    timelock: Int;
    jettonMasterAddress: Address;
    senderPubKey: Int;
    hopChains: map<Int, StringImpl>;
    hopAssets: map<Int, StringImpl>;
    hopAddresses: map<Int, StringImpl>;
}
message(0x0f47e1b8) TokenLocked {
    id: Int;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
    sender: Address;
    srcReceiver: Address;
    srcAsset: String;
    amount: Int as coins;
    timelock: Int;
    hashlock: Int;
    reward: Int as coins;
    rewardTimelock: Int;
    jettonMasterAddress: Address;
}
message(0x6564cfc9) TokenRedeemed {
    id: Int;
    redeemAddress: Address;
    secret: Int;
    hashlock: Int;
}
// String implementation as struct
struct StringImpl {
    data: String;
}

contract TrainJetton with OwnableTransferable {
    override const storageReserve: Int = 100000; // Reserve part of each incoming interaction to cover the contract’s on-chain storage fees

    owner: Address;
    contracts: map<Int, HTLC>;
    rewards: map<Int, Reward>;
    jettonMasterToWallet: map<Address, Address>;

    init() {
        self.owner = sender();
    }

    receive(msg: TokenNotification) {
        let ctx: Context = context();
        let slice = msg.forwardPayload.asCell().beginParse();
        let flag = slice.loadUint(1);
        let refCell = slice.loadRef();
        let refSlice = refCell.beginParse();
        let opCode = refSlice.loadUint(32);
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
        if (opCode == 1734998782) {
            let commitData: CommitData = CommitData.fromSlice(refSlice);
            if (msg.amount != 0 && commitData.timelock > (now() + 900) && !self.contracts.exists(commitData.id) && ctx.value > self.storageReserve && self.jettonMasterToWallet.get(commitData.jettonMasterAddress) == ctx.sender) {
                self.contracts.set(
                    commitData.id,
                    HTLC {
                        sender: msg.from,
                        senderPubKey: commitData.senderPubKey,
                        srcReceiver: commitData.srcReceiver,
                        hashlock: 1,
                        amount: msg.amount,
                        timelock: commitData.timelock,
                        jettonMasterAddress: commitData.jettonMasterAddress,
                    },
                );
                emit(TokenCommitted {
                    id: commitData.id,
                    dstChain: commitData.dstChain,
                    dstAddress: commitData.dstAddress,
                    dstAsset: commitData.dstAsset,
                    sender: msg.from,
                    srcReceiver: commitData.srcReceiver,
                    srcAsset: commitData.srcAsset,
                    amount: msg.amount,
                    timelock: commitData.timelock,
                    jettonMasterAddress: commitData.jettonMasterAddress,
                    senderPubKey: commitData.senderPubKey,
                    hopChains: commitData.hopChains,
                    hopAssets: commitData.hopAssets,
                    hopAddresses: commitData.hopAddresses,
                }.toCell());

                message(MessageParameters {
                    to: msg.from,
                    value: 0,
                    bounce: false,
                    mode: SendRemainingBalance,
                    body: "TRAINCommitExcess".asComment(),
                });
            } else {
                message(MessageParameters {
                    to: ctx.sender,
                    value: 0,
                    bounce: false,
                    mode: SendRemainingBalance,
                    body: TokenTransfer {
                        queryId: 1734998782,
                        amount: msg.amount,
                        destination: msg.from,
                        responseDestination: msg.from,
                        customPayload: null,
                        forwardTonAmount: 1,
                        forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                            .storeUint(0, 32)
                            .storeSlice("TRAINCommitFailed".asSlice())
                            .endCell()).endCell().asSlice(),
                    }.toCell(),
                });
            }
        } else if (opCode == 317164721) {
            let lockData: LockData = LockData.fromSlice(refSlice);
            if (!self.contracts.exists(lockData.id) &&
                msg.amount > lockData.reward &&
                (now() + 1800) < lockData.timelock &&
                lockData.rewardTimelock < lockData.timelock &&
                lockData.rewardTimelock > now() && ctx.value > self.storageReserve && self.jettonMasterToWallet.get(lockData.jettonMasterAddress) == ctx.sender) {
                self.contracts.set(
                    lockData.id,
                    HTLC {
                        sender: msg.from,
                        senderPubKey: 1,
                        srcReceiver: lockData.srcReceiver,
                        hashlock: lockData.hashlock,
                        amount: msg.amount - lockData.reward,
                        timelock: lockData.timelock,
                        jettonMasterAddress: lockData.jettonMasterAddress,
                    },
                );
                if (lockData.reward != 0) {
                    self.rewards.set(lockData.id, Reward { amount: lockData.reward, timelock: lockData.rewardTimelock });
                }
                emit(TokenLocked {
                    id: lockData.id,
                    dstChain: lockData.dstChain,
                    dstAddress: lockData.dstAddress,
                    dstAsset: lockData.dstAddress,
                    sender: msg.from,
                    srcReceiver: lockData.srcReceiver,
                    srcAsset: lockData.srcAsset,
                    amount: msg.amount - lockData.reward,
                    timelock: lockData.timelock,
                    reward: lockData.reward,
                    rewardTimelock: lockData.rewardTimelock,
                    hashlock: lockData.hashlock,
                    jettonMasterAddress: lockData.jettonMasterAddress,
                }.toCell());

                message(MessageParameters {
                    to: msg.from,
                    value: 0,
                    bounce: false,
                    mode: SendRemainingBalance,
                    body: "TRAINLockExcess".asComment(),
                });
            } else {
                message(MessageParameters {
                    to: ctx.sender,
                    value: 0,
                    bounce: false,
                    mode: SendRemainingBalance,
                    body: TokenTransfer {
                        queryId: 317164721,
                        amount: msg.amount,
                        destination: msg.from,
                        responseDestination: msg.from,
                        customPayload: null,
                        forwardTonAmount: 1,
                        forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                            .storeUint(0, 32)
                            .storeSlice("TRAINLockFailed".asSlice())
                            .endCell()).endCell().asSlice(),
                    }.toCell(),
                });
            }
        } else {
            message(MessageParameters {
                to: ctx.sender,
                value: 0,
                bounce: false,
                mode: SendRemainingBalance,
                body: TokenTransfer {
                    queryId: 832224636,
                    amount: msg.amount,
                    destination: msg.from,
                    responseDestination: msg.from,
                    customPayload: null,
                    forwardTonAmount: 1,
                    forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                        .storeUint(0, 32)
                        .storeSlice("TRAINOpCodeNotAllowed".asSlice())
                        .endCell()).endCell().asSlice(),
                }.toCell(),
            });
        }
    }

    receive(msg: AddLock) {
        require(context().value > self.storageReserve, "Storage Fee Required");
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
        require(self.contracts.exists(msg.id), "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.id)!!;
        require(sender() == htlc.sender, "No Allowance");
        require(htlc.hashlock == 1, "Hashlock Already Set");
        require(msg.timelock > (now() + 900), "Not Future Timelock");
        self.contracts.set(
            msg.id,
            HTLC {
                sender: htlc.sender,
                senderPubKey: htlc.senderPubKey,
                srcReceiver: htlc.srcReceiver,
                hashlock: msg.hashlock,
                amount: htlc.amount,
                timelock: msg.timelock,
                jettonMasterAddress: htlc.jettonMasterAddress,
            },
        );
        message(MessageParameters {
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINAddLockExcess".asComment(),
        });
    }

    receive(msg: AddLockSig) {
        require(context().value > self.storageReserve, "Storage Fee Required");
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
        require(self.contracts.exists(msg.data.preloadInt(257)) == true, "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.data.preloadInt(257))!!;
        require(checkSignature(msg.data.hash(), msg.signature, htlc.senderPubKey), "Invalid Signature");
        let id: Int = msg.data.loadInt(257);
        let hashlock: Int = msg.data.loadInt(257);
        let timelock: Int = msg.data.loadInt(257);
        require(timelock > (now() + 900), "Not Future Timelock");
        require(htlc.hashlock == 1, "Hashlock Already Set");
        self.contracts.set(
            id,
            HTLC {
                sender: htlc.sender,
                senderPubKey: htlc.senderPubKey,
                srcReceiver: htlc.srcReceiver,
                hashlock,
                amount: htlc.amount,
                timelock,
                jettonMasterAddress: htlc.jettonMasterAddress,
            },
        );
        message(MessageParameters {
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINAddLockSigExcess".asComment(),
        });
    }

    receive(msg: Redeem) {
        let ctx: Context = context();
        require(self.contracts.exists(msg.id) == true, "Contract Does Not Exist");
        require(ctx.value > self.storageReserve, "Storage Fee Required");
        let htlc: HTLC = self.contracts.get(msg.id)!!;
        let hashlockFromSecretSlice: Slice = beginCell().storeUint(msg.secret, 256).asSlice();
        let hashlockFromSecret: Int = sha256(hashlockFromSecretSlice);
        require(htlc.hashlock == hashlockFromSecret, "Hashlock Not Match");
        emit(TokenRedeemed { id: msg.id, redeemAddress: sender(), secret: msg.secret, hashlock: htlc.hashlock }.toCell());
        if (!self.rewards.exists(msg.id)) {
            nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
            message(MessageParameters {
                to: self.jettonMasterToWallet.get(htlc.jettonMasterAddress)!!,
                value: 0,
                bounce: false,
                mode: SendRemainingBalance,
                body: TokenTransfer {
                    queryId: 0x758db085,
                    amount: htlc.amount,
                    destination: htlc.srcReceiver,
                    responseDestination: ctx.sender,
                    customPayload: null,
                    forwardTonAmount: 1,
                    forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                        .storeUint(0, 32)
                        .storeSlice("TRAINRedeem".asSlice())
                        .endCell()).endCell().asSlice(),
                }.toCell(),
            });
        } else {
            let reward: Reward = Reward { amount: 0, timelock: 0 };
            reward = self.rewards.get(msg.id)!!;
            nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
            if (reward.timelock > now()) {
                message(MessageParameters {
                    to: self.jettonMasterToWallet.get(htlc.jettonMasterAddress)!!,
                    value: (ctx.value - self.storageReserve) / 2,
                    bounce: false,
                    mode: SendDefaultMode,
                    body: TokenTransfer {
                        queryId: 0x758db085,
                        amount: htlc.amount,
                        destination: htlc.srcReceiver,
                        responseDestination: ctx.sender,
                        customPayload: null,
                        forwardTonAmount: 1,
                        forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                            .storeUint(0, 32)
                            .storeSlice("TRAINRedeem".asSlice())
                            .endCell()).endCell().asSlice(),
                    }.toCell(),
                });
                message(MessageParameters {
                    to: self.jettonMasterToWallet.get(htlc.jettonMasterAddress)!!,
                    value: 0,
                    bounce: false,
                    mode: SendRemainingBalance,
                    body: TokenTransfer {
                        queryId: 0x758db90,
                        amount: reward.amount,
                        destination: htlc.sender,
                        responseDestination: ctx.sender,
                        customPayload: null,
                        forwardTonAmount: 1,
                        forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                            .storeUint(0, 32)
                            .storeSlice("TRAINRewardReturn".asSlice())
                            .endCell()).endCell().asSlice(),
                    }.toCell(),
                });
            } else {
                if (ctx.sender == htlc.srcReceiver) {
                    message(MessageParameters {
                        to: self.jettonMasterToWallet.get(htlc.jettonMasterAddress)!!,
                        value: 0,
                        bounce: false,
                        mode: SendRemainingBalance,
                        body: TokenTransfer {
                            queryId: 0x758db085,
                            amount: htlc.amount + reward.amount,
                            destination: htlc.srcReceiver,
                            responseDestination: ctx.sender,
                            customPayload: null,
                            forwardTonAmount: 1,
                            forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                                .storeUint(0, 32)
                                .storeSlice("TRAINRedeemAndReward".asSlice())
                                .endCell()).endCell().asSlice(),
                        }.toCell(),
                    });
                } else {
                    message(MessageParameters {
                        to: self.jettonMasterToWallet.get(htlc.jettonMasterAddress)!!,
                        value: (ctx.value - self.storageReserve) / 2,
                        bounce: false,
                        mode: SendDefaultMode,
                        body: TokenTransfer {
                            queryId: 0x758db085,
                            amount: htlc.amount,
                            destination: htlc.srcReceiver,
                            responseDestination: ctx.sender,
                            customPayload: null,
                            forwardTonAmount: 1,
                            forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                                .storeUint(0, 32)
                                .storeSlice("TRAINRedeem".asSlice())
                                .endCell()).endCell().asSlice(),
                        }.toCell(),
                    });
                    message(MessageParameters {
                        to: self.jettonMasterToWallet.get(htlc.jettonMasterAddress)!!,
                        value: 0,
                        bounce: false,
                        mode: SendRemainingBalance,
                        body: TokenTransfer {
                            queryId: 0x758db085,
                            amount: reward.amount,
                            destination: ctx.sender,
                            responseDestination: ctx.sender,
                            customPayload: null,
                            forwardTonAmount: 1,
                            forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                                .storeUint(0, 32)
                                .storeSlice("TRAINRedeemReward".asSlice())
                                .endCell()).endCell().asSlice(),
                        }.toCell(),
                    });
                }
            }
            let _ = self.rewards.del(msg.id);
        }
        let _ = self.contracts.del(msg.id);
    }

    receive(msg: Refund) {
        let ctx: Context = context();
        require(ctx.value > self.storageReserve, "Storage Fee Required");
        nativeReserve(self.storageReserve, ReserveAddOriginalBalance | ReserveExact | ReserveBounceIfActionFail);
        require(self.contracts.exists(msg.id), "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.id)!!;
        require(htlc.timelock < now(), "Not Passed Timelock");

        let reward: Reward = Reward { amount: 0, timelock: 0 };
        let transferedAmount: Int = htlc.amount;
        if (self.rewards.exists(msg.id)) {
            reward = self.rewards.get(msg.id)!!;
            transferedAmount += reward.amount;
        }
        message(MessageParameters {
            to: self.jettonMasterToWallet.get(htlc.jettonMasterAddress)!!,
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: TokenTransfer {
                queryId: 0xad821ef9,
                amount: transferedAmount,
                destination: htlc.sender,
                responseDestination: ctx.sender,
                customPayload: null,
                forwardTonAmount: 1,
                forwardPayload: beginCell().storeUint(1, 1).storeRef(beginCell()
                    .storeUint(0, 32)
                    .storeSlice("TRAINRefund".asSlice())
                    .endCell()).endCell().asSlice(),
            }.toCell(),
        });

        if (self.rewards.exists(msg.id)) {
            let _ = self.rewards.del(msg.id);
        }
        let _ = self.contracts.del(msg.id);
    }

    receive(msg: SupportJetton) {
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance);
        self.requireOwner();
        require(!self.jettonMasterToWallet.exists(msg.jettonMaster), "Jetton Already Supported");
        self.jettonMasterToWallet.set(msg.jettonMaster, msg.htlcJettonWallet);
        message(MessageParameters {
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINSupportJettonExcess".asComment(),
        });
    }

    receive(msg: RemoveJetton) {
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance);
        self.requireOwner();
        require(self.jettonMasterToWallet.exists(msg.jettonMaster), "Jetton Not Supported");
        let _ = self.jettonMasterToWallet.del(msg.jettonMaster);
        message(MessageParameters {
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINRemoveJettonExcess".asComment(),
        });
    }

    receive() {
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance);
        message(MessageParameters {
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINEmptyMessageNotAllowed".asComment(),
        });
    }

    receive(_: String) {
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance);
        message(MessageParameters {
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINTextMessageNotAllowed".asComment(),
        });
    }

    receive(_: Slice) {
        nativeReserve(self.storageReserve, ReserveExact | ReserveAddOriginalBalance);
        message(MessageParameters {
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINSliceMessageNotAllowed".asComment(),
        });
    }

    get fun getHTLCDetails(id: Int): HTLC? {
        return self.contracts.get(id);
    }

    get fun getContractsLength(): Int {
        let length: Int = 0;
        foreach (key, value in self.contracts) {
            length += 1;
        }
        return length;
    }

    get fun getRewardDetails(id: Int): Reward? {
        return self.rewards.get(id);
    }

    get fun getRewardsLength(): Int {
        let length: Int = 0;
        foreach (key, value in self.rewards) {
            length += 1;
        }
        return length;
    }

    get fun getHTLCJettonWalletForMaster(jettonMaster: Address): Address? {
        return self.jettonMasterToWallet.get(jettonMaster);
    }

    get fun getSupportedJettonsLength(): Int {
        let length: Int = 0;
        foreach (key, value in self.jettonMasterToWallet) {
            length += 1;
        }
        return length;
    }
}
