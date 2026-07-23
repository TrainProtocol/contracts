# Train Protocol — Contract Deployments

**Current release:** v2 (`train.protocol.v2`)
**Last updated:** 2026-07-16
**Deployed from:** branch `main-add-evm`, working tree atop `6ab0cc9` (intent-replay + pagination fix commit pending)
**CREATE2 factory:** `0x4e59b44847b379578588920cA78FbF26c0B4956C` (Arachnid)
**CREATE2 salt:** `0x2cb3c3cf140b71dedade9bbce0490f1ce1423b1c7ed61f35b83f24c982cf63b1` = `keccak256('train.protocol.v2')`
**Compiler:** solc 0.8.34, via-ir, optimizer runs 1,000,000, evm_version cancun

> **Why v2:** v2 adds single-use intent replay protection to `TrainRouter` (per-intent `nonce` + `deadline`
> + `consumedIntent`, enforced across all three gasless paths) and fixes an `offset + limit` overflow in
> `Train`'s paginated getters. Both contracts changed, so all CREATE2 addresses moved. The v1 addresses
> below are retained for historical reference and should be treated as deprecated.

## EVM Contract Addresses — v2 (identical on every EVM chain)

Same on all EVM networks below, and identical on any EVM mainnet if deployed from the same commit,
salt, and compiler settings. Tron uses different addresses — see the Tron tables further down.

| Contract | Address |
| --- | --- |
| ConstantPayoutCurve | `0xFF9d783c6cB8294a4fa4d1556752c3EAF3E20DEE` |
| Train | `0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75` |
| TrainRouter | `0x0d117b12744E1A8b4980c3BdC3542Ad53C27E33a` |

## Testnets — v2

All contracts deployed and source-verified (Etherscan API v2).

