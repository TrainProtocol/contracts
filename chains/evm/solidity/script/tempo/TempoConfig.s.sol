// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { Train } from '../../src/tempo/Train.sol';

interface IPathUSD {
  function balanceOf(address) external view returns (uint256);
  function approve(address, uint256) external returns (bool);
  function allowance(address, address) external view returns (uint256);
  function decimals() external view returns (uint8);
}

/// @notice Shared config for the Tempo on-chain test scripts. Tempo analogue of
///         script/sepolia/SepoliaConfig.s.sol, but much smaller: there is no TrainRouter on
///         Tempo, so none of the permit/Permit2/EIP-3009 signing helpers apply here — those
///         flows don't exist on this branch (see README trust assumption #9). This config only
///         covers direct `Train` calls (`src/tempo/Train.sol`). The native-batched-and-sponsored
///         flow that replaces TrainRouter's role lives in script/tempo/native_flow.py instead —
///         Tempo Transactions are a distinct signed-envelope format outside what a Foundry
///         script (`vm.broadcast`) can construct.
/// @dev Env vars (set in your shell; never commit keys):
///   USER_PK — the user/signer key. Holds pathUSD. (uint256, 0x-hex ok)
///   TRAIN   — deployed src/tempo/Train.sol address.
/// All ERC20 flows use pathUSD (6 decimals, 0x20C0000000000000000000000000000000000000).
abstract contract TempoConfig is Script {
  // ── Tempo well-known addresses ──
  IPathUSD internal constant PATH_USD = IPathUSD(0x20C0000000000000000000000000000000000000);

  // ── Test sizing (tiny, to conserve faucet pathUSD; funds cycle back on redeem) ──
  uint256 internal constant AMOUNT = 10_000; // 0.01 pathUSD (6dp)
  uint256 internal constant REWARD = 2_000; //  0.002 pathUSD

  // ── loaded config ──
  uint256 internal userPk;
  address internal user;
  Train internal train;

  function _load() internal {
    userPk = vm.envUint('USER_PK');
    user = vm.addr(userPk);
    train = Train(vm.envAddress('TRAIN'));
    console.log('user   :', user);
    console.log('train  :', address(train));
    console.log('pathUSD bal (user, 6dp):', PATH_USD.balanceOf(user));
  }

  // ── unique secret per run so hashlocks never collide (SwapAlreadyExists) ──
  function _secret(string memory tag) internal returns (uint256) {
    return uint256(keccak256(abi.encodePacked(vm.unixTime(), tag, user)));
  }

  function _hashlock(uint256 secret) internal pure returns (bytes32) {
    return sha256(abi.encodePacked(secret));
  }

  // ── param builders (Train.* for direct Train calls) ──
  function _userParamsT(bytes32 hashlock, uint256 amount, uint48 timelockDelta, address recipient, address refundTo)
    internal view returns (Train.UserLockParams memory)
  {
    return Train.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: timelockDelta,
      rewardTimelockDelta: timelockDelta / 2, quoteExpiry: uint48(block.timestamp + 600),
      recipient: recipient, refundTo: refundTo, token: address(PATH_USD),
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'pathUSD', rewardRecipient: '', srcChain: 'TEMPO'
    });
  }

  function _solverParamsT(bytes32 hashlock, uint48 timelockDelta)
    internal view returns (Train.SolverLockParams memory)
  {
    return Train.SolverLockParams({
      hashlock: hashlock, amount: AMOUNT, reward: REWARD, timelockDelta: timelockDelta,
      rewardTimelockDelta: timelockDelta / 2, recipient: user, rewardRecipient: user,
      refundTo: user, token: address(PATH_USD), rewardToken: address(PATH_USD),
      payoutCurve: address(0), payoutCurveData: '', srcChain: 'TEMPO'
    });
  }

  function _dstT() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'TEMPO', dstAddress: 'self', dstAmount: AMOUNT, dstToken: 'pathUSD' });
  }

  function _logLock(bytes32 hashlock) internal view {
    Train.UserLock memory l = train.getUserLock(hashlock);
    console.log('  lock.sender :', l.sender);
    console.log('  lock.amount :', l.amount);
    console.log('  lock.status :', uint256(l.status)); // 1=Pending 2=Refunded 3=Redeemed
  }
}
