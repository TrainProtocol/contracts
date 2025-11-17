//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

// Lock object
struct HTLC {
    sender: Address;
    senderPubKey: Int;
    srcReceiver: Address;
    hashlock: Int;
    amount: Int as coins;
    timelock: Int;
}
// Reward object
struct Reward {
    amount: Int as coins;
    timelock: Int;
}
// Messages received by contract
message(0x1b564d91) Commit {
    dstChain: String;
    dstAsset: String;
    dstAddress: String;
    srcAsset: String;
    id: Int;
    amount: Int as coins;
    srcReceiver: Address;
    timelock: Int;
    senderPubKey: Int;
    hopChains: map<Int, StringImpl>;
    hopAssets: map<Int, StringImpl>;
    hopAddresses: map<Int, StringImpl>;
}
message(0x5cdd41d9) AddLock {
    id: Int;
    hashlock: Int;
    timelock: Int;
}
message(0xc1d818ff) AddLockSig {
    data: Slice;
    signature: Slice;
}
message(0x12e78cb1) Lock {
    id: Int;
    hashlock: Int;
    timelock: Int;
    amount: Int as coins;
    reward: Int as coins;
    rewardTimelock: Int;
    srcReceiver: Address;
    srcAsset: String;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
}
message(0x758db085) Redeem {
    id: Int;
    secret: Int;
}
message(0xad821ef9) Refund {
    id: Int;
}
// Emitted messages
message(0x71f9f7aa) TokenCommitted {
    id: Int;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
    sender: Address;
    srcReceiver: Address;
    srcAsset: String;
    amount: Int as coins;
    timelock: Int;
    senderPubKey: Int;
    hopChains: map<Int, StringImpl>;
    hopAssets: map<Int, StringImpl>;
    hopAddresses: map<Int, StringImpl>;
}
message(0x95b0219d) TokenLocked {
    id: Int;
    hashlock: Int;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
    sender: Address;
    srcReceiver: Address;
    srcAsset: String;
    amount: Int as coins;
    timelock: Int;
    reward: Int as coins;
    rewardTimelock: Int;
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
contract Train {
    override const storageReserve: Int = 100000; // Reserve part of each incoming interaction to cover the contract’s on-chain storage fees

    contracts: map<Int, HTLC>;
    rewards: map<Int, Reward>;

    receive(msg: Commit) {
        let ctx: Context = context();
        require(ctx.value > msg.amount + self.storageReserve && msg.amount != 0, "Funds Not Sent");
        nativeReserve(msg.amount + self.storageReserve, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
        require(msg.timelock > (now() + 900), "Not Future Timelock");
        require(!self.contracts.exists(msg.id), "Contract Already Exists");
        self.contracts.set(
            msg.id,
            HTLC {
                sender: ctx.sender,
                senderPubKey: msg.senderPubKey,
                srcReceiver: msg.srcReceiver,
                hashlock: 1,
                amount: msg.amount,
                timelock: msg.timelock,
            },
        );
        emit(TokenCommitted {
            id: msg.id,
            dstChain: msg.dstChain,
            dstAddress: msg.dstAddress,
            dstAsset: msg.dstAsset,
            sender: ctx.sender,
            srcReceiver: msg.srcReceiver,
            srcAsset: msg.srcAsset,
            amount: msg.amount,
            timelock: msg.timelock,
            senderPubKey: msg.senderPubKey,
            hopChains: msg.hopChains,
            hopAssets: msg.hopAssets,
            hopAddresses: msg.hopAddresses,
        }.toCell());

        message(MessageParameters {
            to: ctx.sender,
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINCommitExcess".asComment(),
        });
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
        require(htlc.hashlock == 1, "Hashlock Already Set");
        require(timelock > (now() + 900), "Not Future Timelock");
        self.contracts.set(
            id,
            HTLC {
                sender: htlc.sender,
                senderPubKey: htlc.senderPubKey,
                srcReceiver: htlc.srcReceiver,
                hashlock,
                amount: htlc.amount,
                timelock,
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

    receive(msg: Lock) {
        let ctx: Context = context();
        require(ctx.value > (msg.amount + msg.reward + self.storageReserve) && msg.amount != 0, "Funds Not Sent");
        nativeReserve(msg.amount + msg.reward + self.storageReserve, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
        require(!self.contracts.exists(msg.id), "Contract Already Exists");
        require((now() + 1800) < msg.timelock, "Not Future Timelock");
        require(msg.rewardTimelock < msg.timelock && msg.rewardTimelock > now(), "Invalid Reward Timelock");
        self.contracts.set(
            msg.id,
            HTLC {
                sender: ctx.sender,
                senderPubKey: 1, // as after locking it cant be used for AddLockSig
                srcReceiver: msg.srcReceiver,
                hashlock: msg.hashlock,
                amount: msg.amount,
                timelock: msg.timelock,
            },
        );
        if (msg.reward != 0) {
            self.rewards.set(msg.id, Reward { amount: msg.reward, timelock: msg.rewardTimelock });
        }
        emit(TokenLocked {
            id: msg.id,
            hashlock: msg.hashlock,
            dstChain: msg.dstChain,
            dstAddress: msg.dstAddress,
            dstAsset: msg.dstAsset,
            sender: ctx.sender,
            srcReceiver: msg.srcReceiver,
            srcAsset: msg.srcAsset,
            amount: msg.amount,
            timelock: msg.timelock,
            reward: msg.reward,
            rewardTimelock: msg.rewardTimelock,
        }.toCell());

        message(MessageParameters {
            to: ctx.sender,
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINLockExcess".asComment(),
        });
    }

    receive(msg: Redeem) {
        require(self.contracts.exists(msg.id), "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.id)!!;
        let hashlockFromSecretSlice: Slice = beginCell().storeUint(msg.secret, 256).asSlice();
        let hashlockFromSecret: Int = sha256(hashlockFromSecretSlice);
        require(htlc.hashlock == hashlockFromSecret, "Hashlock Not Match");
        emit(TokenRedeemed { id: msg.id, redeemAddress: sender(), secret: msg.secret, hashlock: htlc.hashlock }.toCell());
        if (!self.rewards.exists(msg.id)) {
            nativeReserve(myBalance() + self.storageReserve - context().value - htlc.amount, ReserveExact | ReserveBounceIfActionFail);
            message(MessageParameters { to: htlc.srcReceiver, bounce: false, value: htlc.amount, mode: SendPayFwdFeesSeparately, body: "TRAINRedeem".asComment() });
            message(MessageParameters {
                to: sender(),
                value: 0,
                bounce: false,
                mode: SendRemainingBalance,
                body: "TRAINRedeemExcess".asComment(),
            });
        } else {
            let reward: Reward = Reward { amount: 0, timelock: 0 };
            reward = self.rewards.get(msg.id)!!;
            nativeReserve(myBalance() + self.storageReserve - context().value - htlc.amount - reward.amount, ReserveExact | ReserveBounceIfActionFail);
            if (reward.timelock > now()) {
                message(MessageParameters { to: htlc.srcReceiver, bounce: false, value: htlc.amount, mode: SendPayFwdFeesSeparately, body: "TRAINRedeem".asComment() });
                message(MessageParameters {
                    to: htlc.sender,
                    value: reward.amount,
                    bounce: false,
                    mode: SendPayFwdFeesSeparately,
                    body: "TRAINRewardReturn".asComment(),
                });
                message(MessageParameters {
                    to: sender(),
                    value: 0,
                    bounce: false,
                    mode: SendRemainingBalance,
                    body: "TRAINRedeemExcess".asComment(),
                });
            } else {
                if (sender() == htlc.srcReceiver) {
                    message(MessageParameters {
                        to: htlc.srcReceiver,
                        bounce: false,
                        value: htlc.amount + reward.amount,
                        mode: SendRemainingBalance,
                        body: "TRAINRedeemAndReward".asComment(),
                    });
                } else {
                    message(MessageParameters { to: htlc.srcReceiver, bounce: false, value: htlc.amount, mode: SendPayFwdFeesSeparately, body: "TRAINRedeem".asComment() });
                    message(MessageParameters {
                        to: sender(),
                        value: reward.amount,
                        bounce: false,
                        mode: SendRemainingBalance,
                        body: "TRAINRedeemReward".asComment(),
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
        require(self.contracts.exists(msg.id), "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.id)!!;
        require(htlc.timelock < now(), "Not Passed Timelock");
        if (self.rewards.exists(msg.id)) {
            let reward: Reward = Reward { amount: 0, timelock: 0 };
            reward = self.rewards.get(msg.id)!!;
            nativeReserve(myBalance() + self.storageReserve - ctx.value - htlc.amount - reward.amount, ReserveExact | ReserveBounceIfActionFail);
            message(MessageParameters { to: htlc.sender, bounce: false, value: htlc.amount + reward.amount, mode: SendPayFwdFeesSeparately, body: "TRAINRefund".asComment() });
            let _ = self.rewards.del(msg.id);
        } else {
            nativeReserve(myBalance() + self.storageReserve - ctx.value - htlc.amount, ReserveExact | ReserveBounceIfActionFail);
            message(MessageParameters { to: htlc.sender, bounce: false, value: htlc.amount, mode: SendPayFwdFeesSeparately, body: "TRAINRefund".asComment() });
        }
        message(MessageParameters {
            to: ctx.sender,
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
            body: "TRAINRefundExcess".asComment(),
        });
        let _ = self.contracts.del(msg.id);
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
}
