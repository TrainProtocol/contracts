
# Train Protocol Bitcoin

## Overview

This project is the **Bitcoin implementation of the Train protocol**, adapted with **minimal changes** to fit Bitcoin’s Taproot and UTXO model.
It provides contract flows for **locking, upgrading, refunding, and redeeming funds** in a hashed time-locked contract (HTLC) style.

The architecture mirrors the Train protocol design, but adjusted for:

* Bitcoin’s **Taproot trees** (hashlock + refund scripts)
* **CSV (CheckSequenceVerify)**-based timelocks
* OP_RETURN metadata outputs for commit chaining

⚠️ **Note on OP_RETURN:**
Current implementation truncates payloads to fit Bitcoin Core limits. Once **Bitcoin Core v30** is released with extended OP_RETURN support, this project will be updated to support **longer metadata outputs**.

---

## Functions Overview

### **commit**

Locks funds into a Taproot contract with two branches:

* **Multisig path** – requires signatures from both sender and receiver
* **Refund path** – allows sender to reclaim funds after CSV timelock

The Taproot key path is unspendable. Optionally attaches metadata (`commitId`, memo, or data) into OP_RETURN.

---

### **addLockInit / addLockFinalize**

Upgrades an existing commit contract to a new lock with a **hashlock + refund** script tree.

* **addLockInit** – builds and signs the PSBT with sender
* **addLockFinalize** – receiver cosigns, finalizes, and broadcasts

This step consumes the old multisig branch and produces a new hashlock contract.

---

### **lock**

Directly funds a Taproot contract with:

* **Hashlock path** – receiver can redeem with secret
* **Refund path** – sender can reclaim after CSV timelock

Encodes metadata (`lockId`, hashlock, timelock, optional dstChain/asset) into OP_RETURN.

---

### **refund**

Spends the **refund path** of any contract (commit, lock, or addLock).
Requires CSV timelock to have passed. Refund destination can be:

* A user-provided `refundAddress`
* A raw `refundScriptHex`
* Defaults to sender’s P2WPKH

---

### **solverRedeem**

Redeems through the **hashlock path** by revealing the secret.

* Receiver provides the preimage
* Solver pays the transaction fees

Encodes `commitId + secret` into OP_RETURN for traceability.

---

### **userRedeemPrepare / userRedeemComplete**

Two-phase redeem flow:

* **userRedeemPrepare** – receiver builds a PSBT with `SIGHASH_SINGLE|ANYONECANPAY`, signs it, and reveals the secret
* **userRedeemComplete** – solver adds fee inputs, finalizes, and broadcasts

This ensures the user only needs the preimage and signature; solver covers fees.

---

### **convertP2WPKHtoP2TR**

Helper to move funds from sender’s P2WPKH UTXOs into a key-path Taproot output.

---

### **convertP2TRtoP2WPKH**

Helper to move funds back from sender’s key-path Taproot UTXOs into P2WPKH.

---

## Usage

Run all scripts with **npm** + **tsx**.
All scripts automatically read from the latest metadata in `/metadata`. You can override with flags when needed.

### Commit

```bash
npx tsx test/commit.ts
```

### Lock

```bash
npx tsx test/lock.ts
```

### Refund

Refund contracts (works with **lock**, **commit**, or **addLock** metadata):

```bash
npx tsx test/refund.ts --meta=lock --refundAddress=tb1qexample...
```

Flags:

* `--meta=lock|commit|addlock` → choose metadata file (default: auto)
* `--refundAddress=...` → refund to a specific address
* `--refundScriptHex=...` → refund to a raw script

### Decode

Decode contract metadata or live txid:

```bash
npx tsx test/decode.ts <txid>
```

---

## Metadata

Each step writes a JSON file under `metadata/` to persist contract state:

* **lock_meta.json** → from `lock.ts`
* **commit_meta.json** → from `commit.ts`
* **addlock_meta.json** → from `addLock.ts`
* **refund_meta.json** → from `refund.ts`

These files contain:

* Contract address & Taproot script data
* Timelock / CSV delay values
* Control blocks for hashlock & refund paths
* IDs (`commitId`, `lockId`) for OP_RETURN chaining

Subsequent scripts automatically read these files, so you can chain flows without re-entering data.
