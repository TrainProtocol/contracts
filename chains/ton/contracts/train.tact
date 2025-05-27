//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

import "@stdlib/deploy";

// Lock object
struct HTLC {
    sender: Address;
    senderPubKey: Int;
    srcReceiver: Address;
    secret: Int;
    hashlock: Int;
    amount: Int;
    timelock: Int;
    claimed: Int;
}
// Reward object
struct Reward {
    amount: Int;
    timelock: Int;
}
// Messages received by contract
message(0x1b564d91) Commit {
    dstChain: String;
    dstAsset: String;
    dstAddress: String;
    srcAsset: String;
    Id: Int;
    amount: Int;
    srcReceiver: Address;
    timelock: Int;
    senderPubKey: Int;
    hopChains: map<Int, StringImpl>;
    hopAssets: map<Int, StringImpl>;
    hopAddresses: map<Int, StringImpl>;
}
message(0x5cdd41d9) AddLock {
    Id: Int;
    hashlock: Int;
    timelock: Int;
}
message(0xc1d818ff) AddLockSig {
    data: Slice;
    signature: Slice;
}
message(0x12e78cb1) Lock {
    Id: Int;
    hashlock: Int;
    timelock: Int;
    amount: Int;
    reward: Int;
    rewardTimelock: Int;
    srcReceiver: Address;
    srcAsset: String;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
}
message(0x758db085) Redeem {
    Id: Int;
    secret: Int;
}
message(0xad821ef9) Refund {
    Id: Int;
}
message(0xd53276db) Excesses {}
// Emitted messages
message(0x71f9f7aa) TokenCommitted {
    Id: Int;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
    sender: Address;
    srcReceiver: Address;
    srcAsset: String;
    amount: Int;
    timelock: Int;
    senderPubKey: Int;
    hopChains: map<Int, StringImpl>;
    hopAssets: map<Int, StringImpl>;
    hopAddresses: map<Int, StringImpl>;
}
message(0x95b0219d) TokenLocked {
    Id: Int;
    hashlock: Int;
    dstChain: String;
    dstAddress: String;
    dstAsset: String;
    sender: Address;
    srcReceiver: Address;
    srcAsset: String;
    amount: Int;
    timelock: Int;
    reward: Int;
    rewardTimelock: Int;
}
message(0x6564cfc9) TokenRedeemed {
    Id: Int;
    redeemAddress: Address;
    secret: Int;
    hashlock: Int;
}
// String implementation as struct
struct StringImpl {
    data: String;
}

