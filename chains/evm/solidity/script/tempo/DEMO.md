# Tempo on-chain demo — every transaction, for real

Every scenario below ran against the real deployed contracts on Moderato testnet (chain id `42431`):

| Contract | Address |
|---|---|
| `Train` ([`src/tempo/Train.sol`](../../src/tempo/Train.sol)) | [`0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29`](https://explore.testnet.tempo.xyz/address/0xf37846fD2D6fAC5E4F7597463a1c4f30397A9e29) |
| `ConstantPayoutCurve` | [`0xe07d9f773112388E0126B31611A4A56Cf6a9E3Fa`](https://explore.testnet.tempo.xyz/address/0xe07d9f773112388E0126B31611A4A56Cf6a9E3Fa) |
| pathUSD (fee-fallback TIP-20) | `0x20C0000000000000000000000000000000000000` |

No txs here are simulated, dry-run, or against a throwaway contract — every hash below is a real,
confirmed transaction against the addresses above, produced by the scripts in this directory. See
[`README.md`](README.md) for how to reproduce any of them.

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
| `lock` (batched `approve` + `userLock`, sponsored) | [`0x99995e1419aab812fa4fd17ac1fd8945a6bb37da40db190560f78e8af06af226`](https://explore.testnet.tempo.xyz/tx/0x99995e1419aab812fa4fd17ac1fd8945a6bb37da40db190560f78e8af06af226) | success | 1,610,173 | fee payer ≠ sender, verified from the receipt's `feePayer` field |
| `redeemUser` (sponsored) | [`0x306dd372da5878d56318ff24ee024dc84950adaabb4c0a0fcdeb1244ae421578`](https://explore.testnet.tempo.xyz/tx/0x306dd372da5878d56318ff24ee024dc84950adaabb4c0a0fcdeb1244ae421578) | success | 320,872 | sender's pathUSD balance nets back to its pre-lock value; sender paid **zero** gas across both transactions |

Sender: `0xDfd6a355aae92Ae58A82Ea247b8fEbf5dC77bEF5` — fee payer:
`0xb577EA81Af0A790d17a74Cc10598e8d8EfB52c42`. The receipt's `feePayer` field on both transactions
reads back as the fee payer's address, confirmed distinct from the sender — this is the load-bearing
proof that Tempo's native `fee_payer_signature` mechanism, not `msg.sender` reassignment or a relayer
contract, is what covers the user's gas.

A first-ever `lock` from a brand-new account (no prior transactions, no prior allowance slot) costs
more — measured separately at `2,107,473` gas — because Tempo's TIP-1000 charges a one-time
250,000-gas account-creation surcharge on top of the per-slot state-creation charges every `lock`
already pays. The `1,610,173`-gas figure above is for a sender with prior on-chain history (the
account created earlier in this same test pass), so it reflects the steady-state cost, not the
one-time first-run cost — both numbers are documented in `native_flow.py`'s comments.

---

## 2. Direct happy path — `userLock` → `redeemUser`

Broadcast directly by the user (no sponsorship) via [`TestDirect.s.sol`](TestDirect.s.sol):

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `userLock` | [`0xb46d344d7386fe890a003246f1d66edc43b0bcd43f96b4de7f62cc9e1a64a708`](https://explore.testnet.tempo.xyz/tx/0xb46d344d7386fe890a003246f1d66edc43b0bcd43f96b4de7f62cc9e1a64a708) | success | 2,082,803 |
| `redeemUser` | [`0xf9d5916ed2052022bc16e8503755ea1002b37d3db3ed22c5321ae4b240af2d16`](https://explore.testnet.tempo.xyz/tx/0xf9d5916ed2052022bc16e8503755ea1002b37d3db3ed22c5321ae4b240af2d16) | success | 314,960 |

Final state: `lock.status == 3` (Redeemed). The `userLock` here is this account's first-ever
transaction, which is why its gas is close to the "first-ever" figure quoted in section 1.

## 3. Solver reward routing — both branches, `TestSolverReward.s.sol`

`redeemSolver`'s reward destination depends on whether the redeem lands before or after
`rewardTimelock`:

| Branch | Step | Tx hash | Status | Gas used |
|---|---|---|---|---|
| [1] redeemed **before** `rewardTimelock` → reward to `rewardRecipient` | `solverLock` | [`0xc95021ca3f56dc5f131a9b4d67d8cf4adb602c4a6377ffa564543c772358a773`](https://explore.testnet.tempo.xyz/tx/0xc95021ca3f56dc5f131a9b4d67d8cf4adb602c4a6377ffa564543c772358a773) | success | 2,585,994 |
| | `redeemSolver` | [`0xeb02aad6dfa634d7c3e020f4d8c8299843a4d8498429211889025cfab09bfd31`](https://explore.testnet.tempo.xyz/tx/0xeb02aad6dfa634d7c3e020f4d8c8299843a4d8498429211889025cfab09bfd31) | success | 326,291 |
| [2] redeemed **at/after** `rewardTimelock` → reward to the redeemer instead | `solverLock` | [`0xc9ca6de9d2a31defae0f0ab627d8ced6358c48e0f60fc3e465a6cbb0c1100bee`](https://explore.testnet.tempo.xyz/tx/0xc9ca6de9d2a31defae0f0ab627d8ced6358c48e0f60fc3e465a6cbb0c1100bee) | success | 2,585,958 |
| | `redeemSolver` | [`0x8533bba3433486c165459085ecd1afa1b47539f753945556e90bbf33611d9afa`](https://explore.testnet.tempo.xyz/tx/0x8533bba3433486c165459085ecd1afa1b47539f753945556e90bbf33611d9afa) | success | 324,190 |

## 4. Refund cycles — timelock-gated

### User lock refund — `TestRefundLock.s.sol` → `TestRefundClaim.s.sol`

Recipient set to a counterparty (not the user), so the user must wait out the 60s timelock rather
than take the "recipient may refund anytime" branch:

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `userLock` (60s timelock) | [`0xc123521db6f51829af9ee0755aa9f5da345aa4bfd06dcd648c770776cd261645`](https://explore.testnet.tempo.xyz/tx/0xc123521db6f51829af9ee0755aa9f5da345aa4bfd06dcd648c770776cd261645) | success | 1,835,491 |
| `refundUser` (after wait) | [`0x94b65a8fc256499a252c57f39b51ef902de2c1f89a5eb162b8a76ba4fabab83d`](https://explore.testnet.tempo.xyz/tx/0x94b65a8fc256499a252c57f39b51ef902de2c1f89a5eb162b8a76ba4fabab83d) | success | 54,259 |

Final state: `lock.status == 2` (Refunded); pathUSD reclaimed to `refundTo == user`.

### Solver lock refund — `TestSolverRefund.s.sol` → `TestSolverRefundClaim.s.sol`

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `solverLock` (60s timelock) | [`0xcf7b72c95ab52a0ec35df578af0b62ab4d0aff24ce19188437e73ebe76bf5179`](https://explore.testnet.tempo.xyz/tx/0xcf7b72c95ab52a0ec35df578af0b62ab4d0aff24ce19188437e73ebe76bf5179) | success | 2,336,670 |
| `refundSolver` (after wait) | [`0x72cb05ce1959cc1a9849044a7d684f9c8936450b7c3a58e4c9a6fc78fdf4bade`](https://explore.testnet.tempo.xyz/tx/0x72cb05ce1959cc1a9849044a7d684f9c8936450b7c3a58e4c9a6fc78fdf4bade) | success | 59,584 |

Both amount and reward returned to `refundTo == user`.

## 5. Unhappy paths — real reverted transactions, `TestUnhappy.s.sol`

Each scenario below is a genuine on-chain revert, not a local simulation — `forge script` was pointed
at each scenario's own `--sig` entrypoint with an explicit gas value on the reverting call (see
README Troubleshooting), so the deliberately-failing transaction actually broadcasts and confirms
`status: 0` on-chain with the exact custom error this branch of `Train` is supposed to raise.

| Scenario | Setup tx | Reverted tx | Revert reason | Gas used (revert) |
|---|---|---|---|---|
| [1] Wrong-secret redeem | [`0xfb83a15c3b4a668544b72c524852ad036da1bc2a1bc36051023d55b7162007b9`](https://explore.testnet.tempo.xyz/tx/0xfb83a15c3b4a668544b72c524852ad036da1bc2a1bc36051023d55b7162007b9) (`userLock`) | [`0x154e371284687653ded62eeee860d9b5da6ad2f5b2a3bed5ff856cbf8158ae94`](https://explore.testnet.tempo.xyz/tx/0x154e371284687653ded62eeee860d9b5da6ad2f5b2a3bed5ff856cbf8158ae94) | `HashlockMismatch()` | 25,201 |
| [2] Double-redeem | [`0x7500f40c51b377dad31208f8de29147be80030c29dec753ce153d523c551d153`](https://explore.testnet.tempo.xyz/tx/0x7500f40c51b377dad31208f8de29147be80030c29dec753ce153d523c551d153) (`userLock`) → [`0x521a0be762842daa16426276cbb6c16f7e68a8cc52b23a775f1cafe71b6d095e`](https://explore.testnet.tempo.xyz/tx/0x521a0be762842daa16426276cbb6c16f7e68a8cc52b23a775f1cafe71b6d095e) (first `redeemUser`, succeeds) | [`0x61647f313dc9185316807697e494490762f3d1a2fce40fce0699eb8b96499256`](https://explore.testnet.tempo.xyz/tx/0x61647f313dc9185316807697e494490762f3d1a2fce40fce0699eb8b96499256) | `LockNotPending()` | 27,375 |
| [3] Early non-recipient refund | [`0x04c4e7d0d60df107c10a1c281655f137c3a1439aa9085567e41619fca68ff8fb`](https://explore.testnet.tempo.xyz/tx/0x04c4e7d0d60df107c10a1c281655f137c3a1439aa9085567e41619fca68ff8fb) (`userLock`) | [`0x4622a467ca58b9fc041d1e1f9466fdf14d16f5646e23795cc50211a6be7fb18e`](https://explore.testnet.tempo.xyz/tx/0x4622a467ca58b9fc041d1e1f9466fdf14d16f5646e23795cc50211a6be7fb18e) | `RefundNotAllowed()` | 26,556 |

All three revert selectors were confirmed by decoding the transaction's actual return data
(`cast receipt <hash>` / the script's own low-level `.call` return value), not assumed from the test
setup — each revert cost only its base call overhead (~25k–27k gas), confirming that a revert rolls
back any state-creation gas the attempted write would otherwise have charged.

## 6. Setup — one-time pathUSD approval

| Step | Tx hash | Status | Gas used |
|---|---|---|---|
| `PATH_USD.approve(Train, type(uint256).max)` | [`0x2a9adf46bc8091a9a94728a0f5d77511b9968c84d42d0c248d67fa4351814053`](https://explore.testnet.tempo.xyz/tx/0x2a9adf46bc8091a9a94728a0f5d77511b9968c84d42d0c248d67fa4351814053) | success | 528,986 |

---

## Summary

20 real transactions, all confirmed on Moderato testnet against the live `Train` deployment: 17
successes (deploys not included — see [`DEPLOYMENTS.md`](../../DEPLOYMENTS.md)) and 3 deliberate,
confirmed reverts. Every happy path reaches its expected terminal state (`Redeemed` or `Refunded`);
every unhappy path reverts with exactly the custom error the code path is designed to raise; the
native sponsorship flow moves real funds through a real lock/redeem cycle while the sender pays zero
gas and never touches a gas token, sponsored entirely by a distinct fee-payer key — the concrete,
on-chain proof that Tempo's native transaction batching and fee-payer sponsorship stand in for
`TrainRouter` on this chain.
