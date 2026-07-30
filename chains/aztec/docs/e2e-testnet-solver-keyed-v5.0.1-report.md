# Train v5 solver-keyed testnet E2E report

Started: 2026-07-30T21:58:38.979Z
Finished: 2026-07-30T22:24:34.076Z

## Environment

- **node**: https://v5.testnet.rpc.aztec-labs.com
- **train**: 0x1e36ef80d7d02ab8ed33aa07635f85152e015b9c4b09fbf5fe54ec11154d3133
- **token1**: 0x217878d61e5d31ed78a8ad6f0a6a9b8ee8a1eec5944a7d122f6d910abee0b098
- **token2**: 0x2f63f2687b2fa5d38b51bc9970674e801e89074bd90b07994b8c288f980ba41a
- **payoutCurve**: 0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7
- **user**: 0x060d33326ccbda2c0db344d77ea869aefcfdba58751b9c334e33447352e368ba
- **solver**: 0x23fdaff557dd1816d098b4aadf4b11db4f5055f1884fe80c09835ce6c9734fc8
- **deployer**: 0x061e6e43a2198b3cce6a23da8f8d812b62aa961463ee7e4d0202ea0871bdfc38
- **explorer**: https://aztecscan.xyz

## Transactions & checks

| # | Stage | Name | Kind | Status | Tx | Block | Prove+submit | Mine | Fee | Note |
|---|-------|------|------|--------|----|-------|--------------|------|-----|------|
| 1 | S0 | node https://v5.testnet.rpc.aztec-labs.com version 5.0.0 | info | INFO |  |  |  |  |  |  |
| 2 | S1 | accounts user=0x060d33326ccbda2c0db344d77ea869aefcfdba58751b9c334e33447352e368ba solver=0x23fdaff557dd1816d098b4aadf4b11db4f5055f1884fe80c09835ce6c9734fc8 deployer=0x061e6e43a2198b3cce6a23da8f8d812b62aa961463ee7e4d0202ea0871bdfc38 | info | INFO |  |  |  |  |  |  |
| 3 | S2 | contracts train=0x1e36ef80d7d02ab8ed33aa07635f85152e015b9c4b09fbf5fe54ec11154d3133 token=0x217878d61e5d31ed78a8ad6f0a6a9b8ee8a1eec5944a7d122f6d910abee0b098 token2=0x2f63f2687b2fa5d38b51bc9970674e801e89074bd90b07994b8c288f980ba41a curve=0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7 | info | INFO |  |  |  |  |  |  |
| 4 | S2 | token1->user balance ok (50000005200) | info | INFO |  |  |  |  |  |  |
| 5 | S2 | token1->solver balance ok (49999990600) | info | INFO |  |  |  |  |  |  |
| 6 | S2 | token2->solver balance ok (299800) | info | INFO |  |  |  |  |  |  |
| 7 | S2 | token1->deployer balance ok (15000000000200) | info | INFO |  |  |  |  |  |  |
| 8 | S2 | token2->deployer balance ok (300200) | info | INFO |  |  |  |  |  |  |
| 9 | S3 | verify Train | check | OK |  |  |  |  |  |  |
| 10 | S3 | verify Token1 | info | INFO |  |  |  |  |  | AztecScan rejected the official shared Token artifact (exit 1); Train verification is unaffected |
| 11 | S3 | verify Token2 | info | INFO |  |  |  |  |  | AztecScan rejected the official shared Token artifact (exit 1); Train verification is unaffected |
| 12 | S3 | verify ConstantPayoutCurve | info | INFO |  |  |  |  |  | not automated - verify manually with artifact payout_curve-ConstantPayoutCurve.json at 0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7 |
| 13 | S4 | H1 [authwit 1000 from user] | tx | OK | [0x30429272e2…](https://aztecscan.xyz/txs/0x30429272e2779a462d6b73ca0394eb96d0d57c119b927b6a588aeefe331c03e0) | 24210 | 15.3s | 4.6s | 1222516978457721408 |  |
| 14 | S4 | H1 user_lock (hashlock 0xcde3017f…) | tx | OK | [0x2e439a0a1c…](https://aztecscan.xyz/txs/0x2e439a0a1c779bf8a04d9889cb67a3cae3ac214279e2189582038ed416a47cec) | 24211 | 13.9s | 4.6s | 6356315652761234664 |  |
| 15 | S4 | H1 redeem_user (by solver) | tx | OK | [0x20bc8201e1…](https://aztecscan.xyz/txs/0x20bc8201e1d1e9f0f0c8e63bf06c4321197efc5aed10b272c49a03339142917f) | 24212 | 17.2s | 18.6s | 3162861947859880728 |  |
| 16 | S4 | H1 recipient received amount | check | OK |  |  |  |  |  | delta=1000 (authwit fees ignored; token != fee asset) |
| 17 | S4 | H1 lock status REDEEMED | check | OK |  |  |  |  |  | status=3 |
| 18 | S4 | H1 secret stored on-chain | check | OK |  |  |  |  |  | get_user_lock().secret matches revealed secret |
| 19 | S4 | H2(curve) [authwit 1000 from user] | tx | OK | [0x19f2ac98ad…](https://aztecscan.xyz/txs/0x19f2ac98ad8eba6370ad6a8d18f1e63ec17f5823dd88035ea7f6ec2bff7f840d) | 24213 | 13.3s | 4.6s | 1222516978457721408 |  |
| 20 | S4 | H2(curve) user_lock (hashlock 0x791ba924…) | tx | OK | [0x2775be8877…](https://aztecscan.xyz/txs/0x2775be88770c38e3333bd72a807bc9164e803cd8cf6b19598862a06c7625a048) | 24214 | 15.1s | 4.6s | 7044294130785246384 |  |
| 21 | S4 | H2 payout_curve stored | check | OK |  |  |  |  |  | stored=0x0f39abe60a09d7750b0f3fc1dada72f151d815f10f63a4413db9a9e2cb5d2fc7 |
| 22 | S4 | H2 redeem_user (curve) | tx | OK | [0x217e935296…](https://aztecscan.xyz/txs/0x217e9352966ea2d40f33bd935bda5d1821ac18b419c4df051a5d0ea536dfcadd) | 24215 | 15.1s | 9.0s | 3782664183820761500 |  |
| 23 | S4 | H2 full payout via constant curve | check | OK |  |  |  |  |  | delta=1000 |
| 24 | S4 | H3 [authwit 1000 from user] | tx | OK | [0x27a407b4e7…](https://aztecscan.xyz/txs/0x27a407b4e78ca9918504c70bf395a19ad0bb3304d9d1bb742a7e5c58a3a153c0) | 24216 | 14.5s | 4.7s | 1200975304803781848 |  |
| 25 | S4 | H3 user_lock (hashlock 0x4e64e030…) | tx | OK | [0x0032c24a49…](https://aztecscan.xyz/txs/0x0032c24a4924fcb0b5cac0ae85b4dc67e179b6f21b4f701e0f369e8a28547ecb) | 24218 | 14.5s | 4.7s | 6244312564177589559 |  |
| 26 | S4 | H3 refund_user by recipient (before timelock) | tx | OK | [0x0ea9ced9d4…](https://aztecscan.xyz/txs/0x0ea9ced9d45bbe4fd13794cca145e8e95c0c1c4b0cef0b6efdac55a0646b1d79) | 24219 | 14.3s | 17.8s | 2882730767937203261 |  |
| 27 | S4 | H3 user refunded in full | check | OK |  |  |  |  |  | net user delta=0 (lock+refund) |
| 28 | S4 | H3 lock status REFUNDED | check | OK |  |  |  |  |  | status=2 |
| 29 | S4 | H4 [authwit 1000 from user] | tx | OK | [0x14cc3be8dc…](https://aztecscan.xyz/txs/0x14cc3be8dc77f7928feeed0710156eac13318bade12ebd56e9b1552f78f03bb6) | 24221 | 14.2s | 9.0s | 1200975304803781848 |  |
| 30 | S4 | H4 user_lock (hashlock 0x2a7a5379…) | tx | OK | [0x27c77a4143…](https://aztecscan.xyz/txs/0x27c77a41433384c2a3fd98dd2b81114b8c878253aacb4dac36cd08cc6590d1ca) | 24222 | 15.3s | 4.7s | 6244312564177589559 |  |
| 31 | S4 | H4 refund_user by non-recipient (after timelock) | tx | OK | [0x2b0d4c76ca…](https://aztecscan.xyz/txs/0x2b0d4c76cac4fee6a4f2fe6884681a0cd75b8ccd80fbf6f01b25939190a27a88) | 24224 | 15.0s | 4.6s | 2882971909190510327 |  |
| 32 | S4 | H4 refunded after timelock | check | OK |  |  |  |  |  | locked at 1785449052, timelock 1785449112 |
| 33 | S4 | H5 [authwit 1000 from solver] | tx | OK | [0x2164d84ac2…](https://aztecscan.xyz/txs/0x2164d84ac2a8fc7032718080fafcb36acc68aa02f079ef057b44586ee758f8c5) | 24225 | 14.2s | 5.6s | 1200975304803781848 |  |
| 34 | S4 | H5 solver_lock | tx | OK | [0x263a5ad9d8…](https://aztecscan.xyz/txs/0x263a5ad9d824e975d0ee1960fb269e64310511ac3a09f2aeec3215b90a6c4691) | 24226 | 14.6s | 4.6s | 4997960599723724101 |  |
| 35 | S4 | H5 lock keyed by canonical solver address | check | OK |  |  |  |  |  | sender=0x23fdaff557dd1816d098b4aadf4b11db4f5055f1884fe80c09835ce6c9734fc8 |
| 36 | S4 | H5 redeem_solver | tx | OK | [0x115545685e…](https://aztecscan.xyz/txs/0x115545685ed805295e7f8c9483a2ec43c9c2908fe612c95a5f01f6a921dd5fbf) | 24227 | 15.1s | 4.8s | 3385370572261075428 |  |
| 37 | S4 | H5 recipient received amount | check | OK |  |  |  |  |  | delta=1000 |
| 38 | S4 | H6 [authwit 1100 from solver] | tx | OK | [0x251a46bb5c…](https://aztecscan.xyz/txs/0x251a46bb5c0bbb15533d4c514ee020e32372ff65b5c4f2b4437ca9fe26530342) | 24228 | 20.6s | 4.6s | 1200975304803781848 |  |
| 39 | S4 | H6 solver_lock | tx | OK | [0x2fbeaca69d…](https://aztecscan.xyz/txs/0x2fbeaca69dcc52de76b38ceda21e50d3590d34aa79a3a9a851060237bde74520) | 24229 | 13.8s | 4.6s | 4998678282025233226 |  |
| 40 | S4 | H6 redeem_solver before reward timelock | tx | OK | [0x0446fce015…](https://aztecscan.xyz/txs/0x0446fce015b03f1415467ff4704ddec72f86e9751f5cd3c45d460cab781636a3) | 24230 | 14.6s | 9.1s | 3709348145837079689 |  |
| 41 | S4 | H6 reward went to reward_recipient | check | OK |  |  |  |  |  | delta=100 |
| 42 | S4 | H7 [authwit 1100 from solver] | tx | OK | [0x031896d1a9…](https://aztecscan.xyz/txs/0x031896d1a9a5f593a366cc03ac44118b6dc505f6b3478a86e74d898d5f4c331b) | 24231 | 13.2s | 4.6s | 1249442338789307256 |  |
| 43 | S4 | H7 solver_lock | tx | OK | [0x287c736a23…](https://aztecscan.xyz/txs/0x287c736a23c1a16415d023e6b5dfd6144b4c93f94f7d2fe089a8935939c48055) | 24233 | 15.3s | 5.2s | 5200406918083413922 |  |
| 44 | S4 | H7 redeem_solver after reward timelock | tx | OK | [0x0eba8d61c4…](https://aztecscan.xyz/txs/0x0eba8d61c48ae1bbafd7919051ea3a596fc7505c7160702104d814d8f8434c94) | 24235 | 13.9s | 4.6s | 3521979978533361354 |  |
| 45 | S4 | H7 amount+reward went to redeemer | check | OK |  |  |  |  |  | delta=1100 (recipient==redeemer==user) |
| 46 | S4 | H8 [authwit 1000 from solver] | tx | OK | [0x2457701fe4…](https://aztecscan.xyz/txs/0x2457701fe40458408018dc3c7b6f4303cdb70dbdefe2b3bcebbcb58e8e6a1ab0) | 24236 | 14.8s | 4.7s | 1249442338789307256 |  |
| 47 | S4 | H8 (reward) [authwit 100 from solver] | tx | OK | [0x25a62dde41…](https://aztecscan.xyz/txs/0x25a62dde41241683dce36bce2dec083b14e0ca40a07cb84efb6b74b0ccacd9e0) | 24237 | 14.8s | 4.8s | 1249442338789307256 |  |
| 48 | S4 | H8 solver_lock | tx | OK | [0x2fc42189c5…](https://aztecscan.xyz/txs/0x2fc42189c5897bd55aa2a339cf62b96e13dda8cbee0620e751cb0d9926bc8183) | 24238 | 14.6s | 13.5s | 5504327423494831783 |  |
| 49 | S4 | H8 redeem_solver (different reward token) | tx | OK | [0x1df1e9129b…](https://aztecscan.xyz/txs/0x1df1e9129bc519c5c1e03ace361caf98e5f9bc716221b24e7d30d081b5b9ea58) | 24239 | 14.7s | 4.7s | 3709348145837079689 |  |
| 50 | S4 | H8 principal paid in token1 | check | OK |  |  |  |  |  | delta=1000 |
| 51 | S4 | H8 reward paid in token2 | check | OK |  |  |  |  |  | delta=100 |
| 52 | S4 | H9 [authwit 1100 from solver] | tx | OK | [0x04f6d32a75…](https://aztecscan.xyz/txs/0x04f6d32a75bf67432f126b1867a872691996f30e7e4c852ec4cad03c708e4534) | 24240 | 14.3s | 4.8s | 1249442338789307256 |  |
| 53 | S4 | H9 solver_lock | tx | OK | [0x0e0e86a16a…](https://aztecscan.xyz/txs/0x0e0e86a16a1fc1f270c2c6f09d8c4c2ad454915474dd1538a61169931f0d7275) | 24241 | 14.5s | 13.4s | 5200406918083413922 |  |
| 54 | S4 | H9 refund_solver after timelock | tx | OK | [0x0558ceb5f3…](https://aztecscan.xyz/txs/0x0558ceb5f3ea5a9930c9548788e1f0191d3ef40140daa3fad3c8d3c084f4202e) | 24243 | 14.5s | 4.6s | 3174529889007475596 |  |
| 55 | S4 | H9 amount+reward returned to solver | check | OK |  |  |  |  |  | net solver delta=0 |
| 56 | S4-views | probe lock #1 [authwit 1000 from solver] | tx | OK | [0x27ae7bb1f8…](https://aztecscan.xyz/txs/0x27ae7bb1f8017dba82e1e915b6cd4c2ab0dc669a09f32df73fbd6d619f7746ec) | 24245 | 13.3s | 4.6s | 1206850078810057968 |  |
| 57 | S4-views | probe lock #1 solver_lock | tx | OK | [0x03de727a5a…](https://aztecscan.xyz/txs/0x03de727a5a8bb8ac100d84da8a798c7af190dd1cbab9bbf6277285ab259438e4) | 24246 | 15.0s | 4.8s | 5022408970059237666 |  |
| 58 | S4-views | probe lock #2 [authwit 1000 from deployer] | tx | OK | [0x059df81ab5…](https://aztecscan.xyz/txs/0x059df81ab50f6fdb642321e80a8dc25cea66f424612adde0a90a40ef1ff551f1) | 24247 | 15.6s | 10.0s | 1206850078810057968 |  |
| 59 | S4-views | probe lock #2 solver_lock | tx | OK | [0x0379b3d4ab…](https://aztecscan.xyz/txs/0x0379b3d4ab067c51af3543a5f65c58a83fb3f56aad2e8cf5c23ccc1c5aa8d5ca) | 24248 | 13.7s | 4.8s | 5022408970059237666 |  |
| 60 | S4-views | same hashlock resolves solver #1 | check | OK |  |  |  |  |  | status=1 sender=0x23fdaff557dd1816d098b4aadf4b11db4f5055f1884fe80c09835ce6c9734fc8 |
| 61 | S4-views | same hashlock resolves solver #2 | check | OK |  |  |  |  |  | status=1 sender=0x061e6e43a2198b3cce6a23da8f8d812b62aa961463ee7e4d0202ea0871bdfc38 |
| 62 | S4-views | unknown solver key is EMPTY | check | OK |  |  |  |  |  | status=0 |
| 63 | S4-views | get_user_lock_count(user) = 4 | view | INFO |  |  |  |  |  |  |
| 64 | S4-views | get_user_lock_hash_at(0) -> 0xcde3017fc6d6… status=3 | view | INFO |  |  |  |  |  |  |
| 65 | S4-views | get_user_lock_hash_at(1) -> 0x791ba9242d6a… status=3 | view | INFO |  |  |  |  |  |  |
| 66 | S4-views | get_user_lock_hash_at(2) -> 0x4e64e030a906… status=2 | view | INFO |  |  |  |  |  |  |
| 67 | S4-views | get_user_lock_hash_at(3) -> 0x2a7a5379049e… status=2 | view | INFO |  |  |  |  |  |  |
| 68 | S4-views | enumeration entries all resolve to existing locks | check | OK |  |  |  |  |  | 4/4 resolve |
| 69 | S5 | user_lock amount=0 | sim-reject | OK |  |  |  |  |  | rejected with "ZeroAmount" |
| 70 | S5 | user_lock timelock_delta=0 | sim-reject | OK |  |  |  |  |  | rejected with "InvalidTimelock" |
| 71 | S5 | user_lock expired quote | sim-reject | OK |  |  |  |  |  | rejected with "QuoteExpired" |
| 72 | S5 | user_lock duplicate hashlock (H1) | sim-reject | OK |  |  |  |  |  | rejected with "SwapAlreadyExists" |
| 73 | S5 | user_lock zero recipient | sim-reject | OK |  |  |  |  |  | rejected with "ZeroAddress" |
| 74 | S5 | user_lock bogus payout curve | sim-reject | OK |  |  |  |  |  | rejected with "" |
| 75 | S5 | solver_lock reward_timelock >= timelock | sim-reject | OK |  |  |  |  |  | rejected with "InvalidRewardTimelock" |
| 76 | S5 | solver_lock zero reward_recipient | sim-reject | OK |  |  |  |  |  | rejected with "ZeroAddress" |
| 77 | S5 | redeem_user unknown hashlock | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 78 | S5 | refund_user unknown hashlock | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 79 | S5 | redeem_solver unknown solver key | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 80 | S5 | refund_solver unknown solver key | sim-reject | OK |  |  |  |  |  | rejected with "LockNotFound" |
| 81 | S5 | redeem_user H1 again (already redeemed) | sim-reject | OK |  |  |  |  |  | rejected with "LockNotPending" |
| 82 | S5 | U-live [authwit 1000 from user] | tx | OK | [0x1f05c1279a…](https://aztecscan.xyz/txs/0x1f05c1279a2236913ebb0f26b311538241a9e6fae8917891ba548e90d39f31f6) | 24249 | 11.9s | 4.7s | 1206850078810057968 |  |
| 83 | S5 | U-live user_lock (hashlock 0xe1d79edb…) | tx | OK | [0x12b0873136…](https://aztecscan.xyz/txs/0x12b087313639889333ea5274f5b93a47009c4bf5893c83da821e610548dd6881) | 24250 | 14.1s | 4.7s | 6274857676131483894 |  |
| 84 | S5 | redeem_user wrong secret | sim-reject | OK |  |  |  |  |  | rejected with "HashlockMismatch" |
| 85 | S5 | refund_user early by non-recipient | sim-reject | OK |  |  |  |  |  | rejected with "RefundNotAllowed" |
| 86 | S5 | U-live cleanup refund by recipient | tx | OK | [0x18b5010013…](https://aztecscan.xyz/txs/0x18b5010013c63cf56d93f64088f3ad54712841b2eefe4a08690df81e1a4a29c9) | 24251 | 13.5s | 4.6s | 2896832133481382226 |  |
| 87 | S5 | S-live [authwit 1000 from solver] | tx | OK | [0x234370db21…](https://aztecscan.xyz/txs/0x234370db21b47f3dc8f1bc2cc8111dba7a801e2f56b3ff0e5b032bdf62d4601d) | 24252 | 13.8s | 9.0s | 1206850078810057968 |  |
| 88 | S5 | S-live solver_lock | tx | OK | [0x0a052cad13…](https://aztecscan.xyz/txs/0x0a052cad137fa8c701f4d85ba03e26968f7d8f16a4a8e70007e11a55381b31b4) | 24253 | 16.4s | 4.6s | 5022408970059237666 |  |
| 89 | S5 | refund_solver early (even by recipient) | sim-reject | OK |  |  |  |  |  | rejected with "RefundNotAllowed" |
| 90 | S5 | S-live cleanup redeem | tx | OK | [0x2c93b174e6…](https://aztecscan.xyz/txs/0x2c93b174e64ad0d76d1bd64567ac75557129637ffa391902b7a90ea603ea4958) | 24255 | 12.7s | 4.6s | 3401930685495694248 |  |
| 91 | S5 | solver_lock retry after redeem | sim-reject | OK |  |  |  |  |  | rejected with "SolverLockAlreadyExists" |
| 92 | S6 | R1 [authwit 1000 from user] | tx | OK | [0x0f655bb9a2…](https://aztecscan.xyz/txs/0x0f655bb9a23ff6fa01ec6374aafa9f31dfa62fd89fc181003f099d98b49dd352) | 24256 | 13.7s | 13.5s | 1225731344256147432 |  |
| 93 | S6 | R1 user_lock (hashlock 0x3aea5332…) | tx | OK | [0x279f26d1ba…](https://aztecscan.xyz/txs/0x279f26d1ba6cacefecedf115195a0bdff209217e9459ced11c88fe876a196341) | 24257 | 14.5s | 4.6s | 6373028323422063681 |  |
| 94 | S6 | R1 redeem_user (sender: solver) | tx | OK | [0x1857091546…](https://aztecscan.xyz/txs/0x1857091546db5c34b84748fc06b85ba7d78092128c5c4079e95c74bd08e1a871) | 24258 | 24.1s | 4.4s | 3171178065713041087 |  |
| 95 | S6 | R1 redeem_user (sender: user) | tx | REVERTED | [0x01b50d8602…](https://aztecscan.xyz/txs/0x01b50d860225e92f61414b297638f1ed310d178d41efb8ffd77cc1536045f400) | 24258 | 24.2s | 4.6s | 1709173374936489208 | on-chain revert: reverted |
| 96 | S6 | R1 exactly one redeem succeeded | check | OK |  |  |  |  |  | outcomes: [REVERTED / OK] — loser REVERTED ON CHAIN |
| 97 | S6 | R2 [authwit 1000 from solver] | tx | OK | [0x027e17efd4…](https://aztecscan.xyz/txs/0x027e17efd455043bedac976c084b08011f9f100005d16482165f98709fd0e6fa) | 24259 | 13.5s | 9.0s | 1225731344256147432 |  |
| 98 | S6 | R2 solver_lock | tx | OK | [0x0ca3f8b1de…](https://aztecscan.xyz/txs/0x0ca3f8b1de0253ceb1943e7f6519d462d42862bbe5ce6d7a1254705dc2257586) | 24260 | 14.4s | 4.7s | 5100984957754420259 |  |
| 99 | S6 | R2 refund_solver (solver) | tx | OK | [0x1a1f8d06f8…](https://aztecscan.xyz/txs/0x1a1f8d06f8bcde329e939f62ee1e792974b8b05c0184065c0aa939ab3ef8d874) | 24263 | 23.2s | 4.7s | 3224060885944793193 |  |
| 100 | S6 | R2 redeem_solver (user) | tx | REVERTED | [0x0ecdc6792f…](https://aztecscan.xyz/txs/0x0ecdc6792f2869ed01231693f2258254940f70e2f08a63359590fd3f747cd1af) | 24263 | 23.2s | 4.7s | 1727379800561818357 | on-chain revert: reverted |
| 101 | S6 | R2 exactly one of redeem/refund succeeded | check | OK |  |  |  |  |  | outcomes: [REVERTED / OK] — loser REVERTED ON CHAIN |
| 102 | S6 | R3 #1 [authwit 1000 from solver] | tx | OK | [0x21ef4cc4d8…](https://aztecscan.xyz/txs/0x21ef4cc4d889b76055fe24f340c2dd1aacc5785b3abf8d526652eb7c58bf746e) | 24264 | 14.7s | 5.0s | 1225731344256147432 |  |
| 103 | S6 | R3 #2 [authwit 1000 from solver] | tx | OK | [0x0c2645fe3e…](https://aztecscan.xyz/txs/0x0c2645fe3e16bd041ff1baf7606821399b0ac1ee26f3dad0095cf7205eaca913) | 24265 | 14.6s | 4.6s | 1225731344256147432 |  |
| 104 | S6 | R3 solver_lock #1 | tx | OK | [0x25b79eb777…](https://aztecscan.xyz/txs/0x25b79eb777dc050555554514100188147684d85b6c9e8edaf7b6db7f5bc340ba) | 24267 | 16.4s | 9.0s | 5100984957754420259 |  |
| 105 | S6 | R3 solver_lock #2 | tx | REVERTED | [0x150e8919b9…](https://aztecscan.xyz/txs/0x150e8919b91697d7abbc4fa7fc570fb9dccc965b28f35294d5b16c98c69d7f3f) | 24268 | 25.2s | 4.6s | 2547489326919379042 | on-chain revert: reverted |
| 106 | S6 | R3 exactly one solver lock funded | check | OK |  |  |  |  |  | outcomes: [OK / REVERTED] |
| 107 | S6 | R3 canonical solver slot is pending | check | OK |  |  |  |  |  | status=1 sender=0x23fdaff557dd1816d098b4aadf4b11db4f5055f1884fe80c09835ce6c9734fc8 |

## Summary

- rows: 107
- mined txs: 50
- on-chain reverted (expected): 3
- sim-rejected (expected): 17
- FAILURES: 0
- solver-key model: permanent `(hashlock, solver AztecAddress)` slot; no numeric index
