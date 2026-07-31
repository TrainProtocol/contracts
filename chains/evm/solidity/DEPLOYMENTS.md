# Train Protocol — Contract Deployments

**Current release:** v3 (`train.protocol.v3`)
**Last updated:** 2026-07-31
**Deployed from:** the v3 solver-guard source (identical `chains/evm/solidity` shared sources on
`main-add-evm` and `main-add-evm-tempo`, both since merged into `main`)
**CREATE2 factory:** `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` (CreateX, `deployCreate2`)
**CREATE2 salt:** `0x6ea79710b625701a4e948a261916507183bbcdc2bf17c7d633ac10d102f42125` = `keccak256('train.protocol.v3')`
  (CreateX classifies it as a "random" salt and deploys under `guardedSalt = keccak256(abi.encode(salt))` —
  no sender or chain id mixed in, so the flow stays permissionless and same-address on every chain)
**Compiler:** solc 0.8.34, via-ir, optimizer runs 1,000,000, evm_version cancun (osaka for Tempo)

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

## Tempo Addresses — v3 (deployed, testnet)

**Different contract, not just different bytecode.** Tempo deploys
[`src/tempo/Train.sol`](src/tempo/Train.sol)'s `Train` — a genuinely distinct contract from the shared
`Train.sol` above (no native-ETH paths, no `userLockFor`; see `README.md` trust assumptions 7–9) — and
**no `TrainRouter`** at all. `evm_version = osaka` (vs `cancun` for the shared set) means the addresses
below legitimately differ from the shared EVM table, via the same `train.protocol.v3` salt and the
same CreateX factory.

