# Train: Permissionless, Trustless Cross-Chain Bridging Protocol

Read the protocol description and spec - [Train Documentation](https://docs.train.tech/)

## TL;DR

- Implements HTLC-based cross-chain atomic swaps with solver-provided liquidity and incentives
- Permissionless and trustless protocol without reliance on 3rd parties
- Designed to support multi-hop routing across chains (future work)
- Alpha version available for testing on multiple testnets

---

## Networks and Repository Layout

This repository is organized so that audited, stable implementations live on the `main` branch, while networks that are still under active development or audit live on dedicated branches.

### Audited networks (in `main`)

The following networks are considered stable enough to live directly in `main`:

-- **EVM (Solidity)** – [`chains/evm/solidity`](./chains/evm/solidity/)  
-- **Solana** – [`chains/solana`](./chains/solana/)  
-- **Starknet** – [`chains/starknet`](./chains/starknet/)  
-- **Fuel** – [`chains/fuel`](./chains/fuel/)

### In-progress / unaudited networks (per-branch)

The following networks are still under active development, testing, or audit.  
Each one lives in its own long-lived branch:

- **Aptos** – [`main-add-aptos`](https://github.com/TrainProtocol/contracts/tree/main-add-aptos)
- **Aztec** – [`main-add-aztec`](https://github.com/TrainProtocol/contracts/tree/main-add-aztec)
- **Bitcoin** – [`main-add-bitcoin`](https://github.com/TrainProtocol/contracts/tree/main-add-bitcoin)
- **Stacks** – [`main-add-stacks`](https://github.com/TrainProtocol/contracts/tree/main-add-stacks)
- **Sui** – [`main-add-sui`](https://github.com/TrainProtocol/contracts/tree/main-add-sui)
- **TON** – [`main-add-ton`](https://github.com/TrainProtocol/contracts/tree/main-add-ton)
- **XRP** – [`main-add-xrp`](https://github.com/TrainProtocol/contracts/tree/main-add-xrp)

---

## Introduction

Train is a revolutionary bridging protocol designed to address the challenges of seamless asset movement across the rapidly expanding cryptocurrency ecosystem. As the number of blockchain networks grows, including L1s, L2s, side-chains, and app-chains, the need for efficient and secure cross-chain asset transfer becomes critical.

## Key Features

- **Trustless**: No reliance on oracle-based systems or 3rd parties
- **Permissionless**: Open for any participant to join without compromising security
- **Multi-hop Routing (planned)**: Enables bridging between chains without direct liquidity pairs
- **Censorship Resistant**: Decentralized design resistant to censorship attempts

## Architecture

<img width="1650" height="1719" alt="htlc" src="https://github.com/user-attachments/assets/3b19eaff-77df-4a28-b25b-270e0e3587db" />

## How It Works

Train uses hash time-locked contracts (HTLCs) to coordinate trustless swaps between users and solvers.

1. The user creates a lock on the source chain using a hashlock.
2. A solver creates a corresponding lock on the destination chain using the same hashlock.
3. The recipient redeems the destination lock by revealing the secret.
4. The same secret is used to redeem the source-chain lock.
5. If a swap does not complete before the timelock, funds can be refunded.

This design ensures that funds are either redeemed with the correct secret or safely refunded after timeout.

## Disclaimer: Development in Progress

Please note that this project is actively under development. It is not ready for deployment on any mainnet environments, unless mentioned as audited.
As we continue to experiment and test new ideas, expect significant changes to the interface. Please be prepared for ongoing modifications.

## Acknowledgements

- The initial HTLC implementation was based on the work done in the [atomic-port](https://github.com/ymuichiro/atomic-port) project by Yuki Uichiro
