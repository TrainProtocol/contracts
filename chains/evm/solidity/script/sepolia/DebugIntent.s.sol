// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console } from 'forge-std/console.sol';
import { SepoliaConfig } from './SepoliaConfig.s.sol';
import { ITrain } from '../../src/interfaces/ITrain.sol';
import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import { SignatureChecker } from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';

contract DebugIntent is SepoliaConfig {
  function run() external {
    _load();
    ITrain.UserLockParams memory p = _userParamsI(_hashlock(_secret('dbg')), AMOUNT, 3600);
    ITrain.DestinationInfo memory d = _dstI();
    bytes memory cd = _callData(p, d);
    bytes32 digest = router.intentDigest(user, address(train), address(USDC), AMOUNT, keccak256(cd));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    bytes memory sig = abi.encodePacked(r, s, v);
    console.log('user      :', user);
    console.log('recovered :', ECDSA.recover(digest, sig));
    console.log('sigCheck  :', SignatureChecker.isValidSignatureNow(user, digest, sig));
    console.log('v         :', v);
    console.logBytes32(digest);
    console.logBytes32(router.DOMAIN_SEPARATOR());
  }
}
