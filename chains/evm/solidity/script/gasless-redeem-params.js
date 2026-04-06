#!/usr/bin/env node
/**
 * Compute the nonce and signature required to call
 * ERC20.transferWithAuthorization(...) for a Train gasless solver-lock redemption.
 *
 * Usage:
 *   node gasless-redeem-params.js \
 *     --hashlock 0xabc... \
 *     --index    1        \
 *     --secret   0xdef... \
 *     --validAfter  0     \
 *     --validBefore 9999999999
 *
 * All hex inputs may omit the 0x prefix.
 * --validAfter  defaults to 0            (valid immediately)
 * --validBefore defaults to 9999999999   (~year 2286, effectively never)
 */

'use strict';

const { AbiCoder, keccak256, toBeHex, zeroPadValue } = require('ethers');

// ── CLI parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name, required = true, defaultValue = undefined) {
  const i = args.indexOf('--' + name);
  if (i === -1 || i + 1 >= args.length) {
    if (required && defaultValue === undefined) {
      console.error(`Missing required argument: --${name}`);
      process.exit(1);
    }
    return defaultValue;
  }
  return args[i + 1];
}

function toBytes32(hex) {
  const h = hex.startsWith('0x') ? hex : '0x' + hex;
  return zeroPadValue(h, 32);
}

function toBigInt(val) {
  return BigInt(val);
}

const hashlock    = toBytes32(getFlag('hashlock'));
const index       = toBigInt(getFlag('index'));
const secret      = toBigInt(toBytes32(getFlag('secret'))); // treat as uint256
const validAfter  = toBigInt(getFlag('validAfter',  false, '0'));
const validBefore = toBigInt(getFlag('validBefore', false, '9999999999'));

// ── Core computation ─────────────────────────────────────────────────────────

const coder = AbiCoder.defaultAbiCoder();

// nonce = keccak256(abi.encode(hashlock, index))
const nonce = keccak256(coder.encode(['bytes32', 'uint256'], [hashlock, index]));

// signature = abi.encode(hashlock, index, secret, validAfter, validBefore)  → 160 bytes
const signature = coder.encode(
  ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256'],
  [hashlock, index, secret, validAfter, validBefore]
);

// ── Output ───────────────────────────────────────────────────────────────────

console.log('\n=== Train gasless-redemption params ===\n');
console.log('Input');
console.log('  hashlock    :', hashlock);
console.log('  index       :', index.toString());
console.log('  secret      :', toBeHex(secret, 32));
console.log('  validAfter  :', validAfter.toString());
console.log('  validBefore :', validBefore.toString());

console.log('\nOutput — pass these to ERC20.transferWithAuthorization()');
console.log('  from        : <Train contract address>');
console.log('  to          : <lock.recipient>');
console.log('  value       : <lock.amount>');
console.log('  validAfter  :', validAfter.toString());
console.log('  validBefore :', validBefore.toString());
console.log('  nonce       :', nonce);
console.log('  signature   :', signature);
console.log('  (sig bytes) :', (signature.length - 2) / 2, 'bytes — must be 160');
console.log();
