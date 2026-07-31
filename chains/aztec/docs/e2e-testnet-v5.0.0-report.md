# Train v5 testnet E2E report

Started: 2026-07-13T15:48:24.627Z  
Finished: 2026-07-13T16:10:40.828Z

## Environment

- **node**: https://v5.testnet.rpc.aztec-labs.com
- **train**: 0x3055f51378381769adb3f9f76b70e6e39b4c9a2a6565acdc5c2d1783e7c21216
- **token1**: 0x264fcdbf3c025c9c7be4e4a593ea688b02158afeca4000a6f6542cf1b71f828f
- **token2**: 0x1658d0a9343374b90096da485a7a6c3998a0c2a70e68b5ad0b06255c5aa02046
- **payoutCurve**: 0x063ae60e12de5e6a34cc1e39d440a018463ea73f46fc73cd3c1c30c942f705ea
- **user**: 0x1971df5d8c09e7ef56be522c864f12b038c5536cea12709e2d868e3ecde904bd
- **solver**: 0x11be4617674fa67952a4e4261dfdde4687bd19413c0baaaa8c72f7e9a13d49e6
- **deployer**: 0x2819d4615c4d7ba1a8d32f3ed8cc4291e2d22e6941f5e5740e9b159c97443011
- **explorer**: https://aztecscan.xyz

## Transactions & checks

