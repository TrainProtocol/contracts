# Train: Permissionless, Trustless Cross-Chain Bridging Protocol

Read the protocol description and sepc [draft] - [Train Documentation](https://docs.train.tech/)

## TL;DR

- Introduces Train, an improved version of HTLC for practical atomic swaps
- Permissionless and trustless protocol without reliance on 3rd parties
- Supports multi-hop transactions for bridging between indirectly connected chains
- Alpha version available for testing on multiple testnets

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

Train introduces, an improved version of HTLC that addresses key limitations:

1. User creates a PreHTLC, committing funds for the selected Solver
2. Solver detects the transaction, generates a Secret, and creates an HTLC on the destination chain
3. User observes the destination transaction and converts their PreHTLC to an HTLC on the source chain
4. Solver reveals the Secret on both chains to complete the transfer

This approach resolves issues with secret management, claim transactions on the destination chain, and liveness requirements.


## Disclaimer: Development in Progress

Please note that this project is actively under development. It is not ready for deployment on any mainnet environments.
As we continue to experiment and test new ideas, expect significant changes to the interface. Please be prepared for ongoing modifications.

## Supported Networks

- [Bitcoin](./chains/bitcoin/README.md)
- [EVM](./chains/evm/README.md)
- [Starknet](./chains/starknet/README.md)
- [TON](./chains/ton/README.md)
- [Solana](./chains/solana/README.md)
- Aptos/Sui (in progress)
- Stacks (in progress)

---

## Acknowledgements

- The initial HTLC implementation was based on the work done in the atomic-port project by Yuki Uichiro (https://github.com/ymuichiro/atomic-port)