| Contract | Address |
| --- | --- |
| ConstantPayoutCurve | [`0x758347A30b49d353F9C4dc8189F5c8f91FeaB27b`](https://explore.testnet.tempo.xyz/address/0x758347A30b49d353F9C4dc8189F5c8f91FeaB27b) |
| Train (tempo) | [`0xCb74407724c463EAA9bC661818364b532F8B5Cb5`](https://explore.testnet.tempo.xyz/address/0xCb74407724c463EAA9bC661818364b532F8B5Cb5) |

| Network | Chain ID | Status | Verified | Explorer |
| --- | --- | --- | --- | --- |
| Tempo Testnet (Moderato) | 42431 | Deployed | Yes (Sourcify) — see note below | [explore.testnet.tempo.xyz](https://explore.testnet.tempo.xyz/address/0xCb74407724c463EAA9bC661818364b532F8B5Cb5) |
| Tempo Mainnet | 4217 | **Train deployed 2026-07-30** (Train only — no curve, no router) | Yes — exact_match (matchId 28227) | [explore.tempo.xyz](https://explore.tempo.xyz/address/0xCb74407724c463EAA9bC661818364b532F8B5Cb5) |

Deployment txs: ConstantPayoutCurve
[`0x2893b94085e1367dfa468c35489c5f80d74c010190d7355f7d3c95325427761b`](https://explore.testnet.tempo.xyz/tx/0x2893b94085e1367dfa468c35489c5f80d74c010190d7355f7d3c95325427761b),
Train
[`0x180880fceb80ab78562cd848f55576efb361f7d343abe280db77ebd10dfd815e`](https://explore.testnet.tempo.xyz/tx/0x180880fceb80ab78562cd848f55576efb361f7d343abe280db77ebd10dfd815e).
Deployed via `script/tempo/DeployTempo.s.sol` (`FOUNDRY_PROFILE=tempo`).

**Verification — DONE (2026-07-30).** Both contracts are source-verified on Tempo's Sourcify-compatible
verifier at `contracts.tempo.xyz` (runtime `match`, creation `match`):

| Contract | matchId | Lookup (verifier API) |
| --- | --- | --- |
| ConstantPayoutCurve | 28225 | [`/v2/contract/42431/0x7583…B27b`](https://contracts.tempo.xyz/v2/contract/42431/0x758347A30b49d353F9C4dc8189F5c8f91FeaB27b) |
| Train (tempo) | 28226 | [`/v2/contract/42431/0xCb74…5Cb5`](https://contracts.tempo.xyz/v2/contract/42431/0xCb74407724c463EAA9bC661818364b532F8B5Cb5) |

Confirm anytime with `GET https://contracts.tempo.xyz/v2/contract/42431/<addr>` or on the explorer
contract page (the explorer reads from the verifier).

*Method (why not a plain `forge verify-contract`):* the installed forge (`1.6.0-nightly-tempo`) always
emits an **Etherscan-format** verify payload once `--verifier-url` is set — even with `--verifier sourcify`
explicit — and POSTs it to a route that 404s; it never reaches Tempo's `/v2/verify/{chainId}/{address}`
Sourcify route. So verification was submitted **directly to the API**, exactly as Tempo's docs
(`tempo.xyz/docs/quickstart/verify-contracts`, "API Verification") describe:

1. Generate the standard-JSON compiler input with forge:
   `$env:FOUNDRY_PROFILE="tempo"; forge verify-contract <addr> <path>:<Name> --show-standard-json-input`.
   **Known quirk (new since the v2 run):** this forge build emits `evmVersion:"cancun"` in the
   std-JSON even under `FOUNDRY_PROFILE=tempo` — patch `settings.evmVersion` to `"osaka"` in the
   generated JSON before submitting, or the bytecode won't match.
2. `POST https://contracts.tempo.xyz/v2/verify/42431/<addr>` with a JSON body
   `{ stdJsonInput, compilerVersion: "v0.8.34+commit.80d5c536", contractIdentifier: "<path>:<Name>",
   creationTransactionHash: "<deploy tx>" }`. Set a browser `User-Agent` — Cloudflare returns 403
   (error 1010, "browser signature banned") for scripted UAs.
3. Poll `GET https://contracts.tempo.xyz/v2/verify/{verificationId}` until `isJobCompleted:true`.

### Tempo Mainnet — v3 (deployed 2026-07-30)

`Train` (tempo variant) is live on Tempo Mainnet (4217) at the **same address as Moderato
testnet** — `0xCb74407724c463EAA9bC661818364b532F8B5Cb5` — deployed with salt
`train.protocol.v3` via CreateX. `ConstantPayoutCurve` deliberately NOT deployed (locks pass
`payoutCurve = address(0)`); its address stays reserved at
`0x758347A30b49d353F9C4dc8189F5c8f91FeaB27b`.

- Deploy tx [`0xad8c4af2fe75070bd470b2587ff561564ae139e79983cb05474b6fdd9a7520d7`](https://explore.tempo.xyz/tx/0xad8c4af2fe75070bd470b2587ff561564ae139e79983cb05474b6fdd9a7520d7), block 32,432,238, **gas 14,647,432**, fee paid in pathUSD.
- Verified on `contracts.tempo.xyz`: runtime `exact_match`, creation `match`, matchId 28227
  (via `script/tempo/verify-tempo.sh`).
- **Deployment gotcha (v3/CreateX):** `forge script` fails in *simulation* with CreateX's
  `FailedContractCreation` on Tempo — stable forge's revm mis-models Tempo, even though a
  chain-side `cast call` of the identical `CreateX.deployCreate2(salt, initCode)` returns the
  correct address. Broadcast it directly instead, with Tempo's 30M per-tx gas cap
  (forge's own estimate is far below the ~14.6M this really needs):
  `cast send 0xba5Ed0…ba5Ed $(cast calldata "deployCreate2(bytes32,bytes)" $SALT $INITCODE) --gas-limit 30000000`

## Tron Addresses — Nile Testnet — v3 (deployed)

Addresses differ from EVM by design (no CREATE2/CreateX on Tron, 0x41 address derivation).
Deployer: `TFkCi38K7h7xicgoP7MNuSsnDQAg1YwbvD`.

| Contract | Address (base58) | Address (hex) |
| --- | --- | --- |
| ConstantPayoutCurve | [`TXnXbz7UKN3KAJV8yNZtkFsHmzBuQ3hSu9`](https://nile.tronscan.org/#/contract/TXnXbz7UKN3KAJV8yNZtkFsHmzBuQ3hSu9) | `41ef4db850bff6d54657b99c033a41ce04d89d752d` |
| Train | [`TRooTQxWa3pgP6oA5QiyASxGKcRFRKY8k9`](https://nile.tronscan.org/#/contract/TRooTQxWa3pgP6oA5QiyASxGKcRFRKY8k9) | `41adba9d2f44f5c3f8317f4073af40199b1923ae68` |
| TrainRouter | [`TE8xNnkiWu71q6rs1mSYLV9Q5ZRaxTwHWX`](https://nile.tronscan.org/#/contract/TE8xNnkiWu71q6rs1mSYLV9Q5ZRaxTwHWX) | `412db874427f5a1d0dbe5ae00a6f6cbb65fce647ec` |

## Tron Addresses — Mainnet (not deployed)

Fill in after `npm run deploy:tron:mainnet`.

| Contract | Address (base58) | Address (hex) |
| --- | --- | --- |
| ConstantPayoutCurve | - | - |
| Train | - | - |
| TrainRouter | - | - |

## Operational Notes

- Reproducibility: same salt + same source + same compiler settings gives the same EVM address on
  any chain (CreateX `deployCreate2` with `guardedSalt = keccak256(abi.encode(salt))`). Any change to
  contract source or compiler config changes the addresses — bump the salt string deliberately for a
  new release and add a new section here.
- Deployment is permissionless and idempotent: anyone can re-run the deploy; only identical bytecode
  can occupy these addresses. The deploy scripts skip contracts already present at their predicted
  address. If `forge script` fails on a chain (see the deploy-tooling note above), the equivalent
  direct call is `cast send 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed "deployCreate2(bytes32,bytes)"
  <salt> <initcode>` with the initcode from `out/<Name>.sol/<Name>.json` (default profile build).
- Verification: a single Etherscan API v2 key covers all EVM chains above, including Monad
  (MonadScan). Contracts whose bytecode matches an already-verified deployment (here: the v2
  ConstantPayoutCurve/TrainRouter) are matched automatically at their new address. TrainRouter
  runtime bytecode differs slightly per chain on purpose (EIP-712 chain-id immutable); explorers
  cross-match it automatically. The CreateX address is unaffected (keyed on initcode).
- Runtime requirement: every target chain must support Cancun / EIP-1153 transient storage
  (on Tron: TVM GreatVoyage v4.8.0+).
- Tooling: [`script/DeployDeterministic.s.sol`](script/DeployDeterministic.s.sol) (Foundry, CreateX),
  [`script/deploy-testnets.ps1`](script/deploy-testnets.ps1) (multi-chain orchestrator),
  [`script/deploy-tron.js`](script/deploy-tron.js) (TronWeb). See the
  [deploy section of the README](README.md#deploy--on-chain-testnet-flow) for usage.
- **Tempo-specific:** the deployer (and any relayer/fee-payer) needs a **pathUSD** balance, not native
  ETH — Tempo has no native gas token, and `eth_getBalance` there always returns a fixed sentinel
  regardless of actual balance, so it cannot be used as an affordability check (`DeployTempo.s.sol`
  checks pathUSD directly). Testnet pathUSD comes from the faucet RPC:
  `cast rpc tempo_fundAddress <addr> --rpc-url https://rpc.moderato.tempo.xyz`. No native-ETH support
  exists on this deployment at all (not just unreachable — the contract itself has no `payable`
  entrypoints). No `TrainRouter` is deployed on Tempo; use the native batched-and-sponsored flow
  instead (`script/tempo/native_flow.py`). pathUSD carries an active TIP-403 blacklist policy
  (README trust assumption 8) — accepted risk, not specific to this deployment tooling. See
  [`script/tempo/README.md`](script/tempo/README.md) for the full walkthrough.

---

## Historical — v2 (`train.protocol.v2`), DEPRECATED

Deployed 2026-07-16 from branch `main-add-evm` atop `6ab0cc9`, via the **Arachnid** CREATE2 factory
(`0x4e59b44847b379578588920cA78FbF26c0B4956C`), salt `keccak256('train.protocol.v2')`
(`0x2cb3c3cf140b71dedade9bbce0490f1ce1423b1c7ed61f35b83f24c982cf63b1`). Superseded by v3: the v2
`Train` uses the old **indexed** solver-lock API (`solverLock → index`, `redeemSolver/refundSolver/
getSolverLock(hashlock, index)`, `getSolverLockCount`) and has **no same-solver double-lock guard** —
a solver retrying `solverLock` there can double-fund a swap. v2 added the TrainRouter single-use
intent replay guard and the paginated-getter overflow fix over v1.

EVM (all 7 testnets): ConstantPayoutCurve `0xFF9d783c6cB8294a4fa4d1556752c3EAF3E20DEE`,
Train `0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75`,
TrainRouter `0x0d117b12744E1A8b4980c3BdC3542Ad53C27E33a`
(Sepolia, Arbitrum/Base/OP/Linea Sepolia, BSC, Monad — all source-verified).

Tempo Moderato (v2): ConstantPayoutCurve `0xe07d9f773112388E0126B31611A4A56Cf6a9E3Fa`,
Train (tempo) `0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29` (Sourcify matchIds 28107/28108,
`exact_match`).

Tron Nile (v2): ConstantPayoutCurve `TSHgwbab9XGjcGdQLdDAEQMgXy6QpnKE97`,
Train `TKPCfMErMoBpr7YWcWJyNM2aG7EcAn6srj`, TrainRouter `TY6hNw9Kvx6AcRJAAk9M9mCxZzuaSbQ3fG`.

## Historical — v1 (`train.protocol.v1`), DEPRECATED

Deployed from commit `c182e0c`, salt `keccak256('train.protocol.v1')`
(`0x5d7885c1f4cd41bf8dc1e01bc410bd87b5deea2f59186528a1021e520116fad6`). Superseded by v2. The v1
`TrainRouter` lacks intent replay protection and the v1 `Train` paginated getters can revert on
`offset + limit` overflow; prefer the v3 addresses above.

EVM (all chains): ConstantPayoutCurve `0xa46966484B1eB2c650333Db72de07f667dF76765`,
Train `0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64`,
TrainRouter `0xCa04b09CCA22A4C872247303aa94FF7Ad700b6a9`.
Deployed on the same 7 testnets (Sepolia, Arbitrum/Base/OP/Linea Sepolia, BSC, Monad).

Tron Nile (v1): ConstantPayoutCurve `TQUDuMYbtjXimHMeFLh9kFnsCYUeqABbSm`,
Train `THVyZWFSabRbjBZXDUMBQaa2Wbxq11b145`, TrainRouter `TQQ4dYHYGvYdZhXsi9amayBMsQKtDPt8a3`.
