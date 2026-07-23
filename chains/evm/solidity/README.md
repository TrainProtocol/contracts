# Train Protocol — EVM Implementation

Trustless, permissionless cross-chain swaps via Hashed Time-Locked Contracts (HTLC). Users lock funds
on the source chain, solvers fulfil on the destination chain, and a single secret preimage atomically
unlocks both sides — or both refund after their timelocks.

## Contracts

| Contract | Role |
|---|---|
| [`Train.sol`](src/Train.sol) | Core HTLC vault. Holds **all** balances in one contract (no clones). User locks, solver locks, redeem, refund, plus a permissionless `userLockFor` intake. Native ETH + ERC20. |
| [`TrainRouter.sol`](src/TrainRouter.sol) | **Address-less gasless intake** for user locks via **Permit2**, **ERC-2612 permit**, and **EIP-3009** `receiveWithAuthorization`. Holds no funds and no governance; forwards into a per-call `train` bound by the user's signed intent. |
| [`ConstantPayoutCurve.sol`](src/ConstantPayoutCurve.sol) | The single payout curve: returns the full locked amount (no time decay). Pluggable via `IPayoutCurve`. |
| [`IPayoutCurve.sol`](src/IPayoutCurve.sol) | Curve interface (called via `STATICCALL`). |
| [`src/interfaces/`](src/interfaces/) | Minimal vendored `IERC3009`, `ISignatureTransfer` (Permit2), and `ITrain` (the `userLockFor` ABI the Router calls). |

Toolchain: Solidity **0.8.34**, `evm_version = cancun`, `via_ir = true`, optimizer runs 1,000,000.
Reentrancy is guarded with OpenZeppelin **`ReentrancyGuardTransient`** (EIP-1153 transient storage).

---

## Swap flow

```
            SOURCE CHAIN (Train)                         DESTINATION CHAIN (Train)
 user  ──userLock(hashlock, …)──►  lock                 solver ──solverLock(hashlock,…)──► lock
                                                          user ──redeemSolver(secret)──► reveals secret
 solver ──redeemUser(secret)──► gets funds  ◄────────────────── (secret now public)
            (or, after timelock, refundUser → refundTo)
```

`hashlock = sha256(abi.encodePacked(secret))` (SHA-256 for cross-chain compatibility; `secret` is a
`uint256`). Redeem works anytime while `Pending`; refunds are timelock-gated (the user lock's
`recipient` may refund anytime).

### Gasless user intake (TrainRouter)

For end users who shouldn't pay gas, a relayer submits the user's **signed intent** to the Router,
which pulls the user's tokens and forwards them into Train:

```
 user signs intent  ──►  relayer calls TrainRouter.forwardWith{Permit,Permit2,Authorization}(user, token, amount, train, callData, nonce, deadline, …)
                              │  pulls user's ERC20 (Permit2 / 2612 / 3009)
                              │  forceApprove(train, amount); train.call(callData); forceApprove(train, 0)
                              ▼
                          arbitrary `train` — here callData = Train.userLockFor(user, …) (lock attributed to `user`)
```

---

## TrainRouter — trust model

The Router is **target-agnostic and fully abstract**: no owner, no stored addresses, and **no knowledge
of the target's ABI**. The caller ABI-encodes the destination call off-chain as opaque `callData`; the
Router only pulls funds and forwards that call. The signed intent commits to
`(user, train, token, amount, keccak256(callData), nonce, deadline)`, so the signature fixes exactly
*where* funds go and *what* call executes — a relayer can only run the precise call the user authorized.

- **Exact-amount approve + forward.** The Router pulls the user's tokens, `forceApprove`s the
  (untrusted) `train` for **exactly** `amount`, low-level-`call`s `callData` (bubbling any revert), then
  resets the approval to 0. `train` can consume at most `amount`.
