// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import 'forge-std/Test.sol';
import '../src/Train.sol';
import '../src/SqrtPayoutCurve.sol';
import '../src/LinearPayoutCurve.sol';
import '../src/VolatilityDecayCurve.sol';
import '../src/IPayoutCurve.sol';
import '../src/TestToken.sol';

contract DecayTest is Test {
  Train public train;
  IPayoutCurve public curve;
  TestToken public token;

  address payable initiator;
  address payable solver;
  address payable receiver;
  address payable rewardRecipient;
  address payable relayer;

  uint256 constant SECRET = 12345;
  bytes32 hashlock;
  address constant NATIVE_ETH = address(0);

  function setUp() public {
    train = new Train();
    curve = IPayoutCurve(_deployLib(type(SqrtPayoutCurve).creationCode));
    token = new TestToken();

    initiator = payable(makeAddr('initiator'));
    solver = payable(makeAddr('solver'));
    receiver = payable(makeAddr('receiver'));
    rewardRecipient = payable(makeAddr('rewardRecipient'));
    relayer = payable(makeAddr('relayer'));

    vm.deal(initiator, 100 ether);
    vm.deal(solver, 100 ether);
    vm.deal(relayer, 1 ether);

    token.mint(initiator, 1000 ether);
    token.mint(solver, 1000 ether);

    vm.prank(initiator);
    token.approve(address(train), type(uint256).max);
    vm.prank(solver);
    token.approve(address(train), type(uint256).max);

    hashlock = sha256(abi.encodePacked(SECRET));
  }

  function _deployLib(bytes memory bytecode) internal returns (address addr) {
    assembly { addr := create(0, add(bytecode, 0x20), mload(bytecode)) }
    require(addr != address(0), 'lib deploy failed');
  }

  // payoutCurveData = config bytes passed directly to computePayout
  // config = abi.encode(gracePeriod=60, A=2e34, B=1e33, Pmin=0.1 ether)
  function _curveData() internal pure returns (bytes memory) {
    return abi.encode(uint256(60), uint256(2e34), uint256(1e33), uint256(0.1 ether));
  }

  function _dst() internal pure returns (Train.DestinationInfo memory) {
    return Train.DestinationInfo({ dstChain: 'ETH', dstAddress: '0xDst', dstAmount: 1, dstToken: 'ETH' });
  }

  function _userParams(uint256 amount, address tokenAddr, address pc, bytes memory pcd)
    internal view returns (Train.UserLockParams memory)
  {
    return Train.UserLockParams({
      hashlock: hashlock, amount: amount, rewardAmount: 0, timelockDelta: 3600,
      rewardTimelockDelta: 1800, quoteExpiry: uint48(block.timestamp + 60),
      recipient: receiver, refundTo: initiator, token: tokenAddr,
      payoutCurve: pc, payoutCurveData: pcd,
      rewardToken: 'ETH', rewardRecipient: 'rewardRecipient', srcChain: 'ETH'
    });
  }

  function _solverParams(uint256 amount, address tokenAddr, uint256 reward, address rewardTokenAddr, address pc, bytes memory pcd)
    internal view returns (Train.SolverLockParams memory)
  {
    return Train.SolverLockParams({
      hashlock: hashlock, amount: amount, reward: reward, timelockDelta: 3600,
      rewardTimelockDelta: 1800, recipient: receiver,
      rewardRecipient: rewardRecipient, refundTo: solver, token: tokenAddr, rewardToken: rewardTokenAddr,
      payoutCurve: pc, payoutCurveData: pcd, srcChain: 'ETH'
    });
  }

  // ============ User Lock ============

  function test_userLock_WithPayoutCurve_StoresCorrectly() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    Train.UserLock memory lock = train.getUserLock(hashlock);
    assertEq(lock.amount, 1 ether);
    assertEq(lock.payoutCurve, address(curve));
    assertGt(lock.startTime, 0);
  }

  function test_userLock_WithoutPayoutCurve_StoresZeroAddress() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(0), '');

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');
    assertEq(train.getUserLock(hashlock).payoutCurve, address(0));
  }

  function test_userLock_RevertsOnInvalidPayoutCurve() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(0xdead), '');

    vm.prank(initiator);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');
  }

  function test_userLock_RevertsWhenCurveReturnsFalseInterface() public {
    FalseInterfaceCurve bad = new FalseInterfaceCurve();
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(bad), '');

    vm.prank(initiator);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');
  }

  function test_userLock_RevertsWhenCurveInterfaceReverts() public {
    RevertingInterfaceCurve bad = new RevertingInterfaceCurve();
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(bad), '');

    vm.prank(initiator);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');
  }

  function test_solverLock_RevertsWhenCurveReturnsFalseInterface() public {
    FalseInterfaceCurve bad = new FalseInterfaceCurve();
    Train.SolverLockParams memory params = _solverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH, address(bad), '');

    vm.prank(solver);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.solverLock{ value: 1 ether }(params, _dst(), '');
  }

  // ============ Redeem User with Decay ============

  function test_redeemUser_GracePeriod_FullPayout() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.warp(block.timestamp + 30);
    uint256 before = receiver.balance;
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    assertEq(receiver.balance - before, 1 ether);
  }

  function test_redeemUser_AfterGrace_ReducedPayout() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.warp(block.timestamp + 660);
    uint256 rBefore = receiver.balance;
    uint256 sBefore = initiator.balance;

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    uint256 rGot = receiver.balance - rBefore;
    uint256 sGot = initiator.balance - sBefore;
    assertLt(rGot, 1 ether);
    assertGt(sGot, 0);
    assertEq(rGot + sGot, 1 ether);
  }

  function test_redeemUser_FloorClamp() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.warp(block.timestamp + 100_000);
    uint256 rBefore = receiver.balance;
    uint256 sBefore = initiator.balance;

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    assertEq(receiver.balance - rBefore, 0.1 ether);
    assertEq(initiator.balance - sBefore, 0.9 ether);
  }

  function test_redeemUser_NoCurve_FullPayout() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(0), '');

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.warp(block.timestamp + 660);
    uint256 before = receiver.balance;
    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);
    assertEq(receiver.balance - before, 1 ether);
  }

  function test_redeemUser_ERC20_WithDecay() public {
    Train.UserLockParams memory params = _userParams(100 ether, address(token), address(curve), _curveData());

    vm.prank(initiator);
    train.userLock(params, _dst(), '', '');

    vm.warp(block.timestamp + 660);
    uint256 rBefore = token.balanceOf(receiver);
    uint256 sBefore = token.balanceOf(initiator);

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    uint256 rGot = token.balanceOf(receiver) - rBefore;
    uint256 sGot = token.balanceOf(initiator) - sBefore;
    assertLt(rGot, 100 ether);
    assertGt(sGot, 0);
    assertEq(rGot + sGot, 100 ether);
  }

  // LinearPayoutCurve through Train: validates supportsInterface + decay at redeem
  // dt = 660 - 60 = 600s → decay = 1e33*600/1e18 = 0.6 ether → payout = 0.4 ether
  function test_redeemUser_WithLinearCurve_Integration() public {
    setUp_linear();
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(linearCurve), _linearCfg());

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.warp(block.timestamp + 660);
    uint256 rBefore = receiver.balance;
    uint256 sBefore = initiator.balance;

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    assertEq(receiver.balance - rBefore, 0.4 ether);
    assertEq(initiator.balance - sBefore, 0.6 ether);
  }

  // VolatilityDecayCurve through Train: validates supportsInterface + decay at redeem
  // amount=100 ether, after grace: payout in [Pmin, amount) and sum conserved
  function test_redeemUser_WithVolCurve_Integration() public {
    setUp_vol();
    vm.deal(initiator, 200 ether);
    Train.UserLockParams memory params = _userParams(100 ether, NATIVE_ETH, address(volCurve), _volCfg());

    vm.prank(initiator);
    train.userLock{ value: 100 ether }(params, _dst(), '', '');

    vm.warp(block.timestamp + 660);
    uint256 rBefore = receiver.balance;
    uint256 sBefore = initiator.balance;

    vm.prank(relayer);
    train.redeemUser(hashlock, SECRET);

    uint256 rGot = receiver.balance - rBefore;
    uint256 sGot = initiator.balance - sBefore;
    assertLt(rGot, 100 ether);
    assertGe(rGot, 85 ether); // at least Pmin (r=0.85)
    assertEq(rGot + sGot, 100 ether);
  }

  // ============ Refund User ignores Decay ============

  function test_refundUser_IgnoresDecay() public {
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.warp(block.timestamp + 7200);
    uint256 before = initiator.balance;
    vm.prank(relayer);
    train.refundUser(hashlock);
    assertEq(initiator.balance - before, 1 ether);
  }

  // ============ Solver Lock ============

  function test_solverLock_WithPayoutCurve_StoresCorrectly() public {
    Train.SolverLockParams memory params = _solverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(solver);
    uint256 idx = train.solverLock{ value: 1.1 ether }(params, _dst(), '');

    Train.SolverLock memory lock = train.getSolverLock(hashlock, idx);
    assertEq(lock.payoutCurve, address(curve));
    assertGt(lock.startTime, 0);
  }

  function test_solverLock_RevertsOnInvalidPayoutCurve() public {
    Train.SolverLockParams memory params = _solverParams(1 ether, NATIVE_ETH, 0, NATIVE_ETH, address(0xdead), '');

    vm.prank(solver);
    vm.expectRevert(Train.InvalidPayoutCurve.selector);
    train.solverLock{ value: 1 ether }(params, _dst(), '');
  }

  // ============ Redeem Solver with Decay ============

  function test_redeemSolver_AfterGrace_ReducedPayout() public {
    Train.SolverLockParams memory params = _solverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(solver);
    uint256 idx = train.solverLock{ value: 1.1 ether }(params, _dst(), '');

    vm.warp(block.timestamp + 660);
    uint256 rBefore = receiver.balance;
    uint256 sBefore = solver.balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, idx, SECRET);

    uint256 rGot = receiver.balance - rBefore;
    uint256 sExcess = solver.balance - sBefore;
    assertLt(rGot, 1 ether);
    assertGt(sExcess, 0);
    assertEq(rGot + sExcess, 1 ether);
  }

  function test_redeemSolver_RewardUnaffected() public {
    Train.SolverLockParams memory params = _solverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(solver);
    uint256 idx = train.solverLock{ value: 1.1 ether }(params, _dst(), '');

    vm.warp(block.timestamp + 660);
    uint256 before = rewardRecipient.balance;
    vm.prank(relayer);
    train.redeemSolver(hashlock, idx, SECRET);
    assertEq(rewardRecipient.balance - before, 0.1 ether);
  }

  function test_redeemSolver_FloorClamp() public {
    Train.SolverLockParams memory params = _solverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(solver);
    uint256 idx = train.solverLock{ value: 1.1 ether }(params, _dst(), '');

    vm.warp(block.timestamp + 100_000);
    uint256 rBefore = receiver.balance;
    uint256 sBefore = solver.balance;

    vm.prank(relayer);
    train.redeemSolver(hashlock, idx, SECRET);

    assertEq(receiver.balance - rBefore, 0.1 ether); // clamped to Pmin
    assertEq(solver.balance - sBefore, 0.9 ether);   // excess returned to refundTo
  }

  // ============ Refund Solver ignores Decay ============

  function test_refundSolver_IgnoresDecay() public {
    Train.SolverLockParams memory params = _solverParams(1 ether, NATIVE_ETH, 0.1 ether, NATIVE_ETH, address(curve), _curveData());

    vm.prank(solver);
    uint256 idx = train.solverLock{ value: 1.1 ether }(params, _dst(), '');

    vm.warp(block.timestamp + 7200);
    uint256 before = solver.balance;
    train.refundSolver(hashlock, idx);
    assertEq(solver.balance - before, 1.1 ether);
  }

  // ============ Revert Handling ============

  function test_redeemUser_RevertsWhenCurveReverts() public {
    RevertingCurve bad = new RevertingCurve();
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(bad), '');

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.prank(relayer);
    vm.expectRevert(Train.InvalidPayout.selector);
    train.redeemUser(hashlock, SECRET);
  }

  function test_redeemUser_RevertsWhenCurveReturnsZero() public {
    ZeroPayoutCurve bad = new ZeroPayoutCurve();
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(bad), '');

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.prank(relayer);
    vm.expectRevert(Train.InvalidPayout.selector);
    train.redeemUser(hashlock, SECRET);
  }

  function test_redeemUser_RevertsWhenCurveExceedsAmount() public {
    OverPayoutCurve bad = new OverPayoutCurve();
    Train.UserLockParams memory params = _userParams(1 ether, NATIVE_ETH, address(bad), '');

    vm.prank(initiator);
    train.userLock{ value: 1 ether }(params, _dst(), '', '');

    vm.prank(relayer);
    vm.expectRevert(Train.InvalidPayout.selector);
    train.redeemUser(hashlock, SECRET);
  }

  // ============ SqrtPayoutCurve Unit Tests ============

  function _cfg() internal pure returns (bytes memory) {
    return abi.encode(uint256(60), uint256(2e34), uint256(1e33), uint256(0.1 ether));
  }

  function test_sqrtCurve_WithinGrace() public view {
    assertEq(curve.computePayout(1 ether, 100, 150, _cfg()), 1 ether);
  }

  function test_sqrtCurve_AtGraceBoundary() public view {
    assertEq(curve.computePayout(1 ether, 100, 160, _cfg()), 1 ether);
  }

  function test_sqrtCurve_AfterGrace_Decays() public view {
    uint256 p = curve.computePayout(1 ether, 100, 170, _cfg());
    assertLt(p, 1 ether);
    assertGt(p, 0.1 ether);
  }

  function test_sqrtCurve_LongTime_ClampsToFloor() public view {
    assertEq(curve.computePayout(1 ether, 100, 100_160, _cfg()), 0.1 ether);
  }

  function test_sqrtCurve_RevertsOnBadData() public {
    vm.expectRevert(SqrtPayoutCurve.InvalidConfig.selector);
    curve.computePayout(1 ether, 100, 200, '');
  }

  function test_sqrtCurve_RevertsWhenFloorExceedsAmount() public {
    bytes memory bad = abi.encode(uint256(0), uint256(0), uint256(0), uint256(2 ether));
    vm.expectRevert(SqrtPayoutCurve.FloorExceedsAmount.selector);
    curve.computePayout(1 ether, 100, 200, bad);
  }

  // ============ LinearPayoutCurve Unit Tests ============
  // config = abi.encode(gracePeriod=60, rate=1e33, Pmin=0.1 ether)
  // rate=1e33 => decay/sec = 1e33/1e18 = 1e15 wei/sec = 0.001 ether/sec
  // headroom = 1 ether - 0.1 ether = 0.9 ether; exhausted after 900s past grace

  IPayoutCurve public linearCurve;

  function setUp_linear() internal {
    linearCurve = IPayoutCurve(_deployLib(type(LinearPayoutCurve).creationCode));
  }

  function _linearCfg() internal pure returns (bytes memory) {
    // gracePeriod=60, rate=1e33 (0.001 ether/sec), Pmin=0.1 ether
    return abi.encode(uint256(60), uint256(1e33), uint256(0.1 ether));
  }

  function test_linearCurve_WithinGrace() public {
    setUp_linear();
    // startTime=100, currentTime=130, grace=60 → still inside grace
    assertEq(linearCurve.computePayout(1 ether, 100, 130, _linearCfg()), 1 ether);
  }

  function test_linearCurve_AtGraceBoundary() public {
    setUp_linear();
    // currentTime=160 → currentTime == startTime + grace → no decay yet
    assertEq(linearCurve.computePayout(1 ether, 100, 160, _linearCfg()), 1 ether);
  }

  function test_linearCurve_AfterGrace_PartialDecay() public {
    setUp_linear();
    // dt=100s → decay = 1e15 * 100 / 1e18 = 0.1 ether → payout = 0.9 ether
    assertEq(linearCurve.computePayout(1 ether, 100, 260, _linearCfg()), 0.9 ether);
  }

  function test_linearCurve_AtFloorBoundary() public {
    setUp_linear();
    // dt=900s → decay = 0.9 ether → payout = exactly Pmin = 0.1 ether
    assertEq(linearCurve.computePayout(1 ether, 100, 1060, _linearCfg()), 0.1 ether);
  }

  function test_linearCurve_PastFloor_ClampsToFloor() public {
    setUp_linear();
    // dt=1000s → decay = 1 ether → clamped to Pmin = 0.1 ether
    assertEq(linearCurve.computePayout(1 ether, 100, 1160, _linearCfg()), 0.1 ether);
  }

  function test_linearCurve_ZeroRate_AlwaysFullPayout() public {
    setUp_linear();
    bytes memory cfg = abi.encode(uint256(0), uint256(0), uint256(0));
    assertEq(linearCurve.computePayout(1 ether, 100, 100_000, cfg), 1 ether);
  }

  function test_linearCurve_RevertsOnBadConfig() public {
    setUp_linear();
    vm.expectRevert(LinearPayoutCurve.InvalidConfig.selector);
    linearCurve.computePayout(1 ether, 100, 200, '');
  }

  function test_linearCurve_RevertsWhenFloorExceedsAmount() public {
    setUp_linear();
    bytes memory bad = abi.encode(uint256(0), uint256(0), uint256(2 ether));
    vm.expectRevert(LinearPayoutCurve.FloorExceedsAmount.selector);
    linearCurve.computePayout(1 ether, 100, 200, bad);
  }

  // ============ VolatilityDecayCurve Unit Tests ============
  //
  // Worked example from Decay Function Specification v1.0 (section 5):
  //   P0 = 100 tokens, r = 0.85, g = 60s, H = 1800s, σ_ann = 1.10
  //   A ≈ 0.0196 tokens/√s  (volatility-driven early penalty)
  //   B ≈ 0.0083 tokens/s   (horizon-driven sustained penalty)
  //   Pmin = 85 tokens
  //
  // Key distinction from SqrtPayoutCurve: A, B, Pmin are derived from `amount`
  // at call time, so the same config bytes work for any lock size.

  IPayoutCurve public volCurve;

  function setUp_vol() internal {
    volCurve = IPayoutCurve(_deployLib(type(VolatilityDecayCurve).creationCode));
  }

  // config: gracePeriod=60, sigmaAnn=1.10e18, H=1800, r=0.85e18
  function _volCfg() internal pure returns (bytes memory) {
    return abi.encode(uint256(60), uint256(1.10e18), uint256(1800), uint256(0.85e18));
  }

  function test_volCurve_WithinGrace() public {
    setUp_vol();
    // currentTime=150, startTime=100, grace=60 → 150 <= 160, no decay
    assertEq(volCurve.computePayout(100e18, 100, 150, _volCfg()), 100e18);
  }

  function test_volCurve_AtGraceBoundary() public {
    setUp_vol();
    // currentTime == startTime + grace → boundary, still full payout
    assertEq(volCurve.computePayout(100e18, 100, 160, _volCfg()), 100e18);
  }

  function test_volCurve_AfterGrace_PartialDecay() public {
    setUp_vol();
    // dt=100s: both A*sqrt(100) and B*100 contribute; result in (Pmin, amount)
    uint256 p = volCurve.computePayout(100e18, 100, 260, _volCfg());
    assertLt(p, 100e18);
    assertGt(p, 85e18);
  }

  function test_volCurve_BeyondHorizon_ClampsToFloor() public {
    setUp_vol();
    // dt = 2 * H = 3600: B term alone would give 2*(amount-Pmin) = 30 ether of decay,
    // which far exceeds the 15 ether headroom → clamped to Pmin
    assertEq(volCurve.computePayout(100e18, 100, 100 + 60 + 3600, _volCfg()), 85e18);
  }

  function test_volCurve_ScalesWithAmount() public {
    setUp_vol();
    // Same config, different amounts — both should clamp to their respective Pmin
    // at dt >> H, demonstrating amount-independence of the config
    assertEq(volCurve.computePayout(200e18, 100, 100 + 60 + 7200, _volCfg()), 170e18); // Pmin = 0.85 * 200e18
    assertEq(volCurve.computePayout(50e18,  100, 100 + 60 + 7200, _volCfg()), 42.5e18); // Pmin = 0.85 * 50e18
  }

  function test_volCurve_ZeroVolatility_ExactDecay() public {
    setUp_vol();
    // sigmaAnn=0 → A=0, pure linear. Use H=1500 for exact integer arithmetic.
    // B = (100e18 - 85e18) * 1e18 / 1500 = 1e34 exactly
    // At dt=750: decay = 1e34 * 750 / 1e18 = 7.5e18 → payout = 92.5e18
    bytes memory cfg = abi.encode(uint256(60), uint256(0), uint256(1500), uint256(0.85e18));
    assertEq(volCurve.computePayout(100e18, 100, 100 + 60 + 750, cfg), 92.5e18);
  }

  function test_volCurve_ZeroVolatility_FloorClamp() public {
    setUp_vol();
    // sigmaAnn=0, H=1500: at dt=H exactly, B*H/1e18 = amount-Pmin → decay >= headroom → Pmin
    bytes memory cfg = abi.encode(uint256(60), uint256(0), uint256(1500), uint256(0.85e18));
    assertEq(volCurve.computePayout(100e18, 100, 100 + 60 + 1500, cfg), 85e18);
  }

  function test_volCurve_RevertsOnBadConfig() public {
    setUp_vol();
    vm.expectRevert(VolatilityDecayCurve.InvalidConfig.selector);
    volCurve.computePayout(100e18, 100, 200, '');
  }

  function test_volCurve_RevertsOnInvalidFloorRatio() public {
    setUp_vol();
    // r = 1e18 means Pmin = amount → no headroom
    bytes memory bad = abi.encode(uint256(60), uint256(1.1e18), uint256(1800), uint256(1e18));
    vm.expectRevert(VolatilityDecayCurve.InvalidFloorRatio.selector);
    volCurve.computePayout(100e18, 100, 200, bad);
  }

  function test_volCurve_RevertsOnZeroHorizon() public {
    setUp_vol();
    bytes memory bad = abi.encode(uint256(60), uint256(1.1e18), uint256(0), uint256(0.85e18));
    vm.expectRevert(VolatilityDecayCurve.InvalidHorizon.selector);
    volCurve.computePayout(100e18, 100, 200, bad);
  }
}

// ============ Mock Payout Curves ============

contract RevertingCurve is IPayoutCurve {
  function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IPayoutCurve).interfaceId; }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { revert('boom'); }
}

contract ZeroPayoutCurve is IPayoutCurve {
  function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IPayoutCurve).interfaceId; }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { return 0; }
}

contract OverPayoutCurve is IPayoutCurve {
  function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IPayoutCurve).interfaceId; }
  function computePayout(uint256 a, uint48, uint48, bytes calldata) external pure returns (uint256) { return a + 1; }
}

// Returns false for supportsInterface — _validatePayoutCurve must reject it
contract FalseInterfaceCurve {
  function supportsInterface(bytes4) external pure returns (bool) { return false; }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { return 0; }
}

// Reverts on supportsInterface — _validatePayoutCurve must reject it
contract RevertingInterfaceCurve {
  function supportsInterface(bytes4) external pure returns (bool) { revert(); }
  function computePayout(uint256, uint48, uint48, bytes calldata) external pure returns (uint256) { return 0; }
}
