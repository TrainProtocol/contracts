# Tempo on-chain demo — every transaction, for real

Every scenario below ran against the real deployed **v3** contracts on Moderato testnet (chain id
`42431`; see [`DEPLOYMENTS.md`](../../DEPLOYMENTS.md) for the release notes — v3 keys solver locks
by `(hashlock, solver)` and adds the `SolverLockAlreadyExists` double-funding guard, demonstrated
live in section 5):

| Contract | Address |
|---|---|
| `Train` ([`src/tempo/Train.sol`](../../src/tempo/Train.sol)) | [`0xCb74407724c463EAA9bC661818364b532F8B5Cb5`](https://explore.testnet.tempo.xyz/address/0xCb74407724c463EAA9bC661818364b532F8B5Cb5) |
| `ConstantPayoutCurve` | [`0x758347A30b49d353F9C4dc8189F5c8f91FeaB27b`](https://explore.testnet.tempo.xyz/address/0x758347A30b49d353F9C4dc8189F5c8f91FeaB27b) |
| pathUSD (fee-fallback TIP-20) | `0x20C0000000000000000000000000000000000000` |

No txs here are simulated, dry-run, or against a throwaway contract — every hash below is a real,
confirmed transaction against the addresses above, produced by the scripts in this directory. See
[`README.md`](README.md) for how to reproduce any of them. (The equivalent v2-era demo ran on
2026-07-16 against `0xf378…9e29`; its transactions remain on-chain but the v2 solver API differs —
this document reflects the current v3 deployment only.)

---

## 1. Native gas-sponsorship flow — the primary integration path

This is what replaces `TrainRouter` on Tempo entirely (see the main
[README](../../README.md), trust assumption 9): one Tempo Transaction batches
`pathUSD.approve(Train, amount)` + `Train.userLock(...)` into a single signed envelope, a **separate
fee-payer** counter-signs and pays for gas, and both calls execute with `msg.sender` still equal to
the real user throughout. The user never holds, spends, or is even aware of a gas token. Run via
[`native_flow.py`](native_flow.py) (`pytempo`) — Tempo Transactions are a distinct signed-envelope
format outside what `vm.broadcast`/Foundry scripts can construct.

| Step | Tx hash | Status | Gas used | Notes |
|---|---|---|---|---|
| `lock` (batched `approve` + `userLock`, sponsored) | [`0xa3e370e4752249f894284cbc8160f8e6d6b538fffaca0a5b60d3713bbef53be3`](https://explore.testnet.tempo.xyz/tx/0xa3e370e4752249f894284cbc8160f8e6d6b538fffaca0a5b60d3713bbef53be3) | success | 2,091,949 | fee payer ≠ sender, verified from the receipt's `feePayer` field; brand-new sender account, so this includes TIP-1000's one-time ~250k account-creation surcharge |
| `redeemUser` (sponsored) | [`0x1489345476b663b2d1a4385483f14351b251f4a3226b67b707e6adb6ac25581a`](https://explore.testnet.tempo.xyz/tx/0x1489345476b663b2d1a4385483f14351b251f4a3226b67b707e6adb6ac25581a) | success | 308,039 | sender's pathUSD balance nets back to its pre-lock value; sender paid **zero** gas across both transactions |

Sender: `0xa95C59466c46004A7fC492C47964CEc345568191` — fee payer:
`0xDf2bf1F4619b34b6654453445c1B8edb4E61bCac`. The receipt's `feePayer` field on both transactions
reads back as the fee payer's address, confirmed distinct from the sender — this is the load-bearing
proof that Tempo's native `fee_payer_signature` mechanism, not `msg.sender` reassignment or a relayer
contract, is what covers the user's gas.

The sender here is a brand-new account (no prior transactions, no prior allowance slot), so the
`2,091,949`-gas `lock` is the **first-ever** cost — Tempo's TIP-1000 charges a one-time 250,000-gas
account-creation surcharge on top of the per-slot state-creation charges every `lock` already pays.
A sender with prior on-chain history pays the steady-state cost instead (compare `userLock` at
1,831,015 gas in section 2, from a warm account).

---

## 2. Direct happy path — `userLock` → `redeemUser`

Broadcast directly by the user (no sponsorship) via [`TestDirect.s.sol`](TestDirect.s.sol):

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `userLock` | [`0x6d608a1dcefd9cb1b30701fb0f2075c5be572a36b44f5c202da9d64df1425f09`](https://explore.testnet.tempo.xyz/tx/0x6d608a1dcefd9cb1b30701fb0f2075c5be572a36b44f5c202da9d64df1425f09) | success | 1,831,015 |
| `redeemUser` | [`0x370d3b2ac19fd52494354f69a91cc55e4aeee09553ad7302970f9341c650bfe1`](https://explore.testnet.tempo.xyz/tx/0x370d3b2ac19fd52494354f69a91cc55e4aeee09553ad7302970f9341c650bfe1) | success | 308,139 |

Final state: `lock.status == 3` (Redeemed). The broadcasting account has prior on-chain history, so
this is the steady-state `userLock` cost (no TIP-1000 first-ever surcharge).

## 3. Solver reward routing — both branches, `TestSolverReward.s.sol`

`redeemSolver`'s reward destination depends on whether the redeem lands before or after
`rewardTimelock`. Note the v3 signature: `redeemSolver(hashlock, solver, secret)` — solver locks are
keyed by the solver's address, there is no index.

| Branch | Step | Tx hash | Status | Gas used |
|---|---|---|---|---|
| [1] redeemed **before** `rewardTimelock` → reward to `rewardRecipient` | `solverLock` | [`0x105e6ae7abcd899aeef6c42804395e2b29a2c78eb309f5ce8acb676b5de17a4b`](https://explore.testnet.tempo.xyz/tx/0x105e6ae7abcd899aeef6c42804395e2b29a2c78eb309f5ce8acb676b5de17a4b) | success | 2,081,680 |
| | `redeemSolver` | [`0x98b1a69343a1ae2deb007f92d091bf4046c6669f88fd09c0db1efd86b3e05335`](https://explore.testnet.tempo.xyz/tx/0x98b1a69343a1ae2deb007f92d091bf4046c6669f88fd09c0db1efd86b3e05335) | success | 319,089 |
| [2] redeemed **at/after** `rewardTimelock` → reward to the redeemer instead | `solverLock` | [`0x4d1684e4bb076b72ac23e8fd7286da1fe6ca44fc01a1ce2709154dfeec993d27`](https://explore.testnet.tempo.xyz/tx/0x4d1684e4bb076b72ac23e8fd7286da1fe6ca44fc01a1ce2709154dfeec993d27) | success | 2,081,644 |
| | `redeemSolver` | [`0xc0cdb21dc5a925c9267b08255d44ea67f95c113a712a078dbc3cd6d5300c3f3f`](https://explore.testnet.tempo.xyz/tx/0xc0cdb21dc5a925c9267b08255d44ea67f95c113a712a078dbc3cd6d5300c3f3f) | success | 316,988 |

## 4. Refund cycles — timelock-gated

### User lock refund — `TestRefundLock.s.sol` → `TestRefundClaim.s.sol`

Recipient set to a counterparty (not the user), so the user must wait out the 60s timelock rather
than take the "recipient may refund anytime" branch:

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `userLock` (60s timelock) | [`0x05234f3aea7b0fbebae8e5648980cdf0404211d6de8011a67b8bd09c7a064ce1`](https://explore.testnet.tempo.xyz/tx/0x05234f3aea7b0fbebae8e5648980cdf0404211d6de8011a67b8bd09c7a064ce1) | success | 1,583,691 |
| `refundUser` (after wait) | [`0x08e784922b9f58485b99ca4b33a41ef744fd956604275e1cdc5cc436fa9f9bad`](https://explore.testnet.tempo.xyz/tx/0x08e784922b9f58485b99ca4b33a41ef744fd956604275e1cdc5cc436fa9f9bad) | success | 47,459 |

Final state: `lock.status == 2` (Refunded); pathUSD reclaimed to `refundTo == user`.

### Solver lock refund — `TestSolverRefund.s.sol` → `TestSolverRefundClaim.s.sol`

v3 signature: `refundSolver(hashlock, solver)`.

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `solverLock` (60s timelock) | [`0x3ed4321783a5859e0dfceab59a206670748021f13c5acf6c62e999cbdb3cbf64`](https://explore.testnet.tempo.xyz/tx/0x3ed4321783a5859e0dfceab59a206670748021f13c5acf6c62e999cbdb3cbf64) | success | 2,077,344 |
| `refundSolver` (after wait) | [`0x32bc4a2ac115ffaf07e4fc8b554bd500b9ff32d63958bb02c27fbb37ea07d5fd`](https://explore.testnet.tempo.xyz/tx/0x32bc4a2ac115ffaf07e4fc8b554bd500b9ff32d63958bb02c27fbb37ea07d5fd) | success | 57,748 |

Both amount and reward returned to `refundTo == user`. Note: after this refund the guard in section
5 still applies — a refunded solver can NOT re-lock the same hashlock from the same address (the v3
uniqueness is permanent); a deliberate re-fill needs a different solver address.

## 5. Unhappy paths — real reverted transactions, `TestUnhappy.s.sol`

Each scenario below is a genuine on-chain revert, not a local simulation — `forge script` was pointed
at each scenario's own `--sig` entrypoint with an explicit gas value on the reverting call (see
README Troubleshooting), so the deliberately-failing transaction actually broadcasts and confirms
`status: 0` on-chain with the exact custom error this branch of `Train` is supposed to raise.

| Scenario | Setup tx | Reverted tx | Revert reason | Gas used (revert) |
|---|---|---|---|---|
| [1] Wrong-secret redeem | [`0x483ce96015c02cd0308b994418168709f617ca7ad45b934484e40c1bb0e4999f`](https://explore.testnet.tempo.xyz/tx/0x483ce96015c02cd0308b994418168709f617ca7ad45b934484e40c1bb0e4999f) (`userLock`) | [`0xef5d1d2cb221d425e34a96078ccc1a12e49571f8fb258483f6b0bf76342c2dee`](https://explore.testnet.tempo.xyz/tx/0xef5d1d2cb221d425e34a96078ccc1a12e49571f8fb258483f6b0bf76342c2dee) | `HashlockMismatch()` | 25,180 |
| [2] Double-redeem | [`0x29e0aec89ab86d49d85c064fb3cf393b6a4b7b8697f9b5f614869225e7a0d8f2`](https://explore.testnet.tempo.xyz/tx/0x29e0aec89ab86d49d85c064fb3cf393b6a4b7b8697f9b5f614869225e7a0d8f2) (`userLock`) → [`0x52a5b26100038afd0e694904ee5fea16eec133765c3cd71e3a9b8f3987b693be`](https://explore.testnet.tempo.xyz/tx/0x52a5b26100038afd0e694904ee5fea16eec133765c3cd71e3a9b8f3987b693be) (first `redeemUser`, succeeds) | [`0x8506fe493981129b981de416a9abd2da3183be578913f0baf3dc8dd5063c549e`](https://explore.testnet.tempo.xyz/tx/0x8506fe493981129b981de416a9abd2da3183be578913f0baf3dc8dd5063c549e) | `LockNotPending()` | 27,342 |
| [3] Early non-recipient refund | [`0x9d59dbb69e93491af9d1a5087eb3eca24bc9da47cd5acea3088767fc6fa32d8b`](https://explore.testnet.tempo.xyz/tx/0x9d59dbb69e93491af9d1a5087eb3eca24bc9da47cd5acea3088767fc6fa32d8b) (`userLock`) | [`0x4ad4b17353479987aa987d8ab52210866dc96caaef08ee56e7d6d51331404e4d`](https://explore.testnet.tempo.xyz/tx/0x4ad4b17353479987aa987d8ab52210866dc96caaef08ee56e7d6d51331404e4d) | `RefundNotAllowed()` | 26,556 |
| [4] **Same-solver duplicate `solverLock` — the v3 double-funding guard** | [`0x9398ef4fd5c8b6839a7b5100fdf70ec11ff11d3191069ad9f9ea2c640c274add`](https://explore.testnet.tempo.xyz/tx/0x9398ef4fd5c8b6839a7b5100fdf70ec11ff11d3191069ad9f9ea2c640c274add) (`solverLock`, succeeds) | [`0x646158bdece9cc57010cac8b90fa727f69d937031bf364964b7bd95290dd3db7`](https://explore.testnet.tempo.xyz/tx/0x646158bdece9cc57010cac8b90fa727f69d937031bf364964b7bd95290dd3db7) | `SolverLockAlreadyExists()` | 35,050 |

All four revert selectors were confirmed by decoding the transaction's actual return data
(the script's own low-level `.call` return value), not assumed from the test setup — each revert
cost only its base call overhead (~25k–35k gas), confirming that a revert rolls back any
state-creation gas the attempted write would otherwise have charged.

Scenario [4] is the on-chain proof of v3's headline change: an identical `solverLock` retry by the
same solver under the same hashlock (the situation a lying/flaky RPC can push a solver into)
reverts **before any funds are pulled** — the account's pathUSD moved only for the first lock; the
retry cost nothing but its gas. Solver locks are keyed by `(hashlock, solver)`; the guard never
lifts, even after refund or redeem.

## 6. Setup — one-time pathUSD approval

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `PATH_USD.approve(Train, type(uint256).max)` | [`0x5b91f1fd023ba63d41acd2707f633d4a616c50e531f804e9ea2ac06d058e224a`](https://explore.testnet.tempo.xyz/tx/0x5b91f1fd023ba63d41acd2707f633d4a616c50e531f804e9ea2ac06d058e224a) | success | 33,218 |

(The broadcasting account already had on-chain history from the v2-era demo, so no TIP-1000
account-creation surcharge applies here — compare the v2 run's 528,986-gas first-ever approval.)

---

## Summary

23 real transactions, all confirmed on Moderato testnet against the live v3 `Train` deployment: 19
successes (deploys not included — see [`DEPLOYMENTS.md`](../../DEPLOYMENTS.md)) and 4 deliberate,
confirmed reverts. Every happy path reaches its expected terminal state (`Redeemed` or `Refunded`);
every unhappy path reverts with exactly the custom error the code path is designed to raise —
including the new `SolverLockAlreadyExists` retry guard, proven with a real double-lock attempt that
took no funds; the native sponsorship flow moves real funds through a real lock/redeem cycle while
the sender pays zero gas and never touches a gas token, sponsored entirely by a distinct fee-payer
key — the concrete, on-chain proof that Tempo's native transaction batching and fee-payer
sponsorship stand in for `TrainRouter` on this chain.