| # | Stage | Name | Kind | Status | Tx | Block | Prove+submit | Mine | Fee | Note |
|---|-------|------|------|--------|----|-------|--------------|------|-----|------|
| 1 | S0 | node https://v5.testnet.rpc.aztec-labs.com version 5.0.0 | info | INFO |  |  |  |  |  |  |
| 2 | S1 | accounts user=0x1971df5d8c09e7ef56be522c864f12b038c5536cea12709e2d868e3ecde904bd solver=0x11be4617674fa67952a4e4261dfdde4687bd19413c0baaaa8c72f7e9a13d49e6 deployer=0x2819d4615c4d7ba1a8d32f3ed8cc4291e2d22e6941f5e5740e9b159c97443011 | info | INFO |  |  |  |  |  |  |
| 3 | S2 | deploy Token2 (reward token) | tx | OK | [0x25b72f95fc…](https://aztecscan.xyz/txs/0x25b72f95fc37d40c9587b66d8666b741abf5697502ac210ab4bb3f4aeb4e7d73) | 78 | 17.0s |  | 2671638195216393276 |  |
| 4 | S2 | deploy ConstantPayoutCurve | tx | OK | [0x091fb59dcb…](https://aztecscan.xyz/txs/0x091fb59dcb72e7f5847650af8e5fdc1c55851519c1998c4d6daa746848407b49) | 79 | 20.8s |  | 1587798815591859045 |  |
| 5 | S2 | deploy Train | tx | OK | [0x100c686794…](https://aztecscan.xyz/txs/0x100c686794ce96cdbceb6b7c48b6c83070adb58f5a720c606690b214c32d7a5e) | 80 | 29.7s |  | 1551304580957650772 |  |
| 6 | S2 | contracts train=0x3055f51378381769adb3f9f76b70e6e39b4c9a2a6565acdc5c2d1783e7c21216 token=0x264fcdbf3c025c9c7be4e4a593ea688b02158afeca4000a6f6542cf1b71f828f token2=0x1658d0a9343374b90096da485a7a6c3998a0c2a70e68b5ad0b06255c5aa02046 curve=0x063ae60e12de5e6a34cc1e39d440a018463ea73f46fc73cd3c1c30c942f705ea | info | INFO |  |  |  |  |  |  |
| 7 | S2 | token1->user balance ok (50000000000) | info | INFO |  |  |  |  |  |  |
| 8 | S2 | token1->solver balance ok (50000000000) | info | INFO |  |  |  |  |  |  |
| 9 | S2 | mint token2->solver | tx | OK | [0x1bd4de5907…](https://aztecscan.xyz/txs/0x1bd4de59079644f3b5f0cc61682603fbcca27a80b5c7276f59a62139b01fc902) | 81 | 13.2s | 3.9s | 1278602774649449678 |  |
| 10 | S3 | AztecScan verification (already done) | info | INFO |  |  |  |  |  |  |
| 11 | S4 | H1 [authwit 1000 from user] | tx | OK | [0x2ebac8840e…](https://aztecscan.xyz/txs/0x2ebac8840ed2dc5e2275de0d7726a775414b8c43e8b7b3204de790aafc4e8a1b) | 82 | 12.0s | 4.7s | 1193785928809917168 |  |
| 12 | S4 | H1 user_lock (hashlock 0x47495026…) | tx | OK | [0x0f9937b90e…](https://aztecscan.xyz/txs/0x0f9937b90ead18d8c9d799280d9aebc3dc3a089ded9db51a7b703d1202bd82e5) | 83 | 12.7s | 4.7s | 6206932352721517494 |  |
| 13 | S4 | H1 redeem_user (by solver) | tx | OK | [0x0b41fda0fd…](https://aztecscan.xyz/txs/0x0b41fda0fda9cbec1a3a659a359235aa497b22beb3bb6dbba387dec81289b6a0) | 84 | 13.1s | 4.7s | 3088529774765848138 |  |
| 14 | S4 | H1 recipient received amount | check | OK |  |  |  |  |  | delta=1000 (authwit fees ignored; token != fee asset) |
| 15 | S4 | H1 lock status REDEEMED | check | OK |  |  |  |  |  | status=3 |
| 16 | S4 | H1 secret stored on-chain | check | OK |  |  |  |  |  | get_user_lock().secret matches revealed secret |
| 17 | S4 | H2(curve) [authwit 1000 from user] | tx | OK | [0x0162b4eca8…](https://aztecscan.xyz/txs/0x0162b4eca8a3058c73e7e959c7ad0cfcc3d316b8312f987b9421f4f99ec4a4b3) | 85 | 12.1s | 4.7s | 1193785928809917168 |  |
| 18 | S4 | H2(curve) user_lock (hashlock 0x796c28f7…) | tx | OK | [0x113518b176…](https://aztecscan.xyz/txs/0x113518b176ef7239fe0ceba1a35e91a6962cbd742f2b4ca008284833aa76f12f) | 86 | 12.6s | 4.0s | 6878742266907941364 |  |
| 19 | S4 | H2 payout_curve stored | check | OK |  |  |  |  |  | stored=0x063ae60e12de5e6a34cc1e39d440a018463ea73f46fc73cd3c1c30c942f705ea |
| 20 | S4 | H2 redeem_user (curve) | tx | OK | [0x12ef586352…](https://aztecscan.xyz/txs/0x12ef58635255d0c914d13049efe4c135fe3173a772a6c85f989238eba9d8778a) | 87 | 12.8s | 17.5s | 3760020092000359000 |  |
| 21 | S4 | H2 full payout via constant curve | check | OK |  |  |  |  |  | delta=1000 |
| 22 | S4 | H3 [authwit 1000 from user] | tx | OK | [0x120d9c7890…](https://aztecscan.xyz/txs/0x120d9c7890418ab809be4ac7b842c823de589b7560e70d523fc605271ee27258) | 88 | 12.5s | 4.9s | 1193785928809917168 |  |
| 23 | S4 | H3 user_lock (hashlock 0x4569c6c8…) | tx | OK | [0x16b705a9d5…](https://aztecscan.xyz/txs/0x16b705a9d547bdcecefbaf7b3d0978d5a142c64e4e538d41e83d5ad47a733ca1) | 89 | 13.0s | 4.8s | 6206932352721517494 |  |
| 24 | S4 | H3 refund_user by recipient (before timelock) | tx | OK | [0x0338c09301…](https://aztecscan.xyz/txs/0x0338c0930105e298934ae070661288b970a72e92c86a9e18506da75c536d05f1) | 92 | 13.5s | 21.9s | 2865473930684276626 |  |
| 25 | S4 | H3 user refunded in full | check | OK |  |  |  |  |  | net user delta=0 (lock+refund) |
| 26 | S4 | H3 lock status REFUNDED | check | OK |  |  |  |  |  | status=2 |
| 27 | S4 | H4 [authwit 1000 from user] | tx | OK | [0x003380515c…](https://aztecscan.xyz/txs/0x003380515c647e2b35e6bf3916b553ceea7f4970257de1d8c9529ae15313546b) | 94 | 12.9s | 3.9s | 1193785928809917168 |  |
| 28 | S4 | H4 user_lock (hashlock 0xd93a139f…) | tx | OK | [0x09e4839d02…](https://aztecscan.xyz/txs/0x09e4839d02cc48ba24424f14453d5dfe9f896b577851281be2d5e1ceab25df4a) | 97 | 13.4s | 9.2s | 6206932352721517494 |  |
| 29 | S4 | H4 refund_user by non-recipient (after timelock) | tx | OK | [0x1a3c1e97f1…](https://aztecscan.xyz/txs/0x1a3c1e97f13156cf10d75b2bb8b1a0072ea0e33dc36e17cb3f4071e7606c86cd) | 101 | 13.1s | 4.7s | 2996332294227042018 |  |
| 30 | S4 | H4 refunded after timelock | check | OK |  |  |  |  |  | locked at 1783958076, timelock 1783958136 |
| 31 | S4 | H5 [authwit 1000 from solver] | tx | OK | [0x064cf87d14…](https://aztecscan.xyz/txs/0x064cf87d1425eaf06f3ffd6c9b3bf63397d564573c19789d3f293ea24dcc2ef8) | 103 | 12.9s | 4.8s | 1248198457598964432 |  |
| 32 | S4 | H5 solver_lock | tx | OK | [0x2352dbafb2…](https://aztecscan.xyz/txs/0x2352dbafb2ff43794fa42034412a83d6f40fab27c613da63e70e1578689bdb90) | 104 | 13.0s | 3.9s | 4967059215136593756 |  |
| 33 | S4 | H5 first index is 1 | check | OK |  |  |  |  |  | index=1 |
| 34 | S4 | H5 redeem_solver | tx | OK | [0x150ae74d53…](https://aztecscan.xyz/txs/0x150ae74d533ea5215205568a03d3cfcdfa740d7ce34bac02edd6f17f1989e08b) | 105 | 12.2s | 4.8s | 3518485608983932152 |  |
| 35 | S4 | H5 recipient received amount | check | OK |  |  |  |  |  | delta=1000 |
| 36 | S4 | H6 [authwit 1100 from solver] | tx | OK | [0x1921940bba…](https://aztecscan.xyz/txs/0x1921940bbaef6a57a076bdad2d385619ba40b746a2a13cd20f026cf8267198d4) | 106 | 12.4s | 4.8s | 1248198457598964432 |  |
| 37 | S4 | H6 solver_lock | tx | OK | [0x1a37501e26…](https://aztecscan.xyz/txs/0x1a37501e26c271224448bb4fb55a614cab187f929e27cf9a5150331db144c379) | 107 | 13.8s | 4.7s | 4967805117186541506 |  |
| 38 | S4 | H6 redeem_solver before reward timelock | tx | OK | [0x0de268bcd2…](https://aztecscan.xyz/txs/0x0de268bcd26798d84b71ee6dfedea76a4b56133c6b57d8614679245838f7e996) | 108 | 9.9s | 4.7s | 3705655307645354358 |  |
| 39 | S4 | H6 reward went to reward_recipient | check | OK |  |  |  |  |  | delta=100 |
| 40 | S4 | H7 [authwit 1100 from solver] | tx | OK | [0x26904da557…](https://aztecscan.xyz/txs/0x26904da5571cef0eb95cef3c4e5fdd84eabcfcabe44d054caaebdf0660c2bafd) | 109 | 13.0s | 3.8s | 1248198457598964432 |  |
| 41 | S4 | H7 solver_lock | tx | OK | [0x1a972a85fc…](https://aztecscan.xyz/txs/0x1a972a85fcdde603d61085e54892e617172fb489c4ca233dd7add00b8f27ddf3) | 110 | 13.5s | 4.7s | 4967805117186541506 |  |
| 42 | S4 | H7 redeem_solver after reward timelock | tx | OK | [0x0779b23b72…](https://aztecscan.xyz/txs/0x0779b23b7260fa65f5a21e9649953df29c93f17e6f8928719159e056799d698e) | 113 | 11.3s | 4.7s | 3518473674551132988 |  |
| 43 | S4 | H7 amount+reward went to redeemer | check | OK |  |  |  |  |  | delta=1100 (recipient==redeemer==user) |
| 44 | S4 | H8 [authwit 1000 from solver] | tx | OK | [0x11dee05005…](https://aztecscan.xyz/txs/0x11dee0500523c386f34ecb665c3790222dd4300b383411627c3801ae86ff9515) | 114 | 12.8s | 4.7s | 1248198457598964432 |  |
| 45 | S4 | H8 (reward) [authwit 100 from solver] | tx | OK | [0x004beb7294…](https://aztecscan.xyz/txs/0x004beb7294a3214c36c2b29515e05079b22e912ac0e925cf09f7e3e697f473a7) | 115 | 10.4s | 4.7s | 1248198457598964432 |  |
| 46 | S4 | H8 solver_lock | tx | OK | [0x1b7496156b…](https://aztecscan.xyz/txs/0x1b7496156b56e1f6cb409c0bf1711a877db38f54cb2331f265ffaf5711b7c704) | 116 | 13.4s | 4.7s | 5271423054813673248 |  |
| 47 | S4 | H8 redeem_solver (different reward token) | tx | OK | [0x03bac38c61…](https://aztecscan.xyz/txs/0x03bac38c6135411fdca28647cf605dbc837a4b48bc88f5c066d11581fe2a610e) | 117 | 11.4s | 4.7s | 3648742903191881212 |  |
| 48 | S4 | H8 principal paid in token1 | check | OK |  |  |  |  |  | delta=1000 |
| 49 | S4 | H8 reward paid in token2 | check | OK |  |  |  |  |  | delta=100 |
| 50 | S4 | H9 [authwit 1100 from solver] | tx | OK | [0x1fdf113d04…](https://aztecscan.xyz/txs/0x1fdf113d04ab8655292e59394786b231c1aa2c5feb1e72d95daa875f153e85fe) | 118 | 13.3s | 3.9s | 1229028305612482848 |  |
| 51 | S4 | H9 solver_lock | tx | OK | [0x0499bface1…](https://aztecscan.xyz/txs/0x0499bface1d91cf0ccc16c010dd9110aa7d2b58abfe1482c4c65ac037d9deac5) | 119 | 13.1s | 4.7s | 4891508292305922484 |  |
| 52 | S4 | H9 refund_solver after timelock | tx | OK | [0x08cb9cbe8f…](https://aztecscan.xyz/txs/0x08cb9cbe8f8014b0e93b3ad9de3bdbd73c488a88260e070c34850bf0c04a11a4) | 121 | 12.5s | 4.8s | 3232868074591308456 |  |
| 53 | S4 | H9 amount+reward returned to solver | check | OK |  |  |  |  |  | net solver delta=0 |
| 54 | S4-views | probe lock #1 [authwit 1000 from solver] | tx | OK | [0x255ca4bf93…](https://aztecscan.xyz/txs/0x255ca4bf9366adab58d93b2e528065ea9aeda2fcb9857584f56cbc53829fa78e) | 122 | 11.4s | 4.7s | 1229028305612482848 |  |
| 55 | S4-views | probe lock #1 solver_lock | tx | OK | [0x1c70f6b900…](https://aztecscan.xyz/txs/0x1c70f6b90008c86018d71aaf80c91c5dc66a83150316a0407b00d9ea5110f40d) | 123 | 13.1s | 9.2s | 4890773846010928984 |  |
| 56 | S4-views | probe lock #2 [authwit 1000 from solver] | tx | OK | [0x2f19e151e5…](https://aztecscan.xyz/txs/0x2f19e151e5047c466b29c5b8292fd4718fda4006ea37ba74cca0684659aa01c7) | 124 | 11.9s | 4.9s | 1229028305612482848 |  |
| 57 | S4-views | probe lock #2 solver_lock | tx | OK | [0x05d153b018…](https://aztecscan.xyz/txs/0x05d153b0185114b6ae5fd7b87746de55abd2c7cdf27a2097ccf839d0f920fb9b) | 125 | 13.5s | 3.9s | 4890773846010928984 |  |
| 58 | S4-views | probe indices are 1 and 2 | check | OK |  |  |  |  |  | got 1, 2 |
| 59 | S4-views | get_solver_lock(h, 2) resolves index 2 (PENDING) | check | OK |  |  |  |  |  | status=1 |
| 60 | S4-views | get_solver_lock(h, 99) is EMPTY | check | OK |  |  |  |  |  | status=0 |
| 61 | S4-views | get_user_lock_count(user) = 4 | view | INFO |  |  |  |  |  |  |
| 62 | S4-views | get_user_lock_hash_at(0) -> 0x474950266eef… status=3 | view | INFO |  |  |  |  |  |  |
| 63 | S4-views | get_user_lock_hash_at(1) -> 0x796c28f7f932… status=3 | view | INFO |  |  |  |  |  |  |
| 64 | S4-views | get_user_lock_hash_at(2) -> 0x4569c6c83405… status=2 | view | INFO |  |  |  |  |  |  |
| 65 | S4-views | get_user_lock_hash_at(3) -> 0xd93a139f76e3… status=2 | view | INFO |  |  |  |  |  |  |
| 66 | S4-views | enumeration entries all resolve to existing locks | check | OK |  |  |  |  |  | 4/4 resolve |
| 67 | S5 | user_lock amount=0 | sim-reject | FAIL |  |  |  |  |  | expected "ZeroAmount", got: Assertion failed:  |
| 68 | S5 | user_lock timelock_delta=0 | sim-reject | FAIL |  |  |  |  |  | expected "InvalidTimelock", got: Assertion failed:  |
| 69 | S5 | user_lock expired quote | sim-reject | FAIL |  |  |  |  |  | expected "QuoteExpired", got: Assertion failed:  |
| 70 | S5 | user_lock duplicate hashlock (H1) | sim-reject | FAIL |  |  |  |  |  | expected "SwapAlreadyExists", got: Assertion failed:  |
| 71 | S5 | user_lock zero recipient | sim-reject | FAIL |  |  |  |  |  | expected "ZeroAddress", got: Assertion failed:  |
| 72 | S5 | user_lock bogus payout curve | sim-reject | OK |  |  |  |  |  | rejected with "" |
| 73 | S5 | solver_lock reward_timelock >= timelock | sim-reject | FAIL |  |  |  |  |  | expected "InvalidRewardTimelock", got: Assertion failed:  |
| 74 | S5 | solver_lock zero reward_recipient | sim-reject | FAIL |  |  |  |  |  | expected "ZeroAddress", got: Assertion failed:  |
| 75 | S5 | redeem_user unknown hashlock | sim-reject | FAIL |  |  |  |  |  | expected "LockNotFound", got: Assertion failed:  |
| 76 | S5 | refund_user unknown hashlock | sim-reject | FAIL |  |  |  |  |  | expected "LockNotFound", got: Assertion failed:  |
| 77 | S5 | redeem_solver unknown index | sim-reject | FAIL |  |  |  |  |  | expected "LockNotFound", got: Assertion failed:  |
| 78 | S5 | refund_solver unknown | sim-reject | FAIL |  |  |  |  |  | expected "LockNotFound", got: Assertion failed:  |
| 79 | S5 | redeem_user H1 again (already redeemed) | sim-reject | FAIL |  |  |  |  |  | expected "LockNotPending", got: Assertion failed:  |
| 80 | S5 | U-live [authwit 1000 from user] | tx | OK | [0x2ba5560ecf…](https://aztecscan.xyz/txs/0x2ba5560ecff1bb85cae615f37666f9084413a70a282a52828d1bb9f22f5a539c) | 126 | 11.8s | 3.9s | 1229028305612482848 |  |
| 81 | S5 | U-live user_lock (hashlock 0x3d7d14d6…) | tx | OK | [0x236eff6922…](https://aztecscan.xyz/txs/0x236eff6922cfc80e19ecbe739aebeb5726220c89248a8ba0894bdfd93fffb0f8) | 127 | 12.8s | 4.7s | 6390170438783325684 |  |
| 82 | S5 | redeem_user wrong secret | sim-reject | FAIL |  |  |  |  |  | expected "HashlockMismatch", got: Assertion failed:  |
| 83 | S5 | refund_user early by non-recipient | sim-reject | FAIL |  |  |  |  |  | expected "RefundNotAllowed", got: Assertion failed:  |
| 84 | S5 | U-live cleanup refund by recipient | tx | OK | [0x1158a12872…](https://aztecscan.xyz/txs/0x1158a1287220a46323c392b51dbcaf54cc66e7966257185fc48eef720590d0a9) | 128 | 11.4s | 9.2s | 2950067080549744636 |  |
| 85 | S5 | S-live [authwit 1000 from solver] | tx | OK | [0x27ce55b21e…](https://aztecscan.xyz/txs/0x27ce55b21e17137b61c84c825605dc37e9a4d0016a23e212a2ebf0cb1db14ae9) | 129 | 11.3s | 3.9s | 1229028305612482848 |  |
| 86 | S5 | S-live solver_lock | tx | OK | [0x12ac107fd3…](https://aztecscan.xyz/txs/0x12ac107fd3dd41be3e055ab887c09fd8fcc9de594df41367f45b1844ca3646ec) | 130 | 11.8s | 4.8s | 4890773846010928984 |  |
| 87 | S5 | refund_solver early (even by recipient) | sim-reject | FAIL |  |  |  |  |  | expected "RefundNotAllowed", got: Assertion failed:  |
| 88 | S5 | S-live cleanup redeem | tx | OK | [0x2e741b6bf5…](https://aztecscan.xyz/txs/0x2e741b6bf50a63a7141dc9428396cf3a85d9f466f72ec7cb6aa7766fe1a2b4e4) | 131 | 10.5s | 4.9s | 3464447804758298928 |  |
| 89 | S6 | R1 [authwit 1000 from user] | tx | OK | [0x17270160f0…](https://aztecscan.xyz/txs/0x17270160f0f389102dd537279f8baaf7542473ec1273173313448723bee1eab3) | 132 | 10.6s | 9.2s | 1250842307113151016 |  |
| 90 | S6 | R1 user_lock (hashlock 0x36e11b31…) | tx | OK | [0x0b4824d739…](https://aztecscan.xyz/txs/0x0b4824d73985a445e9d7e66c52db2b24138ff0f100e74bc85af39623798ecfb6) | 133 | 10.1s | 4.7s | 6503589460057760553 |  |
| 91 | S6 | R1 exactly one redeem succeeded | check | FAIL |  |  |  |  |  | outcomes: [error: Error: Tx 0x0aafa88a97efebde51f90407a8339ba941103413f1993c2cec000ed78a254850 dropped: Tx dropped by P2P node / error: Error: Tx 0x0aec6b772aaaa818b012e69ebeebc64683eb50c798c2837d547a173fa8e2c13e dropped |
| 92 | S6 | R2 [authwit 1000 from solver] | tx | OK | [0x1c691f6e81…](https://aztecscan.xyz/txs/0x1c691f6e81ff1c128ebeb5c8f09e611b31c2376bdebe1fdfc46e3929371a9f0a) | 132 | 12.1s | 4.7s | 1250842307113151016 |  |
| 93 | S6 | R2 solver_lock | tx | OK | [0x0f2530ed1b…](https://aztecscan.xyz/txs/0x0f2530ed1b34951acdb4bfd0287cf4182e948a1fa4b15e35d551fe2f7c40c998) | 133 | 11.9s | 4.7s | 4977580103872617278 |  |
| 94 | S6 | R2 refund_solver (solver) | tx | OK | [0x04fc1f148c…](https://aztecscan.xyz/txs/0x04fc1f148c3a47e2bcc6b5582639da7627f082670cd595679ef5e18cd4b04585) | 135 | 17.9s | 4.5s | 3290110655770014609 |  |
| 95 | S6 | R2 redeem_solver (user) | tx | REVERTED | [0x0fb824d6ee…](https://aztecscan.xyz/txs/0x0fb824d6ee1481725bba0274997bd2dfc33d763710e8591ac976151feb82ab79) | 136 | 17.9s | 9.1s | 1762767791751820541 | on-chain revert: reverted |
| 96 | S6 | R2 exactly one of redeem/refund succeeded | check | OK |  |  |  |  |  | outcomes: [REVERTED / OK] — loser REVERTED ON CHAIN |

## Summary

- rows: 96
- mined txs: 48
- on-chain reverted (expected): 1
- sim-rejected (expected): 1
- FAILURES: 16 — #67 user_lock amount=0, #68 user_lock timelock_delta=0, #69 user_lock expired quote, #70 user_lock duplicate hashlock (H1), #71 user_lock zero recipient, #73 solver_lock reward_timelock >= timelock, #74 solver_lock zero reward_recipient, #75 redeem_user unknown hashlock, #76 refund_user unknown hashlock, #77 redeem_solver unknown index, #78 refund_solver unknown, #79 redeem_user H1 again (already redeemed), #82 redeem_user wrong secret, #83 refund_user early by non-recipient, #87 refund_solver early (even by recipient), #91 R1 exactly one redeem succeeded
