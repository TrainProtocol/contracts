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

## Gas Estimates

> _The following gas usage was measured from Hardhat tests on both native ETH and ERC20 implementations._  
> _All values are for "typical" single-hop cases, without reward unless specified._

### Native Token (ETH)

| Function     | Description                                 | Gas Used (Typical, hop depth = 0) |
|--------------|---------------------------------------------|-----------------------------------|
| commit       | Open HTLC (no hashlock)                     | ~149,581                          |
| lock         | Open HTLC (with hashlock, no reward)        | ~148,214                          |
| addLock      | Add hashlock/timelock to open HTLC          | ~39,456                           |
| addLockSig   | Add hashlock/timelock via EIP-712 signature | ~47,626                           |
| redeem       | Redeem funds (no reward)                    | ~52,706                           |
| refund       | Refund sender (no reward)                   | ~44,066                           |

_Values are from Hardhat test suite (`test/native.js`).  
Real-world usage may differ with input size, hop depth, reward, etc._

### ERC20 Token

| Function     | Description                                 | Gas Used (Typical, hop depth = 0) |
|--------------|---------------------------------------------|-----------------------------------|
| commit       | Open HTLC (no hashlock)                     | ~212,908                          |
| lock         | Open HTLC (with hashlock, no reward)        | ~213,931                          |
| addLock      | Add hashlock/timelock to open HTLC          | ~39,503                           |
| addLockSig   | Add hashlock/timelock via EIP-712 signature | ~47,721                           |
| redeem       | Redeem funds (no reward)                    | ~63,610                           |
| refund       | Refund sender (no reward)                   | ~48,055                           |

_Values from Hardhat test suite (`test/erc20.js`).  
ERC20 operations require allowance and token transfer, so are generally higher than native._


## Usage

Deploy with Solidity `0.8.23` and OpenZeppelin. Use Hardhat, Foundry, or Remix.

## Security

- Use **secure hash functions** (`sha256`).
- Set **appropriate timelock durations**.
- Sign off-chain messages with **secure private keys**.

## License

Released under **MIT License**.