| Network | Chain ID | Status | Verified | Explorer |
| --- | --- | --- | --- | --- |
| Ethereum Sepolia | 11155111 | Deployed | Yes | [sepolia.etherscan.io](https://sepolia.etherscan.io/address/0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75) |
| Arbitrum Sepolia | 421614 | Deployed | Yes | [sepolia.arbiscan.io](https://sepolia.arbiscan.io/address/0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75) |
| Base Sepolia | 84532 | Deployed | Yes | [sepolia.basescan.org](https://sepolia.basescan.org/address/0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75) |
| OP Sepolia | 11155420 | Deployed | Yes | [sepolia-optimism.etherscan.io](https://sepolia-optimism.etherscan.io/address/0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75) |
| BSC Testnet | 97 | Deployed | Yes | [testnet.bscscan.com](https://testnet.bscscan.com/address/0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75) |
| Linea Sepolia | 59141 | Deployed | Yes | [sepolia.lineascan.build](https://sepolia.lineascan.build/address/0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75) |
| Monad Testnet | 10143 | Deployed | Yes (MonadScan) | [testnet.monadscan.com](https://testnet.monadscan.com/address/0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75) |
| Tron Nile | 3448148188 (0xcd8690dc) | Deployed | No (manual on Tronscan, optional) | [nile.tronscan.org](https://nile.tronscan.org/#/contract/TKPCfMErMoBpr7YWcWJyNM2aG7EcAn6srj) |

Explorer links open the Train contract page on each network. The Tron chain ID shown is the one
reported by Tron's EVM-compatible JSON-RPC; Tron addresses differ from the EVM set (see below).

## Mainnets — v2 (not yet deployed)

Same three EVM addresses expected if deployed from this commit with salt `train.protocol.v2`.
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

## Tempo Addresses — v2 (deployed, testnet)

**Different contract, not just different bytecode.** Tempo deploys
[`src/tempo/Train.sol`](src/tempo/Train.sol)'s `Train` — a genuinely distinct contract from the shared
`Train.sol` above (no native-ETH paths, no `userLockFor`; see `README.md` trust assumptions 7–9) — and
**no `TrainRouter`** at all. `evm_version = osaka` (vs `cancun` for the shared set) means the addresses
below legitimately differ from the shared EVM table, via the same `train.protocol.v2` salt.

| Contract | Address |
| --- | --- |
| ConstantPayoutCurve | [`0xe07d9f773112388E0126B31611A4A56Cf6a9E3Fa`](https://explore.testnet.tempo.xyz/address/0xe07d9f773112388E0126B31611A4A56Cf6a9E3Fa) |
| Train (tempo) | [`0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29`](https://explore.testnet.tempo.xyz/address/0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29) |

| Network | Chain ID | Status | Verified | Explorer |
| --- | --- | --- | --- | --- |
| Tempo Testnet (Moderato) | 42431 | Deployed | Yes (Sourcify) — see note below | [explore.testnet.tempo.xyz](https://explore.testnet.tempo.xyz/address/0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29) |
| Tempo Mainnet | 4217 | Not deployed | — | [explore.tempo.xyz](https://explore.tempo.xyz) |

Deployment txs: ConstantPayoutCurve
[`0xb0c5234663741c20b93b596adb61cd49a838250f5f299f64e4b80d9c781a61f3`](https://explore.testnet.tempo.xyz/tx/0xb0c5234663741c20b93b596adb61cd49a838250f5f299f64e4b80d9c781a61f3),
Train
[`0x972f9f88060878c3ee96154dbe0a3e62b943175a3847f3ddfc796e2f9b9aefe2`](https://explore.testnet.tempo.xyz/tx/0x972f9f88060878c3ee96154dbe0a3e62b943175a3847f3ddfc796e2f9b9aefe2).
Deployed via `script/tempo/DeployTempo.s.sol` (`FOUNDRY_PROFILE=tempo`).

**Verification — DONE (2026-07-23).** Both contracts are source-verified on Tempo's Sourcify-compatible
verifier at `contracts.tempo.xyz`, each with an `exact_match` (runtime `exact_match`, creation `match`):

| Contract | matchId | Lookup (verifier API) |
| --- | --- | --- |
| ConstantPayoutCurve | 28107 | [`/v2/contract/42431/0xe07d…E3Fa`](https://contracts.tempo.xyz/v2/contract/42431/0xe07d9f773112388E0126B31611A4A56Cf6a9E3Fa) |
| Train (tempo) | 28108 | [`/v2/contract/42431/0xf378…9e29`](https://contracts.tempo.xyz/v2/contract/42431/0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29) |

Confirm anytime with `GET https://contracts.tempo.xyz/v2/contract/42431/<addr>` (returns HTTP 200 +
`"match":"exact_match"` when verified) or on the explorer contract page. The verifier is a Sourcify v2
instance (per its `/openapi.json`); the live verified copy is authoritative there and the explorer reads
from it.

*Method (why not a plain `forge verify-contract`):* the installed forge (`1.6.0-nightly-tempo`) always
emits an **Etherscan-format** verify payload once `--verifier-url` is set — even with `--verifier sourcify`
explicit — and POSTs it to a route that 404s; it never reaches Tempo's `/v2/verify/{chainId}/{address}`
Sourcify route. (It also runs an Etherscan-style is-verified/ABI precheck first, which fails with a
`host only … did you mean /api?` error; `--skip-is-verified-check` gets past that but the payload shape is
still wrong.) So verification was submitted **directly to the API**, exactly as Tempo's docs
(`tempo.xyz/docs/quickstart/verify-contracts`, "API Verification") describe:

1. Generate the standard-JSON compiler input with forge (this *does* work and is the reliable part):
   `$env:FOUNDRY_PROFILE="tempo"; forge verify-contract <addr> <path>:<Name> --show-standard-json-input`.
2. `POST https://contracts.tempo.xyz/v2/verify/42431/<addr>` with a JSON body
   `{ stdJsonInput, compilerVersion: "v0.8.34+commit.80d5c536", contractIdentifier: "<path>:<Name>",
   creationTransactionHash: "<deploy tx>" }`. Set a browser `User-Agent` — Cloudflare returns 403
   (error 1010, "browser signature banned") for the default `Python-urllib`/scripted UA.
3. Poll `GET https://contracts.tempo.xyz/v2/verify/{verificationId}` until `isJobCompleted:true`.

`FOUNDRY_PROFILE=tempo` is required in step 1 so the std-JSON carries `evmVersion:"osaka"` + `viaIR:true`;
without it the bytecode won't match. The one-off script used lives outside the repo (session scratchpad).

## Tron Addresses — Nile Testnet — v2 (deployed)

Addresses differ from EVM by design (no CREATE2 on Tron, 0x41 address derivation).
Deployer: `TFkCi38K7h7xicgoP7MNuSsnDQAg1YwbvD`.

| Contract | Address (base58) | Address (hex) |
| --- | --- | --- |
| ConstantPayoutCurve | [`TSHgwbab9XGjcGdQLdDAEQMgXy6QpnKE97`](https://nile.tronscan.org/#/contract/TSHgwbab9XGjcGdQLdDAEQMgXy6QpnKE97) | `41b300d2c0773e6f5c5c91a0dcec4d06d1a6dc98da` |
| Train | [`TKPCfMErMoBpr7YWcWJyNM2aG7EcAn6srj`](https://nile.tronscan.org/#/contract/TKPCfMErMoBpr7YWcWJyNM2aG7EcAn6srj) | `416742d4db7d0e14e2722874a57f1d38d080170e74` |
| TrainRouter | [`TY6hNw9Kvx6AcRJAAk9M9mCxZzuaSbQ3fG`](https://nile.tronscan.org/#/contract/TY6hNw9Kvx6AcRJAAk9M9mCxZzuaSbQ3fG) | `41f2bd5df61b877ef57764de3ed41030aeecf3d7c2` |

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
  addresses — bump the salt string deliberately for a new release and add a new section here.
- Deployment is permissionless and idempotent: anyone can re-run the deploy; only identical bytecode
  can occupy these addresses. Re-runs skip already-deployed contracts (this is how the Sepolia v2
  deploy was resumed after a partial run).
- Verification: a single Etherscan API v2 key covers all EVM chains above, including Monad
  (MonadScan). TrainRouter runtime bytecode differs slightly per chain on purpose (EIP-712 chain-id
  immutable); explorers cross-match it automatically. The CREATE2 address is unaffected (keyed on initcode).
- Runtime requirement: every target chain must support Cancun / EIP-1153 transient storage
  (on Tron: TVM GreatVoyage v4.8.0+).
- Tooling: [`script/DeployDeterministic.s.sol`](script/DeployDeterministic.s.sol) (Foundry, CREATE2),
  [`script/deploy-testnets.ps1`](script/deploy-testnets.ps1) (multi-chain orchestrator),
  [`script/deploy-tron.js`](script/deploy-tron.js) (TronWeb). See the
  [deploy section of the README](README.md#deploy--on-chain-testnet-flow) for usage.
- **Tempo-specific:** the deployer (and any relayer/fee-payer) needs a **pathUSD** balance, not native
  ETH — Tempo has no native gas token, and `eth_getBalance` there always returns a fixed sentinel
  regardless of actual balance, so it cannot be used as an affordability check (`DeployTempo.s.sol`
  checks pathUSD directly). No native-ETH support exists on this deployment at all (not just
  unreachable — the contract itself has no `payable` entrypoints). No `TrainRouter` is deployed on
  Tempo; use the native batched-and-sponsored flow instead (`script/tempo/native_flow.py`). pathUSD
  carries an active TIP-403 blacklist policy (README trust assumption 8) — accepted risk, not specific
  to this deployment tooling. See [`script/tempo/README.md`](script/tempo/README.md) for the full
  walkthrough.

---

## Historical — v1 (`train.protocol.v1`), DEPRECATED

Deployed from commit `c182e0c`, salt `keccak256('train.protocol.v1')`
(`0x5d7885c1f4cd41bf8dc1e01bc410bd87b5deea2f59186528a1021e520116fad6`). Superseded by v2. The v1
`TrainRouter` lacks intent replay protection and the v1 `Train` paginated getters can revert on
`offset + limit` overflow; prefer the v2 addresses above.

EVM (all chains): ConstantPayoutCurve `0xa46966484B1eB2c650333Db72de07f667dF76765`,
Train `0x9d81344fd19C2e1B29eCe4372D79EAe637df7E64`,
TrainRouter `0xCa04b09CCA22A4C872247303aa94FF7Ad700b6a9`.
Deployed on the same 7 testnets (Sepolia, Arbitrum/Base/OP/Linea Sepolia, BSC, Monad).

Tron Nile (v1): ConstantPayoutCurve `TQUDuMYbtjXimHMeFLh9kFnsCYUeqABbSm`,
Train `THVyZWFSabRbjBZXDUMBQaa2Wbxq11b145`, TrainRouter `TQQ4dYHYGvYdZhXsi9amayBMsQKtDPt8a3`.
