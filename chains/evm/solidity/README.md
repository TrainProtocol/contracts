# Train Protocol - EVM Implementation

Trustless cross-chain bridge using Hashed Time-Locked Contracts (HTLC).

## Overview

Train Protocol enables permissionless cross-chain token swaps without trusted intermediaries. Users lock funds on the source chain, solvers fulfill the swap on the destination chain, and atomic reveals ensure either both sides complete or both refund.

## Contract Architecture

### Single Unified Contract

The `Train.sol` contract handles both native ETH and ERC20 tokens with a unified interface:

- **Native ETH**: Pass `token = address(0)` and send ETH via `msg.value`
- **ERC20 Tokens**: Pass `token = tokenAddress` and approve before calling

### Storage Structure

```
┌─────────────────────────────────────────────────────────────┐
│                       Train Contract                         │
├─────────────────────────────────────────────────────────────┤
│  userLocks: hashlock => UserLock                            │
│  ├── One lock per hashlock (unique)                         │
│  └── Used by users initiating swaps                         │
├─────────────────────────────────────────────────────────────┤
│  solverLocks: hashlock => index => SolverLock               │
│  ├── Multiple locks per hashlock (index 1, 2, 3, ...)       │
│  └── Used by solvers fulfilling swaps                       │
├─────────────────────────────────────────────────────────────┤
│  solverLockCount: hashlock => count                         │
│  └── Tracks number of solver locks per hashlock             │
└─────────────────────────────────────────────────────────────┘
```

## Core Functions

### User Operations

#### `userLock(params, dst, userData, solverData)`

Creates a user lock to initiate a cross-chain swap.

```solidity
struct UserLockParams {
    bytes32 hashlock;        // sha256(secret) - unique swap identifier
    uint256 amount;          // Amount to lock
    uint256 rewardAmount;    // Reward offered to solver (logged only)
    uint48 timelockDelta;    // Seconds until timelock expires
    uint48 rewardTimelockDelta; // Seconds until reward goes to user
    uint48 quoteExpiry;      // Quote validity timestamp
    address refundTo;        // Refund recipient (if lock is refunded or decay excess)
    address recipient;       // Receives funds on redeem
    address token;           // Token address (0x0 for ETH)
    address payoutCurve;     // Optional decay curve address (0x0 for none)
    bytes payoutCurveData;   // ABI-encoded curve config (empty if no curve)
    string rewardToken;      // Reward token (logged only)
    string rewardRecipient;  // Reward recipient (logged only)
    string srcChain;         // Source chain identifier
}
```

**Requirements:**

- `amount > 0`
- `timelockDelta > 0`
- `block.timestamp < quoteExpiry`
- Token must be valid (ETH or contract with code)
- Hashlock must not already exist
- If `payoutCurve` is set, it must have code and implement `IPayoutCurve`

#### `redeemUser(hashlock, secret)`

Redeems a user lock with the secret preimage. Anyone can call this.

**Requirements:**

- Lock must exist and be pending
- `sha256(secret) == hashlock`

#### `refundUser(hashlock)`

Refunds a user lock. Full amount is returned to `refundTo` (no decay applied on refund).

**Access Control:**

- `recipient` can refund **anytime**
- Anyone else can refund **after timelock expires**

### Solver Operations

#### `solverLock(params, dst, data)`

Creates a solver lock to fulfill a swap. Returns the lock index.

```solidity
struct SolverLockParams {
    bytes32 hashlock;        // Must match user's hashlock
    uint256 amount;          // Amount for recipient
    uint256 reward;          // Solver incentive amount
    uint48 timelockDelta;    // Seconds until timelock
    uint48 rewardTimelockDelta; // Seconds until reward goes to redeemer
    address refundTo;        // Refund recipient (solver, if lock is refunded or decay excess)
    address recipient;       // User receiving funds
    address rewardRecipient; // Gets reward if redeemed early
    address token;           // Main token (0x0 for ETH)
    address rewardToken;     // Reward token (0x0 for ETH)
    address payoutCurve;     // Optional decay curve address (0x0 for none)
    bytes payoutCurveData;   // ABI-encoded curve config (empty if no curve)
    string srcChain;         // Source chain identifier
}
```

**Token Combinations Supported:**
| token | rewardToken | msg.value |
|-------|-------------|-----------|
| ETH | ETH | amount + reward |
| ETH | ERC20 | amount |
| ERC20 | ETH | reward |
| ERC20 | ERC20 (same) | 0 |
| ERC20 | ERC20 (different) | 0 |

