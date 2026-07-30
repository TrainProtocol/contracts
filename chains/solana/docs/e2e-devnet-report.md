# Train HTLC Solana devnet E2E report

Started: 2026-07-30T14:22:38.838Z
Finished: 2026-07-30T14:27:54.619Z

## Environment

- **cluster**: devnet
- **rpc**: https://api.devnet.solana.com
- **train_htlc**: [2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ](https://explorer.solana.com/address/2cQYFAiud2LBg3r6MxKPJ1oS83yyrRwDsgxQSwhL97LJ?cluster=devnet)
- **constant_payout_curve**: [Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF](https://explorer.solana.com/address/Dp4ReoYGG8VRXpnst4vT8g6UDVwUicJwAuiikQWk8HMF?cluster=devnet)
- **mock_decay_curve**: [wmgDCMVreZ5xKv8NTg8rmkGPpb7bs5FHiToxqjc5yMr](https://explorer.solana.com/address/wmgDCMVreZ5xKv8NTg8rmkGPpb7bs5FHiToxqjc5yMr?cluster=devnet)
- **relayer / fee-payer / redeemer (DEFAULT_KEY)**: [AR7DUwfrf17iir72oauSPJMqgYzboALej8a7f9yqnA4F](https://explorer.solana.com/address/AR7DUwfrf17iir72oauSPJMqgYzboALej8a7f9yqnA4F?cluster=devnet)
- **user / source depositor (SOLVER_KEY)**: [2wrZCWSsY1WSSEbR8D1LAW6KECiEVUDiQ95FDDLUi1Wc](https://explorer.solana.com/address/2wrZCWSsY1WSSEbR8D1LAW6KECiEVUDiQ95FDDLUi1Wc?cluster=devnet)
- **solver / destination depositor (THIRDPARTY_KEY)**: [tzuJKcbVgqA3xqND59q1R4otF87or1kWWDGfjHP6A8p](https://explorer.solana.com/address/tzuJKcbVgqA3xqND59q1R4otF87or1kWWDGfjHP6A8p?cluster=devnet)
- **explorer**: https://explorer.solana.com

Actor separation: every lock uses `payer = fee-payer` and `sender = depositor`, so the token/SOL depositor authorizes the debit but never pays fees or rent — the gas payer and the depositor are always distinct wallets. recipient / refund_to / reward_recipient are the natural swap counterparty among the three keys.

## Build and local verification

- anchor build: passed
- anchor test (localnet): 64 passing / 0 failing (anchor test, localnet)

## Deployment status

- train_htlc + constant_payout_curve + mock_decay_curve deployed on devnet at the IDs above.
- intent domain (rail C): initialized.

## Transactions & checks

| # | Stage | Name | Kind | Status | Tx | Slot | Note |
|---|-------|------|------|--------|----|------|------|
| 1 | S0 | fund ephemeral user | tx | OK | [42Y4Kf3UW8…](https://explorer.solana.com/tx/42Y4Kf3UW8hpBwcVrRMhy5L8Rz8T1Y5oafg2MgVojQtLS2jLJ8QpyNXLfykToNn5NreoPnN5j3d9qJ6jmMqE1XcF?cluster=devnet) | 479990796 | 0.100000 SOL |
| 2 | S0 | fund ephemeral solver | tx | OK | [3e4fihVrca…](https://explorer.solana.com/tx/3e4fihVrcagRKHmUP3fQKaxcN4hxiCCZeJQ1KbK8K848aAWoDSiLoo7pc7Pf3BMgumEJhJWXEcAXeLNVqBfFLH8M?cluster=devnet) | 479990799 | 0.100000 SOL |
| 3 | S0 | balances | info | INFO |  |  | feePayer=13.094242 SOL user=0.100000 SOL solver=0.100000 SOL |
| 4 | S1 | mints created | info | INFO |  |  | mintA=Fs1fY4XbwYyWSVNx3oxKcotBoE6rfAb5JdtmaeRMXmtJ mintB=9uAaGQ1qZC7ETrgkNhwbSyZuA3RT7npBdbbwjdPFMvBA |
| 5 | S2 | user_lock_sol amount=0 | tx | REVERTED | [2RPbk71kKD…](https://explorer.solana.com/tx/2RPbk71kKDR44sF9xkdwDWcSx3cUxXrUWuhmFiNW4YfhjsmMcMzLQ3X797b1jZVDbR5NUT68UE5YqQGxYrivES4Y?cluster=devnet) | 479990840 | rejected on-chain with "ZeroAmount" |
| 6 | S2 | user_lock_sol quote expired | tx | REVERTED | [2oPKBHRW8D…](https://explorer.solana.com/tx/2oPKBHRW8DbLM5rxPnXtjqoHLCeBzto1UCAgXMzsEPCMfi16LvUwDz2zmxYGrB7UvefbE6dz3LPJXNHgXRceRgtE?cluster=devnet) | 479990843 | rejected on-chain with "QuoteExpired" |
| 7 | S2 | user_lock_sol refund_to=default (ZeroAddress) | tx | REVERTED | [3MtA6mz5EN…](https://explorer.solana.com/tx/3MtA6mz5ENHE1FAqUcSEbrRdTspxVUbbPGQjLFv6tBGwptDyLnErbZ34Cid7uCV8psFgfn5W3HpgLnt6PeNsXhFE?cluster=devnet) | 479990845 | rejected on-chain with "ZeroAddress" |
| 8 | S2 | user_lock_sol | tx | OK | [y1ezAHo5y6…](https://explorer.solana.com/tx/y1ezAHo5y6iKtqesdESwXxrzXLnuAjUnVXHWHKAJniJyRWZbtbTYxRNynXDEXCb3VFbexXeRiza2AsZMruTt5AM?cluster=devnet) | 479990847 | sender=user amount=2000000 |
| 9 | S2 | lock attributed to user | check | OK |  |  | sender=2wrZCWSsY1WSSEbR8D1LAW6KECiEVUDiQ95FDDLUi1Wc |
| 10 | S2 | rent_payer = feePayer | check | OK |  |  | sponsor pays rent |
| 11 | S2 | redeem_user_sol wrong secret | tx | REVERTED | [3fEb3Gzf8d…](https://explorer.solana.com/tx/3fEb3Gzf8d3a7qvt1ZrP4okYuScAcSguQVejriQLwEiETdgAwFnEh9UfrPdG6KrrwUy7Fnm12LHHKWee7aPX8zTk?cluster=devnet) | 479990849 | rejected on-chain with "HashlockMismatch" |
| 12 | S2 | redeem_user_sol | tx | OK | [2oQtMdUdK1…](https://explorer.solana.com/tx/2oQtMdUdK17RjoeowbiAtRgbMTgVnpkFru9Stvmw4ZAz9yipoDPJEWNJZPk8hfcsWSvYKCUFJf4aYiR6yavf86Vk?cluster=devnet) | 479990852 | caller=relayer, pays recipient |
| 13 | S2 | recipient +amount | check | OK |  |  | delta=2000000 |
| 14 | S3 | user_lock_sol | tx | OK | [oRFjf8TnGH…](https://explorer.solana.com/tx/oRFjf8TnGHDdRUd8DjqrtHieZ4z9noxGTdviBPS1BjvYqf1RXTFZeaXeLAkwE5pcBRrvwKGjVMJ8uedP2JJe1rx?cluster=devnet) | 479990854 | timelock=25s |
| 15 | S3 | refund_user_sol premature (non-recipient) | tx | REVERTED | [3YVewAp8af…](https://explorer.solana.com/tx/3YVewAp8afo38qdfST28pSunzBPmTBdFjeKEBDLnSdXYba94mQc9TXMpFYHMztR7QxJcJC6HYAiTgmmAB4eisn7L?cluster=devnet) | 479990856 | rejected on-chain with "TimelockNotExpired" |
| 16 | S3 | waiting out timelock | info | INFO |  |  | 30s |
| 17 | S3 | refund_user_sol | tx | OK | [5GA3QhT5Jt…](https://explorer.solana.com/tx/5GA3QhT5JtTe4mLbRBEU4SJKuXhS5Zo2NJJ3Exgr3NrpojxJerzzgd4urCfjSbKPRRqaD66RZkwevx4Kwxs9pjrs?cluster=devnet) | 479990938 | caller=relayer after timelock |
| 18 | S3 | refund_to (user) +amount | check | OK |  |  | delta=1500000 |
| 19 | S4 | user_lock_token | tx | OK | [pt8vdJDbqd…](https://explorer.solana.com/tx/pt8vdJDbqdYY3pvQP6EKq23qe4NuBnVJWgs3jqKDg1iSBhCy8BLyh4RoCF1bP1GEEVDbTK7w8aHRmAGjYEYw7qJ?cluster=devnet) | 479990941 | amount=250000 mintA |
| 20 | S4 | vault holds amount | check | OK |  |  | vault=250000 |
| 21 | S4 | redeem_user_sol on token lock (variant confusion) | tx | REVERTED | [4Zi1ZskLb8…](https://explorer.solana.com/tx/4Zi1ZskLb897sDferoLhVHMjAFimgEim9QTMF4uG1opp247rbasriWZxcEp7Vfv2fyozwjar7KrXAK1i8QcFSrKa?cluster=devnet) | 479990944 | rejected on-chain with "WrongToken" |
| 22 | S4 | redeem_user_token | tx | OK | [5DbMbvUSd6…](https://explorer.solana.com/tx/5DbMbvUSd6mH4nFzR754n4R9PQdgoofNDYtj4qHMvvmq1Yz6RvXBH3YKARMBykCYBmZ2Jd5H4r6pgF3hvEdR5HBY?cluster=devnet) | 479990946 | recipient=solver ATA |
| 23 | S4 | recipient ATA credited | check | OK |  |  | ok |
| 24 | S5 | user_lock_token | tx | OK | [4so3oK4owK…](https://explorer.solana.com/tx/4so3oK4owKmVqcPCw28MW1tuo1CBnkbdQGxbskySgGUAwJNa1DwxMAVrzdKxkT6wPzzjJVcrjkhAaZ7DRtop3Y4z?cluster=devnet) | 479990948 | timelock=25s |
| 25 | S5 | user_lock_token duplicate hashlock | tx | REVERTED | [444WEtKq3C…](https://explorer.solana.com/tx/444WEtKq3CK3wuE3hbiodiSB249f47j8dnvAazBhnfCvDr7VhdrNLi3Qdno44HAAJozMKWU2h2D4CKwGmLCkpWUs?cluster=devnet) | 479990950 | rejected on-chain with "already in use" |
| 26 | S5 | waiting out timelock | info | INFO |  |  | 30s |
| 27 | S5 | refund_user_token | tx | OK | [42JtRUTnVZ…](https://explorer.solana.com/tx/42JtRUTnVZ2CvS8SNsW2ANp8Pwr47JvK6oKMb93LtUSvHUJaUBUiEspVnbwvSGtwPvTRwiE9UxM64zDB7kHT7dCg?cluster=devnet) | 479991031 | refund_to=user ATA |
| 28 | S5 | status refunded | check | OK |  |  | lock closed |
| 29 | S6 | solver_lock_sol reward tl >= tl | tx | REVERTED | [31oDYq8HSz…](https://explorer.solana.com/tx/31oDYq8HSziNcmvRUaGLcrkudsi73EJFSDgtFWMomdV7zXVRhLfsKAVyDj7Jd4jxL2vvEnjwo3gsiDrb2poHavVN?cluster=devnet) | 479991034 | rejected on-chain with "RewardTimelockNotLessThanTimelock" |
| 30 | S6 | solver_lock_sol | tx | OK | [3D8pCkNnnB…](https://explorer.solana.com/tx/3D8pCkNnnBrffHxXvt9QN5HZTjCiXXq8HgrKxie4prbgi9SG1YuDHYGodbw9iJeuwZ68YwynqaQM7Wf4XfqzSeNZ?cluster=devnet) | 479991036 | amount=1200000 reward=300000 |
| 31 | S6 | solver_lock_sol duplicate solver | tx | REVERTED | [32e9XucP7R…](https://explorer.solana.com/tx/32e9XucP7RhjNNRVfDkpuopWEiK5T9G1ShriP57pgW5nWdLGPoykmTJ7g82fCe946TaiRyUUnJBk7YcR8K39DJzU?cluster=devnet) | 479991039 | rejected on-chain with "SolverLockAlreadyExists" |
| 32 | S6 | redeem_solver_sol | tx | OK | [2AsNNJmXLG…](https://explorer.solana.com/tx/2AsNNJmXLGkssJhdkzBANUxya1HrdBHhpKqRKrXSCfrcRzLhvSMDS6EcWVsA9x2irWAjXPdW8DrRhBFnVN9LCBiv?cluster=devnet) | 479991041 | reward→reward_recipient (pre-timelock) |
| 33 | S6 | recipient (user) +amount | check | OK |  |  | delta=1200000 |
| 34 | S6 | reward_recipient (solver) +reward | check | OK |  |  | delta=300000 |
| 35 | S6 | redeem_solver_sol double redeem | tx | REVERTED | [4qaVXt74jj…](https://explorer.solana.com/tx/4qaVXt74jjgFWpcwJhLj1gBVKfYbKAGxvj3ybZpRbTzKL34kPSo3QKPp7NvJ2BuFWpvHvAH3RBHawoV9yDwqi8uY?cluster=devnet) | 479991044 | rejected on-chain with "NotPending" |
| 36 | S6 | close_solver_lock | tx | OK | [62jUs5CwJ4…](https://explorer.solana.com/tx/62jUs5CwJ41hb9JMLMfDbsDpod3hHB3p5n25BuwQyvM7KVoa5KpESWRDsWc4iyTptajzRHkV19erkVDUCHJhwwwd?cluster=devnet) | 479991050 | rent→rent_payer |
| 37 | S7 | solver_lock_sol | tx | OK | [5SJbwjMTUe…](https://explorer.solana.com/tx/5SJbwjMTUeYSAVri31ozXrin9YeXibBUfEKC99xZnyaoD1nUdk2Tr9CB4mWRPEBNm7TbLAh2zHFAhivF7pijNTqv?cluster=devnet) | 479991052 | rewardTimelock=25s |
| 38 | S7 | waiting out reward timelock | info | INFO |  |  | 30s |
| 39 | S7 | redeem_solver_sol (late) | tx | OK | [2cocQx7f6T…](https://explorer.solana.com/tx/2cocQx7f6TdujUuccLCxEcPQ4zkMdNmVhxSdcSic1hHtDEZ9o9DxzEM4yDTFPJS9qwetWBkDrirU13jazYW874ys?cluster=devnet) | 479991145 | reward→caller bounty (post-timelock) |
| 40 | S7 | caller received reward bounty | check | OK |  |  | caller +reward (minus fee) |
| 41 | S8 | solver_lock_token #1 | tx | OK | [4ij4WHM1mu…](https://explorer.solana.com/tx/4ij4WHM1muFEftMJLSjvuwrn6fBrxCmp6dKzLhPiGzxDhYzmAVpgBjVpEWkiVUoiVbCKcJ9R3QPckWmF16KunNi7?cluster=devnet) | 479991150 | single vault amount+reward |
| 42 | S8 | solver_lock_token #2 | tx | OK | [2or29mN2Tc…](https://explorer.solana.com/tx/2or29mN2TcsBDmHj9sM8r2FGYbXpZJBxfTa28DP1x5KwohwLgFBc8FuZAbnNA6qdhWB45ksHi6T9y3e8z1svJgHv?cluster=devnet) | 479991152 | for refund |
| 43 | S8 | redeem_solver_token #1 | tx | OK | [m3oSDuriBW…](https://explorer.solana.com/tx/m3oSDuriBWJjQhCRs248FkLJEw1BQSqaFSyYJgeVAPtNrTfyMgtpMPA4yD5h6Nc9QZ7jSrnnQKCG8CsWxMx662X?cluster=devnet) | 479991154 | recipient + reward_recipient |
| 44 | S8 | refund_solver_token premature | tx | REVERTED | [625LyLovX7…](https://explorer.solana.com/tx/625LyLovX7F2P7F8HVrd8NTuU57LEJaVCs39N7pczxA2sR4b219jhsGkPi9qj99ekoyUmKhvgorJRXksietYo3TP?cluster=devnet) | 479991156 | rejected on-chain with "TimelockNotExpired" |
| 45 | S8 | waiting out timelock | info | INFO |  |  | 30s |
| 46 | S8 | refund_solver_token #2 | tx | OK | [2iyac4i9JE…](https://explorer.solana.com/tx/2iyac4i9JEJzZSGBD5GsxqefP7p3afJufP6TCqh67uxFRaDbmSZFVxFGHdq7Be5V7wNL7LxH5gggG5CFbraf4MxH?cluster=devnet) | 479991238 | refund_to=solver ATA |
| 47 | S9 | solver_lock_token_diff_reward identical mints | tx | REVERTED | [Sz9d4TZ2PT…](https://explorer.solana.com/tx/Sz9d4TZ2PThsoEmwSgT5FLcQvSuJTYUYyFqteZ59Tyk4WH2wG2dvPKQqjTT2kvwdxNecC8LCh2PToLFEz2ttqfi?cluster=devnet) | 479991240 | rejected on-chain with "WrongToken" |
| 48 | S9 | solver_lock_token_diff_reward | tx | OK | [Wz2Fjqwy8K…](https://explorer.solana.com/tx/Wz2Fjqwy8KhtFS8xCtTTKRqubJudMyZsNj6FJ31rXv1KbYUuVZy5WR5ppxrniVgyUACThb2W1iRUsYbKLVzgNrM?cluster=devnet) | 479991242 | two vaults mintA + mintB |
| 49 | S9 | redeem_solver_token_diff_reward | tx | OK | [4RSJzMKi6U…](https://explorer.solana.com/tx/4RSJzMKi6UF8KUykcBg5684dWPYmuroBSAZYkdfMmWbGhuaVBUz8uY6kyjmQKU48LgiaTN2oMUNhtgotS9arZKUo?cluster=devnet) | 479991244 | recipient mintA + reward mintB |
| 50 | S9A | solver_lock_sol_token_reward #1 | tx | OK | [W1f6KNMrv9…](https://explorer.solana.com/tx/W1f6KNMrv9SwYoQNHVpBQ8bUgtqePPSDY9TLFG21bm6obLzi2s1XLXnTyZgXt8yUVQm9LiExuqJfdzuep71LXJ3?cluster=devnet) | 479991246 | for redeem |
| 51 | S9A | solver_lock_sol_token_reward #2 | tx | OK | [4Dd3rPQspa…](https://explorer.solana.com/tx/4Dd3rPQspar74uLKU1D5zCx9wpuVcAv2hmcgWTPEPysoiMTnSoDeQrBsVitFD68AtxSfEqYh8BNQXi14yyzC8gvg?cluster=devnet) | 479991248 | for refund |
| 52 | S9A | redeem_solver_sol_token_reward | tx | OK | [2MyPJ3PbET…](https://explorer.solana.com/tx/2MyPJ3PbETpsYpj4m14MmfDrr5G9oBhYrCqmVn7mwqBZ7Sz1oZTeRap8A7tUgSMzoZwnmZ8JUjCZg4KwadBW3s61?cluster=devnet) | 479991251 | SOL→recipient, SPL reward→reward recipient |
| 53 | S9A | mixed SOL principal redeemed | check | OK |  |  | delta=900000 |
| 54 | S9A | mixed SPL reward redeemed | check | OK |  |  | delta=20000 |
| 55 | S9A | waiting out mixed-path timelock | info | INFO |  |  | 30s |
| 56 | S9A | refund_solver_sol_token_reward | tx | OK | [QGumksYbuz…](https://explorer.solana.com/tx/QGumksYbuzukJcy3mefiaK63cgbMHdCrgXVpjdsFkpLsVok1GwB63Uiogg4KweYNuPUEgZ9d66tFhhv4q2hAJow?cluster=devnet) | 479991333 | SOL + SPL reward→refund_to |
| 57 | S9A | mixed SOL principal refunded | check | OK |  |  | delta=900000 |
| 58 | S9A | mixed SPL reward refunded | check | OK |  |  | delta=20000 |
| 59 | S9B | solver_lock_token_sol_reward #1 | tx | OK | [4n36t9LmHW…](https://explorer.solana.com/tx/4n36t9LmHWi4mu8LKx1fjts1i1xfWetDidE2VfqQhhjQcKZrhRJ4ZFCciBAsZz3yFCj3RXkcZBz1zzheFcunzt4p?cluster=devnet) | 479991388 | for redeem |
| 60 | S9B | solver_lock_token_sol_reward #2 | tx | OK | [4Yx7zb7nge…](https://explorer.solana.com/tx/4Yx7zb7nge9LM8J4YRQsrRQzqUsSPgUpPceRdcwBhna3wowG3JsXkuDgzozohAbC6n1HR8KjjwJsJ86BCsnyudAs?cluster=devnet) | 479991390 | for refund |
| 61 | S9B | redeem_solver_token_sol_reward | tx | OK | [2Lka2wsCRE…](https://explorer.solana.com/tx/2Lka2wsCRE8BKfncxtyrbaL8XZ9p5NT8Botsemq4SYMyQWuQTLXKuzJD3CnRJBXNjEYUArEyx2aVKcrGuaTtVLrw?cluster=devnet) | 479991393 | SPL→recipient, SOL reward→reward recipient |
| 62 | S9B | mixed SPL principal redeemed | check | OK |  |  | delta=70000 |
| 63 | S9B | mixed SOL reward redeemed | check | OK |  |  | delta=700000 |
| 64 | S9B | waiting out mixed-path timelock | info | INFO |  |  | 30s |
| 65 | S9B | refund_solver_token_sol_reward | tx | OK | [41KRzUMkqy…](https://explorer.solana.com/tx/41KRzUMkqyxHho6A8RrWHytM9KCXxGTPimgMMhN3hn16MMCiaimVGDmYHF9RBVhuLvfBH4DYjPAgWuFhgGwqFu7o?cluster=devnet) | 479991475 | SPL + SOL reward→refund_to |
| 66 | S9B | mixed SPL principal refunded | check | OK |  |  | delta=70000 |
| 67 | S9B | mixed SOL reward refunded | check | OK |  |  | delta=700000 |
| 68 | S10 | user_lock_sol mismatched curve | tx | REVERTED | [3ZPjvzVd7R…](https://explorer.solana.com/tx/3ZPjvzVd7REBpBYTvrdkCRN1ohWpu2L9kq9e5eDEtfLZApifYPksZTCn2V4isoHPTA3ZJANA8RAozSgTvGy1aAwg?cluster=devnet) | 479991478 | rejected on-chain with "InvalidPayoutCurve" |
| 69 | S10 | user_lock_sol (constant curve) | tx | OK | [4aFpik6E1c…](https://explorer.solana.com/tx/4aFpik6E1cDg75BbHjqsbpXG8miAfzaNjhTg6anKiiMVyz1Go8qkP3nZne5ozyJEZhpFhigegrxJprPL5YCshsP6?cluster=devnet) | 479991480 | curve=constant |
| 70 | S10 | redeem_user_sol (constant curve) | tx | OK | [2DZeAy5TX2…](https://explorer.solana.com/tx/2DZeAy5TX22odBZ4v56AXPB9zqJpKTPN9NZmLNzgmbz7priMkt1FcZAwt9j2Dp5enZ4MDdVbcmkoX43APyGrg87k?cluster=devnet) | 479991483 | payout=amount, excess=0 |
| 71 | S10 | recipient +full amount | check | OK |  |  | delta=1000000 |
| 72 | S11 | user_lock_sol (decay curve) | tx | OK | [qyA8owtYfk…](https://explorer.solana.com/tx/qyA8owtYfkFZ7uBXUiJLEpfHuMurA1EQYZD43ACAohNPPPfF2N4inWZsxXv7R6HsQecpXvxGg6LQpdq3sUYxnkJ?cluster=devnet) | 479991485 | curve=decay (payout=amount/2) |
| 73 | S11 | redeem_user_sol (decay curve) | tx | OK | [5he3LrApa2…](https://explorer.solana.com/tx/5he3LrApa2i758kt5d3uERspkHyWZuuQxtAg9ZtsQq4hDuSCCKjUdeN48VVJGphgpSAJqHqLLddoUWN6EAswfL15?cluster=devnet) | 479991488 | payout+excess split |
| 74 | S11 | recipient +payout(amount/2) | check | OK |  |  | delta=1000000 |
| 75 | S11 | refund_to +excess(amount/2) | check | OK |  |  | delta=1000000 |
| 76 | S11 | user_lock_sol (0-bps curve) | tx | OK | [62nF4AuQcf…](https://explorer.solana.com/tx/62nF4AuQcf7P6A36zXsatoS14jKyhq2imEYETMKT49D1EST2DWqkkzXmkBiywhDktNugMCa5TvX6bptc6LrMJm5o?cluster=devnet) | 479991491 | will fail redeem |
| 77 | S11 | redeem_user_sol zero payout | tx | REVERTED | [4GCzF79kUv…](https://explorer.solana.com/tx/4GCzF79kUvpVbSdFBMEZaPLpGdSuE4utppS3MLuKA1HjepMcMVEu7H57Dy5KnpxdCXAfHy2qWk1iQ794mzD8cGZ7?cluster=devnet) | 479991516 | rejected on-chain with "InvalidPayout" |
| 78 | S12 | rail A tampered tx | sim-reject | OK |  |  | rejected pre-landing (ature) — no on-chain tx by construction |
| 79 | S12 | sponsored user_lock_sol | tx | OK | [kxdfwa21VU…](https://explorer.solana.com/tx/kxdfwa21VUtKB5SNibZnzWkrqquyUWf8pS2hCy7PFJR767YGwf4HomcYiCZAWgVek2BC8PvGyM4qxu1Vx4Kt4NU?cluster=devnet) | 479991519 | user co-signs, relayer pays |
| 80 | S12 | depositor paid only amount (no fees) | check | OK |  |  | delta=1000000 |
| 81 | S12 | rent_payer = relayer | check | OK |  |  | relayer paid rent |
| 82 | S12 | rail A replay | sim-reject | OK |  |  | rejected pre-landing (already) — no on-chain tx by construction |
| 83 | S12 | redeem_user_sol | tx | OK | [2NWh4Jeuik…](https://explorer.solana.com/tx/2NWh4Jeuikn8GgZ4Rneff9u4YkbL8DcqkCzWZ31QgUvxBAR53g596eZvfRwjNpADo4KaXnmPDdKFC3Yj9qMo5MrR?cluster=devnet) | 479991522 | settle |
| 84 | S13 | create durable nonce account | tx | OK | [65xiUcPYs3…](https://explorer.solana.com/tx/65xiUcPYs3XNYb7cXxkucbCNUiS4zDSDPXmoTZv2J7x7s5Ga6kifnGKMmpxiKh9siZtwkpcwSnCuAHPk8Jp6sBLH?cluster=devnet) | 479991524 | authority=relayer |
| 85 | S13 | simulating offline delay | info | INFO |  |  | 2s |
| 86 | S13 | durable-nonce user_lock_sol | tx | OK | [54iep985B3…](https://explorer.solana.com/tx/54iep985B3hTT4khLgDZxKpYSThT6ud18BH99jjVBRZZHn1tfr6umZHKa8eZeGJ53LNBCpMDJtnkknTxCF19aZbe?cluster=devnet) | 479991532 | offline-signed, deferred submit |
| 87 | S13 | rail B nonce replay | sim-reject | OK |  |  | rejected pre-landing () — no on-chain tx by construction |
| 88 | S13 | redeem_user_sol | tx | OK | [4dCMRXxnAB…](https://explorer.solana.com/tx/4dCMRXxnABAmDcwHvp5Q9eXjTaXKpUxSoADNSvT72pjth7QVtz77RbujAcSicHHrvdCPLHNx2bBVjNUGAc9jRhts?cluster=devnet) | 479991535 | settle |
| 89 | S14 | approve delegate (one-time) | tx | OK | [5FZtqLT8gV…](https://explorer.solana.com/tx/5FZtqLT8gVtxF4EbZL5rWMVNmtTTaoQYDo9gpcKt8qgupA2ga9RrPcf2B4MPmGnYMUvaY5xCj3EShVTWhVAaYHw4?cluster=devnet) | 479991537 | user delegates to program PDA |
| 90 | S14 | rail C expired intent | tx | REVERTED | [5ys61WdGaR…](https://explorer.solana.com/tx/5ys61WdGaR5rR2Er7DtGegKht4pTHvuxHoauAQEVhLogC6aDrNVMUq9uso1cZYAH9pQgozHRuo8BFMvu5umPeDti?cluster=devnet) | 479991541 | rejected on-chain with "IntentExpired" |
| 91 | S14 | intent user_lock_token | tx | OK | [4DHu2DoCub…](https://explorer.solana.com/tx/4DHu2DoCubTxyLWzf1X63wBogQCaEFe2hq344R4ejaeHkrTEsUupKwt8RLCvn2KR3h9AiCNJ4CfH33h78G6dY4d3?cluster=devnet) | 479991608 | user signed only a message |
| 92 | S14 | lock attributed to user | check | OK |  |  | sender=user |
| 93 | S14 | rent_payer = relayer | check | OK |  |  | relayer paid rent |
| 94 | S14 | pulled exactly amount | check | OK |  |  | delta=60000 |
| 95 | S14 | rail C tampered params | tx | REVERTED | [DRDFnrNvd6…](https://explorer.solana.com/tx/DRDFnrNvd6pD2ZJjLTjE1NbyqVAghwpwfuqn4HLnD9UrQ2wVkYAFiWktog4p8hyKPTrAScs3FsmJwMBLhwwhkzx?cluster=devnet) | 479991611 | rejected on-chain with "InvalidIntentSignature" |
| 96 | S14 | redeem_user_token | tx | OK | [2pdddsKKM6…](https://explorer.solana.com/tx/2pdddsKKM66Es88a4TAZWFkdXfhHP29KjT61NJ28JD3sRP9rbch1uHp29zbG2PTmBhSs5T2gUhDSU2svQPaWdCiZ?cluster=devnet) | 479991613 | settle the intent lock |
| 97 | S14 | rail C intent replay (post-settle) | tx | REVERTED | [2iXQxFDhPC…](https://explorer.solana.com/tx/2iXQxFDhPCvFMdwyZKwLuckePDe6sxWWrAxLWPpGi65Boq2RrsAkr2oaavjTpAQYsfWkw6Athje9UUKKVFii1rz?cluster=devnet) | 479991615 | rejected on-chain with "already in use" |
| 98 | S15 | intent user_lock_token | tx | OK | [5WM3dxxRH8…](https://explorer.solana.com/tx/5WM3dxxRH8EczBz9FjXeZgVhqwYyVgJFh6HE7PmLvXg7xco1FnMYZir1SZbg5DJWCTemgSTGZHzwbsZ5zfvLsNug?cluster=devnet) | 479991617 | deadline in 8s, nonce=1785421358796 |
| 99 | S15 | close_consumed_intent before deadline | tx | REVERTED | [5oEeYep8Xo…](https://explorer.solana.com/tx/5oEeYep8Xopg6B1Y5NXQtDtE1RcsJa542HFbLqSKhiceYCDE6gE2eptEpN8Z8zw3BpqrfyJP95rSnTByE1bg1Gk3?cluster=devnet) | 479991619 | rejected on-chain with "IntentNotExpired" |
| 100 | S15 | waiting out intent deadline | info | INFO |  |  | 10s |
| 101 | S15 | close_consumed_intent | tx | OK | [5y3uYXtWGF…](https://explorer.solana.com/tx/5y3uYXtWGFS2ZVaZmrwHnQH9vAeKea7Crciu7pGaJzHAAoeLPJarFd8zLKv4Qq8toRTzXHTV9uE7TYLAqUXGd3Cz?cluster=devnet) | 479991648 | rent→relayer after deadline |
| 102 | S16 | user_lock_sol | tx | OK | [2kp5KnzPeW…](https://explorer.solana.com/tx/2kp5KnzPeWQUrsJgqC9svim33UJmxhaVaX5uXdMp14uZwMzrpxzVyjFMQuM23HeL4kShPaqtVxwkkjdAqTjR9gEa?cluster=devnet) | 479991650 | for view |
| 103 | S16 | get_user_lock returns fields | check | OK |  |  | amount=500000 refundTo=user |
| 104 | S16 | solver_lock_sol | tx | OK | [4Raa3cLV9w…](https://explorer.solana.com/tx/4Raa3cLV9wVtHaRn2SfMF9PiUKkLF8ADamith3NbHd2zTLNfDKzwWdXmRgNxxiPv5BSt1cmBQvMw35nFm5eFBVVi?cluster=devnet) | 479991652 | pending, for close negatives |
| 105 | S16 | close_solver_lock while pending | tx | REVERTED | [5TUei2ftb3…](https://explorer.solana.com/tx/5TUei2ftb3xYnQ2x6KCNHg1uP9vr4Yz1TqZWMRsSf3QhcCHNgwqk7jdma3mEyDeesQ38521WduqLQ69qzBpN5RsB?cluster=devnet) | 479991654 | rejected on-chain with "StillPending" |
| 106 | S16 | S16 note | info | INFO |  |  | the pending solver lock is left on-chain (refundable after its timelock); not an error |

## Summary

- rows: 106
- landed txs (success): 46
- on-chain reverted (expected, negative cases): 19
- pre-landing rejections (signature/replay/nonce level, no tx by construction): 3
- FLOW FAILURES: 0

All happy paths and negative cases behaved as expected. Every landable negative case is recorded above as an on-chain `REVERTED` transaction with its explorer link; the pre-landing rejections cannot produce a transaction (they are rejected by the runtime before inclusion) and are noted as such.
