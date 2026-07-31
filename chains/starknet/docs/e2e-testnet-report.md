# Train Protocol Starknet — E2E sepolia report

Started: 2026-07-30T22:12:33.098Z  
Finished: 2026-07-30T22:21:13.239Z

## Environment

- **rpc**: <rpc-endpoint-redacted>
- **chainId**: 0x534e5f5345504f4c4941 (sepolia)
- **train**: `0x331d2d504d582a6918a70928fa31207f73600f45e8089310283223f439d52b0`
- **trainRouter**: `0x1049d123293e9c182397ba1b5de795ee35c9ca0a1f2fecfec2eca14e38cecc8`
- **payoutCurve**: `0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351`
- **strk (principal token)**: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- **eth (second / reward token)**: `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
- **user**: `0x05881aaa9e44c0985ef506829376757f5ff41e431bbeb9d74e6cba2b4b114be4`
- **solver**: `0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684`
- **relayer**: `0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684`
- **deployer**: `0x05881aaa9e44c0985ef506829376757f5ff41e431bbeb9d74e6cba2b4b114be4`
- **explorer**: https://sepolia.voyager.online (also see https://sepolia.starkscan.co)

## Build and local verification

- Cairo build (`scarb build`): FAILED — /bin/sh: 1: scarb: not found
- TypeScript type-check (`npx tsc --noEmit` in scripts/): passed
- Local snforge contract tests (`snforge test`): see output

## Transactions & checks

| # | Stage | Name | Kind | Status | Tx | Block | Fee | Note |
|---|-------|------|------|--------|----|-------|-----|------|
| 1 | S0 | network <rpc-endpoint-redacted> chainId=0x534e5f5345504f4c4941 (sepolia) | info | INFO |  |  |  |  |
| 2 | S0 | tokens strk=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d eth=0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7 | info | INFO |  |  |  |  |
| 3 | S1 | accounts user=0x05881aaa9e44c0985ef506829376757f5ff41e431bbeb9d74e6cba2b4b114be4 solver=0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684 relayer=0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684 (solver == relayer) | info | INFO |  |  |  |  |
| 4 | S2 | contracts train=0x331d2d504d582a6918a70928fa31207f73600f45e8089310283223f439d52b0 trainRouter=0x1049d123293e9c182397ba1b5de795ee35c9ca0a1f2fecfec2eca14e38cecc8 curve=0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351 | info | INFO |  |  |  |  |
| 5 | S2 | strk->user balance = 2627390482531200915860 | info | INFO |  |  |  |  |
| 6 | S2 | strk->solver balance = 873926800853974680580 | info | INFO |  |  |  |  |
| 7 | S2 | eth->solver balance = 99999999999999700 | info | INFO |  |  |  |  |
| 8 | A | A user_lock (hashlock 0xe173b4a854…) | tx | OK | [0x67d20ffd72…](https://sepolia.voyager.online/tx/0x67d20ffd7286f5917755be47ef7492b2a3407674c5d98db56c08844d11d046e) | 12697355 | 0x431260310852960 |  |
| 9 | A | A redeem_user (by depositor, pays solver) | tx | OK | [0x5cb97aa1f8…](https://sepolia.voyager.online/tx/0x5cb97aa1f88bad8e01aaef658cdfd433cd8a4ba215e52f55676b70968c97185) | 12697362 | 0x3dea961a4d04fa0 |  |
| 10 | A | A recipient received amount | check | OK |  |  |  | delta=1000 |
| 11 | A | A lock status REDEEMED | check | OK |  |  |  | status=Redeemed |
| 12 | B | B user_lock with payout_curve (hashlock 0x627f32140e…) | tx | OK | [0x28286f0d61…](https://sepolia.voyager.online/tx/0x28286f0d611a5dc23f341f77b545fe855809d193915dd28a0ef4d55346be7e4) | 12697370 | 0x4758ce3719aa650 |  |
| 13 | B | B payout_curve stored | check | OK |  |  |  | stored=0x27e92c85cf5da7861549ceba60096737a773f9b94f49046604ff0a0035cc351 |
| 14 | B | B redeem_user (curve, by depositor) | tx | OK | [0x380cfb9fa7…](https://sepolia.voyager.online/tx/0x380cfb9fa752bc51b9a95dc5f86a1f1ad7004b08b7a4c2ab5e06634668c305d) | 12697377 | 0x3dea928a885a360 |  |
| 15 | B | B full payout via constant curve, zero excess | check | OK |  |  |  | delta=1000 |
| 16 | C | C user_lock (hashlock 0x30df32aba2…, long timelock) | tx | OK | [0x15472b042a…](https://sepolia.voyager.online/tx/0x15472b042a4ae5d72733e075a7848beb1896cc14dbbdc4340086cae487e1da6) | 12697384 | 0x4312588f4b4db60 |  |
| 17 | C | C refund_user by recipient (before timelock) | tx | OK | [0x42366ca7a3…](https://sepolia.voyager.online/tx/0x42366ca7a384b831ea6272b4bf04251665b8e105bcbd867e5bbd2b97d89d03a) | 12697392 | 0x11a3124513d0f00 |  |
| 18 | C | C refunded to refund_to (user) despite long timelock | check | OK |  |  |  | delta=1000 |
| 19 | C | C lock status REFUNDED | check | OK |  |  |  | status=Refunded |
| 20 | D | D user_lock (hashlock 0xf39494aaee…, short timelock) | tx | OK | [0x1e6cfb48e2…](https://sepolia.voyager.online/tx/0x1e6cfb48e2a21d0ff5f3236e214524e478769fe00644ec8ab3aa8d26e41dea9) | 12697400 | 0x43124c8b2670460 |  |
| 21 | D | D refund_user by third party (relayer, after timelock) | tx | OK | [0x3f7a141905…](https://sepolia.voyager.online/tx/0x3f7a14190520aa813979e12a6a9b8f3c319e5a2f2eb5237884a9098342357e3) | 12697443 | 0x11a311afc73dd80 |  |
| 22 | D | D refund lands on refund_to (user), never the third-party caller | check | OK |  |  |  | refund_to gained 1000 (expected 1000); caller gained 0 (expected 0, fee-corrected) |
| 23 | E | E user_lock_for(beneficiary) (hashlock 0xc1af34a9f3…) | tx | OK | [0xd75e71538c…](https://sepolia.voyager.online/tx/0xd75e71538c8cf48a426b728a57b419c56affa57ce78d11232bc71484484634) | 12697451 | 0x4629f56cd177b30 |  |
| 24 | E | E lock attributed to beneficiary, not caller | check | OK |  |  |  | sender=0x57cd10cf21e71407100695fa72db22ed6c2bed2891ffed06f5304a86d61d |
| 25 | E | E redeem_user (by depositor, pays beneficiary) | tx | OK | [0x5a5e22cb10…](https://sepolia.voyager.online/tx/0x5a5e22cb101b6520240f4dc0440242db0e85a53875926f5105ed92a655596a5) | 12697458 | 0x40ea12210edd2e0 |  |
| 26 | E | E beneficiary received amount | check | OK |  |  |  | delta=1000 |
| 27 | F | F solver_lock (hashlock 0xbe5dfe4ac0…) | tx | OK | [0x600082f987…](https://sepolia.voyager.online/tx/0x600082f987375acb0cc8badedc4bfb4f73aafa52755d9fcf3449dbbe2cb1b1e) | 12697465 | 0x48c770e449d65a0 |  |
| 28 | F | F lock recorded under solver | check | OK |  |  |  | status=Pending |
| 29 | F | F redeem_solver (by relayer) | tx | OK | [0x10b8c6c58e…](https://sepolia.voyager.online/tx/0x10b8c6c58e721934fdb9eb2b13117a62d6e4796495d4ecac566da201340e364) | 12697472 | 0x3e18b69509e9480 |  |
| 30 | F | F recipient received amount | check | OK |  |  |  | delta=1000 |
| 31 | G | G solver_lock (hashlock 0xf58ce24bac…, reward) | tx | OK | [0x7398e57c24…](https://sepolia.voyager.online/tx/0x7398e57c24e1c7b574b5409fe0b22d9ad1930488dee11539c57efaf1d3a1b45) | 12697480 | 0x4bd68f64d529300 |  |
| 32 | G | G redeem_solver (before reward_timelock, by relayer) | tx | OK | [0x5d651aecb6…](https://sepolia.voyager.online/tx/0x5d651aecb6f7ef31debf43bb788b621edff8b136984e71313b8f3c0fdb147c7) | 12697487 | 0x41774b44ff09e80 |  |
| 33 | G | G reward went to reward_recipient (not redeemer) | check | OK |  |  |  | delta=100 |
| 34 | H | H solver_lock (hashlock 0x54b326639f…, short reward_timelock) | tx | OK | [0x54a3cf9a1d…](https://sepolia.voyager.online/tx/0x54a3cf9a1dc452a297d7a933dfdfcf736c906e0564b4f7976f765cd458d9bd6) | 12697495 | 0x4bd692fa0f33300 |  |
| 35 | H | H redeem_solver (after reward_timelock, by relayer) | tx | OK | [0x3c19eebbc7…](https://sepolia.voyager.online/tx/0x3c19eebbc7c10cb0a7a7e23f7788cf499e5f4fdb8f9e80011e3ec1ae894afee) | 12697519 | 0x3e682e78381a4c0 |  |
| 36 | H | H after reward_timelock: amount -> recipient(user), reward -> redeemer(relayer) | check | OK |  |  |  | recipient(user) gained 1000 (expected 1000); redeemer(relayer) gained 100 (expected 100, fee-corrected) |
| 37 | I | I solver_lock (hashlock 0x3b828dbca7…, diff reward token) | tx | OK | [0x5845d0c258…](https://sepolia.voyager.online/tx/0x5845d0c258d6ed7b992d377d37838001b56077cc64b9a3875ed2f1ed2e153a5) | 12697529 | 0x5ac3dc49b4a6cc0 |  |
| 38 | I | I redeem_solver (different reward token, by relayer) | tx | OK | [0x429df26e1f…](https://sepolia.voyager.online/tx/0x429df26e1f538da4c1b9bbe1ea003fa8b3d8e8df92ef2cf0ec3195169710c18) | 12697537 | 0x417b9bb1793de40 |  |
| 39 | I | I principal paid in STRK | check | OK |  |  |  | delta=1000 |
| 40 | I | I reward paid in ETH | check | OK |  |  |  | delta=100 |
| 41 | J | J solver_lock (hashlock 0x2096ab3542…, short timelock) | tx | OK | [0xb319f81211…](https://sepolia.voyager.online/tx/0xb319f812115f96468d0b4616eb5adc40ddcec16a080d4bcd909556b1dc4b24) | 12697544 | 0x4bd693bb4883700 |  |
| 42 | J | J refund_solver (after timelock, by user) | tx | OK | [0xf2381fc63a…](https://sepolia.voyager.online/tx/0xf2381fc63acfd762dae9b602f63e3135da6a7e3fb6ec62ca3963a2b239b20c) | 12697586 | 0x130756aafc0c080 |  |
| 43 | J | J amount+reward returned to solver | check | OK |  |  |  | delta=1100 |
| 44 | K | K user: one-time STRK.approve(router, amount) | tx | OK | [0x4ba6c21b45…](https://sepolia.voyager.online/tx/0x4ba6c21b45d4840c8ae779f1acdd9f4a5529997163886007286d3b840ce8507) | 12697593 | 0x9bd1c585f30e80 |  |
| 45 | K | K intent digest (get_intent_hash): 0x20585b4f6f492fb1250dbacf90b7595aab0eaad9fe95285052e1d4310e7522a | info | INFO |  |  |  |  |
| 46 | K | K relayer: forward_intent (pays gas) | tx | OK | [0x21da9a22fd…](https://sepolia.voyager.online/tx/0x21da9a22fd151db3b804da4a082e1c011a85260d9c3abe5688899e19c93d87c) | 12697600 | 0x57d5672ed69df80 |  |
| 47 | K | K router never holds a residual balance | check | OK |  |  |  | before=0, after=0 |
| 48 | K | K lock attributed to user | check | OK |  |  |  | sender=0x5881aaa9e44c0985ef506829376757f5ff41e431bbeb9d74e6cba2b4b114be4 |
| 49 | K | K is_consumed(intentHash) true after forward | check | OK |  |  |  | is_consumed=true |
| 50 | K | K redeem_user | tx | OK | [0x138b985610…](https://sepolia.voyager.online/tx/0x138b98561040eee85ed3f65cb140976d53564341807c4f88753e466a59fd3cf) | 12697607 | 0x3ddafe0af5f0400 |  |
| 51 | L | user account SNIP-9 (ISRC9_V2) support: true | info | INFO |  |  |  |  |
| 52 | L | L OutsideExecution message hash (hand-rolled SNIP-9 v2): 0x4a0a8b6a70b68c01a48ac04d2bb18835cf55a12828302a3b53e0988c1f0159c | info | INFO |  |  |  |  |
| 53 | L | L relayer: execute_from_outside_v2 (approve + user_lock_for) | tx | OK | [0x2431aba164…](https://sepolia.voyager.online/tx/0x2431aba164ad861133db328f774939b6e14768da0a10aea9b540fd28d8293e) | 12697615 | 0x4d9d0fef94f6d40 |  |
| 54 | L | L lock attributed to user | check | OK |  |  |  | sender=0x5881aaa9e44c0985ef506829376757f5ff41e431bbeb9d74e6cba2b4b114be4 |
| 55 | L | L redeem_user (by relayer, pays user) | tx | OK | [0x1c1fdaae6e…](https://sepolia.voyager.online/tx/0x1c1fdaae6e4c324c121fd5ef9c7d5bcf374a868e733c8509358db752f4b1c7) | 12697621 | 0x3ddd27fe2889180 |  |
| 56 | V | V probe lock #1 solver_lock | tx | OK | [0x4f46e0348e…](https://sepolia.voyager.online/tx/0x4f46e0348e33d71dbe43ba3ee4164cee4dcd675dec197f6ff6fa9a2b3b559fe) | 12697628 | 0x48c787afdc755c0 |  |
| 57 | V | V get_solver_lock(h, solver) is Pending | check | OK |  |  |  | status=Pending |
| 58 | V | V get_solver_lock(h, never-locked addr) is Empty | check | OK |  |  |  | status=Empty |
| 59 | V | V duplicate solver_lock (same solver, same hashlock) reverts | tx | REVERTED |  |  |  | rejected before inclusion: RPC: starknet_estimateFee with params {
  "request": [
    {
      "type": "INVOKE",
      "sender_address": "0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684",
      "calldat |
| 60 | V | V get_user_lock_hashes(user, 0, 1000) total=22 | info | INFO |  |  |  |  |
| 61 | V | V enumeration entries all resolve to existing locks | check | OK |  |  |  | 22/22 resolve |
| 62 | U1 | user_lock amount=0 | sim-reject | OK |  |  |  | rejected with "ZeroAmount" |
| 63 | U1 | user_lock token=0 | sim-reject | OK |  |  |  | rejected with "InvalidToken" |
| 64 | U1 | user_lock timelock_delta=0 | sim-reject | OK |  |  |  | rejected with "InvalidTimelock" |
| 65 | U1 | user_lock expired quote | sim-reject | OK |  |  |  | rejected with "QuoteExpired" |
| 66 | U1 | user_lock duplicate hashlock (A) | sim-reject | OK |  |  |  | rejected with "SwapAlreadyExists" |
| 67 | U1 | user_lock zero recipient | sim-reject | OK |  |  |  | rejected with "ZeroAddress" |
| 68 | U1 | user_lock_for zero user | sim-reject | OK |  |  |  | rejected with "InvalidUser" |
| 69 | U1 | solver_lock reward_timelock_delta >= timelock_delta | sim-reject | OK |  |  |  | rejected with "InvalidRewardTimelock" |
| 70 | U1 | solver_lock zero reward_recipient | sim-reject | OK |  |  |  | rejected with "ZeroAddress" |
| 71 | U1 | redeem_user unknown hashlock | sim-reject | OK |  |  |  | rejected with "LockNotFound" |
| 72 | U1 | refund_solver unknown | sim-reject | OK |  |  |  | rejected with "LockNotFound" |
| 73 | U1 | redeem_user A again (already redeemed) | sim-reject | OK |  |  |  | rejected with "LockNotPending" |
| 74 | U1 | U1-live user_lock (fixture) | tx | OK | [0x84aaf34c5d…](https://sepolia.voyager.online/tx/0x84aaf34c5de0f60659164fdccbc5ba3cc8a37a46eda12123e6ae4f6d81722e) | 12697639 | 0x4303e076432e000 |  |
| 75 | U1 | redeem_user wrong secret | sim-reject | OK |  |  |  | rejected with "HashlockMismatch" |
| 76 | U1 | refund_user early by non-recipient | sim-reject | OK |  |  |  | rejected with "RefundNotAllowed" |
| 77 | U1 | U1-live cleanup refund by recipient | tx | OK | [0x10c4ed01f1…](https://sepolia.voyager.online/tx/0x10c4ed01f13e79814f0964a6d5da785bc6a2a00e0776ba98d9cd9ac739d3294) | 12697646 | 0x119f46eff063c80 |  |
| 78 | U2 | forward_intent wrong router | sim-reject | OK |  |  |  | rejected with "RouterMismatch" |
| 79 | U2 | forward_intent expired deadline | sim-reject | OK |  |  |  | rejected with "IntentExpired" |
| 80 | U2 | forward_intent calldata does not match call_hash | sim-reject | OK |  |  |  | rejected with "CallHashMismatch" |
| 81 | U2 | forward_intent wrong signature | sim-reject | OK |  |  |  | rejected with "InvalidSignature" |
| 82 | U2 | U2 user re-approves router (residual-balance probe) | tx | OK | [0x78197f5998…](https://sepolia.voyager.online/tx/0x78197f5998e6c8e261202539f378bf1cb2ae6489820f9c3be84efed4d248963) | 12697654 | 0xccc3b6c8952a00 |  |
| 83 | U2 | forward_intent under-consumes pulled amount (ResidualBalance) | sim-reject | OK |  |  |  | rejected with "ResidualBalance" |
| 84 | U2 | forward_intent REPLAY of K's already-consumed intent | tx | REVERTED |  |  |  | rejected before inclusion: RPC: starknet_estimateFee with params {
  "request": [
    {
      "type": "INVOKE",
      "sender_address": "0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684",
      "calldat |
| 85 | U3 | execute_from_outside_v2 expired time-bounds | tx | REVERTED |  |  |  | rejected before inclusion: RPC: starknet_estimateFee with params {
  "request": [
    {
      "type": "INVOKE",
      "sender_address": "0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684",
      "calldat |
| 86 | U3 | execute_from_outside_v2 REPLAY of L's already-consumed nonce | tx | REVERTED |  |  |  | rejected before inclusion: RPC: starknet_estimateFee with params {
  "request": [
    {
      "type": "INVOKE",
      "sender_address": "0x020d922d2ee35f5eab127e7341eb9a6c119ab68ee72b29970d3d8532d819e684",
      "calldat |

## Summary

- rows: 86
- mined txs: 33
- on-chain reverted (expected): 4
- sim-rejected (expected): 19
- FAILURES: 0
