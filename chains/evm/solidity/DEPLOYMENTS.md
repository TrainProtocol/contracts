# Train Protocol — Contract Deployments

**Current release:** v3 (`train.protocol.v3`)
**Last updated:** 2026-07-30
**Deployed from:** the v3 solver-guard source (identical `chains/evm/solidity` shared sources on
`main-add-evm` and `main-add-evm-tempo`; the deploy run itself executed from the latter's tree —
the Tempo-specific deployment is documented on that branch)
**CREATE2 factory:** `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` (CreateX, `deployCreate2`)
**CREATE2 salt:** `0x6ea79710b625701a4e948a261916507183bbcdc2bf17c7d633ac10d102f42125` = `keccak256('train.protocol.v3')`
  (CreateX classifies it as a "random" salt and deploys under `guardedSalt = keccak256(abi.encode(salt))` —
  no sender or chain id mixed in, so the flow stays permissionless and same-address on every chain)
**Compiler:** solc 0.8.34, via-ir, optimizer runs 1,000,000, evm_version cancun

> **Why v3:** v3 closes the solver double-funding hazard: solver locks are now keyed by
> `(hashlock, solver)` — at most ONE lock per solver per hashlock, ever — so a blind `solverLock`
> retry (e.g. after an unreliable or malicious RPC claimed the first tx didn't land) reverts with
> `SolverLockAlreadyExists` instead of escrowing a second time. This is an ABI + event change:
> `solverLock` no longer returns an index, `redeemSolver`/`refundSolver`/`getSolverLock` take the
> solver's address instead of an index, `getSolverLockCount` is removed, and the solver events carry
> the solver address. v3 also moves deployment from the Arachnid CREATE2 factory to **CreateX**;
> `TrainRouter` and `ConstantPayoutCurve` are byte-identical to v2 but were redeployed so the whole
> release lives under one factory + salt. The v2 addresses below are retained for historical
> reference and should be treated as deprecated.

## EVM Contract Addresses — v3 (identical on every EVM chain)

Same on all EVM networks below, and identical on any EVM mainnet if deployed from the same source,
salt, and compiler settings via CreateX. Tron uses different addresses — see the Tron tables further down.

| Contract | Address |
| --- | --- |
| ConstantPayoutCurve | `0xf5522F01B44D95f3A8d8be5d78F3eee91d26543C` |
| Train | `0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8` |
| TrainRouter | `0xF406475230bE1A65d06bd87A2724F78F4b6A2928` |

## Testnets — v3

All contracts deployed and source-verified. `Train` was verified fresh on each chain (Etherscan API
v2, `Pass - Verified`); `ConstantPayoutCurve`/`TrainRouter` were auto-matched by Etherscan against
the byte-identical v2 deployments and report "already verified".

| Network | Chain ID | Status | Verified | Explorer |
| --- | --- | --- | --- | --- |
| Ethereum Sepolia | 11155111 | Deployed | Yes | [sepolia.etherscan.io](https://sepolia.etherscan.io/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Arbitrum Sepolia | 421614 | Deployed | Yes | [sepolia.arbiscan.io](https://sepolia.arbiscan.io/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Base Sepolia | 84532 | Deployed | Yes | [sepolia.basescan.org](https://sepolia.basescan.org/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| OP Sepolia | 11155420 | Deployed | Yes | [sepolia-optimism.etherscan.io](https://sepolia-optimism.etherscan.io/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| BSC Testnet | 97 | Deployed | Yes | [testnet.bscscan.com](https://testnet.bscscan.com/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Linea Sepolia | 59141 | Deployed | Yes | [sepolia.lineascan.build](https://sepolia.lineascan.build/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Monad Testnet | 10143 | Deployed | Yes (MonadScan) | [testnet.monadscan.com](https://testnet.monadscan.com/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Tron Nile | 3448148188 (0xcd8690dc) | Deployed | No (manual on Tronscan, optional) | [nile.tronscan.org](https://nile.tronscan.org/#/contract/TRooTQxWa3pgP6oA5QiyASxGKcRFRKY8k9) |

Explorer links open the Train contract page on each network. The Tron chain ID shown is the one
reported by Tron's EVM-compatible JSON-RPC; Tron addresses differ from the EVM set (see below).

*Deploy-tooling note:* Sepolia/Base/OP/BSC/Linea and the first Monad tx went through
`script/deploy-testnets.ps1` → `DeployDeterministic.s.sol`. The installed forge nightly chokes on
some chains' receipts and pruned-state simulation forks, so the remaining Arbitrum/Monad deploys
were sent as direct `cast send <CreateX> "deployCreate2(bytes32,bytes)" <salt> <initcode>` calls —
same factory, same salt, same initcode, hence the same addresses (all receipts `status 0x1`, code
confirmed on-chain).

## Mainnets — v3 (Train deployed 2026-07-30)

**`Train` is live at `0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8` on all seven mainnets below**, deployed from this
source with salt `train.protocol.v3` via CreateX — the same address as the v3 testnet set.
Runtime bytecode is byte-identical on every chain (15,108 bytes; Train has no immutables).
Deploy gas measured at **3,311,670** per chain.

**Scope:** Train only. `ConstantPayoutCurve` and `TrainRouter` are deliberately NOT deployed on
mainnets — locks pass `payoutCurve = address(0)` (full payout), and the gasless rails are
unavailable until TrainRouter ships. Their v3 addresses stay reserved at
`0xf5522F01B44D95f3A8d8be5d78F3eee91d26543C` / `0xF406475230bE1A65d06bd87A2724F78F4b6A2928`.

| Network | Chain ID | Status | Deploy tx | Explorer |
| --- | --- | --- | --- | --- |
| Ethereum | 1 | ✅ Deployed + verified | `0xe64c8d9997ab40bb8def607c2a4540066b5228503b06ab826f823866985d4d60` | [etherscan.io](https://etherscan.io/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Arbitrum One | 42161 | ✅ Deployed + verified | `0x091572c9d1ffc54a29999fadc917e94592fe8c8ce1965ba4e0a9b0c567c339b3` | [arbiscan.io](https://arbiscan.io/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Base | 8453 | ✅ Deployed + verified | _(receipt not captured; CREATE2 address confirmed on-chain)_ | [basescan.org](https://basescan.org/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| OP Mainnet | 10 | ✅ Deployed + verified | `0xd295b1316d3f95ed12e3a7b82260c35ddd50fcd9f778e8853713897033dd868c` | [optimistic.etherscan.io](https://optimistic.etherscan.io/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Polygon PoS | 137 | ✅ Deployed + verified | `0xbe7ac8befa48b622653a4869db4d94bd4acbe42ccc754f257a84de1a2299fd5c` | [polygonscan.com](https://polygonscan.com/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| BNB Smart Chain | 56 | ✅ Deployed + verified | _(receipt not captured; CREATE2 address confirmed on-chain)_ | [bscscan.com](https://bscscan.com/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Robinhood Chain | 4663 | ✅ Deployed + verified | `0x4e2f6a26ec2a3013f521a3567b3588d293b0099375d79b93ed708428058d1a95` | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com/address/0x265978c3e2E5dB9C3Ea665cC40C5925A5fc13Ee8) |
| Linea | 59144 | Not deployed | — | [lineascan.build](https://lineascan.build) |
| Monad | 143 | Not deployed | — | [monadscan.com](https://monadscan.com) |
| Tron | 728126428 (0x2b6653dc) | Not deployed (addresses will differ) | — | [tronscan.org](https://tronscan.org) |

Deployed via `script/deploy-mainnets.sh` — a resumable per-chain orchestrator (skip-if-deployed,
Cancun TSTORE probe, balance preflight that marks `NEEDS_FUNDS` and continues rather than
aborting, Etherscan-v2/Blockscout verification, `deployments/mainnets-v3.json` manifest).
Adding a future EVM chain = one row in its chain table; the same salt reproduces the same
address wherever CreateX is deployed.

> **Ethereum note.** Deployed 2026-07-31 at block 25,648,174 for **0.000390 ETH**
> (3,311,670 gas @ 0.1176 gwei effective). Base fee had spiked to 3.6 gwei during the initial
> run — where the same deploy would have cost ~0.0059 ETH — so the deploy was deferred and
> broadcast from a polling watcher once the base fee fell to 0.126 gwei, a ~93% saving. The
> deployer's existing balance covered it with no additional funding.