contract Train with Deployable {
    contracts: map<Int, HTLC>;
    rewards: map<Int, Reward>;

    receive(msg: Commit) {
        nativeReserve(msg.amount, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);

        emit(Refund { Id: myBalance() }.toCell());
        let ctx: Context = context();
        nativeReserve((myBalance() - ctx.value) + msg.amount, 0);
        require(ctx.value > msg.amount, "Funds Not Sent");
        require(msg.timelock > (now() + 900), "Not Future Timelock");
        require(!self.contracts.exists(msg.Id), "Contract Already Exists");
        self.contracts.set(
            msg.Id,
            HTLC {
                sender: ctx.sender,
                senderPubKey: msg.senderPubKey,
                srcReceiver: msg.srcReceiver,
                secret: 1,
                hashlock: 1,
                amount: msg.amount,
                timelock: msg.timelock,
                claimed: 1,
            },
        );
        emit(TokenCommitted {
            Id: msg.Id,
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
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingBalance,
        });
    }

    receive(msg: AddLock) {
        require(self.contracts.exists(msg.Id) == true, "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.Id)!!;
        let ctx: Context = context();
        require(sender() == htlc.sender, "No Allowance");
        require(htlc.claimed == 1, "Already Claimed");
        require(htlc.hashlock == 1, "Hashlock Already Set");
        require(msg.timelock > (now() + 900), "Not Future Timelock");
        self.contracts.set(
            msg.Id,
            HTLC {
                sender: htlc.sender,
                senderPubKey: htlc.senderPubKey,
                srcReceiver: htlc.srcReceiver,
                secret: 1,
                hashlock: msg.hashlock,
                amount: htlc.amount,
                timelock: msg.timelock,
                claimed: 1,
            },
        );
        send(SendParameters {
            to: sender(),
            value: 0,
            mode: SendRemainingValue | SendIgnoreErrors,
            body: Excesses {}.toCell(),
        });
    }

    receive(msg: AddLockSig) {
        require(self.contracts.exists(msg.data.preloadInt(257)) == true, "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.data.preloadInt(257))!!;
        require(checkSignature(msg.data.hash(), msg.signature, htlc.senderPubKey), "Invalid signature");
        let Id: Int = msg.data.loadInt(257);
        let hashlock: Int = msg.data.loadInt(257);
        let timelock: Int = msg.data.loadInt(257);
        require(htlc.claimed == 1, "Already Claimed");
        require(htlc.hashlock == 1, "Hashlock Already Set");
        require(timelock > (now() + 900), "Not Future Timelock");
        self.contracts.set(
            Id,
            HTLC {
                sender: htlc.sender,
                senderPubKey: htlc.senderPubKey,
                srcReceiver: htlc.srcReceiver,
                secret: 1,
                hashlock,
                amount: htlc.amount,
                timelock,
                claimed: 1,
            },
        );
        send(SendParameters {
            to: sender(),
            value: 0,
            mode: SendRemainingValue | SendIgnoreErrors,
            body: Excesses {}.toCell(),
        });
    }

    receive(msg: Lock) {
        let ctx: Context = context();
        require(ctx.value >= (msg.amount + msg.reward) && msg.amount != 0, "Funds Not Sent");
        require(!self.contracts.exists(msg.Id), "Contract Already Exists");
        require((now() + 1800) < msg.timelock, "Not Future Timelock");
        require(msg.rewardTimelock < msg.timelock && msg.rewardTimelock > now(), "Invalid Reward Timelock");
        self.contracts.set(
            msg.Id,
            HTLC {
                sender: ctx.sender,
                senderPubKey: 1, // as after locking it cant be used for AddLockSig
                srcReceiver: msg.srcReceiver,
                secret: 1,
                hashlock: msg.hashlock,
                amount: msg.amount,
                timelock: msg.timelock,
                claimed: 1,
            },
        );
        if (msg.reward != 0) {
            self.rewards.set(msg.Id, Reward { amount: msg.reward, timelock: msg.rewardTimelock });
        }
        emit(TokenLocked {
            Id: msg.Id,
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
        nativeReserve(((myBalance() - ctx.value) + msg.amount) + msg.reward, 0);
        send(SendParameters { to: sender(), value: 0, mode: SendRemainingBalance, body: Excesses {}.toCell() });
    }

    receive(msg: Redeem) {
        require(self.contracts.exists(msg.Id), "Contract Does Not Exist");
        let htlc: HTLC = self.contracts.get(msg.Id)!!;
        // this check can be removed as after redeem or refund HTLC is deleted
        require(htlc.claimed == 1, "Already Claimed");
        let hashlockFromSecretSlice: Slice = beginCell().storeUint(msg.secret, 256).asSlice();
        let hashlockFromSecret: Int = sha256(hashlockFromSecretSlice);
        require(htlc.hashlock == hashlockFromSecret, "Hashlock Not Match");
        emit(TokenRedeemed { Id: msg.Id, redeemAddress: sender(), secret: msg.secret, hashlock: htlc.hashlock }.toCell());
        if (!self.rewards.exists(msg.Id)) {
            send(SendParameters { to: htlc.srcReceiver, bounce: false, value: htlc.amount, mode: 0 });
            send(SendParameters {
                to: sender(),
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: Excesses {}.toCell(),
            });
        } else {
            let reward: Reward = Reward { amount: 0, timelock: 0 };
            reward = self.rewards.get(msg.Id)!!;
            if (reward.timelock > now()) {
                send(SendParameters { to: htlc.srcReceiver, bounce: false, value: htlc.amount, mode: 0 });
                send(SendParameters {
                    to: htlc.sender,
                    value: reward.amount,
                    mode: SendRemainingValue | SendIgnoreErrors,
                    body: Excesses {}.toCell(),
                });
            } else {
                if (sender() == htlc.srcReceiver) {
                    send(SendParameters {
                        to: htlc.srcReceiver,
                        bounce: false,
                        value: htlc.amount + reward.amount,
                        mode: SendRemainingValue | SendIgnoreErrors,
                    });
                } else {
                    send(SendParameters { to: htlc.srcReceiver, bounce: false, value: htlc.amount, mode: 0 });
                    send(SendParameters {
                        to: sender(),
                        value: reward.amount,
                        mode: SendRemainingValue | SendIgnoreErrors,
                        body: Excesses {}.toCell(),
                    });
                }
            }
            self.rewards.del(msg.Id);
        }
        self.contracts.del(msg.Id);
    }

    receive(msg: Refund) {
        let htlc: HTLC = self.contracts.get(msg.Id)!!;
        require(self.contracts.exists(msg.Id), "Contract Does Not Exist");
        //this check can be removed as after refund and redeem HTLC is deleted
        require(htlc.claimed == 1, "Already Claimed");
        require(htlc.timelock < now(), "Not Passed Timelock");
        if (self.rewards.exists(msg.Id)) {
            let reward: Reward = Reward { amount: 0, timelock: 0 };
            reward = self.rewards.get(msg.Id)!!;
            send(SendParameters { to: htlc.sender, bounce: false, value: htlc.amount + reward.amount, mode: 0 });
            self.rewards.del(msg.Id);
        } else {
            send(SendParameters { to: htlc.sender, bounce: false, value: htlc.amount, mode: 0 });
        }
        // tx sender will get remainig amount after msg processing
        send(SendParameters {
            to: sender(),
            value: 0,
            mode: SendRemainingValue | SendIgnoreErrors,
            body: Excesses {}.toCell(),
        });
        self.contracts.del(msg.Id);
    }

    get fun getHTLCDetails(Id: Int): HTLC? {
        return self.contracts.get(Id);
    }

    get fun getContractsLength(): Int {
        let length: Int = 0;
        foreach (key, value in self.contracts) {
            length += 1;
        }
        return length;
    }

    get fun getRewardDetails(Id: Int): Reward? {
        return self.rewards.get(Id);
    }

    get fun getRewardsLength(): Int {
        let length: Int = 0;
        foreach (key, value in self.rewards) {
            length += 1;
        }
        return length;
    }
}