- **Conservation check.** After forwarding, the Router asserts its token balance returned to the
  pre-pull value (`ResidualBalance` otherwise) — it never custodies a balance, and a malicious/broken
  `train` that doesn't consume the funds reverts the whole tx (the user keeps their tokens).
- **Fund-safety vs. call-shape.** Because the Router doesn't inspect `callData`, the "right
  recipient/curve/amount" guarantee comes **entirely from the user's signature over `keccak256(callData)`**;
  the Router itself only guarantees it forwards exactly that call and custodies nothing. (Here the
  forwarded call is `Train.userLockFor`, which additionally re-measures its own `balanceOf` delta.)
- **Intent binding per standard:**
  - **ERC-2612** — a separate EIP-712 intent signature (verified with `SignatureChecker`, so EOAs and
    ERC-1271 smart accounts both work) binds `hashIntent(user, train, token, amount, callHash, nonce, deadline)`.
  - **Permit2** — the intent hash is the `permitWitnessTransferFrom` **witness** (one signature).
  - **EIP-3009** — the intent hash is forced as the **nonce** (one signature).
- **Replay** — every intent carries a user-chosen `nonce` and a `deadline`; the Router records its struct
  hash in `consumedIntent` and rejects re-use across **all three paths** (`IntentAlreadyConsumed`), and
  rejects an intent past its `deadline` (`IntentExpired`). A signed intent therefore executes at most once
  — vary the `nonce` to authorize a deliberate repeat of the same call. Train's unique-hashlock check
  remains as defense-in-depth behind the Router guard.

The Router's EIP-712 domain is `("TrainRouter", "1")`. `hashIntent`, `intentDigest`, `DOMAIN_SEPARATOR`,
and `WITNESS_TYPE_STRING` are exposed for off-chain signers.

---

## Trust assumptions & known issues

These are **documented, accepted** behaviors — read before integrating.

1. **Payout-curve trust (caller-supplied).** `payoutCurve` is only validated for `IPayoutCurve`
   support at lock creation — there is **no on-chain allowlist**. A lock creator could set a curve
   that returns a near-zero payout (sending most of the redeem to `refundTo`) or reverts (bricking
   redemption). **Mitigation: solvers must only fill locks whose `payoutCurve` they recognize** (it's
   in the `UserLocked` event before they commit). Only `ConstantPayoutCurve` is intended/shipped.
2. **Hashlock front-run squat.** The `userLocks` keyspace is global per `hashlock`. Anyone can occupy
   a hashlock with a ~1-wei lock, permanently blocking that specific swap (the `sender` slot is never
   cleared). No funds are at risk — the victim **re-quotes with a fresh secret**.
3. **`userLockFor` attribution.** Anyone may attribute a lock to any `user` at gas-only cost (the
   1-wei minimum is instantly reclaimable, and the lock owner of record is purely attributive — custody
   keys off `refundTo`/`recipient`, not `sender`). The only effect is appending to a `user`'s history
   list. The enumeration getters are **scale-safe** (windowed storage reads, `total = length`), so the
   list can't be inflated into a getter DoS. Intent-signature verification lives in the Router, never
   in Train.
4. **Fee-on-transfer / rebasing tokens.** The **direct** `userLock`/`solverLock` paths are FoT-safe —
   Train credits the measured balance delta. The **gasless Router** path expects non-FoT tokens (a fee
   on the user→Router leg reverts `InsufficientPulled`; the conservation check guarantees the Router
   custodies nothing but does not by itself guarantee full funding if a fee hits the Router→Train leg).
   Positive-rebasing tokens are not supported (the delta measurement could over-credit from pooled
   funds). Use standard ERC20s (e.g. USDC) on the gasless path.
5. **Native-ETH gas stipend.** ETH is sent with a 10,000-gas stipend. A contract `recipient`/`refundTo`
   whose `receive()`/fallback needs more will make redeem/refund revert — use an EOA for native-ETH
   locks. ERC20 transfers are unaffected.
