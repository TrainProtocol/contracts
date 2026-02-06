# Interacting with TRAIN Protocol on Aztec

## 1. Setup

Run the setup script:

```bash
npx tsx setup.ts
```

* Deploys PXE1 (user), PXE2 (solver), and PXE3 (deployer)
* Registers FPC in each PXE, creates wallets
* Deployer (PXE3) deploys the token and sends 50% to PXE1, 50% to PXE2

---

## 2. Contract Deployment

Deploy the TRAIN Protocol contract:

```bash
npx tsx deploy.ts
```

* Deploys the TRAIN Protocol contract
* Registers it as a contract in all 3 PXEs

---

## 3. User Swaps Funds: Aztec → Destination Chain

### User: Lock Source Funds

```bash
npx tsx lockSrc.ts
```

* Wallet: Uses PXE1 (user) by default
* Config: Adjust call parameters in `scripts/lockSrc.ts` (around line 50)
* Action: User locks funds on Aztec with hashlock and timelock, creating HTLC at htlc_id=0
* Output: On success, writes `swap_id` and transaction details into `data.json`
* Timelock: Must be at least 1800 seconds (30 minutes) in the future

### Solver: Lock Destination Funds

```bash
npx tsx lockDst.ts
```

* Solver monitors Aztec public logs to confirm user's lock succeeded
* Locks corresponding funds on the destination chain (or Aztec if destination is Aztec)
* The contract automatically assigns htlc_id (0 if solver is first, otherwise finds next free slot)
* Hashlock: Must *exactly* match the user's hashlock from source chain
* Timelock: Must be *shorter* than the user's timelock (at least 900 seconds in future)
* Reward: Must be at least 10% of the swap amount
* Reward Timelock: Window during which only solver can claim reward

### User or Solver: Redeem Funds

```bash
npx tsx redeem.ts
```

* Either party can redeem by providing the correct secret (preimage of hashlock)
* If redeemed before reward_timelock expires:
  * User receives the swap amount
  * Solver receives their reward
* If redeemed after reward_timelock expires:
  * If user redeems: user gets amount + reward
  * If someone else redeems: user gets amount, redeemer gets reward
* The secret is revealed on-chain when redeemed, allowing the other party to complete their side

### Refund: Expired Funds

```bash
npx tsx refund.ts
```

* After timelock expires, the HTLC creator can refund their locked funds
* Returns amount + reward (for solver HTLCs) or just amount (for user HTLCs)

---

## 4. User Swaps Funds: Source Chain → Aztec

### User: Lock Source Funds

* User locks funds on the source chain using the source chain's TRAIN contract
* Provides hashlock, timelock, and destination details
* Creates HTLC at htlc_id=0 on source chain

### Solver: Lock Destination Funds (Aztec)

```bash
npx tsx lockDst.ts
```

* Solver monitors the source chain to confirm user's lock succeeded
* Locks corresponding funds on Aztec after extracting swap details from source chain logs
* The contract automatically assigns htlc_id based on swap state
* Hashlock: Must *exactly* match the user's hashlock from source chain
* Timelock: Must be *shorter* than user's source chain timelock
* Reward: At least 10% of swap amount, claimable by whoever redeems

### Solver: Redeems on Source Chain

* After locking funds on Aztec, solver can redeem on the source chain by providing the secret
* This reveals the secret on-chain, allowing the user to complete redemption on Aztec

### User: Redeems on Aztec

```bash
npx tsx redeem.ts
```

* User monitors the source chain until solver reveals the secret
* Uses the revealed secret to redeem funds on Aztec
* Supplies: swap_id, htlc_id, and secret (split into high/low 128-bit values)
* Receives the locked amount according to reward timelock rules

### Refund

```bash
npx tsx refund.ts
```

* If timelock expires before redemption, either party can refund their respective HTLC
* User refunds on source chain, solver refunds on Aztec

---

## 5. Query Functions

### Get HTLC Details

Query specific HTLC information:

```typescript
await train.methods.get_htlc(swap_id, htlc_id).simulate({ from: address });
```

Returns: amount, token, hashlock (high/low), secret (high/low), sender, src_receiver, timelock, claimed status, reward, reward_timelock

### Check HTLC Existence

```typescript
await train.methods.has_htlc(swap_id, htlc_id).simulate({ from: address });
```

Returns: boolean indicating if HTLC exists

### Get User's Historical Swaps

```typescript
await train.methods.get_user_swaps(user_address).simulate({ from: address });
```

Returns: BoundedVec of swap_ids (up to 100) that the user created via lock_src

### Get User's Swap Count

```typescript
await train.methods.get_user_swaps_count(user_address).simulate({ from: address });
```

Returns: Total number of swaps the user has created

---

## 6. Helper Functions

The `utils.ts` module centralizes all routine interactions with the TRAIN Protocol:

* Spin up and configure PXE environments
* Generate swap IDs, secrets, and hashlocks (split into 128-bit high/low values)
* Invoke contract getters to check HTLC status
* Monitor Aztec public logs
* Handle sponsored payment methods for fee abstraction
