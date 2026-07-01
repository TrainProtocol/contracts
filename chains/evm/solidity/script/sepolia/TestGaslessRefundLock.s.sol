// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';
import { TrainRouter } from '../../src/TrainRouter.sol';
import { ITrain } from '../../src/interfaces/ITrain.sol';

/// @notice Step 1 of the GASLESS refund demo: the user signs (off-chain), the relayer broadcasts to
///         the TrainRouter (ERC-2612 permit path). The TrainRouter pulls the USER's USDC and forwards it into
///         Train with a 60s timelock. Crucially `refundTo = user` (the depositor) and
///         `recipient = a counterparty` (so the later refund is timelock-gated, not redeemed).
/// @dev Set REFUND_SALT to a fresh value and reuse the SAME value in TestGaslessRefundClaim.
///   $env:REFUND_SALT = "g1"
///   forge script script/sepolia/TestGaslessRefundLock.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast
contract TestGaslessRefundLock is SepoliaConfig {
  function run() external {
    _load();
    string memory salt = vm.envString('REFUND_SALT');
    address counterparty = address(uint160(uint256(keccak256('train.sepolia.counterparty'))));
    uint256 secret = uint256(keccak256(abi.encodePacked(salt, 'gasless-refund', user)));
    bytes32 hl = _hashlock(secret);

    // depositor = user (TrainRouter pulls USER's USDC); refundTo = user; recipient = counterparty; 60s lock
    ITrain.UserLockParams memory p = ITrain.UserLockParams({
      hashlock: hl, amount: AMOUNT, rewardAmount: 0, timelockDelta: 60,
      rewardTimelockDelta: 30, quoteExpiry: uint48(block.timestamp + 600),
      recipient: counterparty, refundTo: user, token: address(USDC),
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'USDC', rewardRecipient: '', srcChain: 'SEPOLIA'
    });
    ITrain.DestinationInfo memory d = _dstI();
    bytes memory cd = _callData(p, d);

    // GASLESS: user signs the ERC-2612 permit (spender = TrainRouter) + the EIP-712 intent; relayer sends.
    (uint8 v, bytes32 r, bytes32 s) = _signPermit(AMOUNT, type(uint256).max);
    bytes memory intentSig = _signIntent(AMOUNT, cd);

    uint256 userBefore = USDC.balanceOf(user);
    vm.startBroadcast(relayerPk);
    router.forwardWithPermit(
      user, address(USDC), AMOUNT, address(train), cd,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: type(uint256).max, v: v, r: r, s: s }),
      intentSig
    );
    vm.stopBroadcast();

    console.log('Gasless lock created: USER signed, RELAYER broadcast.');
    console.log('  depositor (USDC pulled from)  :', user);
    console.log('  USDC pulled from user (6dp)   :', userBefore - USDC.balanceOf(user)); // = AMOUNT
    console.log('  lock.refundTo  (should = user):', user);
    console.log('  lock.recipient (counterparty) :', counterparty);
    console.log('  hashlock:', vm.toString(hl));
    console.log('Wait ~60s, then run TestGaslessRefundClaim with the SAME REFUND_SALT.');
    _logLock(hl);
  }
}
