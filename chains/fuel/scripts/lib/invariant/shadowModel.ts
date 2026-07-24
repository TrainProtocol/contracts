/**
 * In-memory "shadow model" for the stateful invariant-fuzzing harness (see `docs/ARCHITECTURE.md`'s
 * invariant table -- SOLV/CONS/LWF/PAG/SIDX -- for the invariants this backs). This is NOT a simulation of the contract --
 * it never computes anything the contract itself would compute. It only records what the
 * driver's handlers (`./handlers.ts`) know MUST now be true after a real transaction they just
 * submitted to a real local node succeeded, so the invariant checks (`./invariants.ts`) have
 * something independent to compare the real on-chain state and real wallet balances against.
 *
 * Every amount is tracked as a `BN` (fuels-ts's bn.js wrapper) to avoid any floating-point/
 * `Number` precision loss, exactly like the contract's own `u64` fields.
 */
import { bn, type BN } from 'fuels';

export type ShadowLockStatus = 'Pending' | 'Redeemed' | 'Refunded';

/** A "fuse" length picked at creation time -- see `handlers.ts`'s file doc comment for why
 * short/long timelocks are deliberately profiled rather than drawn from one flat distribution
 * (short fuses exist specifically to make `refund_user`'s non-recipient path / `refund_solver`
 * reachable within this test's real-wall-clock budget without indefinite waiting). */
export type Fuse = 'short' | 'long';

export interface ShadowUserLock {
  hashlock: string;
  /** Decimal-string `u256` secret whose `sha256` is `hashlock` -- this run always knows it,
   * since every hashlock used anywhere in this harness is minted by `randomSecretAndHashlock`. */
  secretArg: string;
  amount: BN;
  recipientIdx: number;
  refundToIdx: number;
  funderIdx: number;
  status: ShadowLockStatus;
  createdAtMs: number;
  timelockDeltaSec: number;
  /** Real wall-clock estimate (`createdAtMs + timelockDeltaSec * 1000`) of when
   * `std::block::timestamp()` (TAI64, tracks real time on this test node -- confirmed in
   * `trainCore.test.ts`'s file doc comment) crosses `timelock`. Only load-bearing for `fuse ===
   * 'short'` locks; `'long'` locks (3600s) are never waited on. */
  timelockDeadlineMs: number;
  fuse: Fuse;
}

export interface ShadowSolverLock {
  hashlock: string;
  /** 1-based, matches the contract's own indexing. */
  index: number;
  amount: BN; // principal only, mirrors `SolverLockData.amount` (excludes reward)
  reward: BN;
  recipientIdx: number;
  rewardRecipientIdx: number;
  refundToIdx: number;
  funderIdx: number;
  status: ShadowLockStatus;
  createdAtMs: number;
  timelockDeltaSec: number;
  timelockDeadlineMs: number;
  rewardTimelockDeltaSec: number;
  rewardTimelockDeadlineMs: number;
  fuse: Fuse;
}

/** The whole in-memory belief state. One instance per invariant campaign (shared across every
 * run/sequence in that campaign -- see `driver.ts`'s file doc comment for why one shared node +
 * one shared model, rather than one of each per run, was chosen for this phase). */
export class ShadowModel {
  userLocks = new Map<string, ShadowUserLock>();
  /** hashlock -> (index -> lock). A `Map` (not array) at the inner level so index gaps/holes
   * are never silently assumed contiguous by this model itself -- the contract's own contiguity
   * (1..count, no gaps) is exactly what SIDX independently verifies against real chain state. */
  solverLocks = new Map<string, Map<number, ShadowSolverLock>>();
  solverLockCount = new Map<string, number>();
  /** Every hashlock a `user_lock`/`user_lock_for` call has EVER succeeded under, regardless of
   * that lock's current status -- this is the exact set LWF's "hashlock squatting is permanent"
   * clause is about. Solver-lock-only hashlocks are deliberately NOT
   * added here: `validate_solver_lock_params` never touches the `user_locks` map, so a hashlock
   * that only ever had solver locks does not block a fresh `user_lock` -- see `main.sw`'s
   * `validate_user_lock_params`/`validate_solver_lock_params` for the two independent checks.
   */
  everCreatedUserHashlocks = new Set<string>();
  /** hashlock -> the decimal-string secret this run minted it with (see `ShadowUserLock.secretArg`
   * doc comment -- every hashlock in this harness has a known secret by construction). */
  knownSecrets = new Map<string, string>();

