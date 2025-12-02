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

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @title TrainERC20 Contract
/// @notice Mirrors the Train.sol HTLC logic for ERC20 transfers.
/// @dev Implements identical swap/state handling as Train.sol while using SafeERC20 for moves.
contract TrainERC20 is ReentrancyGuard {
  using SafeERC20 for IERC20;

  constructor() {}

  /// @dev Custom errors copied from Train.sol to keep logic identical.
  error FundsNotSent();
  error NotPassedTimelock();
  error HTLCNotExists();
  error HashlockNotMatch();
  error AlreadyClaimed();
  error InvalidTimelock();
  error InvalidRewardTimelock();
  error SwapAlreadyInitialized();
  error InvalidRewardAmount();
  error NoAllowance();

  /// @dev ERC20 HTLC storage struct. Same layout as Train.sol plus token address.
  struct HTLC {
    uint256 amount;
    bytes32 hashlock;
    uint256 secret;
    address payable sender;
    address payable srcReceiver;
    uint48 timelock;
    uint8 claimed;
    uint256 reward;
    uint48 rewardTimelock;
    address token;
  }

  /// @dev Storage for HTLCs mapped by swapId and htlcId.
  mapping(bytes32 => mapping(uint256 => HTLC)) private contracts;
  /// @dev Tracks swapIds initialized by each user (reward == 0 path).
  mapping(address => bytes32[]) private userSwaps;

  /// @dev Events mirror Train.sol with an extra token parameter for ERC20 context.
  event SrcLocked(
    bytes32 indexed swapId,
    bytes32 hashlock,
    string dstChain,
    string dstAddress,
    string dstAsset,
    address indexed sender,
    address srcReceiver,
    string srcAsset,
    uint256 amount,
    uint48 timelock,
    address token
  );

  event DstLocked(
    bytes32 indexed swapId,
    uint256 indexed htlcId,
    bytes32 hashlock,
    string dstChain,
    string dstAddress,
    string dstAsset,
    address indexed sender,
    address srcReceiver,
    string srcAsset,
    uint256 amount,
    uint256 reward,
    uint48 rewardTimelock,
    uint48 timelock,
    address token
  );

  event TokenRefunded(bytes32 indexed swapId, uint256 indexed htlcId);
  event TokenRedeemed(
    bytes32 indexed swapId,
    uint256 indexed htlcId,
    address redeemAddress,
    uint256 secret,
    bytes32 hashlock
  );

  modifier _exists(bytes32 swapId, uint256 htlcId) {
    if (!hasHTLC(swapId, htlcId)) revert HTLCNotExists();
    _;
  }

  /// @notice Locks ERC20 tokens for a user-initiated HTLC (no reward).
  function lockSrc(
    bytes32 swapId,
    bytes32 hashlock,
    uint48 timelock,
    address payable srcReceiver,
    string calldata srcAsset,
    string calldata dstChain,
    string calldata dstAddress,
    string calldata dstAsset,
    uint256 amount,
    address token
  ) external nonReentrant returns (bytes32, uint256) {
    if (amount == 0) revert FundsNotSent();
    if (block.timestamp + 1800 > timelock) revert InvalidTimelock();

    if (contracts[swapId][0].sender != address(0)) revert SwapAlreadyInitialized();

    IERC20 erc = IERC20(token);
    if (erc.allowance(msg.sender, address(this)) < amount) revert NoAllowance();
    erc.safeTransferFrom(msg.sender, address(this), amount);

    userSwaps[msg.sender].push(swapId);

    contracts[swapId][0] = HTLC(
      amount,
      hashlock,
      uint256(1),
      payable(msg.sender),
      srcReceiver,
      timelock,
      uint8(1),
      0,
      0,
      token
    );

    emit SrcLocked(
      swapId,
      hashlock,
      dstChain,
      dstAddress,
      dstAsset,
      msg.sender,
      srcReceiver,
      srcAsset,
      amount,
      timelock,
      token
    );

    return (swapId, 0);
  }

  /// @notice Locks ERC20 tokens for a solver-initiated HTLC (with reward).
  function lockDst(
    bytes32 swapId,
    bytes32 hashlock,
    uint256 reward,
    uint48 rewardTimelock,
    uint48 timelock,
    address payable srcReceiver,
    string calldata srcAsset,
    string calldata dstChain,
    string calldata dstAddress,
    string calldata dstAsset,
    uint256 amount,
    address token
  ) external nonReentrant returns (bytes32, uint256) {
    if (amount == 0) revert FundsNotSent();
    if (block.timestamp + 900 > timelock) revert InvalidTimelock();
    if (reward == 0) revert InvalidRewardAmount();

    // Enforce reward at least 10% of amount via multiplication to avoid rounding
    unchecked {
      if (reward * 10 < amount) revert InvalidRewardAmount();
    }

    if (rewardTimelock > timelock || rewardTimelock <= block.timestamp) revert InvalidRewardTimelock();

    uint256 htlcId;
    bool isNewSwap = (contracts[swapId][0].sender == address(0));
    if (isNewSwap) {
      htlcId = 0;
    } else {
      htlcId = 1;
      while (contracts[swapId][htlcId].sender != address(0)) {
        unchecked {
          htlcId++;
        }
      }
    }

    IERC20 erc = IERC20(token);
    uint256 totalTransfer = amount + reward;
    if (erc.allowance(msg.sender, address(this)) < totalTransfer) revert NoAllowance();
    erc.safeTransferFrom(msg.sender, address(this), totalTransfer);

    contracts[swapId][htlcId] = HTLC(
      amount,
      hashlock,
      uint256(1),
      payable(msg.sender),
      srcReceiver,
      timelock,
      uint8(1),
      reward,
      rewardTimelock,
      token
    );

    emit DstLocked(
      swapId,
      htlcId,
      hashlock,
      dstChain,
      dstAddress,
      dstAsset,
      msg.sender,
      srcReceiver,
      srcAsset,
      amount,
      reward,
      rewardTimelock,
      timelock,
      token
    );

    return (swapId, htlcId);
  }

  /// @notice Refunds tokens when the timelock has passed and the swap was not redeemed.
  function refund(bytes32 swapId, uint256 htlcId) external _exists(swapId, htlcId) nonReentrant returns (bool) {
    HTLC storage htlc = contracts[swapId][htlcId];
    if (htlc.claimed != 1) revert AlreadyClaimed();
    if (htlc.timelock > block.timestamp) revert NotPassedTimelock();

    htlc.claimed = 2;

    IERC20 erc = IERC20(htlc.token);
    if (htlc.reward != 0) {
      erc.safeTransfer(htlc.sender, htlc.amount + htlc.reward);
    } else {
      erc.safeTransfer(htlc.sender, htlc.amount);
    }

    emit TokenRefunded(swapId, htlcId);
    return true;
  }

  /// @notice Redeems tokens when a valid secret is provided.
  function redeem(
    bytes32 swapId,
    uint256 htlcId,
    uint256 secret
  ) external _exists(swapId, htlcId) nonReentrant returns (bool) {
    HTLC storage htlc = contracts[swapId][htlcId];

    if (htlc.hashlock != sha256(abi.encodePacked(secret))) revert HashlockNotMatch();
    if (htlc.claimed != 1) revert AlreadyClaimed();

    htlc.claimed = 3;
    htlc.secret = secret;

    IERC20 erc = IERC20(htlc.token);
    if (htlc.reward == 0) {
      erc.safeTransfer(htlc.srcReceiver, htlc.amount);
    } else if (htlc.rewardTimelock > block.timestamp) {
      erc.safeTransfer(htlc.srcReceiver, htlc.amount);
      erc.safeTransfer(htlc.sender, htlc.reward);
    } else {
      if (msg.sender == htlc.srcReceiver) {
        erc.safeTransfer(htlc.srcReceiver, htlc.amount + htlc.reward);
      } else {
        erc.safeTransfer(htlc.srcReceiver, htlc.amount);
        erc.safeTransfer(msg.sender, htlc.reward);
      }
    }

    emit TokenRedeemed(swapId, htlcId, msg.sender, secret, htlc.hashlock);
    return true;
  }

  /// @notice View helper mirroring Train.sol naming.
  function getHTLCDetails(bytes32 swapId, uint256 htlcId) public view returns (HTLC memory) {
    return contracts[swapId][htlcId];
  }

  function getUserSwaps(address user) public view returns (bytes32[] memory) {
    return userSwaps[user];
  }

  function hasHTLC(bytes32 swapId, uint256 htlcId) private view returns (bool) {
    return (contracts[swapId][htlcId].sender != address(0));
  }
}
