# Train: Permissionless, Trustless Cross-Chain Bridging Protocol

Read the protocol description and spec - [Train Documentation](https://docs.train.tech/)

## TL;DR

- Introduces Train, an improved version of HTLC for practical atomic swaps
- Permissionless and trustless protocol without reliance on 3rd parties
- Supports multi-hop transactions for bridging between indirectly connected chains
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
- **Multi-hop Transactions**: Enables bridging between chains without direct Solver connections
- **Censorship Resistant**: Decentralized design resistant to censorship attempts

## Architecture

<img width="2312" alt="Diagram 1" src="https://github.com/user-attachments/assets/d004b399-bbe8-4138-ab01-56b8ee5a06c9" />

## How It Works

Train introduces an improved version of HTLC that addresses key limitations:

1. User creates a PreHTLC, committing funds for the selected Solver
2. Solver detects the transaction, generates a Secret, and creates an HTLC on the destination chain
3. User observes the destination transaction and converts their PreHTLC to an HTLC on the source chain
4. Solver reveals the Secret on both chains to complete the transfer

This approach resolves issues with secret management, claim transactions on the destination chain, and liveness requirements.

## Disclaimer: Development in Progress

Please note that this project is actively under development. It is not ready for deployment on any mainnet environments, unless mentioned as audited.
As we continue to experiment and test new ideas, expect significant changes to the interface. Please be prepared for ongoing modifications.

## Acknowledgements

- The initial HTLC implementation was based on the work done in the [atomic-port](https://github.com/ymuichiro/atomic-port) project by Yuki Uichiro
