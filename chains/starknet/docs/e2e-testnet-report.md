# Train Protocol Starknet — E2E sepolia report

Started: 2026-07-21T15:33:57.172Z  
Finished: 2026-07-21T15:43:42.838Z

## Environment

- **rpc**: <rpc-endpoint-redacted>
- **chainId**: 0x534e5f5345504f4c4941 (sepolia)
- **train**: `0x4ae1ae0dd1dd01be306725ab8de15707241284c8dd49cbaf37bcf845bf2d20b`
- **trainRouter**: `0x1049d123293e9c182397ba1b5de795ee35c9ca0a1f2fecfec2eca14e38cecc8`
- **payoutCurve**: `0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351`
- **strk (principal token)**: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- **eth (second / reward token)**: `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
- **user**: `0x0430a74277723d1ebba7119339f0f8276ca946c1b2c73de7636fd9eba31e1c1f`
- **solver**: `0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684`
- **relayer**: `0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684`
- **deployer**: `0x0430a74277723d1ebba7119339f0f8276ca946c1b2c73de7636fd9eba31e1c1f`
- **explorer**: https://sepolia.voyager.online (also see https://sepolia.starkscan.co)

## Build and local verification

- Cairo build (`scarb build`): passed
- TypeScript type-check (`npx tsc --noEmit` in scripts/): passed
- Local snforge contract tests (`snforge test`): Tests: 79 passed, 0 failed, 0 ignored, 0 filtered out

## Transactions & checks

| # | Stage | Name | Kind | Status | Tx | Block | Fee | Note |
|---|-------|------|------|--------|----|-------|-----|------|
| 1 | S0 | network <rpc-endpoint-redacted> chainId=0x534e5f5345504f4c4941 (sepolia) | info | INFO |  |  |  |  |
| 2 | S0 | tokens strk=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d eth=0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7 | info | INFO |  |  |  |  |
| 3 | S1 | accounts user=0x0430a74277723d1ebba7119339f0f8276ca946c1b2c73de7636fd9eba31e1c1f solver=0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684 relayer=0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684 (solver == relayer) | info | INFO |  |  |  |  |
| 4 | S2 | contracts train=0x4ae1ae0dd1dd01be306725ab8de15707241284c8dd49cbaf37bcf845bf2d20b trainRouter=0x1049d123293e9c182397ba1b5de795ee35c9ca0a1f2fecfec2eca14e38cecc8 curve=0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351 | info | INFO |  |  |  |  |
| 5 | S2 | strk->user balance = 1180322379630192970088 | info | INFO |  |  |  |  |
| 6 | S2 | strk->solver balance = 884524712844828900964 | info | INFO |  |  |  |  |
| 7 | S2 | eth->solver balance = 99999999999999900 | info | INFO |  |  |  |  |
| 8 | A | A user_lock (hashlock 0x3320015c52…) | tx | OK | [0x26e51e81a3…](https://sepolia.voyager.online/tx/0x26e51e81a3e216509e5649cd0d833f97db9f9310509b427b76a12f71a9fc434) | 12267745 | 0x3ab4f30feb53560 |  |
| 9 | A | A redeem_user (by depositor, pays solver) | tx | OK | [0x79e5850eaf…](https://sepolia.voyager.online/tx/0x79e5850eaf25a65e0679b64dd845276468c693bb80594ce19454d15a7fd04d5) | 12267751 | 0x36312957a8fea60 |  |
| 10 | A | A recipient received amount | check | OK |  |  |  | delta=1000 |
| 11 | A | A lock status REDEEMED | check | OK |  |  |  | status=Redeemed |
| 12 | B | B user_lock with payout_curve (hashlock 0xe33e791f71…) | tx | OK | [0x21703e4c40…](https://sepolia.voyager.online/tx/0x21703e4c40d995d306ed5a348ebbb535413e136f321c23b3e49c4bcf415cf5) | 12267759 | 0x3e72e0bf84f8090 |  |
| 13 | B | B payout_curve stored | check | OK |  |  |  | stored=0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351 |
| 14 | B | B redeem_user (curve, by depositor) | tx | OK | [0x1e3c678c3e…](https://sepolia.voyager.online/tx/0x1e3c678c3e116f93ea3873880d378a53469590c357e24b1296cdf2dae5deff4) | 12267765 | 0x36312616021c320 |  |
| 15 | B | B full payout via constant curve, zero excess | check | OK |  |  |  | delta=1000 |
| 16 | C | C user_lock (hashlock 0xc7fbef0ae9…, long timelock) | tx | OK | [0x7a9992c5ec…](https://sepolia.voyager.online/tx/0x7a9992c5eca25a5b8a80438c2b315e0f00e854865c73f9dccd6013a00c5191a) | 12267770 | 0x3ab4e942e7ff160 |  |
| 17 | C | C refund_user by recipient (before timelock) | tx | OK | [0x4e7032dad3…](https://sepolia.voyager.online/tx/0x4e7032dad3a403c0bbc2fe71895380e17d042c9be7e27ec71b786c755d99407) | 12267776 | 0xf7003c26679e00 |  |
| 18 | C | C refunded to refund_to (user) despite long timelock | check | OK |  |  |  | delta=1000 |
| 19 | C | C lock status REFUNDED | check | OK |  |  |  | status=Refunded |
| 20 | D | D user_lock (hashlock 0xca468b9811…, short timelock) | tx | OK | [0x5dcd567b09…](https://sepolia.voyager.online/tx/0x5dcd567b0998a92db58ab8a3c8970af9c7df1a48468030c074c8f0f54135d6e) | 12267782 | 0x3ab4dfff9e03c60 |  |
| 21 | D | D refund_user by third party (relayer, after timelock) | tx | OK | [0x191e46d755…](https://sepolia.voyager.online/tx/0x191e46d7551b217f6b952b29840a0e8d39897d7687ecb1b112ed0c1fd48a3a8) | 12267815 | 0xf7000d8113ab00 |  |
| 22 | D | D refund lands on refund_to (user), never the third-party caller | check | OK |  |  |  | refund_to gained 1000 (expected 1000); caller gained 0 (expected 0, fee-corrected) |
| 23 | E | E user_lock_for(beneficiary) (hashlock 0xc0e82db52f…) | tx | OK | [0x6fed885203…](https://sepolia.voyager.online/tx/0x6fed885203f3fbacabd7a153e409fb2856b14f75e2b4977922547cd0c1fba85) | 12267821 | 0x3d69b17e89d4630 |  |
| 24 | E | E lock attributed to beneficiary, not caller | check | OK |  |  |  | sender=0xb3a80a371ebc628fff33b9b887a6095da2fb6456e5dcbf1c3b05184049c5 |
| 25 | E | E redeem_user (by depositor, pays beneficiary) | tx | OK | [0x7c630a8ad0…](https://sepolia.voyager.online/tx/0x7c630a8ad07c975e37aded9396a1f02d604cc313ea2b649807b211ece02c106) | 12267827 | 0x38dd3ff6a206e10 |  |
| 26 | E | E beneficiary received amount | check | OK |  |  |  | delta=1000 |
| 27 | F | F solver_lock (hashlock 0x7aed3e1fdb…) | tx | OK | [0x132e72dec6…](https://sepolia.voyager.online/tx/0x132e72dec67730e725d3570d44fa3e68b7010e5e0e9634f6f0fca5274bad930) | 12267832 | 0x40b6929c7ba0e80 |  |
| 28 | F | F first index is 1 | check | OK |  |  |  | index=1 |
| 29 | F | F redeem_solver (by relayer) | tx | OK | [0x514e16da08…](https://sepolia.voyager.online/tx/0x514e16da08cf873edd5fa5954a9f7b754bd64514f6249c54433e4dba14cb470) | 12267838 | 0x367f756549dbce0 |  |
| 30 | F | F recipient received amount | check | OK |  |  |  | delta=1000 |
| 31 | G | G solver_lock (hashlock 0xca70b70f37…, reward) | tx | OK | [0x4cab28ca3d…](https://sepolia.voyager.online/tx/0x4cab28ca3dfa5f6a79ca0b725e8c81c3cc9f5965b229c1f324f2a826b8e9512) | 12267843 | 0x43a8a6e214c1650 |  |
| 32 | G | G redeem_solver (before reward_timelock, by relayer) | tx | OK | [0x25f6969dab…](https://sepolia.voyager.online/tx/0x25f6969dabcafc10b87231e6027c4a27085ad791d98f5ea13dd2a7b815048c0) | 12267849 | 0x397325313a26270 |  |
| 33 | G | G reward went to reward_recipient (not redeemer) | check | OK |  |  |  | delta=100 |
| 34 | H | H solver_lock (hashlock 0xde40452811…, short reward_timelock) | tx | OK | [0x3710520978…](https://sepolia.voyager.online/tx/0x3710520978a1d46d0b052436f83b1bbf4daf9b1e167d36f9eb420e3cd5cac6f) | 12267855 | 0x43a8afc4d09e5f0 |  |
| 35 | H | H redeem_solver (after reward_timelock, by relayer) | tx | OK | [0x5d11c662f5…](https://sepolia.voyager.online/tx/0x5d11c662f5897d2950e344820fddef24cc8a253b18e11c46fa8b4c1843e1397) | 12267872 | 0x36c515e63aa8e20 |  |
| 36 | H | H after reward_timelock: amount -> recipient(user), reward -> redeemer(relayer) | check | OK |  |  |  | recipient(user) gained 1000 (expected 1000); redeemer(relayer) gained 100 (expected 100, fee-corrected) |
| 37 | I | I solver_lock (hashlock 0xba3647497e…, diff reward token) | tx | OK | [0x7843deabf7…](https://sepolia.voyager.online/tx/0x7843deabf777664a37bae93075340683198a9be223778ef711047f751189e3a) | 12267877 | 0x507836cbb4756e0 |  |
| 38 | I | I redeem_solver (different reward token, by relayer) | tx | OK | [0x6a159038d8…](https://sepolia.voyager.online/tx/0x6a159038d83a09c8600a9e3a7c80712023d29c8ed6064331185620c575ef815) | 12267884 | 0x39770c8c2fa4970 |  |
| 39 | I | I principal paid in STRK | check | OK |  |  |  | delta=1000 |
| 40 | I | I reward paid in ETH | check | OK |  |  |  | delta=100 |
| 41 | J | J solver_lock (hashlock 0xf1270b0c01…, short timelock) | tx | OK | [0x2112647abf…](https://sepolia.voyager.online/tx/0x2112647abf842d989f0385206d84a6eed902fc3fd90a29f5774f8fc232d4cb8) | 12267890 | 0x43a8abe0e86b8d0 |  |
| 42 | J | J refund_solver (after timelock, by user) | tx | OK | [0x28e7b480a8…](https://sepolia.voyager.online/tx/0x28e7b480a802aa72c38b4a0fe4a63f191bf126a3e9e22124d64384019cca91) | 12267922 | 0x10c588c5bde5200 |  |
| 43 | J | J amount+reward returned to solver | check | OK |  |  |  | delta=1100 |
| 44 | K | K user: one-time STRK.approve(router, amount) | tx | OK | [0x3d589a160f…](https://sepolia.voyager.online/tx/0x3d589a160fb0580990f7a0308e5636f89ee52897eb7c53ba0d00b9ff953e35d) | 12267928 | 0xb360a087d7cdf0 |  |
| 45 | K | K intent digest (get_intent_hash): 0x32331b2791aedba74e6003c47818609fda62a45d80aef6447eb87d8d5fe04a9 | info | INFO |  |  |  |  |
| 46 | K | K relayer: forward_intent (pays gas) | tx | OK | [0x28bab5442a…](https://sepolia.voyager.online/tx/0x28bab5442a77d5e11d658a670c70403aa9155fa1e87e7e8aa8cb76cc3bc169c) | 12267936 | 0x4cf1abb15f5b9f0 |  |
| 47 | K | K router never holds a residual balance | check | OK |  |  |  | before=0, after=0 |
| 48 | K | K lock attributed to user | check | OK |  |  |  | sender=0x430a74277723d1ebba7119339f0f8276ca946c1b2c73de7636fd9eba31e1c1f |
| 49 | K | K is_consumed(intentHash) true after forward | check | OK |  |  |  | is_consumed=true |
| 50 | K | K redeem_user | tx | OK | [0x7617ec817c…](https://sepolia.voyager.online/tx/0x7617ec817c8b7de4913245dc4e4174332e587b156bc9f3156ff7cf0c8f44b27) | 12267941 | 0x362f395d04844e0 |  |
| 51 | L | user account SNIP-9 (ISRC9_V2) support: true | info | INFO |  |  |  |  |
| 52 | L | L OutsideExecution message hash (hand-rolled SNIP-9 v2): 0x607670bd43f3317b20083a5814b47d38032777d62e8deeed6854bc5ccf171cc | info | INFO |  |  |  |  |
| 53 | L | L relayer: execute_from_outside_v2 (approve + user_lock_for) | tx | OK | [0xffd89f386c…](https://sepolia.voyager.online/tx/0xffd89f386c1f4cfdd9489e79cc557bcbabf54d742c6622a354bfc35c3cd704) | 12267947 | 0x43fdc87434e3370 |  |
| 54 | L | L lock attributed to user | check | OK |  |  |  | sender=0x430a74277723d1ebba7119339f0f8276ca946c1b2c73de7636fd9eba31e1c1f |
| 55 | L | L redeem_user (by relayer, pays user) | tx | OK | [0x5764a0847c…](https://sepolia.voyager.online/tx/0x5764a0847c31bf380fdd5188c2e5a15bf5b5d1adec8059cc27feb3b8d3a4170) | 12267952 | 0x36312ad003182e0 |  |
| 56 | V | V probe lock #1 solver_lock | tx | OK | [0x7d0a41b182…](https://sepolia.voyager.online/tx/0x7d0a41b18210a61682fdaa3c0e293ab359d62d3312f1975a2f087252632b30f) | 12267958 | 0x40b6a1350d0e500 |  |
| 57 | V | V probe lock #2 solver_lock | tx | OK | [0x2249b2ec06…](https://sepolia.voyager.online/tx/0x2249b2ec0684a89d26beebd73e00815700f41e80cd4908200759ce0c9b464fe) | 12267963 | 0x3e0a88fc13759b0 |  |
| 58 | V | V probe indices are 1 and 2 | check | OK |  |  |  | got 1, 2 |
| 59 | V | V get_solver_lock(h, 2) resolves index 2 (Pending) | check | OK |  |  |  | status=Pending |
| 60 | V | V get_solver_lock(h, 99) is Empty | check | OK |  |  |  | status=Empty |
| 61 | V | V get_user_lock_hashes(user, 0, 1000) total=18 | info | INFO |  |  |  |  |
| 62 | V | V enumeration entries all resolve to existing locks | check | OK |  |  |  | 18/18 resolve |
| 63 | U1 | user_lock amount=0 | sim-reject | OK |  |  |  | rejected with "ZeroAmount" |
| 64 | U1 | user_lock token=0 | sim-reject | OK |  |  |  | rejected with "InvalidToken" |
| 65 | U1 | user_lock timelock_delta=0 | sim-reject | OK |  |  |  | rejected with "InvalidTimelock" |
| 66 | U1 | user_lock expired quote | sim-reject | OK |  |  |  | rejected with "QuoteExpired" |
| 67 | U1 | user_lock duplicate hashlock (A) | sim-reject | OK |  |  |  | rejected with "SwapAlreadyExists" |
| 68 | U1 | user_lock zero recipient | sim-reject | OK |  |  |  | rejected with "ZeroAddress" |
| 69 | U1 | user_lock_for zero user | sim-reject | OK |  |  |  | rejected with "InvalidUser" |
| 70 | U1 | solver_lock reward_timelock_delta >= timelock_delta | sim-reject | OK |  |  |  | rejected with "InvalidRewardTimelock" |
| 71 | U1 | solver_lock zero reward_recipient | sim-reject | OK |  |  |  | rejected with "ZeroAddress" |
| 72 | U1 | redeem_user unknown hashlock | sim-reject | OK |  |  |  | rejected with "LockNotFound" |
| 73 | U1 | refund_solver unknown | sim-reject | OK |  |  |  | rejected with "LockNotFound" |
| 74 | U1 | redeem_user A again (already redeemed) | sim-reject | OK |  |  |  | rejected with "LockNotPending" |
| 75 | U1 | U1-live user_lock (fixture) | tx | OK | [0x5188fff656…](https://sepolia.voyager.online/tx/0x5188fff6567f991c3fec522ff4e6ea9f018f96423fceeb928206ece9a3ade1a) | 12267971 | 0x3ab4fa26b0d7260 |  |
| 76 | U1 | redeem_user wrong secret | sim-reject | OK |  |  |  | rejected with "HashlockMismatch" |
| 77 | U1 | refund_user early by non-recipient | sim-reject | OK |  |  |  | rejected with "RefundNotAllowed" |
| 78 | U1 | U1-live cleanup refund by recipient | tx | OK | [0x5c65bb28e8…](https://sepolia.voyager.online/tx/0x5c65bb28e85d4918a9cb4224cb28a1c1d04a068e3713c5db4d49e70597ecd10) | 12267979 | 0xf700993818e280 |  |
| 79 | U2 | forward_intent wrong router | sim-reject | OK |  |  |  | rejected with "RouterMismatch" |
| 80 | U2 | forward_intent expired deadline | sim-reject | OK |  |  |  | rejected with "IntentExpired" |
| 81 | U2 | forward_intent calldata does not match call_hash | sim-reject | OK |  |  |  | rejected with "CallHashMismatch" |
| 82 | U2 | forward_intent wrong signature | sim-reject | OK |  |  |  | rejected with "InvalidSignature" |
| 83 | U2 | U2 user re-approves router (residual-balance probe) | tx | OK | [0x29edcad14d…](https://sepolia.voyager.online/tx/0x29edcad14d22a0c28b839f9f9da5b10ead779c84a60dfd4a5fce395e2e761c5) | 12267986 | 0xb360acf50c9330 |  |
| 84 | U2 | forward_intent under-consumes pulled amount (ResidualBalance) | sim-reject | OK |  |  |  | rejected with "ResidualBalance" |
| 85 | U2 | forward_intent REPLAY of K's already-consumed intent | tx | REVERTED |  |  |  | rejected before inclusion: RPC: starknet_estimateFee with params {
  "request": [
    {
      "type": "INVOKE",
      "sender_address": "0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684",
      "calldat |
| 86 | U3 | execute_from_outside_v2 expired time-bounds | tx | REVERTED |  |  |  | rejected before inclusion: RPC: starknet_estimateFee with params {
  "request": [
    {
      "type": "INVOKE",
      "sender_address": "0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684",
      "calldat |
| 87 | U3 | execute_from_outside_v2 REPLAY of L's already-consumed nonce | tx | REVERTED |  |  |  | rejected before inclusion: RPC: starknet_estimateFee with params {
  "request": [
    {
      "type": "INVOKE",
      "sender_address": "0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684",
      "calldat |

## Summary

- rows: 87
- mined txs: 33
- on-chain reverted (expected): 3
- sim-rejected (expected): 19
- FAILURES: 0

## On-chain deployment & verification (Sepolia)

| Contract | Address | Class hash |
|---|---|---|
| Train | `0x4ae1ae0dd1dd01be306725ab8de15707241284c8dd49cbaf37bcf845bf2d20b` | `0x0689ed744206b543442dd3c42f6d53f3ebd0fdded4569a11fe8b387bd8f0e264` |
| TrainRouter | `0x1049d123293e9c182397ba1b5de795ee35c9ca0a1f2fecfec2eca14e38cecc8` | `0x04337936c40c90f76a58d1c3d8b73c2e3adcdd63b89656ea57b84d1de1a8ef66` |
| ConstantPayoutCurve | `0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351` | `0x01a3aa57876586b59a68c134c8690c3596ad524b9326920c8c0b71a0334ef33e` |

- **Functional verification: PASS** — all three classes exercised on-chain by the 33 mined
  transactions above (deploys, both gasless rails, redeem/refund, view probes), 0 failures.
- **Explorer source verification (Voyager): VERIFIED** — all three classes are source-verified on
  Voyager (scarb 2.14.0, `status: Verification successful`). The verifier submission includes
  `Scarb.lock` (so the verifier resolves the exact dependency versions we built with — a fresh
  resolve from `Scarb.toml` alone fails version-solving on our mixed OpenZeppelin versions) and the
  per-contract `CONTRACT_NAME`. Source code is visible at:
  - Train — `https://sepolia.voyager.online/class/0x0689ed744206b543442dd3c42f6d53f3ebd0fdded4569a11fe8b387bd8f0e264#code`
  - TrainRouter — `https://sepolia.voyager.online/class/0x04337936c40c90f76a58d1c3d8b73c2e3adcdd63b89656ea57b84d1de1a8ef66#code`
  - ConstantPayoutCurve — `https://sepolia.voyager.online/class/0x01a3aa57876586b59a68c134c8690c3596ad524b9326920c8c0b71a0334ef33e#code`