#### `redeemSolver(hashlock, index, secret)`

Redeems a solver lock. Reward distribution depends on timing:

```
                    rewardTimelock              timelock
Time: ──────────────────┼───────────────────────────┼──────────►
                        │                           │
      ◄─── Early ──────►│◄──── Late ───────────────►│◄── Expired
                        │                           │
      reward →          │  reward →                 │       Can redeem
      rewardRecipient   │  msg.sender (redeemer)    │  (but should refund)
```

#### `refundSolver(hashlock, index)`

Refunds a solver lock (amount + reward) to `refundTo`. Only callable after timelock expires. No decay applied on refund.

## Storage Layout

### UserLock fields

| Field | Type | Notes |
|---|---|---|
| `secret` | `uint256` | Set on redeem |
| `amount` | `uint256` | Actual amount received (fee-on-transfer safe) |
| `startTime` | `uint48` | Block timestamp at lock creation |
| `timelock` | `uint48` | Absolute expiry timestamp |
| `status` | `LockStatus` | `Pending` / `Redeemed` / `Refunded` |
| `sender` | `address` | `msg.sender` at lock time (tracked in history) |
| `refundTo` | `address` | Receives refunds and decay excess |
| `recipient` | `address` | Receives payout on redeem |
| `token` | `address` | `address(0)` for ETH |
| `payoutCurve` | `address` | Optional decay curve library (`address(0)` = none) |
| `payoutCurveData` | `bytes` | ABI-encoded curve config (dynamic) |

### SolverLock fields

| Field | Type | Notes |
|---|---|---|
| `secret` | `uint256` | Set on redeem |
| `amount` | `uint256` | Actual amount received |
| `reward` | `uint256` | Actual reward received |
| `startTime` | `uint48` | Block timestamp at lock creation |
| `timelock` | `uint48` | Absolute expiry timestamp |
| `rewardTimelock` | `uint48` | Reward recipient switches after this |
| `status` | `LockStatus` | `Pending` / `Redeemed` / `Refunded` |
| `sender` | `address` | `msg.sender` at lock time |
| `refundTo` | `address` | Receives refunds and decay excess |
| `recipient` | `address` | Receives amount on redeem |
| `rewardRecipient` | `address` | Receives reward if redeemed before `rewardTimelock` |
| `token` | `address` | `address(0)` for ETH |
| `rewardToken` | `address` | `address(0)` for ETH |
| `payoutCurve` | `address` | Optional decay curve library (`address(0)` = none) |
| `payoutCurveData` | `bytes` | ABI-encoded curve config (dynamic) |

## Security Features

### Reentrancy Protection

All state-changing functions use OpenZeppelin's `ReentrancyGuard` with the `nonReentrant` modifier.

### ETH Transfer Gas Stipend

ETH transfers use a 10,000 gas stipend to prevent:

- Griefing attacks via gas-expensive `receive()` functions
- Reentrancy through ETH transfers

```solidity
(bool success,) = to.call{ value: amount, gas: GAS_STIPEND }('');
if (!success) revert TransferFailed();
```

**Note:** Recipients with complex `receive()` functions (>10k gas) cannot receive ETH directly. Use a wrapper contract or ERC20 tokens instead.

### Safe Token Transfers

ERC20 transfers use OpenZeppelin's `SafeERC20` to handle:

- Tokens that don't return booleans (USDT)
- Tokens that revert on failure
- Tokens with non-standard implementations

### Hashlock Validation

The hashlock uses SHA-256 for cross-chain compatibility:

```solidity
bytes32 hashlock = sha256(abi.encodePacked(secret));
```

Where `secret` is a `uint256` value.

## Events

### UserLocked

Emitted when a user creates a lock. Contains all information needed for solvers to fulfill the swap.

### SolverLocked

Emitted when a solver creates a lock. Includes the index for multi-lock scenarios.

### UserRedeemed / SolverRedeemed

Emitted on successful redemption. Includes the revealed secret.

### UserRefunded / SolverRefunded

Emitted when a lock is refunded.

## Error Codes

