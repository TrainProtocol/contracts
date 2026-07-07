# Train Protocol — Contract Deployments

**Last updated:** 2026-07-07
**Deployed from commit:** `c182e0c`
**CREATE2 factory:** `0x4e59b44847b379578588920cA78FbF26c0B4956C` (Arachnid)
**CREATE2 salt:** `0x5d7885c1f4cd41bf8dc1e01bc410bd87b5deea2f59186528a1021e520116fad6` = `keccak256('train.protocol.v1')`
**Compiler:** solc 0.8.34, via-ir, optimizer runs 1,000,000, evm_version cancun

## EVM Contract Addresses (identical on every EVM chain)

Same on all EVM networks below, and will also be identical on the EVM mainnets provided
deployment uses the same commit, salt, and compiler settings. Tron uses different addresses —
see the Tron tables further down.

| Contract | Address |
| --- | --- |
| ConstantPayoutCurve | `0xa46966484B1eB2c650333Db72de07f667dF76765` |
| Train | `0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64` |
| TrainRouter | `0xCa04b09CCA22A4C872247303aa94FF7Ad700b6a9` |

## Testnets

| Network | Chain ID | Status | Verified | Explorer |
| --- | --- | --- | --- | --- |
| Ethereum Sepolia | 11155111 | Deployed | Yes | [sepolia.etherscan.io](https://sepolia.etherscan.io/address/0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64) |
| Arbitrum Sepolia | 421614 | Deployed | Yes | [sepolia.arbiscan.io](https://sepolia.arbiscan.io/address/0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64) |
| Base Sepolia | 84532 | Deployed | Yes | [sepolia.basescan.org](https://sepolia.basescan.org/address/0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64) |
| OP Sepolia | 11155420 | Deployed | Yes | [sepolia-optimism.etherscan.io](https://sepolia-optimism.etherscan.io/address/0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64) |
| BSC Testnet | 97 | Deployed | Yes | [testnet.bscscan.com](https://testnet.bscscan.com/address/0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64) |
| Linea Sepolia | 59141 | Deployed | Yes | [sepolia.lineascan.build](https://sepolia.lineascan.build/address/0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64) |
| Monad Testnet | 10143 | Deployed | Yes (MonadScan) | [testnet.monadscan.com](https://testnet.monadscan.com/address/0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64) |
| Tron Nile | 3448148188 (0xcd8690dc) | Deployed | No (manual on Tronscan, optional) | [nile.tronscan.org](https://nile.tronscan.org/#/contract/THVyZWFSabRbjBZXDUMBQaa2Wbxq11b145) |

Explorer links open the Train contract page on each network. The Tron chain ID shown is the one
reported by Tron's EVM-compatible JSON-RPC; Tron addresses differ from the EVM set (see below).

## Mainnets (not yet deployed)

Same three EVM addresses expected if deployed from commit `c182e0c` with salt `train.protocol.v1`.
Tron mainnet will get new, unrelated addresses.

| Network | Chain ID | Status | Explorer |
| --- | --- | --- | --- |
| Ethereum | 1 | Not deployed | [etherscan.io](https://etherscan.io) |
| Arbitrum One | 42161 | Not deployed | [arbiscan.io](https://arbiscan.io) |
| Base | 8453 | Not deployed | [basescan.org](https://basescan.org) |
| OP Mainnet | 10 | Not deployed | [optimistic.etherscan.io](https://optimistic.etherscan.io) |
| BNB Smart Chain | 56 | Not deployed | [bscscan.com](https://bscscan.com) |
| Linea | 59144 | Not deployed | [lineascan.build](https://lineascan.build) |
| Monad | 143 | Not deployed | [monadscan.com](https://monadscan.com) |
| Tron | 728126428 (0x2b6653dc) | Not deployed | [tronscan.org](https://tronscan.org) |

## Tron Addresses — Nile Testnet (deployed)

Addresses differ from EVM by design (no CREATE2 on Tron, 0x41 address derivation).
Smoke-tested on-chain: `computePayout` returns correctly (Cancun/TVM compatible, GreatVoyage 4.8.0+).

| Contract | Address (base58) | Address (hex) |
| --- | --- | --- |
| ConstantPayoutCurve | [`TQUDuMYbtjXimHMeFLh9kFnsCYUeqABbSm`](https://nile.tronscan.org/#/contract/TQUDuMYbtjXimHMeFLh9kFnsCYUeqABbSm) | `419f0e93976a679555f506cd6207bfdefbab6df6fd` |
| Train | [`THVyZWFSabRbjBZXDUMBQaa2Wbxq11b145`](https://nile.tronscan.org/#/contract/THVyZWFSabRbjBZXDUMBQaa2Wbxq11b145) | `41529a8e4033bcdf10c0998a72288aaef78076b368` |
| TrainRouter | [`TQQ4dYHYGvYdZhXsi9amayBMsQKtDPt8a3`](https://nile.tronscan.org/#/contract/TQQ4dYHYGvYdZhXsi9amayBMsQKtDPt8a3) | `419e452c186891f1a433eaaaca2288c77d5c0fcde4` |

## Tron Addresses — Mainnet (not deployed)

Fill in after `npm run deploy:tron:mainnet`.

| Contract | Address (base58) | Address (hex) |
| --- | --- | --- |
| ConstantPayoutCurve | - | - |
| Train | - | - |
| TrainRouter | - | - |

## Operational Notes

- Reproducibility: same salt + same commit + same compiler settings gives the same EVM address on
  any chain (Arachnid CREATE2 factory). Any change to contract source or compiler config changes the
  addresses — bump the salt to `train.protocol.v2` for the next release and add a new section here.
- Deployment is permissionless and idempotent: anyone can re-run the deploy; only identical bytecode
  can occupy these addresses. Re-runs skip already-deployed contracts.
- Verification: a single Etherscan API v2 key covers all EVM chains above, including Monad
  (MonadScan). TrainRouter runtime bytecode differs slightly per chain on purpose (EIP-712 chain-id
  immutable); explorers cross-match it automatically. The CREATE2 address is unaffected (keyed on initcode).
- Runtime requirement: every target chain must support Cancun / EIP-1153 transient storage
  (on Tron: TVM GreatVoyage v4.8.0+).
- Tooling: [`script/DeployDeterministic.s.sol`](script/DeployDeterministic.s.sol) (Foundry, CREATE2),
  [`script/deploy-testnets.ps1`](script/deploy-testnets.ps1) (multi-chain orchestrator),
  [`script/deploy-tron.js`](script/deploy-tron.js) (TronWeb). See the
  [deploy section of the README](README.md#deploy--on-chain-testnet-flow) for usage.
