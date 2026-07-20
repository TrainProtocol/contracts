# Train HTLC Solana devnet E2E report

Started: 2026-07-20T16:41:37.896Z
Finished: 2026-07-20T16:45:22.638Z

## Environment

- **cluster**: devnet
- **rpc**: https://api.devnet.solana.com
- **train_htlc**: [2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ](https://explorer.solana.com/address/2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ?cluster=devnet)
- **constant_payout_curve**: [Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF](https://explorer.solana.com/address/Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF?cluster=devnet)
- **mock_decay_curve**: [wmgDCMVreZ5xKv8NTg8rmkGPpb7bs5FHiToxqjc5yMr](https://explorer.solana.com/address/wmgDCMVreZ5xKv8NTg8rmkGPpb7bs5FHiToxqjc5yMr?cluster=devnet)
- **relayer / fee-payer / redeemer (DEFAULT_KEY)**: [AR7DUwfrf17iir72oauSPJMqgYzboALej8a7f9yqnA4F](https://explorer.solana.com/address/AR7DUwfrf17iir72oauSPJMqgYzboALej8a7f9yqnA4F?cluster=devnet)
- **user / source depositor (SOLVER_KEY)**: [BKTxkxMsNpKmmtzKpA4c3gp6B8wvPrTDGJFp2mp1Gw6u](https://explorer.solana.com/address/BKTxkxMsNpKmmtzKpA4c3gp6B8wvPrTDGJFp2mp1Gw6u?cluster=devnet)
- **solver / destination depositor (THIRDPARTY_KEY)**: [8nvF65SJpPuJ36shzCNqZ3rtcz33cqsBpWsLyfaF6c8A](https://explorer.solana.com/address/8nvF65SJpPuJ36shzCNqZ3rtcz33cqsBpWsLyfaF6c8A?cluster=devnet)
- **explorer**: https://explorer.solana.com

Actor separation: every lock uses `payer = fee-payer` and `sender = depositor`, so the token/SOL depositor authorizes the debit but never pays fees or rent — the gas payer and the depositor are always distinct wallets. recipient / refund_to / reward_recipient are the natural swap counterparty among the three keys.

## Build and local verification

- anchor build: passed
- anchor test (localnet): 61 passing / 0 failing

## Deployment status

- train_htlc + constant_payout_curve + mock_decay_curve deployed on devnet at the IDs above.
- intent domain (rail C): initialized.

## Transactions & checks

| # | Stage | Name | Kind | Status | Tx | Slot | Note |
|---|-------|------|------|--------|----|------|------|
| 1 | S0 | balances | info | INFO |  |  | feePayer=9.827544 SOL user=0.977309 SOL solver=1.006475 SOL |
| 2 | S1 | mints created | info | INFO |  |  | mintA=6YFaad7BEP4T5f6pXdB7ZjzhjFz2kdpxXA5fSUCmJN5Q mintB=WWRdAaEFeRitwsdo1GySfKELcHFB287vZsJWpq9rnp6 |
| 3 | S2 | user_lock_sol amount=0 | tx | REVERTED | [45MtHdMv7Z…](https://explorer.solana.com/tx/45MtHdMv7Z6MoLE1BeBBPUktYwW5pXDVvssxwz8SziUD1qUwLQ3NULKWTmTPmmYMeSjCAjQZMRutXAymcBh8en32?cluster=devnet) | 477656749 | rejected on-chain with "ZeroAmount" |
| 4 | S2 | user_lock_sol quote expired | tx | REVERTED | [zZyiHRLChh…](https://explorer.solana.com/tx/zZyiHRLChhhTv2rFY2rZBP4hGMaPYvRtjDTYjx2vAhEni4weLkFqTrmQRW6aiCk6PFuL9zVjwZENgRYaV7wRuV5?cluster=devnet) | 477656751 | rejected on-chain with "QuoteExpired" |
| 5 | S2 | user_lock_sol refund_to=default (ZeroAddress) | tx | REVERTED | [2QEUHFLRme…](https://explorer.solana.com/tx/2QEUHFLRmeZ1SEU6UUmqSvCe4moLQYNq4itQCD2o8FRSMAodvV7DW8PPaZjFQC1xwn9WGRSivAeHsRQHVCaeBv2K?cluster=devnet) | 477656759 | rejected on-chain with "ZeroAddress" |
| 6 | S2 | user_lock_sol | tx | OK | [2Lg22spNgC…](https://explorer.solana.com/tx/2Lg22spNgCUtREBzqhkhXXUvm5TiMzXQn7LnBPckqar2mFRBHU4ghHEvkHELjVpjtNpER4jrzLe4ukXohGCvLQ9J?cluster=devnet) | 477656765 | sender=user amount=2000000 |
| 7 | S2 | lock attributed to user | check | OK |  |  | sender=BKTxkxMsNpKmmtzKpA4c3gp6B8wvPrTDGJFp2mp1Gw6u |
| 8 | S2 | rent_payer = feePayer | check | OK |  |  | sponsor pays rent |
| 9 | S2 | redeem_user_sol wrong secret | tx | REVERTED | [5mz3rbAYvf…](https://explorer.solana.com/tx/5mz3rbAYvfrkJaUMjNz2fT2Ap6pB2iJXLS7wR9BNmPafDyLz9WDVrxPdwnAW6ebqybNrUbw8xFJRUFVUnMkGmpKi?cluster=devnet) | 477656768 | rejected on-chain with "HashlockMismatch" |
| 10 | S2 | redeem_user_sol | tx | OK | [5Dz7uzVc12…](https://explorer.solana.com/tx/5Dz7uzVc127ibcbW5Y8hezQVHypSm8Te7ioe46hVEgrN3JAgEE7EXMDqvmcqWhs6bXeLAUQnY7D669E6Xnv4YDC?cluster=devnet) | 477656772 | caller=relayer, pays recipient |
| 11 | S2 | recipient +amount | check | OK |  |  | delta=2000000 |
| 12 | S3 | user_lock_sol | tx | OK | [4FNagDp2zZ…](https://explorer.solana.com/tx/4FNagDp2zZX7PJ9NZxK696Kam4zSVaqCkKHf5Nfz3P3voiz2L5tEcGpPWMt3BKN7rhd6eEWFH8TXXcfpjEGcNCZa?cluster=devnet) | 477656775 | timelock=25s |
| 13 | S3 | refund_user_sol premature (non-recipient) | tx | REVERTED | [5PsRx3PNsa…](https://explorer.solana.com/tx/5PsRx3PNsaWpeYgmPAwyuKeigHBSVmwAAGxHvv8KYNHeUyetmyLsTh3M2wAUKAE5p4pqyKGTdBU6iadKEgMKENUC?cluster=devnet) | 477656778 | rejected on-chain with "TimelockNotExpired" |
| 14 | S3 | waiting out timelock | info | INFO |  |  | 30s |
| 15 | S3 | refund_user_sol | tx | OK | [2KxUiBKdM4…](https://explorer.solana.com/tx/2KxUiBKdM4LFA5npVpRPDyiKxPAyyjk1fU5bqNQ5dj679kPe7iB6Pfup1pTJzd9LPKLyRXPJJvzLVNoAiiU13uX2?cluster=devnet) | 477656871 | caller=relayer after timelock |
| 16 | S3 | refund_to (user) +amount | check | OK |  |  | delta=1500000 |
| 17 | S4 | user_lock_token | tx | OK | [XfqvYdPq7D…](https://explorer.solana.com/tx/XfqvYdPq7DRhiYdqsRAMKLnkVweaHRMJb99r6tYE66dkhKHyuKbnw5YtAhXF8oMmufep9775iWFwzmEmaMXFiR9?cluster=devnet) | 477656873 | amount=250000 mintA |
| 18 | S4 | vault holds amount | check | OK |  |  | vault=250000 |
| 19 | S4 | redeem_user_sol on token lock (variant confusion) | tx | REVERTED | [38KumdEwmn…](https://explorer.solana.com/tx/38KumdEwmnErhGKsUfA2BtZ1j7VFD4NuwFYG19gt2qBca2MfZksQZygH1tnRikpCbDSdxwFPKi54rjYnzarWgodY?cluster=devnet) | 477656876 | rejected on-chain with "WrongToken" |
| 20 | S4 | redeem_user_token | tx | OK | [sEnLFLPxmA…](https://explorer.solana.com/tx/sEnLFLPxmAd2UdnUZEndK5DhzKgoLSe5FKP4jxDJxVcmFUqKKHQzY519EnZ4e4XDjmoUZoFm185WGfs7JpXtewS?cluster=devnet) | 477656878 | recipient=solver ATA |
| 21 | S4 | recipient ATA credited | check | OK |  |  | ok |
| 22 | S5 | user_lock_token | tx | OK | [5ricySwqz9…](https://explorer.solana.com/tx/5ricySwqz9Dq59CETULqb3zw2JHHjwm7zhmQVYZ3jsGe4p3aNzM2ivAjkro3aSqsYz6g19Vwaz9UcNYULfvcZ5cz?cluster=devnet) | 477656885 | timelock=25s |
| 23 | S5 | user_lock_token duplicate hashlock | tx | REVERTED | [63iP5xXHoR…](https://explorer.solana.com/tx/63iP5xXHoRFLdNysnJJsZRpUgGch7qojxJ8c7kyjgsKogd9fuduVPPnncgKmipt8u1CsjHm6pCb7PbL5XN7Rydy4?cluster=devnet) | 477656888 | rejected on-chain with "already in use" |
| 24 | S5 | waiting out timelock | info | INFO |  |  | 30s |
| 25 | S5 | refund_user_token | tx | OK | [4ZM7YBseaL…](https://explorer.solana.com/tx/4ZM7YBseaLMSDnhkmUTZ4tzKDfNGXt6tBiSwXkqF1BzQqMVTJAGdYdDpxxTTJqWVtuXDwLGqYadapSVz7xy1RnQ6?cluster=devnet) | 477656983 | refund_to=user ATA |
| 26 | S5 | status refunded | check | OK |  |  | lock closed |
| 27 | S6 | solver_lock_sol index=5 out of order | tx | REVERTED | [551bZEqtxe…](https://explorer.solana.com/tx/551bZEqtxe9hM3gCfXhMXq7WCFRGXcAmQYCaZFWMg5Kc3CJvXpYNPYE95qDhqiemwvWLPnZ5TfwswZycwvABfyMx?cluster=devnet) | 477656986 | rejected on-chain with "InvalidIndex" |
| 28 | S6 | solver_lock_sol reward tl >= tl | tx | REVERTED | [3PrTKhdLsY…](https://explorer.solana.com/tx/3PrTKhdLsYF868Q4MkR7cMDYpTk43tyDmHNKwmJSYhPehybfpQm3i4dhiksrbLXKkWYF2N97Jmejf4vJxzCFMHhM?cluster=devnet) | 477656988 | rejected on-chain with "RewardTimelockNotLessThanTimelock" |
| 29 | S6 | solver_lock_sol | tx | OK | [5M1U18vhyS…](https://explorer.solana.com/tx/5M1U18vhyS7jg6s9xwBA6pm9FCZ5Dv7H8FaBMZQkE8onNySJLE3SsNZGkNESgoSiHUEL8kVGy7994BsXtizH9F2q?cluster=devnet) | 477656990 | amount=1200000 reward=300000 |
| 30 | S6 | redeem_solver_sol | tx | OK | [4WSB4ycosX…](https://explorer.solana.com/tx/4WSB4ycosXuMg3wKhzxdMvLY8ga8CQS8hTs5aVcdvW7PFxCBXYCSKeFXFMweiCDaKoJQS6c634XP83kyt132o8zb?cluster=devnet) | 477656993 | reward→reward_recipient (pre-timelock) |
| 31 | S6 | recipient (user) +amount | check | OK |  |  | delta=1200000 |
| 32 | S6 | reward_recipient (solver) +reward | check | OK |  |  | delta=300000 |
| 33 | S6 | redeem_solver_sol double redeem | tx | REVERTED | [28DHsqUtMj…](https://explorer.solana.com/tx/28DHsqUtMjuffwQxTbiKmzeuFM6SAPQ9XwFZQxRDz17CrUcgRtK126FrE6XBLp3YrUQKE7kvQtt67oRsqeU8ooX4?cluster=devnet) | 477656996 | rejected on-chain with "NotPending" |
| 34 | S6 | close_solver_lock | tx | OK | [4o2Ttaedw1…](https://explorer.solana.com/tx/4o2Ttaedw1TRqLEcdWZp3bMkAtDE98uLR9QPtREMEeecZ4A6RBND1kwkz8rjkL9u6DKZ1WAbUR52h3PLxafx2qYe?cluster=devnet) | 477656999 | rent→rent_payer |
| 35 | S7 | solver_lock_sol | tx | OK | [4Medwg4JbG…](https://explorer.solana.com/tx/4Medwg4JbGa6A2U5VhozjTwU4T1qAozJ2PBG44fHKKNWbDfWKXtACLBSV4ajwfcUXk1hM8jaiutxoaxDy86UHefi?cluster=devnet) | 477657002 | rewardTimelock=25s |
| 36 | S7 | waiting out reward timelock | info | INFO |  |  | 30s |
| 37 | S7 | redeem_solver_sol (late) | tx | OK | [4ViQj4DZ1v…](https://explorer.solana.com/tx/4ViQj4DZ1vrcpC6XeXJN5WffPq3evhT92Aq2kpuwjNQCSj5UdMthNJiMCz6AjYsoTMbKaXuosm6fHKKfcz7JsmoE?cluster=devnet) | 477657093 | reward→caller bounty (post-timelock) |
| 38 | S7 | caller received reward bounty | check | OK |  |  | caller +reward (minus fee) |
| 39 | S8 | solver_lock_token #1 | tx | OK | [23zXtQop4o…](https://explorer.solana.com/tx/23zXtQop4oajE1LrMbiZ4aUZez2CJEq4Qpq9n3PeHc8Lv4hv8cnVC3NxV2roQionc32y5KmpXYVnThKYmq95TeC1?cluster=devnet) | 477657099 | single vault amount+reward |
| 40 | S8 | solver_lock_token #2 | tx | OK | [4Mgv9kq851…](https://explorer.solana.com/tx/4Mgv9kq851JhntANh8sZwRT2wazaLC3DGmXi6uqSU8A6ZUGRthzNfHEgCn5weqwsc2hE38nEZ17icSKn5TrNBCx9?cluster=devnet) | 477657101 | for refund |
| 41 | S8 | redeem_solver_token #1 | tx | OK | [543CzAVfwE…](https://explorer.solana.com/tx/543CzAVfwEtp4KbQ6oVJBHznUmzeXe7ADdjtB3aA4PXLEcnEdZ4ewckcERA5DAM1GascwS5RXpzBfGAxQHFGRKGn?cluster=devnet) | 477657103 | recipient + reward_recipient |
| 42 | S8 | refund_solver_token premature | tx | REVERTED | [43L9LacFAL…](https://explorer.solana.com/tx/43L9LacFALWQwLBvdFnNRW6TcZuydzVdRRvrQUEK3ZhqVDAM5P3ZTN4kYzNQ3kadTcvzYe5DFLeEJMhVzNjvk7hQ?cluster=devnet) | 477657105 | rejected on-chain with "TimelockNotExpired" |
| 43 | S8 | waiting out timelock | info | INFO |  |  | 30s |
| 44 | S8 | refund_solver_token #2 | tx | OK | [5D54DmbvHE…](https://explorer.solana.com/tx/5D54DmbvHEJSHkfFRbeUpxCukP5ie1x6dieaZmrk1xEGijF2bwsHqJzdxQtDKZPT3HNTf2e1XSDeFNXTp4RnActR?cluster=devnet) | 477657196 | refund_to=solver ATA |
| 45 | S9 | solver_lock_token_diff_reward identical mints | tx | REVERTED | [bRG2Ya39mb…](https://explorer.solana.com/tx/bRG2Ya39mbVShtnXEAvMXyjYANS4u9EiHAj3VEHRPY7zrd4Ef2Nc7FM9WutRarTN8yD2ifjPdD1aPTxgzhb1eNy?cluster=devnet) | 477657198 | rejected on-chain with "WrongToken" |
| 46 | S9 | solver_lock_token_diff_reward | tx | OK | [3hrHdfB9rM…](https://explorer.solana.com/tx/3hrHdfB9rMfYWKQJp3qjxzfzhqXtyyLhEk6J47xsF5v5qaWaY5QkQq9Eru9RbFbFYbEyYLSVoonDUZrfNktfcRxv?cluster=devnet) | 477657200 | two vaults mintA + mintB |
| 47 | S9 | redeem_solver_token_diff_reward | tx | OK | [2gzD6KWpsF…](https://explorer.solana.com/tx/2gzD6KWpsFUwn1jNuAGAfyU5mzjyk23JQH871jNG5L8ZRjwSLaxaVvorUfMgJ8V3dfhXh2b5FMAWL1z2Y1T8XQXW?cluster=devnet) | 477657202 | recipient mintA + reward mintB |
| 48 | S10 | user_lock_sol mismatched curve | tx | REVERTED | [5AHchYqsR1…](https://explorer.solana.com/tx/5AHchYqsR1mE4EweeP12XjW5HbCev59NeyxWkwqKnPB2bvS3wK8fiGvFWmkTMfVGLnmp22DmgUQgwdWiXU5PZ1VN?cluster=devnet) | 477657204 | rejected on-chain with "InvalidPayoutCurve" |
| 49 | S10 | user_lock_sol (constant curve) | tx | OK | [2YpTQe1BPp…](https://explorer.solana.com/tx/2YpTQe1BPppwBHxb4AQSRSFuY4hjpdeNVNHk6gRjuCCnKt9PpNPZEuF2C2eA1qAcGwgX5Ze3dQ3C5qRTbRTBRroM?cluster=devnet) | 477657207 | curve=constant |
| 50 | S10 | redeem_user_sol (constant curve) | tx | OK | [5kUgiEEhgF…](https://explorer.solana.com/tx/5kUgiEEhgFSNwCahaFmTyxXVXnjgeVuKzyzyR2YTDSH2sZTtcisXxNRZnGShBRvPXFYchpJqaQX8Yf8nYH8tFfo5?cluster=devnet) | 477657210 | payout=amount, excess=0 |
| 51 | S10 | recipient +full amount | check | OK |  |  | delta=1000000 |
| 52 | S11 | user_lock_sol (decay curve) | tx | OK | [361wDTFVAs…](https://explorer.solana.com/tx/361wDTFVAsCZSzmH5qS8LnKtz544vaB9BSLBCnGFSzwyh3nwus8WmKJ5pMaE4eNQWV7YK3h7Wu6cKNaYnKtpDi7z?cluster=devnet) | 477657212 | curve=decay (payout=amount/2) |
| 53 | S11 | redeem_user_sol (decay curve) | tx | OK | [5tagKSjqkY…](https://explorer.solana.com/tx/5tagKSjqkYo4hG32BKHPYd56gFYhEq8ECmrYBQfps96AWoGS7jYQmgCK7aMvDCMGCbZCGRTM5jGEthhMH1f5yyV9?cluster=devnet) | 477657227 | payout+excess split |
| 54 | S11 | recipient +payout(amount/2) | check | OK |  |  | delta=1000000 |
| 55 | S11 | refund_to +excess(amount/2) | check | OK |  |  | delta=1000000 |
| 56 | S11 | user_lock_sol (0-bps curve) | tx | OK | [sde1Yctn3S…](https://explorer.solana.com/tx/sde1Yctn3SrDjEmQgXeddchFh9xBKc5usrZftd2TNtVH5gpWDTZm2Yza1JJBk9x2od4kD5GGThvuNegnR7Fy9cL?cluster=devnet) | 477657230 | will fail redeem |
| 57 | S11 | redeem_user_sol zero payout | tx | REVERTED | [4bfG5f2Hm5…](https://explorer.solana.com/tx/4bfG5f2Hm5iGfZhk8pxLgMnkj7DAKU9atMmVGrV1qUzNVCeKnEhSpr5xp2RK9phsndmwNLyLRwRhk5yRLAYBPqmR?cluster=devnet) | 477657235 | rejected on-chain with "InvalidPayout" |
| 58 | S12 | rail A tampered tx | sim-reject | OK |  |  | rejected pre-landing (ature) — no on-chain tx by construction |
| 59 | S12 | sponsored user_lock_sol | tx | OK | [4iyfPAhDcq…](https://explorer.solana.com/tx/4iyfPAhDcqb2f6PfWTGbTFVcLL8rby8sP5Cc9c5obm43oj3sQPbv7qxp7aPTVeRdbDJzobr8NGuJmgtr69xLeiZj?cluster=devnet) | 477657242 | user co-signs, relayer pays |
| 60 | S12 | depositor paid only amount (no fees) | check | OK |  |  | delta=1000000 |
| 61 | S12 | rent_payer = relayer | check | OK |  |  | relayer paid rent |
| 62 | S12 | rail A replay | sim-reject | OK |  |  | rejected pre-landing (already) — no on-chain tx by construction |
| 63 | S12 | redeem_user_sol | tx | OK | [5dcgpAM1xY…](https://explorer.solana.com/tx/5dcgpAM1xYscoYzTg3SBjdwR86yuUcXB66t4g6nnVxzgAeP3KFxgFEpvyQLJR4JoiKrfRp2eYjakK822nUUhYKv5?cluster=devnet) | 477657247 | settle |
| 64 | S13 | create durable nonce account | tx | OK | [NX6J2FnNZi…](https://explorer.solana.com/tx/NX6J2FnNZi2gbWggSHGvhVZ2Ss6cHdzZzU7jV1FdjJmaLU85eXksLxKg2cYzrf2K2fmUmAL66XESJMrwxZBfqqY?cluster=devnet) | 477657250 | authority=relayer |
| 65 | S13 | simulating offline delay | info | INFO |  |  | 2s |
| 66 | S13 | durable-nonce user_lock_sol | tx | OK | [4b2QC2Zfw6…](https://explorer.solana.com/tx/4b2QC2Zfw6uhKwEbKpg8P9XECVx2rcZ6WwWKNCqVCwurSMRCGxB2X37JKuxxVhoUdz7MmMhokEMW5zE1YtVhKeSM?cluster=devnet) | 477657258 | offline-signed, deferred submit |
| 67 | S13 | rail B nonce replay | sim-reject | OK |  |  | rejected pre-landing () — no on-chain tx by construction |
| 68 | S13 | redeem_user_sol | tx | OK | [5uGToShXG4…](https://explorer.solana.com/tx/5uGToShXG4Q8kvWsRBQ2LHKr23wGoxzGi6iuHxdKmff4E9HXpKhqmqShJ8VhAaRWf6jk1bWwBQDSbs6AqHwYs5Xk?cluster=devnet) | 477657261 | settle |
| 69 | S14 | approve delegate (one-time) | tx | OK | [27YRpisRW8…](https://explorer.solana.com/tx/27YRpisRW82ygjKHgyKx1zAwbGhk4B5HwG6C2kGVGDcR5piuAtWGrnvcF11tGRdVwGSbNM2eKRg6PfANNtBjjboc?cluster=devnet) | 477657263 | user delegates to program PDA |
| 70 | S14 | rail C expired intent | tx | REVERTED | [zadRGa3sMK…](https://explorer.solana.com/tx/zadRGa3sMKaGxrxdLYQ9o4iFDnzQZcMkcGNd8mJcgcvn1StZQZzgqgWQbNk3gUCS75u1susN5UZm46ek73bqsmb?cluster=devnet) | 477657265 | rejected on-chain with "IntentExpired" |
| 71 | S14 | intent user_lock_token | tx | OK | [3ayiDCoQYp…](https://explorer.solana.com/tx/3ayiDCoQYpoPpyEgbyX6GnkD2AmAJ944JfzTwxP9spETDowhmSfvbs7siJNmyJyBiq9RX9FMDZ8eWSMKULvgCGZV?cluster=devnet) | 477657268 | user signed only a message |
| 72 | S14 | lock attributed to user | check | OK |  |  | sender=user |
| 73 | S14 | rent_payer = relayer | check | OK |  |  | relayer paid rent |
| 74 | S14 | pulled exactly amount | check | OK |  |  | delta=60000 |
| 75 | S14 | rail C tampered params | tx | REVERTED | [1LKmGcEtBE…](https://explorer.solana.com/tx/1LKmGcEtBE3P3sMgdvqZEcKQzRCiQ71vsv3mQWDKfiCkCRzQUECqFpKpfjf2rdKrmiVXVEXze61Wf4ayVRZpsar?cluster=devnet) | 477657271 | rejected on-chain with "InvalidIntentSignature" |
| 76 | S14 | redeem_user_token | tx | OK | [2Ta1oTnwFK…](https://explorer.solana.com/tx/2Ta1oTnwFKqVaxVgti3JiYBNT1SaEi2X6S7JAKhY6rc8faKdUMfDVLMGaQeyVxDG7fQxLnbXm8Nu5ZeYt4NjHa51?cluster=devnet) | 477657273 | settle the intent lock |
| 77 | S14 | rail C intent replay (post-settle) | tx | REVERTED | [GDyPJ8Uvp2…](https://explorer.solana.com/tx/GDyPJ8Uvp2Yti2fqBk8yJVsZuwKLmnUUHJKNFpXtWgQY3KLRMWbrR5rDpUBjwn4vy8ke2VS4hiAbqgPwqNnYnNm?cluster=devnet) | 477657278 | rejected on-chain with "already in use" |
| 78 | S15 | intent user_lock_token | tx | OK | [4WdTw1ukMA…](https://explorer.solana.com/tx/4WdTw1ukMAQwhBk1F6iU6hEvGChhfFUCZujoYRWAnUMZeWyG8xu3EUsx9UPXgVRrdAMrhyKjmhBzr17cY7mLX6un?cluster=devnet) | 477657280 | deadline in 8s, nonce=1784565697848 |
| 79 | S15 | close_consumed_intent before deadline | tx | REVERTED | [56dcDqGumH…](https://explorer.solana.com/tx/56dcDqGumHcuyvTMWyE1Fn8i9N8oYtivT4kH3n6EsDpSFk6qf4EX813z9AhDyf3nQc1CubFLZvP1cs8F2RM8W3bT?cluster=devnet) | 477657285 | rejected on-chain with "IntentNotExpired" |
| 80 | S15 | waiting out intent deadline | info | INFO |  |  | 10s |
| 81 | S15 | close_consumed_intent | tx | OK | [5SMZSddBAi…](https://explorer.solana.com/tx/5SMZSddBAiTbwfDMXbgS29Zt7HG9NA6nzQgxvXsD61Qcj1i2S9rFgnXj2Z3NPZZvSzGPJ5su8K5MHgJ7H9Q7E4NG?cluster=devnet) | 477657321 | rent→relayer after deadline |
| 82 | S16 | user_lock_sol | tx | OK | [5DQCHNt6Qk…](https://explorer.solana.com/tx/5DQCHNt6QkX81XaSrBLvzGKX5EytfqmWdCrdPGGJYiXNkRjjCMxHzjdezLBMwmFVXDMrvZUeej2yPm5GzTF3jiJ2?cluster=devnet) | 477657324 | for view |
| 83 | S16 | get_user_lock returns fields | check | OK |  |  | amount=500000 refundTo=user |
| 84 | S16 | solver_lock_sol | tx | OK | [3Dfw6YDGU3…](https://explorer.solana.com/tx/3Dfw6YDGU3zgQSgT1BdhpS9rj3nr8ZZzaYv2aa4eTyy8ZYXPpgD6ARAayXnSmgSTV336DgPY1J6tKE2WyhQC3NHD?cluster=devnet) | 477657328 | pending, for close negatives |
| 85 | S16 | close_solver_lock while pending | tx | REVERTED | [41moSKyan2…](https://explorer.solana.com/tx/41moSKyan2P71J2mb3iCNcKDJoYb6wbsMKgspVsfrw6c6zaAJzoWcUWTMbys1SXX9S4L7NU81rdiKABsgKDL1C94?cluster=devnet) | 477657331 | rejected on-chain with "StillPending" |
| 86 | S16 | S16 note | info | INFO |  |  | the pending solver lock is left on-chain (refundable after its timelock); not an error |

## Summary

- rows: 86
- landed txs (success): 36
- on-chain reverted (expected, negative cases): 19
- pre-landing rejections (signature/replay/nonce level, no tx by construction): 3
- FLOW FAILURES: 0

All happy paths and negative cases behaved as expected. Every landable negative case is recorded above as an on-chain `REVERTED` transaction with its explorer link; the pre-landing rejections cannot produce a transaction (they are rejected by the runtime before inclusion) and are noted as such.
