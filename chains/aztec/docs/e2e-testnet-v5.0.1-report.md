# Train v5.0.1 migration testnet E2E report

Started: 2026-07-20T13:16:44.087Z
Finished: 2026-07-20T13:37:51.931Z

## Environment

- **node**: https://v5.testnet.rpc.aztec-labs.com
- **train**: 0x0483a6a15a6275c9482dbf8aa78aa96fe9291d60b08841a35739ebba4c33d9e6
- **token1**: 0x217878d61e5d31ed78a8ad6f0a6a9b8ee8a1eec5944a7d122f6d910abee0b098
- **token2**: 0x2f63f2687b2fa5d38b51bc9970674e801e89074bd90b07994b8c288f980ba41a
- **payoutCurve**: 0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7
- **user**: 0x060d33326ccbda2c0db344d77ea869aefcfdba58751b9c334e33447352e368ba
- **solver**: 0x23fdaff557dd1816d098b4aadf4b11db4f5055f1884fe80c09835ce6c9734fc8
- **deployer**: 0x061e6e43a2198b3cce6a23da8f8d812b62aa961463ee7e4d0202ea0871bdfc38
- **explorer**: https://aztecscan.xyz

The contracts, compiler, generated artifacts, and Aztec.js clients were v5.0.1.
The public testnet node reported v5.0.0, so the E2E runner emitted a version warning.

## Build and local verification

- Train compilation: passed (warnings only)
- ConstantPayoutCurve compilation: passed
- TypeScript type-check (`npx tsc --noEmit`): passed
- Local TXE contract tests: 34/34 passed
- `Train.ts` was regenerated and was byte-identical to the existing generated binding

## Registry and explorer status

- The canonical AuthRegistry was already deployed at
  `0x1e8e7e73c592a1b1c9199b4b655ddc7a16fa8a8488df595610b71d3dc1cc666c`.
  No AuthRegistry publication transaction was sent.
- Train artifact and instance verification succeeded on AztecScan. Deployed Train class:
  `0x0ab867300344fdd50af17311f051eb8be027d7b81edb570d182b9b2cf94bdef4`.
- AztecScan rejected the official v5.0.1 Token artifact with an HTTP 500 response. Token1
  and Token2 share deployed class
  `0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf`.
- Neither class was present at `https://testnet.aztec-registry.xyz/`. Train upload was
  attempted twice and returned HTTP 503 because the registry's Aztec node was unavailable.
  The official Token artifact returned HTTP 400 as incompatible; the registry advertised
  Aztec 4.3.0 compatibility. No artifact was successfully added to that registry.
- The S3 row below was skipped by the legacy blanket `E2E_VERIFIED=1` setting. After this
  run, the runner was changed to cache verification by the exact deployment addresses so a
  stale flag cannot skip verification for future deployments.

## Transactions & checks

