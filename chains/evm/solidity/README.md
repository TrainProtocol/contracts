# Train EVM Contracts

This Hardhat package contains the EVM leg of the Train protocol. The current Solidity sources are:

| File                       | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `contracts/Train.sol`      | Native ETH hashed-timelock contract that escrows value via `msg.value`.        |
| `contracts/TrainERC20.sol` | ERC20 mirror of `Train.sol`, using `SafeERC20` transfers and allowance checks. |
| `contracts/TestToken.sol`  | Minimal mintable token used only inside the automated tests.                   |

Both Train contracts implement the same swap lifecycle and storage layout so off-chain tooling can treat them interchangeably.

## HTLC Model

- `lockSrc` opens a user HTLC (no reward). User flows always consume `htlcId = 0` and register in `userSwaps`.
- `lockDst` opens a solver HTLC (with reward). Solver flows either take slot `0` (if first for a `swapId`) or append to the next open slot.
- Funds stay locked until a matching secret pre-image is supplied via `redeem` or the timelock passes and anyone can `refund`.
- Rewards include a separate `rewardTimelock` so solvers/relayers can claim the fee even if the receiver lags. Rewards must be at least 10% of the swap amount (ETH: `msg.value - reward`; ERC20: `amount`) validated via multiplication to avoid integer rounding.
- Errors such as `InvalidTimelock`, `InvalidRewardTimelock`, `InvalidRewardAmount`, `FundsNotSent`, `NoAllowance`, or `SwapAlreadyInitialized` enforce invariants in both contracts.

Events (`SrcLocked`, `DstLocked`, `TokenRedeemed`, `TokenRefunded`) surface all data required for off-chain monitoring. The ERC20 variant appends the `token` address to the event schema.

## Development & Testing

All work happens from `chains/evm/solidity` using Solidity **0.8.30** (optimizer enabled, via-IR, Cancun target). Two deterministic test suites cover the native and ERC20 variants (including boundary and tiny-amount cases):

```bash
# Native ETH contract
npx hardhat test test/native.js

# ERC20 mirror (mints/approves TestToken per signer)
npx hardhat test test/erc20.js

```

For gas measurements, enable reporting when running the tests.

## Gas Snapshots

Collected with `REPORT_GAS=true npx hardhat test ...` on Hardhat's in-process network (Cancun rules, 30M gas block, optimizer runs = 200). Figures report min/avg/max across every call seen during the suite.

### `Train.sol`

| Method    | Min     | Avg     | Max     | Calls |
| --------- | ------- | ------- | ------- | ----- |
| `lockSrc` | 178,024 | 193,818 | 195,136 | 78    |
| `lockDst` | 192,269 | 195,109 | 203,697 | 51    |
| `redeem`  | 55,832  | 60,587  | 67,621  | 21    |
| `refund`  | 44,746  | 45,259  | 47,246  | 11    |

### `TrainERC20.sol`

| Method    | Min     | Avg     | Max     | Calls |
| --------- | ------- | ------- | ------- | ----- |
| `lockSrc` | 217,326 | 247,501 | 251,526 | 17    |
| `lockDst` | 214,503 | 216,957 | 229,333 | 14    |
| `redeem`  | 59,219  | 66,642  | 72,383  | 6     |
| `refund`  | 50,597  | 52,559  | 55,570  | 5     |

_ERC20 flows cost more because every HTLC transfer moves `amount + reward` into the contract and back out with `safeTransfer` checks._

## Usage Notes

- Hashlocks are computed as `sha256(abi.encodePacked(secret))`; tests use a `uint256` secret to avoid ABI ambiguity.
- Timelocks: users must set at least 30 minutes in the future (`lockSrc`), solvers at least 15 minutes (`lockDst`). Solver reward timelocks must be `<= timelock` and strictly greater than `block.timestamp` when submitted.
- Reward ratio: solver rewards must be at least 10% of the swap amount. Validation uses multiplication (e.g., `reward * 10 >= amount`) to avoid integer-division rounding.
- ERC20 callers must approve **amount + reward** before calling `lockDst` (and at least **amount** for `lockSrc`); otherwise `NoAllowance` reverts.
- `getUserSwaps(address)` returns only swaps opened through the rewardless path (slot `0`).
