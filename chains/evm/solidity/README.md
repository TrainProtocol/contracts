# Train EVM Contracts

This Hardhat package contains the EVM leg of the Train protocol. The current Solidity sources are:

| File                       | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `contracts/Train.sol`      | Native ETH hashed-timelock contract that escrows value via `msg.value`.        |
| `contracts/TrainERC20.sol` | ERC20 mirror of `Train.sol`, using `SafeERC20` transfers and allowance checks. |
| `contracts/TestToken.sol`  | Minimal mintable token used only inside the automated tests.                   |

Both Train contracts implement the same swap lifecycle and storage layout so off-chain tooling can treat them interchangeably.

## HTLC Model

- `lock` opens an HTLC. User flows (reward `0`) always consume `htlcId = 0` and register in `userSwaps`. Solver flows (reward > 0) either take slot `0` (if first) or append to the next open slot.
- Funds stay locked until a matching secret pre-image is supplied via `redeem` or the timelock passes and anyone can `refund`.
- Rewards are optional and include a separate `rewardTimelock` so solvers/relayers can claim the fee even if the receiver lags.
- Errors such as `InvalidTimelock`, `FundsNotSent`, `NoAllowance`, or `SwapAlreadyInitialized` enforce invariants in both contracts.

Events (`UserLocked`, `SolverLocked`, `TokenRedeemed`, `TokenRefunded`) surface all data required for off-chain monitoring. The ERC20 variant simply appends the `token` address to the event schema.

## Development & Testing

All work happens from `chains/evm/solidity` using Node 18+ and Hardhat **2.20.1** (Solidity **0.8.30**, optimizer enabled, via-IR, Cancun target). Two deterministic test suites cover the native and ERC20 variants:

```bash
# Native ETH contract
npx hardhat test test/native.js

# ERC20 mirror (mints/approves TestToken per signer)
npx hardhat test test/erc20.js

```

For gas measurements, enable the gas reporter on-demand: `cd chains/evm/solidity; $env:REPORT_GAS="true"; npx hardhat test test/native.js`.

## Gas Snapshots

Collected with `REPORT_GAS=true npx hardhat test ...` on Hardhat's in-process network (Cancun rules, 30M gas block, optimizer runs = 200). Figures report min/avg/max across every call seen during the suite.

### `Train.sol`

| Method   | Min     | Avg     | Max     | Calls |
| -------- | ------- | ------- | ------- | ----- |
| `lock`   | 178,596 | 194,176 | 196,931 | 60    |
| `redeem` | 55,810  | 60,457  | 67,587  | 11    |
| `refund` | 44,746  | 44,806  | 44,905  | 8     |

### `TrainERC20.sol`

| Method   | Min     | Avg     | Max     | Calls |
| -------- | ------- | ------- | ------- | ----- |
| `lock`   | 214,376 | 234,189 | 252,509 | 31    |
| `redeem` | 59,216  | 66,639  | 72,380  | 6     |
| `refund` | 50,575  | 52,537  | 55,548  | 5     |

_ERC20 flows cost more because every HTLC transfer moves `amount + reward` into the contract and back out with `safeTransfer` checks._

## Usage Notes

- Hashlocks are computed as `sha256(abi.encodePacked(secret))`; tests use a `uint256` secret to avoid ABI ambiguity.
- Timelocks must sit at least 15 minutes in the future. Solver reward timelocks must be `<= timelock` and strictly greater than `block.timestamp` when submitted.
- ERC20 callers must approve **amount + reward** before calling `lock`; otherwise `NoAllowance` reverts.
- `getUserSwaps(address)` returns only swaps opened through the rewardless path (slot `0`).