| Error                   | Description                              |
| ----------------------- | ---------------------------------------- |
| `ZeroAmount`            | Lock amount is zero                      |
| `LockNotFound`          | No lock exists for hashlock/index        |
| `HashlockMismatch`      | Provided secret doesn't hash to hashlock |
| `LockNotPending`        | Lock already redeemed or refunded        |
| `InvalidTimelock`       | Timelock delta is zero                   |
| `InvalidRewardTimelock` | rewardTimelockDelta >= timelockDelta     |
| `SwapAlreadyExists`     | User lock already exists for hashlock    |
| `TransferFailed`        | ETH transfer failed                      |
| `MsgValueMismatch`      | msg.value doesn't match expected ETH     |
| `RefundNotAllowed`      | Refund attempted too early               |
| `InvalidToken`          | Token address has no code                |
| `QuoteExpired`          | Quote expiry timestamp passed            |
| `InvalidPayoutCurve`    | Curve has no code or does not implement `IPayoutCurve` |
| `InvalidPayout`         | Curve returned 0 or more than amount     |

## Historical Swap Tracking

The contract provides built-in historical swap tracking for user locks, allowing applications to query all swaps created by a specific address.

### Storage Tracking

```solidity
mapping(address => bytes32[]) private userLockHashes;
```

Each time a user creates a lock via `userLock()`, the hashlock is automatically appended to their history array. This tracking:

- **Persists forever** - Hashlocks remain in history even after redemption or refund
- **Tracks initiators only** - Only the `sender` address is tracked, not recipients
- **On-chain query support** - Enables frontend applications to display user swap history

### Query Functions

#### `getUserLockHashes(address user, LockStatus status, uint256 offset, uint256 limit)`

Returns paginated and filtered hashlocks for swaps created by the user.

```solidity
// Get all hashlocks (no filtering)
(bytes32[] memory hashlocks, uint256 total) = train.getUserLockHashes(
    userAddress,
    LockStatus.Empty,  // Empty = no status filter
    0,                 // offset: start from index 0
    10                 // limit: return max 10 results
);
// Returns: ([hashlock1, hashlock2, ...], totalCount)

// Get only redeemed swaps
(bytes32[] memory redeemedHashes, uint256 redeemedTotal) = train.getUserLockHashes(
    userAddress,
    LockStatus.Redeemed,
    0,
    10
);
```

**Parameters:**

- `user` - Address to query
- `status` - Filter by status (`Empty` for no filter, or `Pending`/`Redeemed`/`Refunded`)
- `offset` - Starting index for pagination
- `limit` - Maximum results to return (0 returns empty array)

**Returns:**

- `hashlocks` - Array of filtered hashlocks
- `total` - Total count of matching hashlocks (useful for calculating total pages)

**Use case:** Efficiently fetch paginated list of swap identifiers with optional status filtering.

#### `getUserLocks(address user, LockStatus status, uint256 offset, uint256 limit)`

Returns paginated and filtered complete `UserLock` structs for swaps created by the user.

```solidity
// Get all locks with pagination
(Train.UserLock[] memory locks, uint256 total) = train.getUserLocks(
    userAddress,
    LockStatus.Empty,  // Empty = no status filter
    0,                 // Page 1: offset 0
    5                  // 5 items per page
);

// Page 2 with same filter
(Train.UserLock[] memory page2, uint256 total) = train.getUserLocks(
    userAddress,
    LockStatus.Empty,
    5,                 // offset 5 = next 5 items
    5
);

// Get only pending swaps
(Train.UserLock[] memory pendingLocks, uint256 pendingTotal) = train.getUserLocks(
    userAddress,
    LockStatus.Pending,
    0,
    10
);

for (uint i = 0; i < pendingLocks.length; i++) {
    // Access: pendingLocks[i].amount, pendingLocks[i].recipient, etc.
}
```

**Parameters:**

- `user` - Address to query
- `status` - Filter by status (`Empty` for all, `Pending`/`Redeemed`/`Refunded` for specific)
- `offset` - Starting index for pagination
- `limit` - Maximum results to return

**Returns:**

- `locks` - Array of filtered UserLock structs
- `total` - Total count of matching locks

**Use case:** Fetch paginated full swap details with optional filtering by status.

### Status Tracking

The returned locks include real-time status:

- `LockStatus.Pending` - Active swap awaiting redemption
- `LockStatus.Redeemed` - Completed swap (includes revealed `secret`)
- `LockStatus.Refunded` - Cancelled/expired swap

## Usage Examples

### User Initiating a Swap (ETH)

