//     @@                                    @@@
//    @@@
//    @@@        @@   @@@@      @@@@@         @     @    @@@@@
//  @@@@@@@@@   @@@@@@      @@@@    @@@@@    @@@   @@@@@@    @@@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//    @@@       @@@       @@@           @@@  @@@   @@@          @@@
//     @@@      @@@        @@@@       @@@@@  @@@   @@@          @@@
//       @@@@@  @@@           @@@@@@@@@ @@@  @@@   @@@          @@@

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { ReentrancyGuard } from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @notice Subset of EIP-3009 used by Train for gasless ERC20 redemptions via isValidSignature
interface IERC3009 {
  function DOMAIN_SEPARATOR() external view returns (bytes32);
  function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
  function transferWithAuthorization(
    address from,
    address to,
    uint256 value,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce,
    bytes calldata signature
  ) external;
}

/// @title Train Protocol - Cross-Chain HTLC Bridge
/// @author Train Protocol
/// @notice Trustless cross-chain bridge using Hashed Time-Locked Contracts
/// @dev Supports native ETH (token=address(0)) and ERC20 tokens. Hashlock = sha256(secret).
contract Train is ReentrancyGuard {
  using SafeERC20 for IERC20;

  /// @notice EIP-3009 TransferWithAuthorization typehash
  bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
    keccak256(
      'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
    );

  /// @notice EIP-1271 magic value returned when a signature is valid
  bytes4 private constant EIP1271_MAGIC_VALUE = 0x1626ba7e;

  /// @notice Gas limit for ETH transfers to prevent griefing attacks
  uint256 constant GAS_STIPEND = 10_000;

  /// @notice Sentinel value representing native ETH
  address constant NATIVE_ETH = address(0);

  /// @notice Thrown when lock amount is zero
  error ZeroAmount();

  /// @notice Thrown when no lock exists for the given hashlock
  error LockNotFound();

  /// @notice Thrown when provided secret doesn't match hashlock
  error HashlockMismatch();

  /// @notice Thrown when lock is not in Pending status
  error LockNotPending();

  /// @notice Thrown when timelock delta is zero
  error InvalidTimelock();

  /// @notice Thrown when rewardTimelockDelta >= timelockDelta
  error InvalidRewardTimelock();

  /// @notice Thrown when user lock already exists for hashlock
  error SwapAlreadyExists();

  /// @notice Thrown when ETH transfer fails
  error TransferFailed();

  /// @notice Thrown when msg.value doesn't match expected ETH amount
  error MsgValueMismatch();

  /// @notice Thrown when refund is attempted before allowed
  error RefundNotAllowed();

  /// @notice Thrown when token address has no code
  error InvalidToken();

  /// @notice Thrown when quote has expired
  error QuoteExpired();

  /// @notice Lock lifecycle states
  enum LockStatus {
    Empty,
    Pending,
    Refunded,
    Redeemed
  }

  /// @notice User-initiated lock storage structure
  struct UserLock {
    uint256 secret;
    uint256 amount;
    address sender;
    address refundTo;
    uint48 timelock;
    LockStatus status;
    address recipient;
    address token;
  }

  /// @notice Solver-initiated lock storage structure
  struct SolverLock {
    uint256 secret;
    uint256 amount;
    uint256 reward;
    address sender;
    address refundTo;
    uint48 timelock;
    uint48 rewardTimelock;
    address recipient;
    LockStatus status;
    address rewardRecipient;
    address token;
    address rewardToken;
  }

  /// @notice Emitted when user creates a lock
  event UserLocked(
    bytes32 indexed hashlock,
    address indexed sender,
    address indexed recipient,
    address refundTo,
    string srcChain,
    address token,
    uint256 amount,
    uint48 timelock,
    string dstChain,
    string dstAddress,
    uint256 dstAmount,
    string dstToken,
    uint256 rewardAmount,
    string rewardToken,
    string rewardRecipient,
    uint48 rewardTimelockDelta,
    uint48 quoteExpiry,
    bytes userData,
    bytes solverData
  );

  /// @notice Emitted when solver creates a lock
  event SolverLocked(
    bytes32 indexed hashlock,
    address indexed sender,
    address indexed recipient,
    address refundTo,
    uint256 index,
    string srcChain,
    address token,
    uint256 amount,
    uint256 reward,
    address rewardToken,
    address rewardRecipient,
    uint48 timelock,
    uint48 rewardTimelock,
    string dstChain,
    string dstAddress,
    uint256 dstAmount,
    string dstToken,
    bytes data
  );

  /// @notice Emitted when user lock is refunded
  event UserRefunded(bytes32 indexed hashlock);

  /// @notice Emitted when solver lock is refunded
  event SolverRefunded(bytes32 indexed hashlock, uint256 indexed index);

  /// @notice Emitted when user lock is redeemed
  event UserRedeemed(bytes32 indexed hashlock, address redeemer, uint256 secret);

  /// @notice Emitted when solver lock is redeemed
  event SolverRedeemed(bytes32 indexed hashlock, uint256 indexed index, address redeemer, uint256 secret);

  /// @notice Cross-chain destination details (logged only, not stored)
  struct DestinationInfo {
    string dstChain;
    string dstAddress;
    uint256 dstAmount;
    string dstToken;
  }

  /// @notice Parameters for creating a user lock
  struct UserLockParams {
    bytes32 hashlock;
    uint256 amount;
    uint256 rewardAmount;
    uint48 timelockDelta;
    uint48 rewardTimelockDelta;
    uint48 quoteExpiry;
    address refundTo;
    address recipient;
    address token;
    string rewardToken;
    string rewardRecipient;
    string srcChain;
  }

  /// @notice Parameters for creating a solver lock
  struct SolverLockParams {
    bytes32 hashlock;
    uint256 amount;
    uint256 reward;
    uint48 timelockDelta;
    uint48 rewardTimelockDelta;
    address refundTo;
    address recipient;
    address rewardRecipient;
    address token;
    address rewardToken;
    string srcChain;
  }

  /// @dev hashlock => UserLock
  mapping(bytes32 => UserLock) private userLocks;

  /// @dev hashlock => index => SolverLock
  mapping(bytes32 => mapping(uint256 => SolverLock)) private solverLocks;

  /// @dev hashlock => count of solver locks
  mapping(bytes32 => uint256) private solverLockCount;

  /// @dev Historical hashlocks per user address
  mapping(address => bytes32[]) private userLockHashes;

  /// @notice Create a user lock to initiate a cross-chain swap
  /// @param params Lock parameters including hashlock, amount, addresses, and timelocks
  /// @param dst Destination chain details (logged only)
  /// @param userData Arbitrary user data for cross-chain coordination
  /// @param solverData Arbitrary solver data for cross-chain coordination
  function userLock(
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata userData,
    bytes calldata solverData
  ) external payable nonReentrant {
    if (params.amount == 0) revert ZeroAmount();
    if (params.timelockDelta == 0) revert InvalidTimelock();
    if (block.timestamp >= params.quoteExpiry) revert QuoteExpired();
    if (params.token != NATIVE_ETH && params.token.code.length == 0) revert InvalidToken();
    if (userLocks[params.hashlock].sender != address(0)) revert SwapAlreadyExists();

    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;

    UserLock storage lock = userLocks[params.hashlock];
    lock.sender = msg.sender;
    lock.refundTo = params.refundTo == address(0) ? msg.sender : params.refundTo;
    lock.recipient = params.recipient;
    lock.timelock = timelock;
    lock.status = LockStatus.Pending;
    lock.token = params.token;

    // Track hashlock for this user
    userLockHashes[msg.sender].push(params.hashlock);

    lock.amount = _transferIn(params.token, params.amount);
    _emitUserLocked(params, dst, timelock, msg.sender, lock.refundTo, userData, solverData);
  }

  /// @notice Create a solver lock to fulfill a swap
  /// @dev Reward goes to rewardRecipient if redeemed before rewardTimelock, else to redeemer
  /// @param params Lock parameters including hashlock, amount, reward, addresses, and timelocks
  /// @param dst Destination chain details (logged only)
  /// @param data Arbitrary data for cross-chain coordination
  /// @return index The index of this solver lock for the hashlock
  function solverLock(
    SolverLockParams calldata params,
    DestinationInfo calldata dst,
    bytes calldata data
  ) external payable nonReentrant returns (uint256 index) {
    if (params.amount == 0) revert ZeroAmount();
    if (params.timelockDelta == 0) revert InvalidTimelock();
    if (params.token != NATIVE_ETH && params.token.code.length == 0) revert InvalidToken();
    if (params.reward > 0 && params.rewardTimelockDelta >= params.timelockDelta) revert InvalidRewardTimelock();
    if (params.reward > 0 && params.rewardToken != NATIVE_ETH && params.rewardToken.code.length == 0)
      revert InvalidToken();

    uint48 timelock = uint48(block.timestamp) + params.timelockDelta;
    uint48 rewardTimelock = uint48(block.timestamp) + params.rewardTimelockDelta;

    index = ++solverLockCount[params.hashlock];
    SolverLock storage lock = solverLocks[params.hashlock][index];
    lock.sender = msg.sender;
    lock.refundTo = params.refundTo == address(0) ? msg.sender : params.refundTo;
    lock.recipient = params.recipient;
    lock.rewardRecipient = params.rewardRecipient;
    lock.timelock = timelock;
    lock.rewardTimelock = rewardTimelock;
    lock.token = params.token;
    lock.status = LockStatus.Pending;
    lock.rewardToken = params.rewardToken;

    (lock.amount, lock.reward) = _transferInMixed(params.token, params.amount, params.rewardToken, params.reward);
    _emitSolverLocked(params, dst, index, timelock, rewardTimelock, msg.sender, lock.refundTo, data);
  }

  /// @notice Refund a user lock
  /// @dev Recipient can refund anytime; others only after timelock expires
  /// @param hashlock The hashlock identifying the lock
  function refundUser(bytes32 hashlock) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (msg.sender != lock.recipient && lock.timelock > block.timestamp) {
      revert RefundNotAllowed();
    }

    lock.status = LockStatus.Refunded;
    _transferOut(lock.token, payable(lock.refundTo), lock.amount);
    emit UserRefunded(hashlock);
  }

  /// @notice Refund a solver lock (amount + reward returned to refundTo)
  /// @dev Only callable after timelock expires
  /// @param hashlock The hashlock identifying the lock
  /// @param index The index of the solver lock
  function refundSolver(bytes32 hashlock, uint256 index) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][index];
    address sender = lock.sender;
    if (sender == address(0)) revert LockNotFound();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    _syncGaslessRedemption(lock, hashlock, index);
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    if (lock.timelock > block.timestamp) revert RefundNotAllowed();

    lock.status = LockStatus.Refunded;
    _transferOutMixed(
      lock.token,
      lock.amount,
      payable(lock.refundTo),
      lock.rewardToken,
      lock.reward,
      payable(lock.refundTo)
    );
    emit SolverRefunded(hashlock, index);
  }

  /// @notice Redeem a user lock with the secret preimage
  /// @param hashlock The hashlock identifying the lock
  /// @param secret The secret preimage where sha256(secret) == hashlock
  function redeemUser(bytes32 hashlock, uint256 secret) external nonReentrant {
    UserLock storage lock = userLocks[hashlock];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;
    _transferOut(lock.token, payable(lock.recipient), lock.amount);
    emit UserRedeemed(hashlock, msg.sender, secret);
  }

  /// @notice Redeem a solver lock with the secret preimage
  /// @dev Amount goes to recipient. Reward goes to rewardRecipient before rewardTimelock, else to caller.
  /// @param hashlock The hashlock identifying the lock
  /// @param index The index of the solver lock
  /// @param secret The secret preimage where sha256(secret) == hashlock
  function redeemSolver(bytes32 hashlock, uint256 index, uint256 secret) external nonReentrant {
    SolverLock storage lock = solverLocks[hashlock][index];
    if (lock.sender == address(0)) revert LockNotFound();
    if (hashlock != sha256(abi.encodePacked(secret))) revert HashlockMismatch();
    if (lock.status != LockStatus.Pending) revert LockNotPending();
    _syncGaslessRedemption(lock, hashlock, index);
    if (lock.status != LockStatus.Pending) revert LockNotPending();

    lock.status = LockStatus.Redeemed;
    lock.secret = secret;

    address rewardTo = lock.rewardTimelock > block.timestamp ? lock.rewardRecipient : msg.sender;
    _transferOutMixed(
      lock.token,
      lock.amount,
      payable(lock.recipient),
      lock.rewardToken,
      lock.reward,
      payable(rewardTo)
    );
    emit SolverRedeemed(hashlock, index, msg.sender, secret);
  }

  /// @dev If the lock's ERC-3009 gasless transfer was already executed (deterministic nonce is spent),
  ///      mark the lock as Redeemed to prevent double-spend via refundSolver or redeemSolver.
  ///      Security assumption: the token MUST mark the nonce as used only AFTER isValidSignature
  ///      returns the magic value — not before calling it. If the nonce is marked first and the
  ///      call then fails, the gasless path is permanently broken: every subsequent
  ///      transferWithAuthorization is rejected (nonce already used) and isValidSignature returns
  ///      0xffffffff once this function sets the lock to Redeemed. redeemSolver/refundSolver
  ///      are unaffected and remain usable unless the nonce was burned. USDC marks nonces correctly.
  ///      NOTE: SolverRedeemed event is NOT emitted here — the ERC-3009 transferWithAuthorization
  ///      transaction on the token contract serves as the on-chain redemption record.
  function _syncGaslessRedemption(SolverLock storage lock, bytes32 hashlock, uint256 index) internal {
    if (lock.token == NATIVE_ETH) return;
    bytes32 nonce = keccak256(abi.encode(hashlock, index));
    if (IERC3009(lock.token).authorizationState(address(this), nonce)) {
      lock.status = LockStatus.Redeemed;
    }
  }

  /// @notice EIP-1271 callback — called by an ERC-3009 token during transferWithAuthorization
  /// @dev View / STATICCALL compatible. Compatible with tokens that call isValidSignature via STATICCALL.
  ///      Callers MUST use the deterministic nonce: keccak256(abi.encode(hashlock, index)).
  ///      This binds the authorization uniquely to one lock and prevents cross-lock replay.
  ///      signature = abi.encode(hashlock, index, secret, validAfter, validBefore)
  ///      The digest is reconstructed from the token's DOMAIN_SEPARATOR to verify to == lock.recipient
  ///      and value == lock.amount, preventing wrong-recipient attacks.
  /// @param digest EIP-3009 digest computed by the token
  /// @param signature abi.encode(bytes32 hashlock, uint256 index, uint256 secret, uint256 validAfter, uint256 validBefore)
  /// @return EIP1271_MAGIC_VALUE if valid, 0xffffffff otherwise
  function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
    if (signature.length != 160) return bytes4(0xffffffff);

    (bytes32 hashlock, uint256 index, uint256 secret, uint256 validAfter, uint256 validBefore) = abi.decode(
      signature,
      (bytes32, uint256, uint256, uint256, uint256)
    );

    SolverLock storage lock = solverLocks[hashlock][index];
    if (lock.sender == address(0)) return bytes4(0xffffffff);
    if (msg.sender != lock.token) return bytes4(0xffffffff);
    if (lock.status != LockStatus.Pending) return bytes4(0xffffffff);
    if (hashlock != sha256(abi.encodePacked(secret))) return bytes4(0xffffffff);

    bytes32 nonce = keccak256(abi.encode(hashlock, index));
    bytes32 expectedDigest = keccak256(
      abi.encodePacked(
        '\x19\x01',
        IERC3009(msg.sender).DOMAIN_SEPARATOR(),
        keccak256(
          abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            address(this),
            lock.recipient,
            lock.amount,
            validAfter,
            validBefore,
            nonce
          )
        )
      )
    );
    if (digest != expectedDigest) return bytes4(0xffffffff);

    return EIP1271_MAGIC_VALUE;
  }

  /// @notice Get user lock details
  /// @param hashlock The hashlock identifying the lock
  /// @return The UserLock struct
  function getUserLock(bytes32 hashlock) external view returns (UserLock memory) {
    return userLocks[hashlock];
  }

  /// @notice Get solver lock details
  /// @param hashlock The hashlock identifying the lock
  /// @param index The index of the solver lock
  /// @return The SolverLock struct
  function getSolverLock(bytes32 hashlock, uint256 index) external view returns (SolverLock memory) {
    return solverLocks[hashlock][index];
  }

  /// @notice Get the number of solver locks for a hashlock
  /// @param hashlock The hashlock to query
  /// @return The count of solver locks
  function getSolverLockCount(bytes32 hashlock) external view returns (uint256) {
    return solverLockCount[hashlock];
  }

  /// @notice Check whether a token supports the gasless ERC-3009 redemption path
  /// @dev Probes for the bytes-signature variant of transferWithAuthorization
  ///      (selector 0xe3ee160e). Tokens implementing only the (v,r,s) ECDSA variant are
  ///      incompatible — they never call isValidSignature and will silently fail.
  ///      This is a best-effort check: a call with only the selector and no args is sent;
  ///      a non-empty revert means the function exists (bad-args panic), an empty revert means
  ///      the selector is unknown. Does not protect against proxy patterns that accept any selector.
  /// @param token ERC-3009 token address to check
  /// @return True if the bytes-signature variant appears to be present
  function supportsGaslessRedemption(address token) external view returns (bool) {
    if (token == NATIVE_ETH || token.code.length == 0) return false;
    bytes4 selector = bytes4(
      keccak256('transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)')
    );
    (, bytes memory ret) = token.staticcall(abi.encodePacked(selector));
    return ret.length > 0;
  }

  /// @notice Get all hashlocks for user locks created by an address with optional filtering and pagination
  /// @param user The address to query
  /// @param status Lock status filter (Empty = no filter, otherwise filter by specific status)
  /// @param offset Starting index for pagination
  /// @param limit Number of results to return
  /// @return hashlocks Array of filtered hashlocks
  /// @return total Total count of matching hashlocks
  function getUserLockHashes(
    address user,
    LockStatus status,
    uint256 offset,
    uint256 limit
  ) external view returns (bytes32[] memory hashlocks, uint256 total) {
    bytes32[] memory allHashes = userLockHashes[user];

    // If no pagination limit specified, return empty
    if (limit == 0) {
      return (new bytes32[](0), 0);
    }

    // Count matching entries
    uint256 matchCount = 0;
    for (uint256 i = 0; i < allHashes.length; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        matchCount++;
      }
    }

    // Calculate pagination bounds
    if (offset >= matchCount) {
      return (new bytes32[](0), matchCount);
    }

    uint256 end = offset + limit;
    if (end > matchCount) {
      end = matchCount;
    }
    uint256 size = end - offset;

    // Build filtered result
    bytes32[] memory result = new bytes32[](size);
    uint256 resultIndex = 0;
    uint256 currentIndex = 0;

    for (uint256 i = 0; i < allHashes.length && resultIndex < size; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        if (currentIndex >= offset) {
          result[resultIndex] = allHashes[i];
          resultIndex++;
        }
        currentIndex++;
      }
    }

    return (result, matchCount);
  }

  /// @notice Get all user lock details created by an address with optional filtering and pagination
  /// @param user The address to query
  /// @param status Lock status filter (Empty = no filter, otherwise filter by specific status)
  /// @param offset Starting index for pagination
  /// @param limit Number of results to return
  /// @return locks Array of filtered UserLock structs
  /// @return total Total count of matching locks
  function getUserLocks(
    address user,
    LockStatus status,
    uint256 offset,
    uint256 limit
  ) external view returns (UserLock[] memory locks, uint256 total) {
    bytes32[] memory allHashes = userLockHashes[user];

    // If no pagination limit specified, return empty
    if (limit == 0) {
      return (new UserLock[](0), 0);
    }

    // Count matching entries
    uint256 matchCount = 0;
    for (uint256 i = 0; i < allHashes.length; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        matchCount++;
      }
    }

    // Calculate pagination bounds
    if (offset >= matchCount) {
      return (new UserLock[](0), matchCount);
    }

    uint256 end = offset + limit;
    if (end > matchCount) {
      end = matchCount;
    }
    uint256 size = end - offset;

    // Build filtered result
    UserLock[] memory result = new UserLock[](size);
    uint256 resultIndex = 0;
    uint256 currentIndex = 0;

    for (uint256 i = 0; i < allHashes.length && resultIndex < size; i++) {
      if (status == LockStatus.Empty || userLocks[allHashes[i]].status == status) {
        if (currentIndex >= offset) {
          result[resultIndex] = userLocks[allHashes[i]];
          resultIndex++;
        }
        currentIndex++;
      }
    }

    return (result, matchCount);
  }

  /// @dev Transfer ETH or ERC20 into the contract
  /// @param token Token address (NATIVE_ETH for ETH)
  /// @param amount Amount requested by the caller
  /// @return received Actual amount received; equals amount for ETH, may be less for fee-on-transfer ERC20s
  function _transferIn(address token, uint256 amount) internal returns (uint256 received) {
    if (token == NATIVE_ETH) {
      if (msg.value != amount) revert MsgValueMismatch();
      return amount;
    } else {
      if (msg.value != 0) revert MsgValueMismatch();
      uint256 before = IERC20(token).balanceOf(address(this));
      IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
      return IERC20(token).balanceOf(address(this)) - before;
    }
  }

  /// @dev Transfer amount and reward tokens into the contract
  /// @param token Main token address
  /// @param amount Main amount requested
  /// @param rewardToken Reward token address
  /// @param reward Reward amount requested
  /// @return receivedAmount Actual main amount received; may be less than amount for fee-on-transfer tokens
  /// @return receivedReward Actual reward amount received; may be less than reward for fee-on-transfer tokens.
  ///         When token == rewardToken, the fee is split proportionally between amount and reward.
  function _transferInMixed(
    address token,
    uint256 amount,
    address rewardToken,
    uint256 reward
  ) internal returns (uint256 receivedAmount, uint256 receivedReward) {
    uint256 expectedEth;
    if (token == NATIVE_ETH) {
      expectedEth = amount;
      if (reward > 0 && rewardToken == NATIVE_ETH) {
        expectedEth += reward;
      }
    } else if (reward > 0 && rewardToken == NATIVE_ETH) {
      expectedEth = reward;
    }
    if (msg.value != expectedEth) revert MsgValueMismatch();

    // ETH amounts are always exact
    if (token == NATIVE_ETH) receivedAmount = amount;
    if (reward > 0 && rewardToken == NATIVE_ETH) receivedReward = reward;

    if (token != NATIVE_ETH) {
      bool sameToken = reward > 0 && rewardToken == token;
      uint256 totalAmount = sameToken ? amount + reward : amount;
      uint256 before = IERC20(token).balanceOf(address(this));
      IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
      uint256 actualTotal = IERC20(token).balanceOf(address(this)) - before;
      if (sameToken) {
        // Proportional split preserving the requested ratio
        receivedAmount = (actualTotal * amount) / totalAmount;
        receivedReward = actualTotal - receivedAmount;
      } else {
        receivedAmount = actualTotal;
      }
    }
    if (reward > 0 && rewardToken != NATIVE_ETH && rewardToken != token) {
      uint256 before = IERC20(rewardToken).balanceOf(address(this));
      IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), reward);
      receivedReward = IERC20(rewardToken).balanceOf(address(this)) - before;
    }
  }

  /// @dev Transfer ETH or ERC20 out of the contract
  /// @param token Token address (NATIVE_ETH for ETH)
  /// @param to Recipient address
  /// @param amount Amount to transfer
  function _transferOut(address token, address payable to, uint256 amount) internal {
    if (token == NATIVE_ETH) {
      (bool success, ) = to.call{ value: amount, gas: GAS_STIPEND }('');
      if (!success) revert TransferFailed();
    } else {
      IERC20(token).safeTransfer(to, amount);
    }
  }

  /// @dev Transfer amount and reward to potentially different recipients
  /// @param token Main token address
  /// @param amount Main amount to transfer
  /// @param amountTo Recipient for main amount
  /// @param rewardToken Reward token address
  /// @param reward Reward amount to transfer
  /// @param rewardTo Recipient for reward
  function _transferOutMixed(
    address token,
    uint256 amount,
    address payable amountTo,
    address rewardToken,
    uint256 reward,
    address payable rewardTo
  ) internal {
    if (reward > 0 && token == rewardToken && amountTo == rewardTo) {
      _transferOut(token, amountTo, amount + reward);
    } else {
      _transferOut(token, amountTo, amount);
      if (reward > 0) {
        _transferOut(rewardToken, rewardTo, reward);
      }
    }
  }

  /// @dev Emit UserLocked event (separated to avoid stack too deep).
  ///      amount in the event reflects params.amount (requested), not lock.amount (actually received).
  function _emitUserLocked(
    UserLockParams calldata params,
    DestinationInfo calldata dst,
    uint48 timelock,
    address sender,
    address refundTo,
    bytes calldata userData,
    bytes calldata solverData
  ) internal {
    emit UserLocked(
      params.hashlock,
      sender,
      params.recipient,
      refundTo,
      params.srcChain,
      params.token,
      params.amount,
      timelock,
      dst.dstChain,
      dst.dstAddress,
      dst.dstAmount,
      dst.dstToken,
      params.rewardAmount,
      params.rewardToken,
      params.rewardRecipient,
      params.rewardTimelockDelta,
      params.quoteExpiry,
      userData,
      solverData
    );
  }

  /// @dev Emit SolverLocked event (separated to avoid stack too deep).
  ///      amount/reward in the event reflect params values (requested), not lock values (actually received).
  function _emitSolverLocked(
    SolverLockParams calldata params,
    DestinationInfo calldata dst,
    uint256 index,
    uint48 timelock,
    uint48 rewardTimelock,
    address sender,
    address refundTo,
    bytes calldata data
  ) internal {
    emit SolverLocked(
      params.hashlock,
      sender,
      params.recipient,
      refundTo,
      index,
      params.srcChain,
      params.token,
      params.amount,
      params.reward,
      params.rewardToken,
      params.rewardRecipient,
      timelock,
      rewardTimelock,
      dst.dstChain,
      dst.dstAddress,
      dst.dstAmount,
      dst.dstToken,
      data
    );
  }
}