6. **Native ETH is ERC20-only on the gasless path.** `userLock`/`solverLock` stay `payable` for native
   ETH; the Router is ERC20-only (the gasless standards are token signatures).
7. **Tempo gets a dedicated contract, not this one.** Tempo has no native gas token —
   `CALLVALUE`/`BALANCE`/`SELFBALANCE` always return 0. Rather than deploy this `Train.sol` with its
   native-ETH paths sitting unreachable, Tempo deploys [`src/tempo/Train.sol`](src/tempo/Train.sol): the
   same core HTLC logic with `payable`, the native-ETH branches, and `userLockFor` removed entirely
   (see point 9 for why `userLockFor` specifically isn't needed there). See
   [`script/tempo/README.md`](script/tempo/README.md).
8. **pathUSD carries an active TIP-403 blacklist policy.** Tempo's fee-fallback TIP-20 (`0x20C0...`) is
   not on the permissive default policy — it's on an admin-controlled blacklist (policy id 2, immediate
   effect, no appeal process). If a lock's `recipient`/`refundTo` gets blocked after creation, both
   redeem and refund can revert permanently on that lock — Train has no admin sweep. Accepted risk,
   noted here for awareness; document the current admin identity/governance when it's needed.
9. **`TrainRouter` is not deployed on Tempo at all.** Its whole purpose — let a user sign once
   off-chain and have an unrelated relayer submit and pay for it — is already a native Tempo Transaction
   feature (`calls: Vec<Call>` batching + `fee_payer_signature` sponsorship), proven working end-to-end
   on Moderato testnet. Deploying `TrainRouter` on Tempo would just reintroduce the TIP-1004 permit-`v`
   trap and TIP-403 exposure above for a caller with no reason to exist there — hence no `userLockFor`
   either (its only purpose is letting `TrainRouter` attribute a lock to someone other than
   `msg.sender`). See [`script/tempo/README.md`](script/tempo/README.md) for the native gasless flow.

---

## Core functions

### Train — user
- `userLock(params, dst, userData, solverData)` `payable` — caller funds + creates a user lock.
- `userLockFor(user, params, dst, userData, solverData)` — permissionless, ERC20-only, non-payable;
  funds pulled from `msg.sender`, lock attributed to `user`. The Router's forwarding target.
- `redeemUser(hashlock, secret)` — anyone with the secret; pays `recipient` (curve payout), excess to
  `refundTo`.
- `refundUser(hashlock)` — `recipient` anytime, others after timelock; returns full amount to `refundTo`.

### Train — solver
- `solverLock(params, dst, data) → index` `payable` — supports all (token, rewardToken) ETH/ERC20
  combinations; returns the per-hashlock lock index.
- `redeemSolver(hashlock, index, secret)` — reward → `rewardRecipient` before `rewardTimelock`, else →
  the redeemer (relayer bounty).
- `refundSolver(hashlock, index)` — after timelock; returns amount + reward to `refundTo`.

### Train — views (off-chain enumeration)
- `getUserLock(hashlock) → UserLock` · `getSolverLock(hashlock, index) → SolverLock` ·
  `getSolverLockCount(hashlock) → uint256`
- `getUserLockHashes(user, offset, limit) → (bytes32[], total)` and
  `getUserLocks(user, offset, limit) → (UserLock[], total)` — **windowed** reads (no whole-array copy);
  `total` is the user's lock count. Filter by `UserLock.status` **off-chain** (the on-chain status
  filter was removed so these never hit a node's `eth_call` gas cap regardless of list size).

### TrainRouter
- `forwardWithPermit(user, token, amount, train, callData, nonce, deadline, permitData, intentSig)`
- `forwardWithPermit2(user, token, amount, train, callData, nonce, deadline, permit2, permit, sig)`
- `forwardWithAuthorization(user, token, amount, train, callData, nonce, deadline, auth)`
- Each pulls `amount` of `token` gaslessly and forwards `callData` (e.g. an encoded `Train.userLockFor`)
  to `train`, then emits `IntentForwarded(user, train, callHash, relayer, token, amount)`. The intent's
  `nonce`+`deadline` give single-use replay protection (`consumedIntent`) across all three paths.
