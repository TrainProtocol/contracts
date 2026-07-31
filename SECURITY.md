# Security Policy

The Train Protocol contracts are deployed on several mainnets (see the
[Deployments section of the README](./README.md#deployments--current-release-v3)) and **have not
been audited**. We take vulnerability reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do NOT open a public issue, pull request, or discussion for security problems.**

Report privately through GitHub's vulnerability reporting form:

**[github.com/TrainProtocol/contracts/security/advisories/new](https://github.com/TrainProtocol/contracts/security/advisories/new)**

(Repository **Security** tab → **Report a vulnerability**.) The report opens a private draft
advisory visible only to you and the maintainers. This is the only reporting channel.

Please include where possible:

- The affected contract(s), chain(s), and deployed address(es)
- Impact — what an attacker can do, and preconditions
- Reproduction steps: a PoC, failing test, or transaction trace
- A suggested fix, if you have one

## Scope

**In scope**

- All contract sources on the `main` branch:
  `chains/evm/solidity` (including the Tempo variant under `src/tempo/`), `chains/fuel`,
  `chains/starknet`, `chains/solana`, `chains/aztec`
- The deployed **v3** contracts listed in the [README](./README.md#deployments--current-release-v3)
  (mainnets and testnets)

**Out of scope**

- Third-party dependencies (OpenZeppelin, forge-std, chain SDKs, …) — please report upstream
- Behavior already documented as a known trust assumption or accepted risk (see e.g. the
  [EVM README's trust assumptions](./chains/evm/solidity/README.md))
- Early-stage networks that exist only on `main-add-*` branches
- Denial-of-service via network-level spam, gas-price griefing inherent to the underlying chain,
  or issues requiring compromised keys

## No bounty

There is **no bug bounty or monetary reward program at this time**. If you want, we will credit
you by name/handle in the published advisory — entirely your choice, anonymous reports are
welcome too.

## What to expect

- We aim to acknowledge reports within **3 business days**.
- Triage, discussion, and the fix happen inside the private advisory (GitHub supports a temporary
  private fork for the patch).
- Disclosure timing is agreed **case by case** with the reporter. Deployed contracts are
  immutable, so a fix may require deploying new contracts and migrating integrators — please
  allow for that before public disclosure.

## Safe harbor

We will not pursue legal action against good-faith security research that follows this policy.
Please do not exploit vulnerabilities against contracts holding real user funds and do not test
on mainnet deployments — use the testnet deployments, a local fork, or the test suites in this
repository for PoCs.
