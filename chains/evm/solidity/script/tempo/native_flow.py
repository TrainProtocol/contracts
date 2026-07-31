#!/usr/bin/env python3
"""Native, batched, sponsored gasless flow for Train on Tempo -- the pattern that replaces
TrainRouter on this chain (see ../../README.md trust assumption 9).

`lock`: one Tempo Transaction batches [pathUSD.approve(train, amount), train.userLock(...)].
`redeem`: one Tempo Transaction wraps train.redeemUser(hashlock, secret) alone (no batching
needed -- redeem doesn't require a prior approval). In both modes the sender signs fully
offline; a separate fee-payer counter-signs and broadcasts, covering gas. Calls execute with
msg.sender == the real sender (confirmed at source in crates/revm/src/handler.rs's
execute_multi_call_with -- the caller is never reassigned across a batch, and one outer
checkpoint wraps the whole thing, reverting entirely on any failure).

Requires: pip install pytempo web3 eth-account

cast's `-tempo` nightly build (foundryup -n tempo) has a reproducible bug where
`batch-send`/`send` silently drop --tempo.sponsor-signature -- don't use cast for anything
involving a fee-payer signature. This script is the actual working path.

Usage:
    python native_flow.py lock \
        --train 0xYourDeployedTrainAddress \
        --sender-key 0xSenderPrivateKey --fee-payer-key 0xFeePayerPrivateKey \
        --amount 10000 --rpc https://rpc.moderato.tempo.xyz
    # prints a secret + hashlock -- save both, then:
    python native_flow.py redeem \
        --train 0xYourDeployedTrainAddress \
        --sender-key 0xSenderPrivateKey --fee-payer-key 0xFeePayerPrivateKey \
        --secret <secret from lock step> --rpc https://rpc.moderato.tempo.xyz

Both the sender and fee-payer addresses need a pathUSD balance beforehand -- the sender needs at
least `--amount` for `lock` (redeem needs nothing from the sender), the fee-payer needs enough to
cover gas in both cases. Fund both via the faucet first:
    curl -X POST https://tempo.xyz/developers/api/faucet -H "Content-Type: application/json" \
        -d '{"address": "0xYourAddress"}'
"""

import argparse
import hashlib
import secrets

from eth_account import Account
from pytempo import Call, TempoTransaction
from web3 import Web3

PATH_USD = "0x20C0000000000000000000000000000000000000"  # 6 decimals, same on testnet + mainnet