- views: `hashIntent(user, train, token, amount, callHash, nonce, deadline)`, `intentDigest(...)`,
  `consumedIntent(intentHash)`, `DOMAIN_SEPARATOR()`, `WITNESS_TYPE_STRING()`

---

## Payout curves

A lock may set `payoutCurve` + `payoutCurveData`; on redeem the recipient gets `computePayout(...)` and
any remainder goes to `refundTo` (refunds always return the full amount). The curve is `STATICCALL`ed
(`external view`), so it cannot mutate Train state. Curves must implement EIP-165; Train validates a
configured `payoutCurve` with OpenZeppelin's `ERC165Checker` before trusting it. The single shipped
curve, **`ConstantPayoutCurve`**, returns the full `amount` (no decay) — making the mechanism an
explicit no-op while keeping extensibility. See trust assumption #1 above on accepting arbitrary curves.

```solidity
interface IPayoutCurve is IERC165 {
  function computePayout(uint256 amount, uint48 startTime, uint48 currentTime, bytes calldata config)
    external view returns (uint256 payout);            // must satisfy 0 < payout <= amount
  // supportsInterface(bytes4) inherited from IERC165; Train probes it via ERC165Checker.
}
```

---

## Storage layout

Both lock structs are packing-aware (see the per-field slot annotations in `Train.sol`):

- **`UserLock`** — slots 0–7: `secret`,`amount` (full slots); `{sender,timelock,startTime}` pack into
  one slot; `{status,recipient}` into the next; `refundTo`,`token`,`payoutCurve` one each; `payoutCurveData` dynamic.
- **`SolverLock`** — slots 0–10: `secret`,`amount`,`reward`; `{sender,timelock,rewardTimelock}` pack;
  `{startTime,recipient,status}` pack; `rewardRecipient`,`refundTo`,`token`,`rewardToken`,`payoutCurve`
  one each; `payoutCurveData` dynamic.

`lock.amount`/`lock.reward` store the **measured received** amount (fee-on-transfer safe); the
`UserLocked`/`SolverLocked` events log the measured amount and the lock's `payoutCurve`
(`address(0)` when none), so indexers/solvers can see the curve without an extra RPC call.

---

## Errors

**Train:** `ZeroAmount`, `ZeroAddress`, `InvalidUser`, `NativeNotSupported`, `LockNotFound`,
`HashlockMismatch`, `LockNotPending`, `InvalidTimelock`, `InvalidRewardTimelock`, `SwapAlreadyExists`,
`TransferFailed`, `MsgValueMismatch`, `RefundNotAllowed`, `InvalidToken`, `QuoteExpired`,
`InvalidPayoutCurve`, `InvalidPayout`.

**TrainRouter:** `InvalidUser`, `NativeNotSupported`, `InvalidIntentSignature`, `Permit2Mismatch`,
`InsufficientPulled`, `ResidualBalance`.

---

## Build & test

```bash
forge build
forge test                                                   # unit + fuzz (fork tests self-skip)
forge test --fork-url $MAINNET_RPC_URL --match-path test/TrainRouterFork.t.sol   # real Permit2 + USDC
```

Test layout: `Train.t.sol` (+ `Train.fuzz.t.sol`) core unit/fuzz; `TrainRouter.t.sol` (mock Permit2/3009)
and `TrainRouterFork.t.sol` (real Permit2 + USDC); `UserLockFor.t.sol`; `PayoutCurve.t.sol`
(ConstantPayoutCurve + curve plumbing and the non-constant excess split); `TrainEdgeCases.t.sol` (revert
paths, zero-address guards, scale-safe getters, double-settle, dust, bounds); `TrainInvariants.t.sol` and
`Reentrancy.t.sol`. The protocol-wide invariants live once in `test/invariant/` and run under three engines —
Foundry (`FoundryInvariant`), Echidna, and Medusa.