| # | Stage | Name | Kind | Status | Tx | Block | Prove+submit | Mine | Fee | Note |
|---|-------|------|------|--------|----|-------|--------------|------|-----|------|
| 1 | S0 | node https://v5.testnet.rpc.aztec-labs.com version 5.0.0 | info | INFO |  |  |  |  |  |  |
| 2 | S1 | accounts user=0x060d33326ccbda2c0db344d77ea869aefcfdba58751b9c334e33447352e368ba solver=0x23fdaff557dd1816d098b4aadf4b11db4f5055f1884fe80c09835ce6c9734fc8 deployer=0x061e6e43a2198b3cce6a23da8f8d812b62aa961463ee7e4d0202ea0871bdfc38 | info | INFO |  |  |  |  |  |  |
| 3 | S2 | contracts train=0x0483a6a15a6275c9482dbf8aa78aa96fe9291d60b08841a35739ebba4c33d9e6 token=0x217878d61e5d31ed78a8ad6f0a6a9b8ee8a1eec5944a7d122f6d910abee0b098 token2=0x2f63f2687b2fa5d38b51bc9970674e801e89074bd90b07994b8c288f980ba41a curve=0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7 | info | INFO |  |  |  |  |  |  |
| 4 | S2 | token1->user balance ok (50000002100) | info | INFO |  |  |  |  |  |  |
| 5 | S2 | token1->solver balance ok (49999995800) | info | INFO |  |  |  |  |  |  |
| 6 | S2 | token2->solver balance ok (299900) | info | INFO |  |  |  |  |  |  |
| 7 | S3 | AztecScan verification stage skipped by legacy cache flag; actual status documented above | info | INFO |  |  |  |  |  |  |
| 8 | S4 | H1 [authwit 1000 from user] | tx | OK | [0x0fb6704861…](https://aztecscan.xyz/txs/0x0fb67048615f323fa96845278ae4481826a44baaeeae793bd2966170f3de0d79) | 9880 | 10.4s | 4.8s | 1237324079455544256 |  |
| 9 | S4 | H1 user_lock (hashlock 0x17091ed9…) | tx | OK | [0x055406715d…](https://aztecscan.xyz/txs/0x055406715d9745fa741f8e823d8062a67cfe6be15cdb4910bfdffd0fb5f5f140) | 9881 | 15.0s | 4.7s | 6433303219807717848 |  |
| 10 | S4 | H1 redeem_user (by solver) | tx | OK | [0x29bea4ca4c…](https://aztecscan.xyz/txs/0x29bea4ca4ce9a901fb23380ac9af117df95fd3f67a18bd302e777eb2d39446f9) | 9882 | 11.6s | 4.8s | 3201170468010835496 |  |
| 11 | S4 | H1 recipient received amount | check | OK |  |  |  |  |  | delta=1000 (authwit fees ignored; token != fee asset) |
| 12 | S4 | H1 lock status REDEEMED | check | OK |  |  |  |  |  | status=3 |
| 13 | S4 | H1 secret stored on-chain | check | OK |  |  |  |  |  | get_user_lock().secret matches revealed secret |
| 14 | S4 | H2(curve) [authwit 1000 from user] | tx | OK | [0x25a47461cb…](https://aztecscan.xyz/txs/0x25a47461cbf542ecdc1d48d8aedb93f2c3b21a30b74972992b9868e6db8b39a6) | 9883 | 11.2s | 7.4s | 1237324079455544256 |  |
| 15 | S4 | H2(curve) user_lock (hashlock 0xce07bed5…) | tx | OK | [0x159240efc7…](https://aztecscan.xyz/txs/0x159240efc775f3656f314b88afcb338f560fc8434e7a09245df251cd1bcafec0) | 9884 | 12.4s | 4.6s | 7129614479288295888 |  |
| 16 | S4 | H2 payout_curve stored | check | OK |  |  |  |  |  | stored=0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7 |
| 17 | S4 | H2 redeem_user (curve) | tx | OK | [0x01bafff4d3…](https://aztecscan.xyz/txs/0x01bafff4d310a96c423b3eac92a661754be99af7a93f1eae25dfecdc86fb5b5e) | 9885 | 9.8s | 6.7s | 3897150474630428000 |  |
| 18 | S4 | H2 full payout via constant curve | check | OK |  |  |  |  |  | delta=1000 |
| 19 | S4 | H3 [authwit 1000 from user] | tx | OK | [0x0faa7e0a9f…](https://aztecscan.xyz/txs/0x0faa7e0a9fe79f8c8e23b4ac481b87498052a16c2d482c057cd6af8bfa049c31) | 9886 | 12.1s | 4.6s | 1237324079455544256 |  |
| 20 | S4 | H3 user_lock (hashlock 0xd305a588…) | tx | OK | [0x2ec94e08cb…](https://aztecscan.xyz/txs/0x2ec94e08cbd1014677162dab69002fdcb63486e40e096958bac290273bb713b7) | 9887 | 10.4s | 6.9s | 6433303219807717848 |  |
| 21 | S4 | H3 refund_user by recipient (before timelock) | tx | OK | [0x12ce40ff89…](https://aztecscan.xyz/txs/0x12ce40ff89957db674c3af86d9a81455fa17f91be117ae8cefa057085b31dea3) | 9888 | 10.6s | 4.6s | 2969979631961573192 |  |
| 22 | S4 | H3 user refunded in full | check | OK |  |  |  |  |  | net user delta=0 (lock+refund) |
| 23 | S4 | H3 lock status REFUNDED | check | OK |  |  |  |  |  | status=2 |
| 24 | S4 | H4 [authwit 1000 from user] | tx | OK | [0x2be27e17d1…](https://aztecscan.xyz/txs/0x2be27e17d1ec6dc119cc75bdf05f98ef52ff6fa76faada3e422dcbace81d1b65) | 9890 | 16.1s | 5.0s | 1237324079455544256 |  |
| 25 | S4 | H4 user_lock (hashlock 0x93d9e641…) | tx | OK | [0x05a9419d44…](https://aztecscan.xyz/txs/0x05a9419d440a7700fda87d561052e705d845078d14fb2a5cbd678fe03d9826ef) | 9891 | 12.0s | 4.6s | 6433303219807717848 |  |
| 26 | S4 | H4 refund_user by non-recipient (after timelock) | tx | OK | [0x163ecf2946…](https://aztecscan.xyz/txs/0x163ecf29464270768afac225f7e86c79edd5f7f767e0c4cfe324a6cef59bfbb1) | 9893 | 11.1s | 4.6s | 2981953244133636107 |  |
| 27 | S4 | H4 refunded after timelock | check | OK |  |  |  |  |  | locked at 1784553660, timelock 1784553720 |
| 28 | S4 | H5 [authwit 1000 from solver] | tx | OK | [0x0bc74f61e7…](https://aztecscan.xyz/txs/0x0bc74f61e7cc85f7b9d775e0d82f5bc2bf38161fc5caf37ab876205b57ff19fc) | 9894 | 13.0s | 4.6s | 1242208498413560568 |  |
| 29 | S4 | H5 solver_lock | tx | OK | [0x0fbec4e4a2…](https://aztecscan.xyz/txs/0x0fbec4e4a238bdc3c2b0816fae89b35a25fc3a632ba968ee810c25692596c431) | 9895 | 11.0s | 4.7s | 4943222875819699994 |  |
| 30 | S4 | H5 first index is 1 | check | OK |  |  |  |  |  | index=1 |
| 31 | S4 | H5 redeem_solver | tx | OK | [0x07263032a2…](https://aztecscan.xyz/txs/0x07263032a2d3d704d6087bd0b04b5bb76a0292910cc80a1737195b44d2754c0c) | 9896 | 13.3s | 13.3s | 3501600805879155348 |  |
| 32 | S4 | H5 recipient received amount | check | OK |  |  |  |  |  | delta=1000 |
| 33 | S4 | H6 [authwit 1100 from solver] | tx | OK | [0x14a8574004…](https://aztecscan.xyz/txs/0x14a8574004989131a92a27156489c01b4c56ba658bb0ce92342b1f59d04ec5db) | 9897 | 12.7s | 4.6s | 1242208498413560568 |  |
| 34 | S4 | H6 solver_lock | tx | OK | [0x257defe8a5…](https://aztecscan.xyz/txs/0x257defe8a562765f8df9d36d49c6fab2adf83dccebf0fc62c722150af25deec9) | 9898 | 11.5s | 4.7s | 4943965198372486619 |  |
| 35 | S4 | H6 redeem_solver before reward timelock | tx | OK | [0x08a0187243…](https://aztecscan.xyz/txs/0x08a018724354a75e94413889c893c29cf9d7012799cb76d527f2008e6b85a276) | 9899 | 12.5s | 4.6s | 3687872298931605017 |  |
| 36 | S4 | H6 reward went to reward_recipient | check | OK |  |  |  |  |  | delta=100 |
| 37 | S4 | H7 [authwit 1100 from solver] | tx | OK | [0x054d5feda4…](https://aztecscan.xyz/txs/0x054d5feda40049c03a8c42ae9aa35121fa7bff34f7481b4b1ab0a977bb9f4974) | 9900 | 11.8s | 4.9s | 1242208498413560568 |  |
| 38 | S4 | H7 solver_lock | tx | OK | [0x0ebe0865c7…](https://aztecscan.xyz/txs/0x0ebe0865c751dc4a38c62138c8ffad00c355a1d20846cc33b92b371bdbd16665) | 9901 | 13.1s | 4.7s | 4943965198372486619 |  |
| 39 | S4 | H7 redeem_solver after reward timelock | tx | OK | [0x0b1adf0ea5…](https://aztecscan.xyz/txs/0x0b1adf0ea545ed314f54c1c1931e50289d340d2873827ff6b3ed590f2b085bc3) | 9903 | 9.4s | 6.7s | 3395112025895140416 |  |
| 40 | S4 | H7 amount+reward went to redeemer | check | OK |  |  |  |  |  | delta=1100 (recipient==redeemer==user) |
| 41 | S4 | H8 [authwit 1000 from solver] | tx | OK | [0x2ca2260089…](https://aztecscan.xyz/txs/0x2ca226008978e796206fc0a8f1af9554444b56c2c74b8d9236572bb6b8967900) | 9904 | 11.5s | 4.6s | 1204435214266209024 |  |
| 42 | S4 | H8 (reward) [authwit 100 from solver] | tx | OK | [0x035a985854…](https://aztecscan.xyz/txs/0x035a985854f35a6c2c1640810a578290c2e1918e4e9877f8869ab0b1f4561b5f) | 9905 | 12.3s | 4.6s | 1204435214266209024 |  |
| 43 | S4 | H8 solver_lock | tx | OK | [0x19dc71d7fc…](https://aztecscan.xyz/txs/0x19dc71d7fc8df2362490baba05ab96b74f813ee284e260bcdd2add2760505d9a) | 9906 | 9.9s | 4.6s | 5086601027151924736 |  |
| 44 | S4 | H8 redeem_solver (different reward token) | tx | OK | [0x136dfee745…](https://aztecscan.xyz/txs/0x136dfee745230797335f0dceb9a1afcba0e6760d1ee7761def92012978cc0488) | 9907 | 13.6s | 4.6s | 3575730860175876256 |  |
| 45 | S4 | H8 principal paid in token1 | check | OK |  |  |  |  |  | delta=1000 |
| 46 | S4 | H8 reward paid in token2 | check | OK |  |  |  |  |  | delta=100 |
| 47 | S4 | H9 [authwit 1100 from solver] | tx | OK | [0x04e8cfca3f…](https://aztecscan.xyz/txs/0x04e8cfca3f047855b1ffa0771f101c5a5880be0b8c999173f4c54f7201f644e4) | 9908 | 10.3s | 4.6s | 1204435214266209024 |  |
| 48 | S4 | H9 solver_lock | tx | OK | [0x2b6c06857e…](https://aztecscan.xyz/txs/0x2b6c06857ec128281523d3172ffb6e0898ad3d1b8c80a70e4a86c4eea57632e0) | 9909 | 14.3s | 4.6s | 4793628276276685792 |  |
| 49 | S4 | H9 refund_solver after timelock | tx | OK | [0x2378fca5ad…](https://aztecscan.xyz/txs/0x2378fca5add9cde744fd09299f1ae2899d87f3b766a99983fdbb25288ebeddd9) | 9911 | 14.2s | 4.6s | 3168177766397588928 |  |
| 50 | S4 | H9 amount+reward returned to solver | check | OK |  |  |  |  |  | net solver delta=0 |
| 51 | S4-views | probe lock #1 [authwit 1000 from solver] | tx | OK | [0x2871b3fa8b…](https://aztecscan.xyz/txs/0x2871b3fa8b788749f4862258e2dfc97d10aff0121e3bd97476ad3137a26b57ef) | 9913 | 11.2s | 4.6s | 1204435214266209024 |  |
| 52 | S4-views | probe lock #1 solver_lock | tx | OK | [0x227188501d…](https://aztecscan.xyz/txs/0x227188501d435ff85ad4ff6e07d83cc62a61fe87f45f460efa0306746500c488) | 9914 | 13.3s | 4.6s | 4792908526392457792 |  |
| 53 | S4-views | probe lock #2 [authwit 1000 from solver] | tx | OK | [0x3036a6c01f…](https://aztecscan.xyz/txs/0x3036a6c01fddd6aa4e72e3b27e86d901573756ded21976f66beb90426e7566fd) | 9915 | 12.1s | 6.8s | 1204435214266209024 |  |
| 54 | S4-views | probe lock #2 solver_lock | tx | OK | [0x1bef09f0c8…](https://aztecscan.xyz/txs/0x1bef09f0c8bf422030f686d65d43b92ba737e52124b30855f1399ad61f9696ac) | 9916 | 11.4s | 4.6s | 4792908526392457792 |  |
| 55 | S4-views | probe indices are 1 and 2 | check | OK |  |  |  |  |  | got 1, 2 |
| 56 | S4-views | get_solver_lock(h, 2) resolves index 2 (PENDING) | check | OK |  |  |  |  |  | status=1 |
| 57 | S4-views | get_solver_lock(h, 99) is EMPTY | check | OK |  |  |  |  |  | status=0 |
| 58 | S4-views | get_user_lock_count(user) = 10 | view | INFO |  |  |  |  |  |  |
| 59 | S4-views | get_user_lock_hash_at(0) -> 0x4d459fdd32ed… status=3 | view | INFO |  |  |  |  |  |  |
| 60 | S4-views | get_user_lock_hash_at(1) -> 0x0a8d843875e8… status=3 | view | INFO |  |  |  |  |  |  |
| 61 | S4-views | get_user_lock_hash_at(2) -> 0x2d8d0ad84f07… status=2 | view | INFO |  |  |  |  |  |  |
| 62 | S4-views | get_user_lock_hash_at(3) -> 0x0014dd67c7d2… status=2 | view | INFO |  |  |  |  |  |  |
| 63 | S4-views | get_user_lock_hash_at(4) -> 0xfc2317a6e4ac… status=2 | view | INFO |  |  |  |  |  |  |
| 64 | S4-views | get_user_lock_hash_at(5) -> 0x6fa66466169c… status=3 | view | INFO |  |  |  |  |  |  |
| 65 | S4-views | get_user_lock_hash_at(6) -> 0x17091ed9a512… status=3 | view | INFO |  |  |  |  |  |  |
| 66 | S4-views | get_user_lock_hash_at(7) -> 0xce07bed55513… status=3 | view | INFO |  |  |  |  |  |  |
| 67 | S4-views | get_user_lock_hash_at(8) -> 0xd305a588443f… status=2 | view | INFO |  |  |  |  |  |  |
| 68 | S4-views | get_user_lock_hash_at(9) -> 0x93d9e641a2c7… status=2 | view | INFO |  |  |  |  |  |  |
| 69 | S4-views | enumeration entries all resolve to existing locks | check | OK |  |  |  |  |  | 10/10 resolve |
| 70 | S5 | user_lock amount=0 | sim-reject | OK |  |  |  |  |  | rejected with "ZeroAmount" |
| 71 | S5 | user_lock timelock_delta=0 | sim-reject | OK |  |  |  |  |  | rejected with "InvalidTimelock" |
| 72 | S5 | user_lock expired quote | sim-reject | OK |  |  |  |  |  | rejected with "QuoteExpired" |
| 73 | S5 | user_lock duplicate hashlock (H1) | sim-reject | OK |  |  |  |  |  | rejected with "SwapAlreadyExists" |
| 74 | S5 | user_lock zero recipient | sim-reject | OK |  |  |  |  |  | rejected with "ZeroAddress" |
| 75 | S5 | user_lock bogus payout curve | sim-reject | OK |  |  |  |  |  | rejected with "" |
| 76 | S5 | solver_lock reward_timelock >= timelock | sim-reject | OK |  |  |  |  |  | rejected with "InvalidRewardTimelock" |
| 77 | S5 | solver_lock zero reward_recipient | sim-reject | OK |  |  |  |  |  | rejected with "ZeroAddress" |
| 78 | S5 | redeem_user unknown hashlock | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 79 | S5 | refund_user unknown hashlock | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 80 | S5 | redeem_solver unknown index | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 81 | S5 | refund_solver unknown | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 82 | S5 | redeem_user H1 again (already redeemed) | sim-reject | OK |  |  |  |  |  | rejected with "LockNotPending" |
| 83 | S5 | U-live [authwit 1000 from user] | tx | OK | [0x01de06e7f6…](https://aztecscan.xyz/txs/0x01de06e7f6f54c631f332f0d370c098fc984577815d5c0f78cdb15b785f05fac) | 9917 | 8.5s | 4.7s | 1187216481298855656 |  |
| 84 | S5 | U-live user_lock (hashlock 0x75dbaa3c…) | tx | OK | [0x1ef77f4dcd…](https://aztecscan.xyz/txs/0x1ef77f4dcd52a2820ff6ab4edd80c8ee41e79f11e701331e3ab27ff2b872b0c0) | 9918 | 13.6s | 4.7s | 6172775377578944673 |  |
| 85 | S5 | redeem_user wrong secret | sim-reject | OK |  |  |  |  |  | rejected with "HashlockMismatch" |
| 86 | S5 | refund_user early by non-recipient | sim-reject | OK |  |  |  |  |  | rejected with "RefundNotAllowed" |
| 87 | S5 | U-live cleanup refund by recipient | tx | OK | [0x0bec3e0139…](https://aztecscan.xyz/txs/0x0bec3e01395a778b8a9c27fbbb682daf2dd18d47dc4341d44826a42d75a57a0f) | 9919 | 10.6s | 6.9s | 2849705123122009867 |  |
| 88 | S5 | S-live [authwit 1000 from solver] | tx | OK | [0x00815db1a2…](https://aztecscan.xyz/txs/0x00815db1a254486d523f50772d0c1acd327fadfc7173b94ec23cdc498054acae) | 9920 | 11.4s | 4.6s | 1187216481298855656 |  |
| 89 | S5 | S-live solver_lock | tx | OK | [0x223df63c51…](https://aztecscan.xyz/txs/0x223df63c51ba7bde8204c72bd7cbd3bbd9d144bb3f68725a17b699cc7601d791) | 9921 | 11.8s | 7.1s | 4724388600143720398 |  |
| 90 | S5 | refund_solver early (even by recipient) | sim-reject | OK |  |  |  |  |  | rejected with "RefundNotAllowed" |
| 91 | S5 | S-live cleanup redeem | tx | OK | [0x2a477e343a…](https://aztecscan.xyz/txs/0x2a477e343ac08504e9ab9121dcf633e7ead3bf07843b5aa1f0f361e06b5dfdf9) | 9922 | 9.2s | 4.8s | 3346586497337801916 |  |
| 92 | S6 | R1 [authwit 1000 from user] | tx | OK | [0x1675035e61…](https://aztecscan.xyz/txs/0x1675035e6111aef4f0ae41f592431ec8d57a3a34fb51be48f33557bc9f00b825) | 9924 | 12.2s | 7.0s | 1187216481298855656 |  |
| 93 | S6 | R1 user_lock (hashlock 0xb5ad7ce3…) | tx | OK | [0x2ae9ad453c…](https://aztecscan.xyz/txs/0x2ae9ad453cd7bc21ff49447236df97bb12741775e661a979f31db561f8563905) | 9925 | 10.3s | 4.9s | 6172775377578944673 |  |
| 94 | S6 | R1 redeem_user (sender: user) | tx | OK | [0x25ed8b6bcc…](https://aztecscan.xyz/txs/0x25ed8b6bcc1598ad4f9734f80bf406e6a53d40e4bf52b812d723401f18a59393) | 9926 | 10.3s | 7.5s | 3071533482757362271 |  |
| 95 | S6 | R1 redeem_user (sender: solver) | tx | REVERTED | [0x17b65b08dd…](https://aztecscan.xyz/txs/0x17b65b08dd8b10e71918ab9f037d78b7301189cba30a95780ba1b2fc2508ead5) | 9927 | 19.0s | 4.6s | 1655467823051561464 | on-chain revert: reverted |
| 96 | S6 | R1 exactly one redeem succeeded | check | OK |  |  |  |  |  | outcomes: [OK / REVERTED] — loser REVERTED ON CHAIN |
| 97 | S6 | R2 [authwit 1000 from solver] | tx | OK | [0x1fd6fc913b…](https://aztecscan.xyz/txs/0x1fd6fc913be372717878c46c2002619ca730029741deb2bd4ceef5c654d77186) | 9928 | 11.0s | 4.6s | 1187216481298855656 |  |
| 98 | S6 | R2 solver_lock | tx | OK | [0x2df6b48317…](https://aztecscan.xyz/txs/0x2df6b48317982fa73eccd512b7532c5cce6a2a17bb13503c562e171cdb6ee02b) | 9929 | 14.2s | 4.6s | 4724388600143720398 |  |
| 99 | S6 | R2 redeem_solver (user) | tx | OK | [0x2b7226398d…](https://aztecscan.xyz/txs/0x2b7226398dcc92e497ea207be5fdd8cab742a74527efccd2362cd0c538327008) | 9931 | 18.4s | 4.4s | 3346586497337801916 |  |
| 100 | S6 | R2 refund_solver (solver) | tx | REVERTED | [0x0bc1fd4f80…](https://aztecscan.xyz/txs/0x0bc1fd4f80ada6cd9cabe4ffecef15c1a6c6634aae6e6ffd73963f0e96d730c9) | 9932 | 18.8s | 11.9s | 1500101700938724070 | on-chain revert: reverted |
| 101 | S6 | R2 exactly one of redeem/refund succeeded | check | OK |  |  |  |  |  | outcomes: [OK / REVERTED] — loser REVERTED ON CHAIN |

## Summary

- rows: 101
- mined txs: 46
- on-chain reverted (expected): 2
- sim-rejected (expected): 16
- FAILURES: 0

All happy paths, timelock behavior, reward routing, refunds, view/enumeration checks,
negative cases, and concurrent race tests completed successfully. In both race tests exactly
one transaction succeeded and the competing transaction reverted on-chain as expected.
