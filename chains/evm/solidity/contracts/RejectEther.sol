// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract RejectEther {
  receive() external payable {
    revert('ETH not accepted');
  }

  fallback() external payable {
    revert('ETH not accepted');
  }
}