PATH_USD_ABI = [
    {
        "name": "approve",
        "type": "function",
        "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
]

# Mirrors src/tempo/Train.sol's UserLockParams / DestinationInfo / UserLock struct layout
# exactly -- field order and types must match, or the ABI encoding silently misaligns.
TRAIN_ABI = [
    {
        "name": "userLock",
        "type": "function",
        "inputs": [
            {
                "name": "params",
                "type": "tuple",
                "components": [
                    {"name": "hashlock", "type": "bytes32"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "rewardAmount", "type": "uint256"},
                    {"name": "timelockDelta", "type": "uint48"},
                    {"name": "rewardTimelockDelta", "type": "uint48"},
                    {"name": "quoteExpiry", "type": "uint48"},
                    {"name": "recipient", "type": "address"},
                    {"name": "refundTo", "type": "address"},
                    {"name": "token", "type": "address"},
                    {"name": "payoutCurve", "type": "address"},
                    {"name": "payoutCurveData", "type": "bytes"},
                    {"name": "rewardToken", "type": "string"},
                    {"name": "rewardRecipient", "type": "string"},
                    {"name": "srcChain", "type": "string"},
                ],
            },
            {
                "name": "dst",
                "type": "tuple",
                "components": [
                    {"name": "dstChain", "type": "string"},
                    {"name": "dstAddress", "type": "string"},
                    {"name": "dstAmount", "type": "uint256"},
                    {"name": "dstToken", "type": "string"},
                ],
            },
            {"name": "userData", "type": "bytes"},
            {"name": "solverData", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "name": "redeemUser",
        "type": "function",
        "inputs": [{"name": "hashlock", "type": "bytes32"}, {"name": "secret", "type": "uint256"}],
        "outputs": [],
    },
    {
        "name": "getUserLock",
        "type": "function",
        "inputs": [{"name": "hashlock", "type": "bytes32"}],
        "outputs": [
            {
                "name": "",
                "type": "tuple",
                "components": [
                    {"name": "secret", "type": "uint256"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "sender", "type": "address"},
                    {"name": "timelock", "type": "uint48"},
                    {"name": "startTime", "type": "uint48"},
                    {"name": "status", "type": "uint8"},
                    {"name": "recipient", "type": "address"},
                    {"name": "refundTo", "type": "address"},
                    {"name": "token", "type": "address"},
                    {"name": "payoutCurve", "type": "address"},
                    {"name": "payoutCurveData", "type": "bytes"},
                ],
            }
        ],
    },
]

# Measured on real Moderato testnet (not estimated): a first-ever `lock` from a fresh account
# actually cost 2,107,473 gas end to end -- far more than a naive TIP-1000 estimate suggests,
# because `UserLock` is an 8-slot struct and *every* slot that goes zero->nonzero on a brand-new
# lock (amount, the packed {sender,timelock,startTime} slot, the packed {status,recipient} slot,
# refundTo, token) pays its own 250,000-gas state-creation charge -- on top of the fresh pathUSD
# allowance slot, Train's first-ever pathUSD balance credit, and the user's lock-history array
# write. A local `cast run`/revm trace only shows ~300k of *regular* execution gas and misses all
# of this state-creation gas entirely, so it will look fine locally right up until the real chain
# rejects it out of gas. `redeem` touches no new slots (just flips an existing status byte and
# moves already-existing balances) so it's dramatically cheaper -- budget accordingly per mode.
LOCK_GAS_LIMIT = 3_000_000
REDEEM_GAS_LIMIT = 1_000_000


def _send_sponsored(w3, sender, fee_payer, calls, gas_limit):
    tx = TempoTransaction.create(
        chain_id=w3.eth.chain_id,
        gas_limit=gas_limit,
        max_fee_per_gas=w3.eth.gas_price * 2,
        max_priority_fee_per_gas=w3.eth.gas_price,
        nonce=w3.eth.get_transaction_count(sender.address),
        fee_token=PATH_USD,
        awaiting_fee_payer=True,  # a distinct fee-payer will co-sign below -- required, not optional
        calls=calls,
    )
    sender_signed = tx.sign(sender.key.hex())
    fully_signed = sender_signed.sign(fee_payer.key.hex(), for_fee_payer=True)
    tx_hash = w3.eth.send_raw_transaction(fully_signed.encode())
    print(f"\nbroadcast tx : {tx_hash.hex()}")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print(f"status       : {receipt.status} (1 = success)")
    print(f"gasUsed      : {receipt.gasUsed}")
    print(f"feePayer     : {receipt.get('feePayer', '?')} (should equal fee-payer, not sender)")
    return receipt


def cmd_lock(args, w3, sender, fee_payer, train, path_usd):
    print(f"sender pathUSD balance    : {path_usd.functions.balanceOf(sender.address).call()}")
    print(f"fee-payer pathUSD balance : {path_usd.functions.balanceOf(fee_payer.address).call()}")

    secret = secrets.randbits(256)  # fresh random secret per run so hashlocks never collide
    hashlock = hashlib.sha256(secret.to_bytes(32, "big")).digest()
    quote_expiry = w3.eth.get_block("latest")["timestamp"] + 600

    approve_data = path_usd.encode_abi(abi_element_identifier="approve", args=[args.train, args.amount])
    user_lock_params = (
        hashlock, args.amount, 0, args.timelock_delta, args.timelock_delta // 2, quote_expiry,
        sender.address, sender.address, PATH_USD,  # recipient, refundTo, token
        "0x0000000000000000000000000000000000000000", b"",  # payoutCurve, payoutCurveData
        "pathUSD", "", "TEMPO",  # rewardToken, rewardRecipient, srcChain (informational)
    )
    dst_info = ("TEMPO", "self", args.amount, "pathUSD")
    user_lock_data = train.encode_abi(abi_element_identifier="userLock", args=[user_lock_params, dst_info, b"", b""])

    _send_sponsored(
        w3, sender, fee_payer,
        (Call.create(to=PATH_USD, data=approve_data), Call.create(to=args.train, data=user_lock_data)),
        args.gas_limit,
    )

    lock = train.functions.getUserLock(hashlock).call()
    print(f"lock.sender  : {lock[2]} (should equal sender: {sender.address})")
    print(f"lock.amount  : {lock[1]}")
    print(f"lock.status  : {lock[5]} (1 = Pending)")
    print(f"\nsecret (save for the redeem step): {secret}")
    print(f"hashlock: 0x{hashlock.hex()}")


def cmd_redeem(args, w3, sender, fee_payer, train, path_usd):
    hashlock = hashlib.sha256(args.secret.to_bytes(32, "big")).digest()
    bal_before = path_usd.functions.balanceOf(sender.address).call()
    print(f"sender pathUSD balance before: {bal_before}")

    redeem_data = train.encode_abi(abi_element_identifier="redeemUser", args=[hashlock, args.secret])
    _send_sponsored(w3, sender, fee_payer, (Call.create(to=args.train, data=redeem_data),), args.gas_limit)

    bal_after = path_usd.functions.balanceOf(sender.address).call()
    lock = train.functions.getUserLock(hashlock).call()
    print(f"sender pathUSD balance after : {bal_after} (delta: {bal_after - bal_before}, gas cost: 0 to sender)")
    print(f"lock.status  : {lock[5]} (3 = Redeemed)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--train", required=True, help="deployed src/tempo/Train.sol address")
    common.add_argument("--sender-key", required=True, help="sender private key (0x-hex)")
    common.add_argument("--fee-payer-key", required=True, help="fee-payer private key (0x-hex) -- pays gas")
    common.add_argument("--rpc", default="https://rpc.moderato.tempo.xyz", help="Tempo RPC endpoint")

    lock_p = sub.add_parser("lock", parents=[common], help="batched approve+userLock, sponsored")
    lock_p.add_argument("--amount", type=int, default=10_000, help="pathUSD amount, 6dp (default 0.01)")
    lock_p.add_argument("--timelock-delta", type=int, default=3600, help="seconds until refundable")
    lock_p.add_argument("--gas-limit", type=int, default=LOCK_GAS_LIMIT)

    redeem_p = sub.add_parser("redeem", parents=[common], help="redeemUser, sponsored")
    redeem_p.add_argument("--secret", type=int, required=True, help="secret printed by the lock step")
    redeem_p.add_argument("--gas-limit", type=int, default=REDEEM_GAS_LIMIT)

    args = p.parse_args()

    w3 = Web3(Web3.HTTPProvider(args.rpc))
    sender = Account.from_key(args.sender_key)
    fee_payer = Account.from_key(args.fee_payer_key)
    train = w3.eth.contract(address=Web3.to_checksum_address(args.train), abi=TRAIN_ABI)
    path_usd = w3.eth.contract(address=Web3.to_checksum_address(PATH_USD), abi=PATH_USD_ABI)

    print(f"chain id  : {w3.eth.chain_id}")
    print(f"sender    : {sender.address}")
    print(f"fee payer : {fee_payer.address}")

    if args.mode == "lock":
        cmd_lock(args, w3, sender, fee_payer, train, path_usd)
    else:
        cmd_redeem(args, w3, sender, fee_payer, train, path_usd)


if __name__ == "__main__":
    main()