```solidity
Train train = Train(TRAIN_ADDRESS);

// Generate secret and hashlock
uint256 secret = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender)));
bytes32 hashlock = sha256(abi.encodePacked(secret));

// Create user lock
Train.UserLockParams memory params = Train.UserLockParams({
    hashlock: hashlock,
    amount: 1 ether,
    rewardAmount: 0.01 ether,
    timelockDelta: 3600,  // 1 hour
    rewardTimelockDelta: 1800,  // 30 minutes
    quoteExpiry: uint48(block.timestamp + 300),  // 5 minutes
    refundTo: msg.sender,
    recipient: SOLVER_ADDRESS,
    token: address(0),  // ETH
    rewardToken: "ETH",
    rewardRecipient: "0x...",
    srcChain: "ethereum"
});

Train.DestinationInfo memory dst = Train.DestinationInfo({
    dstChain: "arbitrum",
    dstAddress: "0x...",
    dstAmount: 1000e6,  // 1000 USDC
    dstToken: "USDC"
});

train.userLock{value: 1 ether}(params, dst, "", "");

// Store secret securely - needed to redeem on destination chain
```

### Solver Fulfilling a Swap (ERC20 with ETH Reward)

```solidity
IERC20(USDC).approve(address(train), amount);

Train.SolverLockParams memory params = Train.SolverLockParams({
    hashlock: hashlock,  // From user's lock event
    amount: 1000e6,  // 1000 USDC
    reward: 0.01 ether,
    timelockDelta: 1800,  // 30 minutes
    rewardTimelockDelta: 900,  // 15 minutes
    refundTo: msg.sender,
    recipient: USER_ADDRESS,
    rewardRecipient: msg.sender,
    token: USDC,
    rewardToken: address(0),  // ETH reward
    srcChain: "arbitrum"
});

uint256 index = train.solverLock{value: 0.01 ether}(params, dst, "");
```

### Redeeming with Secret

```solidity
// User redeems solver lock on destination
train.redeemSolver(hashlock, index, secret);

// Solver redeems user lock on source (after seeing secret from above)
train.redeemUser(hashlock, secret);
```

## Payout Curves

Locks can optionally specify a payout curve library that reduces the claimable amount over time after the grace period. When `payoutCurve` is set on a lock, the redeemer receives only `computePayout(...)` tokens, and any remainder is returned to `refundTo`. Refunds always return the full amount regardless of decay.

### Interface

All curve libraries implement `IPayoutCurve`:

```solidity
interface IPayoutCurve {
    function computePayout(
        uint256 amount,
        uint48 startTime,
        uint48 currentTime,
        bytes calldata config
    ) external view returns (uint256 payout);

    function supportsInterface(bytes4 interfaceId) external pure returns (bool);
}
```

Solidity emits `STATICCALL` at the call site for `external view` functions, so a curve library cannot modify Train's state. At deposit time, Train calls `supportsInterface(type(IPayoutCurve).interfaceId)` to verify the address is a valid curve — any contract that returns `false` or reverts is rejected with `InvalidPayoutCurve`.

### Implementations

#### `SqrtPayoutCurve` (library)

Combined sqrt + linear decay. A and B are supplied directly as token-denominated coefficients.

```
P(t) = max(Pmin, amount - A*sqrt(Δt)/1e18 - B*Δt/1e18)
```

Config (128 bytes): `abi.encode(uint256 gracePeriod, uint256 A, uint256 B, uint256 Pmin)`

| Field | Description |
|-------|-------------|
| `gracePeriod` | Seconds of full payout before decay begins |
| `A` | Sqrt-term coefficient × 1e18 (token-wei / √s) |
| `B` | Linear-term coefficient × 1e18 (token-wei / s) |
| `Pmin` | Absolute floor in token-wei |

#### `LinearPayoutCurve` (library)

Simple linear decay at a fixed rate per second.

```
P(t) = max(Pmin, amount - rate*Δt/1e18)
```

Config (96 bytes): `abi.encode(uint256 gracePeriod, uint256 rate, uint256 Pmin)`

| Field | Description |
|-------|-------------|
| `gracePeriod` | Seconds of full payout before decay begins |
| `rate` | Decay rate × 1e18 (token-wei / s); e.g. `1e33` = 0.001 ether/s |
| `Pmin` | Absolute floor in token-wei |

#### `VolatilityDecayCurve` (library)

Parameterised by market quantities rather than raw coefficients. A, B, and Pmin are derived from `amount` at call time, so the same config bytes apply to any lock size.

```
P(t) = max(Pmin, P0 - A*sqrt(Δt) - B*Δt)

Pmin = r * amount
A    = amount * σ_ann / sqrt(SECONDS_PER_YEAR)   [early-delay penalty]
B    = (amount - Pmin) / H                        [sustained-delay penalty]
```

Config (128 bytes): `abi.encode(uint256 gracePeriod, uint256 sigmaAnn, uint256 H, uint256 r)`

