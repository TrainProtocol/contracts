// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import 'forge-std/Script.sol';
import { console } from 'forge-std/console.sol';
import { TrainRouter } from '../../src/TrainRouter.sol';
import { Train } from '../../src/Train.sol';
import { ITrain } from '../../src/interfaces/ITrain.sol';
import { ERC20 } from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import { ERC20Permit } from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { IERC20Permit } from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol';

/// @notice Throwaway ERC-2612 token so the on-chain check needs no USDC — just the deployer's gas.
contract VToken is ERC20, ERC20Permit {
  constructor() ERC20('V2 Verify Token', 'V2VT') ERC20Permit('V2 Verify Token') {}
  function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @notice Minimal on-chain verification of the v2 deployment against the LIVE Train + TrainRouter.
///         Exercises the ERC-2612 gasless forward, the new intent replay guard (consumedIntent), the
///         Train pagination overflow fix (offset=1, limit=max), and redeem — with real broadcast txs.
///         The deployer plays both `user` (signs) and `relayer` (broadcasts).
/// @dev  TRAIN=0x877a7629BA8EfA6dd79057ab9105FdE3aDe93d75 ROUTER=0x0d117b12744E1A8b4980c3BdC3542Ad53C27E33a \
///       forge script script/sepolia/VerifyV2.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract VerifyV2 is Script {
  bytes32 constant PERMIT_TYPEHASH =
    keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');
  uint256 constant AMOUNT = 1e18;
  uint256 constant DEADLINE = type(uint256).max;

  uint256 pk;
  address user;
  Train train;
  TrainRouter router;
  VToken token;

  function run() external {
    pk = vm.envUint('PRIVATE_KEY');
    user = vm.addr(pk);
    train = Train(vm.envAddress('TRAIN'));
    router = TrainRouter(vm.envAddress('ROUTER'));

    // sanity: the live router must expose the new v2 witness string (nonce+deadline)
    require(_contains(router.WITNESS_TYPE_STRING(), 'uint256 nonce,uint256 deadline'), 'router not v2');

    vm.startBroadcast(pk);
    token = new VToken();
    token.mint(user, AMOUNT * 4);
    vm.stopBroadcast();
    console.log('VToken deployed:', address(token));

    // ----- forward #1 (intent nonce 1) -> Train lock A -----
    uint256 secretA = uint256(keccak256('v2-verify-A'));
    bytes32 hlA = sha256(abi.encodePacked(secretA));
    bytes memory cdA = _cd(hlA);
    _forward(hlA, cdA, 1);
    require(train.getUserLock(hlA).sender == user, 'lock A not created');
    require(train.getUserLock(hlA).amount == AMOUNT, 'lock A amount');
    require(IERC20(token).balanceOf(address(router)) == 0, 'router holds funds');
    require(IERC20(token).allowance(address(router), address(train)) == 0, 'residual allowance');
    bytes32 intentA = router.hashIntent(user, address(train), address(token), AMOUNT, keccak256(cdA), 1, DEADLINE);
    require(router.consumedIntent(intentA), 'intent A not consumed (replay guard off)');
    console.log('forward #1 OK: lock A created, intent A consumed');

    // ----- replay guard: re-submitting the SAME intent must revert IntentAlreadyConsumed -----
    (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(AMOUNT); // fresh permit; guard reverts before it matters
    bytes memory intentSigA = _signIntent(cdA, 1);
    bool reverted;
    bytes4 sel;
    try router.forwardWithPermit(
      user, address(token), AMOUNT, address(train), cdA, 1, DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: DEADLINE, v: pv, r: pr, s: ps }), intentSigA
    ) {
      reverted = false;
    } catch (bytes memory err) {
      reverted = true;
      if (err.length >= 4) sel = bytes4(err);
    }
    require(reverted, 'REPLAY DID NOT REVERT');
    require(sel == TrainRouter.IntentAlreadyConsumed.selector, 'replay reverted for wrong reason');
    console.log('replay guard OK: IntentAlreadyConsumed');

    // ----- forward #2 (intent nonce 2, fresh hashlock) -> user now has 2 locks -----
    uint256 secretB = uint256(keccak256('v2-verify-B'));
    bytes32 hlB = sha256(abi.encodePacked(secretB));
    bytes memory cdB = _cd(hlB);
    _forward(hlB, cdB, 2);
    require(train.getUserLock(hlB).sender == user, 'lock B not created');
    console.log('forward #2 OK: lock B created (user now has 2 locks)');

    // ----- pagination fix: offset=1, limit=max must NOT overflow-revert -----
    (bytes32[] memory hashes, uint256 total) = train.getUserLockHashes(user, 1, type(uint256).max);
    require(total >= 2, 'pagination: total');
    require(hashes.length == total - 1, 'pagination: page length');
    (Train.UserLock[] memory locks, uint256 total2) = train.getUserLocks(user, 1, type(uint256).max);
    require(total2 == total && locks.length == total - 1, 'pagination: getUserLocks');
    console.log('pagination fix OK: getUserLockHashes/getUserLocks(offset=1, limit=max) returned; total =', total);

    // ----- redeem both locks (recipient = user) -----
    vm.startBroadcast(pk);
    train.redeemUser(hlA, secretA);
    train.redeemUser(hlB, secretB);
    vm.stopBroadcast();
    require(uint8(train.getUserLock(hlA).status) == uint8(Train.LockStatus.Redeemed), 'redeem A');
    require(uint8(train.getUserLock(hlB).status) == uint8(Train.LockStatus.Redeemed), 'redeem B');
    console.log('redeem OK: locks A and B redeemed');
    console.log('=== ON-CHAIN V2 VERIFICATION PASSED ===');
  }

  // ---- helpers ----

  function _params(bytes32 hl) internal view returns (ITrain.UserLockParams memory) {
    return ITrain.UserLockParams({
      hashlock: hl, amount: AMOUNT, rewardAmount: 0, timelockDelta: 3600,
      rewardTimelockDelta: 1800, quoteExpiry: uint48(block.timestamp + 600),
      recipient: user, refundTo: user, token: address(token),
      payoutCurve: address(0), payoutCurveData: '',
      rewardToken: 'V2VT', rewardRecipient: '', srcChain: 'SEPOLIA'
    });
  }

  function _dst() internal pure returns (ITrain.DestinationInfo memory) {
    return ITrain.DestinationInfo({ dstChain: 'SEPOLIA', dstAddress: 'self', dstAmount: AMOUNT, dstToken: 'V2VT' });
  }

  function _cd(bytes32 hl) internal view returns (bytes memory) {
    return abi.encodeCall(ITrain.userLockFor, (user, _params(hl), _dst(), bytes(''), bytes('')));
  }

  function _signPermit(uint256 value) internal view returns (uint8 v, bytes32 r, bytes32 s) {
    uint256 nonce = IERC20Permit(address(token)).nonces(user);
    bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, user, address(router), value, nonce, DEADLINE));
    bytes32 digest = keccak256(abi.encodePacked('\x19\x01', token.DOMAIN_SEPARATOR(), structHash));
    (v, r, s) = vm.sign(pk, digest);
  }

  function _signIntent(bytes memory cd, uint256 nonce) internal view returns (bytes memory) {
    bytes32 digest = router.intentDigest(user, address(train), address(token), AMOUNT, keccak256(cd), nonce, DEADLINE);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
    return abi.encodePacked(r, s, v);
  }

  function _forward(bytes32, bytes memory cd, uint256 nonce) internal {
    (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(AMOUNT);
    bytes memory intentSig = _signIntent(cd, nonce);
    vm.startBroadcast(pk);
    router.forwardWithPermit(
      user, address(token), AMOUNT, address(train), cd, nonce, DEADLINE,
      TrainRouter.Permit2612({ value: AMOUNT, deadline: DEADLINE, v: pv, r: pr, s: ps }), intentSig
    );
    vm.stopBroadcast();
  }

  function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
    bytes memory h = bytes(haystack);
    bytes memory n = bytes(needle);
    if (n.length == 0 || n.length > h.length) return false;
    for (uint256 i = 0; i <= h.length - n.length; i++) {
      bool ok = true;
      for (uint256 j = 0; j < n.length; j++) {
        if (h[i + j] != n[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }
}
