# Train: Permissionless, Trustless Cross-Chain Bridging Protocol

Read the protocol description and spec - [Train Documentation](https://docs.train.tech/)

## TL;DR

- Implements HTLC-based cross-chain atomic swaps with solver-provided liquidity and incentives
- Permissionless and trustless protocol without reliance on 3rd parties
- Designed to support multi-hop routing across chains (future work)
- Live on EVM, Tempo, Fuel, and Starknet mainnets (current release: **v3**, Train contract only); all networks available on testnets

---

## Networks and Repository Layout

`main` carries the latest state of every production-track network. Networks still in early
development live only on their own long-lived `main-add-<network>` branch; per-network branches
are kept after merging and remain the place where chain work continues.

### Networks in `main`

| Network | Path | Status |
| --- | --- | --- |
| **EVM (Solidity)** | [`chains/evm/solidity`](./chains/evm/solidity/) | v3 live on 7 mainnets + 7 testnets |
| **Tempo** | [`chains/evm/solidity/src/tempo`](./chains/evm/solidity/src/tempo/) | v3 live on Tempo mainnet + Moderato testnet |
| **Tron** | [`chains/evm/solidity`](./chains/evm/solidity/) (TVM deploy of the EVM contracts) | v3 on Nile testnet |
| **Fuel** | [`chains/fuel`](./chains/fuel/) | Live on Ignition mainnet + Sepolia testnet |
| **Starknet** | [`chains/starknet`](./chains/starknet/) | Live on mainnet + Sepolia testnet |
| **Solana** | [`chains/solana`](./chains/solana/) | Devnet |
| **Aztec** | [`chains/aztec`](./chains/aztec/) | In development · testnet |

### In-progress networks (per-branch)

- **Aptos** – [`main-add-aptos`](https://github.com/TrainProtocol/contracts/tree/main-add-aptos)
- **Bitcoin** – [`main-add-bitcoin`](https://github.com/TrainProtocol/contracts/tree/main-add-bitcoin)
- **Stacks** – [`main-add-stacks`](https://github.com/TrainProtocol/contracts/tree/main-add-stacks)
- **Sui** – [`main-add-sui`](https://github.com/TrainProtocol/contracts/tree/main-add-sui)
- **TON** – [`main-add-ton`](https://github.com/TrainProtocol/contracts/tree/main-add-ton)
- **XRP** – [`main-add-xrp`](https://github.com/TrainProtocol/contracts/tree/main-add-xrp)
- **Zcash** – [`main-add-zcash`](https://github.com/TrainProtocol/contracts/tree/main-add-zcash)

---

## Deployments — current release (v3)

Latest release addresses only. Historical/superseded deployments live in each chain's canonical
record: [`chains/evm/solidity/DEPLOYMENTS.md`](./chains/evm/solidity/DEPLOYMENTS.md),
[`chains/fuel/DEPLOYMENTS.md`](./chains/fuel/DEPLOYMENTS.md),
[`chains/starknet/docs/mainnet-deployment.md`](./chains/starknet/docs/mainnet-deployment.md),
[`chains/solana/README.md`](./chains/solana/README.md),
[`chains/aztec/README.md`](./chains/aztec/README.md).

Mainnet scope everywhere so far is **Train only** — `ConstantPayoutCurve` and `TrainRouter` are
deliberately not deployed on mainnets (locks pass `payoutCurve = 0` for full payout); their
deterministic addresses stay reserved.

### EVM — same address on every EVM chain (CreateX, salt `keccak256('train.protocol.v3')`)

| Contract | Address |
| --- | --- |
| Train | `0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8` |
| ConstantPayoutCurve | `0xf5522F01B44D95f3A8d8be5d78F3eee91d26543C` (testnets only) |
| TrainRouter | `0xF406475230bE1A65d06bd87A2724F78F4b6A2928` (testnets only) |

**Mainnets (Train deployed + verified):** Ethereum (1), Arbitrum One (42161), Base (8453),
OP Mainnet (10), Polygon PoS (137), BNB Smart Chain (56), Robinhood Chain (4663).

**Testnets (all three contracts, verified):** Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia,
OP Sepolia, BSC Testnet, Linea Sepolia, Monad Testnet.

### Tempo (dedicated `src/tempo/Train.sol` contract, no router)

| Contract | Address | Networks |
| --- | --- | --- |
| Train (tempo) | `0xCb74407724c463EAA9bC661818364b532F8B5Cb5` | Mainnet (4217) + Moderato testnet (42431), Sourcify-verified |
| ConstantPayoutCurve | `0x758347A30b49d353F9C4dc8189F5c8f91FeaB27b` | Moderato testnet only |

### Tron — Nile testnet (mainnet not deployed)

| Contract | Address |
| --- | --- |
| Train | `TRooTQxWa3pgP6oA5QiyASxGKcRFRKY8k9` |
| ConstantPayoutCurve | `TXnXbz7UKN3KAJV8yNZtkFsHmzBuQ3hSu9` |
| TrainRouter | `TE8xNnkiWu71q6rs1mSYLV9Q5ZRaxTwHWX` |

### Fuel (deterministic contract IDs — identical on testnet and mainnet)

| Contract | Contract ID | Networks |
| --- | --- | --- |
| Train | `0x445464bf4d8f2ad1cdffefa8345438f6769c44fc4aedf0eb9c2e34f5756f5750` | Ignition mainnet + Sepolia testnet |
| ConstantPayoutCurve | `0xfc598e7d022590a0eecc2f58c9ba865ace7c2ca5acae881dced5f2dbb37eb33b` | Sepolia testnet only |

### Starknet

| Network | Contract | Address |
| --- | --- | --- |
| Mainnet | Train | `0x397630513a04161f0f73bc1aaf76c6e10f85d8b17b42d00d11e8767a1cf5255` |
| Sepolia | Train | `0x331d2d504d582a6918a70928fa31207f73600f45e8089310283223f439d52b0` |
| Sepolia | TrainRouter | `0x1049d123293e9c182397ba1b5de795ee35c9ca0a1f2fecfec2eca14e38cecc8` |
| Sepolia | ConstantPayoutCurve | `0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351` |

Mainnet and Sepolia Train share class hash
`0x64d8573c2f3ef167278c765031ed7c8a969ebac44dbe56ac687450e45a7bb49` (verified on Voyager).

### Solana — devnet

| Program | Program ID |
| --- | --- |
| train_htlc | `2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ` |
| constant_payout_curve | `Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF` |

### Aztec — testnet

| Contract | Address |
| --- | --- |
| Train | `0x1e36ef80d7d02ab8ed33aa07635f85152e015b9c4b09fbf5fe54ec11154d3133` |
| ConstantPayoutCurve | `0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7` |

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

Please note that this project is actively under development and **the contracts have not been
audited**. Mainnet deployments of the current release exist, but use them at your own risk.
As we continue to experiment and test new ideas, expect significant changes to the interface. Please be prepared for ongoing modifications.

## Acknowledgements

- The initial HTLC implementation was based on the work done in the [atomic-port](https://github.com/ymuichiro/atomic-port) project by Yuki Uichiro
