// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { ERC20 } from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import { ERC20Permit } from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol';
import { IERC165 } from '@openzeppelin/contracts/utils/introspection/IERC165.sol';
import { IPayoutCurve } from '../../src/IPayoutCurve.sol';
import { ITrain } from '../../src/interfaces/ITrain.sol';

/// @notice Payout curve that returns `amount * num / den` (clamped to >=1), so 0 < payout < amount
///         whenever num < den — used to exercise the `excess > 0` redeem branch.
contract MockDecayCurve is IPayoutCurve {
  uint256 public immutable num;
  uint256 public immutable den;

  constructor(uint256 _num, uint256 _den) {
    num = _num;
    den = _den;
  }

  function supportsInterface(bytes4 id) external pure returns (bool) {
    return id == type(IERC165).interfaceId || id == type(IPayoutCurve).interfaceId;
  }

  function computePayout(uint256 amount, uint48, uint48, bytes calldata) external view returns (uint256) {
    uint256 p = (amount * num) / den;
    if (p == 0) p = 1; // keep within the contract's required 0 < payout <= amount
    return p;
  }
}

/// @notice ERC-2612 token that charges a fee on transfer, crediting the recipient `value*(1-fee)`.
///         feeBps == 10_000 means a 100% fee (recipient receives nothing).
contract FeeOnTransferToken is ERC20, ERC20Permit {
  uint256 public immutable feeBps;
  address public constant FEE_SINK = address(0xFEE);

  constructor(uint256 _feeBps) ERC20('Fee Token', 'FOT') ERC20Permit('Fee Token') {
    feeBps = _feeBps;
  }

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  function _update(address from, address to, uint256 value) internal override {
    if (from != address(0) && to != address(0) && feeBps > 0) {
      uint256 fee = (value * feeBps) / 10_000;
      super._update(from, to, value - fee);
      if (fee > 0) super._update(from, FEE_SINK, fee);
    } else {
      super._update(from, to, value);
    }
  }
}

/// @notice A fake "Train" that accepts the forwarding call but never pulls the approved funds,
///         leaving a residual in the router → triggers TrainRouter.ResidualBalance.
contract NoPullTrain {
  function userLockFor(
    address,
    ITrain.UserLockParams calldata,
    ITrain.DestinationInfo calldata,
    bytes calldata,
    bytes calldata
  ) external {}
}

/// @notice Replays a stored (target, calldata) on the first invocation and bubbles any revert.
///         Used to attempt reentrancy from inside an external call (token transfer / train forward).
abstract contract Reenterer {
  address internal reentryTarget;
  bytes internal reentryData;
  bool internal armed;

  function arm(address target, bytes calldata data) external {
    reentryTarget = target;
    reentryData = data;
    armed = true;
  }

  function _fire() internal {
    if (!armed) return;
    armed = false; // one-shot
    (bool ok, bytes memory ret) = reentryTarget.call(reentryData);
    if (!ok) {
      assembly {
        revert(add(ret, 0x20), mload(ret))
      }
    }
  }
}

/// @notice ERC20 whose transferFrom reenters a target (e.g. Train) — Train's nonReentrant must block it.
contract ReentrantToken is ERC20, Reenterer {
  constructor() ERC20('Reentrant', 'RE') {}

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  function transferFrom(address from, address to, uint256 value) public override returns (bool) {
    bool r = super.transferFrom(from, to, value);
    _fire();
    return r;
  }
}

/// @notice A fake "Train" whose userLockFor reenters a target (the router) — router's nonReentrant blocks it.
contract ReentrantTrain is Reenterer {
  function userLockFor(
    address,
    ITrain.UserLockParams calldata,
    ITrain.DestinationInfo calldata,
    bytes calldata,
    bytes calldata
  ) external {
    _fire();
  }
}

/// @notice Rejects all ETH — used to trigger TransferFailed on native refund/redeem paths.
contract RejectETH {
  receive() external payable {
    revert('no eth');
  }
}