> Medusa/Echidna read a cached Slither result (`slither_results.json`). Keep that file (or run
> `medusa fuzz --use-slither-force`) — without a cache Medusa launches a live Slither pass that is very
> slow / hangs on this `via_ir` project.

## Deploy & on-chain testnet flow

`script/Deploy.s.sol` deploys `ConstantPayoutCurve` + `Train` + `TrainRouter` and prints the addresses.
For a complete Sepolia deploy-and-exercise walkthrough (env vars, faucets, the gasless flows against
real Permit2/USDC, refunds, the EIP-7702 signer caveat, and `--verify`), see
[`script/sepolia/README.md`](script/sepolia/README.md).

```bash
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast \
  --verify --verifier etherscan --etherscan-api-key $ETHERSCAN_API_KEY
```

Target an EVM with **Cancun** support (transient storage). Well-known addresses used by the testnet
scripts: Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical), Sepolia USDC
`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.

### Deterministic multi-testnet deploy (same address on every chain)

`script/DeployDeterministic.s.sol` deploys the three contracts via **CREATE2** through the Arachnid
factory (`0x4e59b44847b379578588920cA78FbF26c0B4956C`), so the addresses depend only on the salt and
the initcode — **not** on the deployer key or nonce. Every chain gets the same three addresses, the
script is idempotent (already-deployed contracts are skipped), and deployment is permissionless:
anyone re-running it can only land the exact same bytecode at the same address.

`script/deploy-testnets.ps1` orchestrates it across 7 testnets — Sepolia, Arbitrum Sepolia,
Base Sepolia, OP Sepolia, BSC Testnet, Linea Sepolia, Monad Testnet — using the public
`[rpc_endpoints]` in `foundry.toml`, with explorer verification (Etherscan API v2 everywhere,
including MonadScan for Monad testnet):

```powershell
# fund the deployer key on all target chains first, then:
.\script\deploy-testnets.ps1 -DryRun            # simulate everywhere, broadcast nothing
.\script\deploy-testnets.ps1 -Chains sepolia    # pilot one chain
.\script\deploy-testnets.ps1                    # deploy + verify on all 7
```

Salt policy: addresses derive from `keccak256('train.protocol.v2')` (override with `CREATE2_SALT`).
Same salt + same commit + same solc/settings ⇒ same address; **any source or compiler-settings
change alters the initcode and therefore the address** — bump the salt string deliberately for a
new release. Each run also writes a local summary of that run to `deployments/testnets.json`
(gitignored, overwritten per run); the canonical deployment record lives in
[`DEPLOYMENTS.md`](DEPLOYMENTS.md) — deployed addresses, chain IDs, and per-network status.

**Tron** cannot share these addresses (different address derivation, no CREATE2 factory) and is
deployed separately with plain deploys via TronWeb — `npm install`, set `TRON_PRIVATE_KEY`, then
`npm run deploy:tron:nile` (or `:shasta` / `:mainnet`). Requires TVM ≥ GreatVoyage-v4.8.0 (Kant)
for transient storage; Nile/Shasta have it.

### Deploying to Tempo

Tempo (targets the Osaka hard fork, no native gas token) deploys a different contract
([`src/tempo/Train.sol`](src/tempo/Train.sol), not `Train.sol`) via a dedicated `[profile.tempo]` build
profile and `script/tempo/DeployTempo.s.sol` — no `TrainRouter` (see trust assumptions 7–9 above). Full
walkthrough, connection details, the native gasless-intake flow, and solver operational notes: see
[`script/tempo/README.md`](script/tempo/README.md).

> ⚠️ No guarantee of security is given. An independent audit and a bug bounty are recommended before
> mainnet use.
