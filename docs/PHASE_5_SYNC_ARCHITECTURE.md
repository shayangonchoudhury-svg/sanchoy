# SANCHOY PHASE 5 — MULTI-DEVICE SYNCHRONIZATION ARCHITECTURE

## 1. Executive Summary & Core Principle

Sanchoy's multi-device architecture supports a single authenticated user operating across multiple clients (laptops, desktops, tablets, and phones) while adhering strictly to:
- **Local-First Working Database:** IndexedDB remains the primary database. UI actions, financial commands, and calculations never block on network reachability.
- **Client-Side Encrypted Cloud:** Firestore acts strictly as an encrypted synchronization layer at `users/{uid}/private/workspace`. Zero plaintext financial attributes exist in the cloud.
- **Zero Silent Data Loss:** Independent transactions from multiple devices are merged deterministically via a 3-way ledger reconciliation algorithm. Conflicting edits are preserved rather than overwritten.
- **Deterministic Financial Engine:** Balances, daily allocations, and recovery periods are recalculated locally from source transactions and configs rather than trusting arbitrary remote balances.

---

## 2. Architecture Diagram

```
                       FIRESTORE
               (Encrypted Cloud Storage)
               /users/{uid}/private/workspace
                         │
           ┌─────────────┴─────────────┐
           │                           │
       Device A                    Device B
 (dev_9f4a...128-bit)        (dev_3c8b...128-bit)
           │                           │
   AES-GCM DEK Decrypt         AES-GCM DEK Decrypt
           │                           │
    3-Way Merge Engine          3-Way Merge Engine
           │                           │
       IndexedDB                   IndexedDB
  (Local-First Working)       (Local-First Working)
           │                           │
Deterministic Ledger Engine  Deterministic Ledger Engine
```

---

## 3. Key Components & Modules

### 3.1 Device Identity (`js/sync/device.js`)
- **Anonymous Device Identifier:** Each client generates a persistent identifier (`dev_<32 hex chars>`, 128-bit cryptographic entropy).
- **Privacy Guarantee:** Contains zero personal or hardware information (no email, UID, screen dimensions, IP, or predictable timestamps).
- **Purpose:** Distinguishes mutation sources during multi-device synchronization and prevents self-conflict loops.

### 3.2 Offline Mutation Queue & Idempotency (`js/sync/queue.js`)
- **Persistence:** Local mutations (`ADD_TX`, `EDIT_TX`, `DELETE_TX`, `UPDATE_ALLOWANCE`) are immediately enqueued in local storage with stable mutation IDs (`mut_<24 hex chars>`).
- **Idempotency:** Replaying mutations during retries or network reconnections cannot create duplicate transactions because transactions carry permanent UUIDs (`tx_<24 hex chars>`).
- **Resilience:** The offline queue survives page refreshes and browser terminations.

### 3.3 Revision Model & Optimistic Concurrency (`js/sync/revision.js`)
- **Local vs Cloud Revisions:** Every local write advances the local client revision (`clientRevision`).
- **Stale Revision Detection:** Before applying updates to Firestore, the controller compares `remoteRevision` with `localBaseRevision`. If remote has advanced, Sanchoy triggers the 3-Way Merge Engine instead of a destructive overwrite.

### 3.4 3-Way Financial Ledger Merge Engine (`js/sync/merge.js`)
When Device A and Device B both mutate from the same base revision:
1. **Independent Transactions:** Added transactions from Device A and Device B are merged into a unified set without duplicates.
2. **Deletions:** Explicit deletions are honored without resurrecting removed entries if the opposing device made no modifications.
3. **Same-Transaction Divergence:** If both devices modified the same transaction with differing amounts or dates, the system flags a `TRANSACTION_EDIT_CONFLICT`.
4. **Configuration & Vault Merge:** Allowance versioning prefers the highest explicit revision, and Secret Savings Vault records are unified by stable ID without altering their inner PBKDF2/AES-GCM encryption.

### 3.5 Conflict Preservation (`js/sync/conflict.js`)
- If an irreconcilable conflict occurs, Sanchoy preserves both `localSnapshot` and `remoteSnapshot` in `sanchoy_active_conflicts`.
- Status is set to `SyncState.CONFLICT` with visual warnings (`! Conflict`), guaranteeing zero silent data loss.

### 3.6 Subtle UI Synchronization Indicator (`js/firebase/sync.js`)
- Subtle status pill in header:
  - `✓ Synced` (green)
  - `↻ Syncing…` (accent pulse)
  - `○ Offline (N)` (amber with queued mutation counter)
  - `! Conflict` (rose alert)
  - `× Sync Error` (rose alert with exponential backoff retry)

---

## 4. Multi-Device Login Flow

```
1. Google Sign-In
   → State: AUTHENTICATED_LOCKED (Firebase user authenticated, financial UI locked)
2. Private Passcode Submission
   → Fetch remote encrypted envelope from /users/{uid}/private/workspace
   → Unwrap DEK using PBKDF2 (100,000 iterations, SHA-256)
   → Decrypt workspace ciphertext using AES-GCM 256-bit
   → Restore ledger into local IndexedDB
   → Reconcile deterministic balances locally
   → State: AUTHENTICATED_UNLOCKED
```

---

## 5. Security & Privacy Guarantees

1. **Passcode & Recovery Codes:** Never transmitted to Firestore, never logged, never stored in plaintext.
2. **Volatile Key Management:** The DEK exists in volatile application memory only and is removed from the application security context upon lock or sign-out.
3. **No Plaintext Financial Data in Cloud:** Firestore contains only ciphertext (`encryptedData`, `encryptedDataIv`) and envelope metadata (`cryptoVersion`, `clientRevision`, `updatedAt`).
4. **Cross-Tab Synchronization:** Uses `BroadcastChannel('sanchoy_sync_channel')` to prevent stale tab states on the same device.

---

## 6. Verification Status

- **Automated Test Suites:**
  - 15/15 Financial Engine & Allowance tests
  - 15/15 Transaction System & Reconciliation tests
  - 7/7 Phase 4 Dual-Layer Cryptography tests
  - 12/12 Phase 4.1 Security Hardening tests
  - 13/13 Phase 5 Multi-Device Synchronization & Conflict tests
- **Total:** **62/62 tests passing** (100% pass rate).