| Field | Description |
|-------|-------------|
| `gracePeriod` | Seconds of full payout before decay begins |
| `sigmaAnn` | Annualised volatility × 1e18; e.g. `1.10e18` for 110% vol |
| `H` | Decay horizon in seconds (time for linear term alone to exhaust `amount - Pmin`) |
| `r` | Floor ratio × 1e18; must be `< 1e18`. Recommended range: `[0.80e18, 0.90e18]` |

**Example config** (110% vol, 30-minute horizon, 85% floor):
```solidity
bytes memory config = abi.encode(
    60,       // gracePeriod: 1-minute relay buffer
    1.10e18,  // sigmaAnn: 110% annualised volatility
    1800,     // H: 30-minute decay horizon
    0.85e18   // r: 85% floor ratio
);
```

## Build & Test

```bash
# Install dependencies
forge install

# Build
forge build

# Run tests
forge test

# Run tests with verbosity
forge test -vvv

# Run specific test
forge test --match-test "testFunctionName"

# Gas report
forge test --gas-report

# Coverage
forge coverage
```

## Deployment

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) installed
- RPC endpoint for target network
- Deployer private key with sufficient ETH for gas

### Deploy Scripts

Two deployment scripts are provided under `script/`:

| Script | Deploys |
|--------|---------|
| `script/Deploy.s.sol` | `Train` |
| `script/DeployPayoutCurves.s.sol` | `SqrtPayoutCurve`, `LinearPayoutCurve`, `VolatilityDecayCurve` |

### Deploy Commands

```bash
# Set environment variables
export PRIVATE_KEY=<your-private-key>
export RPC_URL=<network-rpc-url>

# Deploy Train contract
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# Deploy payout curve contracts
forge script script/DeployPayoutCurves.s.sol --rpc-url $RPC_URL --broadcast

# Deploy with Etherscan verification
forge script script/Deploy.s.sol \
    --rpc-url $RPC_URL \
    --broadcast \
    --verify \
    --etherscan-api-key <your-api-key>

forge script script/DeployPayoutCurves.s.sol \
    --rpc-url $RPC_URL \
    --broadcast \
    --verify \
    --etherscan-api-key <your-api-key>
```

### Supported Networks

The contract targets **Cancun** EVM version. Ensure the target network supports Cancun opcodes (available on Ethereum mainnet, Arbitrum, Optimism, Base, etc. since March 2024).

## Gas Costs

### Deployment

| Metric          | Value         |
| --------------- | ------------- |
| Deployment Cost | 1,545,494 gas |
| Contract Size   | 6,858 bytes   |

### Function Costs

Gas costs vary based on token type (ETH vs ERC20) and storage operations (cold vs warm slots).

| Function              | Min    | Avg     | Median  | Max     | Description                          |
| --------------------- | ------ | ------- | ------- | ------- | ------------------------------------ |
| **User Operations**   |
| `userLock`            | 32,614 | 149,029 | 155,986 | 211,142 | Higher for ERC20 + hashlock tracking |
| `redeemUser`          | 29,262 | 94,464  | 94,817  | 95,129  | Reveals secret, transfers out        |
| `refundUser`          | 29,187 | 41,593  | 46,642  | 47,764  | Returns funds to sender              |
| **Solver Operations** |
| `solverLock`          | 31,747 | 187,420 | 179,288 | 289,546 | Higher for mixed token types         |
| `redeemSolver`        | 29,412 | 112,898 | 107,041 | 136,954 | 2 transfers (amount + reward)        |
| `refundSolver`        | 29,513 | 51,771  | 51,794  | 63,482  | Returns amount + reward              |
| **View Functions**    |
| `getUserLock`         | 11,723 | 11,723  | 11,723  | 11,723  | Read 5 storage slots                 |
| `getSolverLock`       | 18,426 | 18,426  | 18,426  | 18,426  | Read 8 storage slots                 |
| `getSolverLockCount`  | 2,479  | 2,479   | 2,479   | 2,479   | Read 1 storage slot                  |
| `getUserLockHashes`   | 2,869  | 9,553   | 5,140   | 48,294  | Scales with user's swap count        |
| `getUserLocks`        | 3,101  | 32,140  | 17,234  | 144,525 | Fetches full history (expensive)     |

### Gas Optimization Notes

- **ETH transfers** are cheaper than ERC20 (~21k vs ~50k+ gas)
- **Same token for amount and reward** saves one transfer (~30k gas)
- **Recipient == RewardRecipient** enables combined transfer (~30k gas saved)
- **Storage packing** minimizes slot usage (5 slots for UserLock, 8 for SolverLock)
