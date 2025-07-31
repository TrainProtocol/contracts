# Train Contract

## Overview

The **Train Contract** enables secure, atomic cross-chain swaps.

## Features

- **Secure Swaps**: Trustless cross-chain transactions.
- **EIP-712 Signatures**: Off-chain message verification.
- **Event-Based Tracking**: Real-time updates.
- **Timelock & Hashlock**: Ensures safe fund handling.

## Functions

- **commit(...)** - Lock funds.
- **lock(...)** - Lock funds with a hashlock.
- **addLock(...)** - Update an HTLC with a new hashlock and timelock.
- **addLockSig(...)** - Add a hashlock using a signed message.
- **redeem(Id, secret)** - Claim funds with a secret.
- **refund(Id)** - Reclaim expired funds.

## Events

- `TokenCommitted`: Funds locked.
- `TokenLocked`: Hashlock added.
- `TokenLockAdded`: Additional lock applied.
- `TokenRedeemed`: Swap completed.
- `TokenRefunded`: Funds refunded.

## Gas Estimates (Native Token)

> _The following gas usage was measured from Hardhat tests on the native ETH implementation._


| Function     | Description                                 | Gas Used (Typical, hop depth = 1) |
|--------------|---------------------------------------------|-----------------------------------|
| commit       | Open HTLC (no hashlock)                     | ~155,255                          |
| lock         | Open HTLC (with hashlock, no reward)        | ~148,214                          |
| addLock      | Add hashlock/timelock to open HTLC          | ~39,456                           |
| addLockSig   | Add hashlock/timelock via EIP-712 signature | ~47,626                           |
| redeem       | Redeem funds (no reward)                    | ~52,706                           |
| refund       | Refund sender (no reward)                   | ~44,066                           |

_Values are from Hardhat test suite (`test/native.js`).  
Real-world values depend on chain state and input complexity (e.g., hop depth, reward, etc)._

## Usage

Deploy with Solidity `0.8.23` and OpenZeppelin. Use Hardhat, Foundry, or Remix.

## Security

- Use **secure hash functions** (`sha256`).
- Set **appropriate timelock durations**.
- Sign off-chain messages with **secure private keys**.

## License

Released under **MIT License**.