  pendingUserLockObligation(): BN {
    let total = bn(0);
    for (const lock of this.userLocks.values()) {
      if (lock.status === 'Pending') total = total.add(lock.amount);
    }
    return total;
  }

  pendingSolverLockObligation(): BN {
    let total = bn(0);
    for (const byIndex of this.solverLocks.values()) {
      for (const lock of byIndex.values()) {
        if (lock.status === 'Pending') total = total.add(lock.amount).add(lock.reward);
      }
    }
    return total;
  }

  /** SOLV's right-hand side: what the contract's real balance of the tracked asset SHOULD be
   * right now, per this model. */
  totalPendingObligation(): BN {
    return this.pendingUserLockObligation().add(this.pendingSolverLockObligation());
  }

  pendingUserLocks(): ShadowUserLock[] {
    return [...this.userLocks.values()].filter((l) => l.status === 'Pending');
  }

  pendingSolverLocks(): ShadowSolverLock[] {
    const out: ShadowSolverLock[] = [];
    for (const byIndex of this.solverLocks.values()) {
      for (const lock of byIndex.values()) if (lock.status === 'Pending') out.push(lock);
    }
    return out;
  }

  allHashlocksWithSolverLocks(): string[] {
    return [...this.solverLocks.keys()];
  }

  /** Every hashlock this run has ever minted a secret for (user-lock or solver-lock-only) --
   * used by `createSolverLock` to occasionally reuse an existing hashlock rather than always
   * minting a fresh one (exercises multiple solver locks under one hashlock, and user+solver
   * locks sharing one hashlock, which is the realistic HTLC shape). */
  allKnownHashlocks(): string[] {
    return [...this.knownSecrets.keys()];
  }
}

/**
 * SIGNED-DELTA ARITHMETIC NOTE (read before touching anything delta-related in this directory):
 * fuels-ts's `BN` class (`@fuel-ts/math`) is built for unsigned on-chain wire values and
 * silently DISCARDS THE SIGN on every arithmetic result -- `caller()` (the method every
 * `add`/`sub`/`mul`/... override routes through) rebuilds its return value via
 * `new _BN(output.toArray())`, and `bn.js`'s own `toArray()` serializes only the MAGNITUDE,
 * dropping the internal `.negative` flag entirely. Confirmed empirically:
 * `bn(5).sub(bn(10)).toString()` is `'5'`, not `'-5'`; `bn(10).mul(-1).toString()` is `'10'`,
 * not `'-10'`; `bn(10).neg().toString()` is `'10'` too. This is exactly correct behavior for a
 * type that only ever represents non-negative `u64`/`u256` wire values -- but it makes `BN`
 * fundamentally unusable for tracking SIGNED balance deltas (a wallet's balance can legitimately
 * decrease). Every delta in this invariant harness (`ActionOutcome.expectedDeltas`,
 * `BalanceSnapshot` diffing in `invariants.ts`) is therefore tracked as a native `bigint`
 * (correct signed arithmetic, no precision limits) instead -- `toBig` below is the one place a
 * `BN`/`number` amount is converted at that boundary. `ShadowUserLock.amount`/
 * `ShadowSolverLock.amount`/`.reward` themselves stay `BN` (they're always non-negative, only
 * ever `.add()`ed together for SOLV's obligation sum, and need to round-trip through fuels-ts
 * call arguments) -- only the SIGNED delta bookkeeping had to move off `BN`.
 */
export function toBig(v: BN | number | string): bigint {
  return BigInt(v.toString());
}

/** Adds `delta` to whatever `map` currently holds for `key` (0n if absent) -- used throughout
 * `handlers.ts` so two contributions to the same wallet within one action (e.g. a redeemer who
 * happens to also be the recipient) accumulate instead of clobbering each other. */
export function addDelta(map: Map<number | 'contract', bigint>, key: number | 'contract', delta: bigint): void {
  const prev = map.get(key) ?? 0n;
  map.set(key, prev + delta);
}
