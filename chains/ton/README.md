# TrainProtocol – TON Chain Contracts

This directory contains the TON chain implementation of TrainProtocol’s **PreHTLC-based atomic swap** contracts with jetton support. These smart contracts enable trust-minimized, permissionless cross-chain bridging within the Train protocol.

---

## 📂 Directory Layout

```

chains/ton/
├── contracts/         # Tact smart contracts
├── wrappers/          # TypeScript wrappers
├── tests/             # Unit/E2E tests using TON sandbox
├── scripts/           # Deployment and interaction scripts
├── build/             # Compiled artifacts
└── README.md          # ← You are here

````

---

## ⚙️ Setup & Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile the contracts:

   ```bash
   npx blueprint build
   ```

3. Run tests (requires sandbox):

   ```bash
   npx blueprint test
   ```

   Or for a specific test suite:

   ```bash
   npx blueprint test train.spec.ts
   ```

4. Deployment (example script):

   ```bash
    npx ts-node scripts/deployContract.ts
   ```

---

# TON Contract Fee Estimates from Tests

This document summarizes the estimated TON fees for different message types based on sandbox test results.

---

## Jetton Contract Fees

| Message Type    | Estimated Fee (TON) |
|-----------------|---------------------|
| JettonSupport   | 0.01285665          |
| RemoveJetton    | 0.012001987         |
| Commit          | 0.058337534         |
| Lock            | 0.058708207         |
| AddLock         | 0.016310649         |
| AddLockSig      | 0.01837698          |
| Refund          | 0.040652117         |
| Redeem          | 0.075710956         |

---

## Native Contract Fees

| Message Type    | Estimated Fee (TON) |
|-----------------|---------------------|
| Commit          | 0.025061979         |
| AddLock         | 0.016422649         |
| Lock            | 0.030122977         |
| Refund          | 0.016338719         |
| Redeem          | 0.027525638         |
| AddLockSig      | 0.01899098          |

---



- Jetton contract tests: `tests/trainjetton.spec.ts`  
- Native contract tests: `tests/train.spec.ts`

---

**Note:** These fees represent approximate costs of sending each message type on the TON blockchain during testing in a sandbox environment.
