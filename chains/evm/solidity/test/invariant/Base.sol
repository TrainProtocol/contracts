// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Actor} from "./Actor.sol";
import {Clamp} from "./utils/Clamp.sol";
import {DecimalPrinter} from "./utils/DecimalPrinter.sol";
import {Deployer} from "./utils/Deployer.sol";
import {vm} from "./utils/Hevm.sol";
import {Logger} from "./utils/Logger.sol";
import {Math} from "./utils/Math.sol";
import {StringUtils} from "./utils/StringUtils.sol";
import {EnumerableSet} from "./utils/EnumerableSet.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {Train} from "../../src/Train.sol";
import {MockDecayCurve} from "../mocks/Mocks.sol";

/// @notice Base contract with state variables and setup functions
abstract contract Base is StringUtils, Clamp, Deployer, Math {
    using DecimalPrinter for uint256;

    string[] internal ACTOR_LABELS = ["Alice", "Bob", "Charlie"];
    uint256 internal constant BLOCK_INTERVAL = 12 seconds;
    uint256 internal constant INITIAL_ETH_BALANCE = 1_000 ether;
    uint256 internal constant INITIAL_TOKEN_BALANCE = 1_000_000 ether;

    // ―――――――――――――――――――――――――― Ghosts ――――――――――――――――――――――――――

    struct Ghosts {
        uint256 _placeholder;
    }

    Ghosts internal ghosts;

    // ―――――――――――――――――――――――――― Actors ――――――――――――――――――――――――――

    address[] internal actors;
    address internal actor;
    address internal admin;

    modifier asActor() virtual {
        vm.startPrank(actor);
        _;
        vm.stopPrank();
    }

    modifier asAdmin() virtual {
        vm.startPrank(admin);
        _;
        vm.stopPrank();
    }

    // ―――――――――――――――――――――――― Contracts ―――――――――――――――――――――――――

    Train internal train;
    MockERC20 internal token;

    // A decay curve (returns amount/2) so handlers can create curve-backed locks that exercise the
    // redeem `excess > 0` split — the invariants must hold whether or not a lock has a payout curve.
    address internal curve;

    // Dedicated payees that never act and never fund. Every lock pays its principal to
    // `recipientAddr`, refunds to `refundAddr`, and routes solver rewards to `rewardAddr`. Keeping
    // them disjoint from the acting actors lets the redeem/refund properties assert exact per-address
    // balance deltas with no aliasing (a redeemer is always an actor, never a payee).
    address internal constant recipientAddr = address(0x1111000000000000000000000000000000001111);
    address internal constant refundAddr = address(0x2222000000000000000000000000000000002222);
    address internal constant rewardAddr = address(0x3333000000000000000000000000000000003333);

    // ――――――――――――――― Lock registry (harness bookkeeping) ―――――――――――――――
    // The fuzzer cannot invert sha256, so the harness owns the secret⇄hashlock mapping: handlers that
    // create locks pick a fresh secret and record it here so redeem/refund handlers (and invariants)
    // can target real locks and enumerate them.

    uint256 internal secretCounter;
    bytes32[] internal userHashlocks; // every created user lock (Pending or terminal)
    mapping(bytes32 => uint256) internal userSecretOf;

    struct SolverRef {
        bytes32 hashlock;
        uint256 index;
        uint256 secret;
    }
    SolverRef[] internal solverRefs; // every created solver lock

    // ―――――――――――――――――――――――――― Setup ―――――――――――――――――――――――――――

    function setup() internal {
        train = new Train();
        token = new MockERC20(address(this), 0, "Mock", "MCK", 18);
        curve = address(new MockDecayCurve(1, 2)); // P(t) = amount / 2

        setupActors();

        // Fund + approve every actor so userLock / userLockFor / solverLock can pull via transferFrom.
        for (uint256 i; i < actors.length; i++) {
            token.deal(actors[i], INITIAL_TOKEN_BALANCE);
            vm.prank(actors[i]);
            token.approve(address(train), type(uint256).max);
        }
    }

    function setupActors() internal {
        admin = address(this);
        vm.label(admin, "Admin");

        for (uint256 i; i < ACTOR_LABELS.length; i++) {
            address _actor = address(new Actor{value: INITIAL_ETH_BALANCE}());
            actors.push(_actor);
            if (ACTOR_LABELS.length > i) {
                vm.label(_actor, ACTOR_LABELS[i]);
            }
        }
        actor = actors[0];
    }

    // ――――――――――――――――――― Lock-building helpers ―――――――――――――――――――

    /// @dev Fresh, unique (secret, hashlock) pair the harness controls.
    function _freshLock() internal returns (uint256 s, bytes32 hl) {
        secretCounter++;
        s = uint256(keccak256(abi.encodePacked("train-invariant-secret", secretCounter)));
        hl = sha256(abi.encodePacked(s));
    }

    function _dst() internal pure returns (Train.DestinationInfo memory) {
        return Train.DestinationInfo({dstChain: "dst", dstAddress: "a", dstAmount: 1, dstToken: "T"});
    }

    function _userParams(bytes32 hl, uint256 amount, uint48 timelockDelta)
        internal
        view
        returns (Train.UserLockParams memory)
    {
        return Train.UserLockParams({
            hashlock: hl,
            amount: amount,
            rewardAmount: 0,
            timelockDelta: timelockDelta,
            rewardTimelockDelta: timelockDelta / 2,
            quoteExpiry: uint48(block.timestamp + 1 hours),
            recipient: recipientAddr,
            refundTo: refundAddr,
            token: address(token),
            payoutCurve: address(0),
            payoutCurveData: "",
            rewardToken: "T",
            rewardRecipient: "rr",
            srcChain: "src"
        });
    }

    function _solverParams(bytes32 hl, uint256 amount, uint256 reward, uint48 timelockDelta)
        internal
        view
        returns (Train.SolverLockParams memory)
    {
        return Train.SolverLockParams({
            hashlock: hl,
            amount: amount,
            reward: reward,
            timelockDelta: timelockDelta,
            rewardTimelockDelta: timelockDelta / 2,
            recipient: recipientAddr,
            rewardRecipient: rewardAddr,
            refundTo: refundAddr,
            token: address(token),
            rewardToken: address(token),
            payoutCurve: address(0),
            payoutCurveData: "",
            srcChain: "src"
        });
    }

    // ――――――――――――――――――――――――― Helpers ――――――――――――――――――――――――――

    // Maps an arbitrary address to an actor address
    function toActor(address addy) internal view returns (address) {
        return actors[uint256(uint160(addy)) % actors.length];
    }

    // Maps an arbitrary address to an actor address that is different from the current actor
    function toActorNotCurrent(address addy) internal view returns (address) {
        address _actor = actors[uint256(uint160(addy)) % actors.length];
        if (_actor == actor) {
            _actor = actors[(uint256(uint160(addy)) + 1) % actors.length];
        }
        return _actor;
    }

    // Sums the native token balances of all actors
    function sumActorsBalances() internal view returns (uint256 sumOfBalances) {
        for (uint256 i; i < actors.length; i++) {
            sumOfBalances += actors[i].balance;
        }
    }

    // Sums the ERC-20 token balances of all actors for a given token
    function sumActorsERC20Balances(address _token) internal view returns (uint256 sumOfBalances) {
        for (uint256 i; i < actors.length; i++) {
            bytes memory data = abi.encodeWithSignature("balanceOf(address)", actors[i]);
            (bool success, bytes memory result) = _token.staticcall(data);
            require(success, "sumActorsERC20Balances: failed to get balance");
            sumOfBalances += abi.decode(result, (uint256));
        }
    }

    /// @dev Total MockERC20 held by every address that can ever hold it: the acting actors, the
    ///      three dedicated payees, and the Train escrow. Equals totalSupply iff no tokens leak to
    ///      an untracked address and none are minted/burned outside setup.
    function sumSystemTokenBalance() internal view returns (uint256) {
        return sumActorsERC20Balances(address(token)) + token.balanceOf(recipientAddr)
            + token.balanceOf(refundAddr) + token.balanceOf(rewardAddr) + token.balanceOf(address(train));
    }

    function skipBlocks(uint256 blocks) internal {
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * BLOCK_INTERVAL);
    }

    function skipTime(uint256 time) internal {
        uint256 blocks = (time + BLOCK_INTERVAL - 1) / BLOCK_INTERVAL;
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + time);
    }
}
