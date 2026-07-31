# Train Protocol Starknet — Mainnet Deployments

## Current release — solver double-lock guard (deployed 2026-07-31)

Deployed from `main-add-starknet` @ `f78bacf` ("solver double-lock guard + fresh Sepolia deploy,
e2e, verification") · Starknet mainnet (`SN_MAIN`)

| | |
|---|---|
| **Train contract** | [`0x397630513a04161f0f73bc1aaf76c6e10f85d8b17b42d00d11e8767a1cf5255`](https://voyager.online/contract/0x397630513a04161f0f73bc1aaf76c6e10f85d8b17b42d00d11e8767a1cf5255) |
| **Class hash** | [`0x64d8573c2f3ef167278c765031ed7c8a969ebac44dbe56ac687450e45a7bb49`](https://voyager.online/class/0x64d8573c2f3ef167278c765031ed7c8a969ebac44dbe56ac687450e45a7bb49#code) |
| Declare tx | [`0x720f791455287deab0a248e53cff1764b65cb302f4362a4f8c39d3bd21372cf`](https://voyager.online/tx/0x720f791455287deab0a248e53cff1764b65cb302f4362a4f8c39d3bd21372cf) |
| Deploy tx (UDC) | [`0x2406f8f1bacaa591114e8d1f64d64662936788d17afef83ebb61b191b4a0652`](https://voyager.online/tx/0x2406f8f1bacaa591114e8d1f64d64662936788d17afef83ebb61b191b4a0652) |
| Deploy salt | `train-protocol-mainnet-v1` (UDC `unique: false` — address is a pure function of class hash + salt) |
| Compiler | scarb 2.14.0 / cairo 2.14.0 |

- The address matched the pre-computed deterministic prediction exactly.
- **Class hash is identical to the fresh Sepolia deployment** (`0x331d2d50…52b0` on Sepolia
  carries this same class), so mainnet ships precisely the bytecode that passed the Sepolia
  e2e suite for this release. Verified pre-deploy by comparing the locally built class hash
  against `starknet_getClassHashAt` on Sepolia.
- `verify.ts` report: **[PASS]** on-chain class hash matches local build; **[PASS]** ABI matches.
- Voyager source verification: class already verified — Voyager keys verification by **class
  hash**, and this identical class was source-verified during the Sepolia run, so the mainnet
  class page shows source without a resubmission (the submit API returns
  "Contract or class already verified").
- Live probe: 11 interface functions exposed, identity-keyed solver API present.

### Scope

Train only. `ConstantPayoutCurve` and `TrainRouter` are deliberately **not** deployed on mainnet
— locks pass `payout_curve = 0x0` (validation skipped, full payout), and the Rail A gasless
flow stays unavailable until the router ships. Both remain deployable later at their own
deterministic addresses.

### Cost

| Item | STRK |
|---|---|
| Declare (class) + UDC deploy | **52.55** |
| Balance required to submit (resource bounds) | 118.12 |
| Deployer `0x05881aaa…4be4` remaining | 73.86 |

Note the gap between the 118.12 STRK the protocol requires the account to *hold* and the 52.55
actually charged — Starknet validates against maximum resource bounds, so a declare needs
roughly 2.25× its true cost sitting in the account.

## Superseded — first mainnet release (deployed 2026-07-29)

Still live, but superseded by the address above (pre-solver-guard bytecode):

| | |
|---|---|
| Train contract | `0x60111a1a10c8669c899ea74a7a155891887b3dd906e7f3eb912907cac50d66a` |
| Class hash | `0x689ed744206b543442dd3c42f6d53f3ebd0fdded4569a11fe8b387bd8f0e264` |
| Declare / deploy tx | `0x6aa1f8eed4ab8b69932de21c2db8ba9b4fe45b5facf5bde177f4c079ee23a38` / `0x54f750aa6ac1a59f21e07c86c457c9f5b07c37264692cc5f4d83f8ae7dd717b` |

Cost then: account deploy 0.0436 + declare ~50.43 + UDC deploy ~0.05 ≈ 50.52 STRK.

## Tokens (for integrators)

Canonical mainnet tokens (same addresses as Sepolia):
- STRK: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- ETH: `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
