# EVM (Foundry) — chains/evm/solidity

All commands run from `chains/evm/solidity/`.

## Setup — submodules are required

```
git submodule update --init --recursive   # forge-std + openzeppelin-contracts (pinned SHAs)
```
`--recursive` matters: `remappings.txt` references libs nested inside the OZ submodule.
Without submodules `forge build` fails.

## Build / test

```
forge build                    # solc 0.8.34, via_ir, 1,000,000 runs, evm_version cancun
forge test                     # unit + fuzz; fork tests self-skip without RPC env
forge fmt --check              # line_length 120, tab_width 2
forge test --match-contract FoundryInvariant   # invariant suite
echidna . --contract FuzzTester --config echidna.yaml
medusa fuzz
```

- `slither_results.json` is a **committed Slither cache** — Medusa/Echidna need it; without it
  Medusa launches a live Slither pass that hangs on this via_ir project.
- Profiles via `FOUNDRY_PROFILE`: `default` (cancun), `tron`, `tempo` (**osaka**).

## Layout

- `src/Train.sol` — core HTLC vault (native + ERC20, ReentrancyGuardTransient/EIP-1153).
- `src/TrainRouter.sol` — fund-less gasless intake: Permit2, ERC-2612, EIP-3009.
- `src/ConstantPayoutCurve.sol` + `src/IPayoutCurve.sol` — pluggable payout curve (ERC-165 probed).
- `src/tempo/Train.sol` — **distinct contract** for Tempo L1: no native-asset paths, no
  `userLockFor`, no TrainRouter (Tempo has no native gas token; fees are paid in pathUSD).
  Mirror suite in `test/tempo/` (own invariant tree); run with `FOUNDRY_PROFILE=tempo`.
- `script/tempo/` — Tempo deploy/e2e scripts + `native_flow.py` (batched fee-sponsored flow).

## Deploy / verify gotchas

- Canonical record: `DEPLOYMENTS.md` (v3 = CreateX `deployCreate2`, salt
  `keccak256('train.protocol.v3')`, same address on every EVM chain).
- When `forge script` simulation fails (pruned-state forks, CreateX `FailedContractCreation` on
  Tempo), broadcast directly: `cast send <CreateX> "deployCreate2(bytes32,bytes)" <salt> <initcode>`
  (Tempo needs `--gas-limit 30000000`).
- Tempo verification: `forge verify-contract` 404s against Tempo's Sourcify — use
  `script/tempo/verify-tempo.sh` (direct `POST /v2/verify/{chainId}/{addr}`); patch
  `settings.evmVersion` to `"osaka"` in the generated std-JSON first.
- Tempo balance checks: `eth_getBalance` returns a fixed sentinel — check pathUSD instead.
- Tron: `npm run deploy:tron:nile|shasta|mainnet` (TronWeb, `FOUNDRY_PROFILE=tron`), different addresses by design.
