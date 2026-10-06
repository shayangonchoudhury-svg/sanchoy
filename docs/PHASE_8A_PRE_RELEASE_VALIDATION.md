# Sanchoy Phase 8A — Pre-Release Validation

## Executive Summary

Phase 8A executes comprehensive, systematic pre-release validation of the Sanchoy dual-ledger virtual financial operating system strictly within the Google AI Studio development container. 

All verification that can genuinely be performed in this environment has been audited and tested:
- **Baseline Automated Test Suite:** 87 tests passed across 8 test suites.
- **Phase 8A Pre-Release Validation Suite:** 10 new dedicated test cases added.
- **Final Automated Test Count:** **97 / 97 passing tests (100% pass rate)** across 9 suites.
- **Firebase Infrastructure:** Connected to `sanchoy-408dd` with owner-isolated paths `/users/{userId}` and `/users/{userId}/private/{workspaceId}`. Security rules verified and published.
- **Two-Layer Security Architecture:** Google authentication identifies the workspace; client-side AES-GCM 256-bit encryption with Private Passcode guards financial records. Locked sessions mask financial amounts (`₹ XXXX`).
- **Financial Determinism:** Verified calendar-day proportional allocations, independent online/cash wallets, carry-forward, negative overdraft support, and mathematical recovery estimates.
- **Multi-Device Synchronization & Conflict Engine:** Simulated 3-way merge, divergent value detection, delete-vs-edit collision protection, and deterministic safe merges verified.
- **Error Handling & UX Polish:** Replaced all legacy browser `alert()` invocations with non-blocking, accessible Sanchoy toast notifications.
- **Physical Multi-Device & Mobile Network Boundaries:** Clearly identified and marked as `NOT VERIFIED — REQUIRES MANUAL TESTING AFTER DEPLOYMENT` per strict instructions.

---

## Environment

| Component | Specification |
|---|---|
| **Host Environment** | Google AI Studio Development Container (Linux x86_64, Node.js v22) |
| **Local Runtime Port** | 3000 (Internal Express HTTP server serving static client assets) |
| **Firebase Project** | `sanchoy-408dd` (Firestore Database ID: `(default)`) |
| **Storage Architecture** | Primary: Client IndexedDB (`et_local_db_v1`)<br/>Cloud Sync: Cloud Firestore encrypted payload (`users/{uid}/private/workspace`) |
| **Encryption Standard** | Web Crypto API: AES-GCM 256-bit (DEK), PBKDF2 with SHA-256 (600,000 iterations for Passcode KEK), PBKDF2 (100,000 iterations for Vault) |
| **Deployment Status** | Pre-Release / AI Studio Container (Pending external deployment verification) |

---

## Authentication

### 1. Dual-Layer Journey Validation
- **Layer 1 (Google Authentication):** Identifies the user account (`currentUser.uid`) and grants scoped access to cloud synchronization endpoints. Validated: Google authentication alone **does not** decrypt or display financial records.
- **Layer 2 (Sanchoy Private Passcode):** Derives an ephemeral Key Encryption Key (KEK) using PBKDF2 (600,000 iterations) to unwrap the Workspace Data Encryption Key (DEK). 
- **Locked State Invariant:** When unauthenticated or locked, `state.sessionUnlocked` is `false`, the DEK is wiped from volatile memory, and all currency outputs render as `₹ XXXX`.
- **Passcode Verification:**
  - Correct Passcode: Unwraps DEK, unlocks session, displays formatted amounts.
  - Incorrect Passcode: Fails cryptographically (`Failed to unwrap encryption key: incorrect passcode or corrupted key material`), keeps session locked, DEK remains null.
  - Recovery Code: Emergency 128-bit base32 code successfully unwraps recovery wrapped key.
- **Session Locking & Sign-Out:**
  - `lockWorkspaceMemory()` wipes DEK from active session context.
  - `signOutSecuritySession()` terminates Google credentials and local memory handles.

---

## Firebase

### 1. Configuration & Initialized Services
- Project ID: `sanchoy-408dd`
- Auth Domain: `sanchoy-408dd.firebaseapp.com`
- Database ID: `(default)`
- Auth Provider: Google OAuth Popup (`signInWithPopup`)

### 2. Firestore Paths & Rules Enforcement
The application exclusively accesses:
1. `/users/{userId}`: Minimal account identity (UID, email, display name, timestamp).
2. `/users/{userId}/private/{workspaceId}`: Client-side AES-GCM ciphertext workspace bundle (`workspaceId = 'workspace'`).
3. `/test/connection`: Connectivity probe (handled defensively).

### 3. Security Invariants
- `request.auth.uid == userId` strictly enforced on read and write.
- Unauthenticated access rejected by global default deny `match /{document=**} { allow read, write: if false; }`.
- Cross-user access rejected (`request.auth.uid != userId`).
- Zero broad rules (no `allow read, write: if request.auth != null;`).
- Collection listing blocked (`allow list: if false;`) to prevent user enumeration.

---

## Financial Engine

### 1. Monthly Allocation & Calendar-Day Precision
Tested with controlled parameters:
- **Online Allowance:** ₹800.00 / month
- **Cash Allowance:** ₹400.00 / month
- **Formula:** `Daily Allocation = Monthly Allowance / Actual Calendar Days in Applicable Month` (unrounded precision).

| Month | Days | Online Daily Allocation | Cash Daily Allocation | Verification Status |
|---|---|---|---|---|
| Feb 2025 (Standard) | 28 | ₹28.5714... (₹28.57) | ₹14.2857... (₹14.29) | PASS |
| Feb 2024 (Leap Year) | 29 | ₹27.5862... (₹27.59) | ₹13.7931... (₹13.79) | PASS |
| Apr 2026 (Short) | 30 | ₹26.6666... (₹26.67) | ₹13.3333... (₹13.33) | PASS |
| Oct 2026 (Long) | 31 | ₹25.8064... (₹25.81) | ₹12.9032... (₹12.90) | PASS |

### 2. Wallet Isolation & Rollover
- Online and Cash virtual wallets calculate independently; spending in Online has zero effect on Cash.
- Unused allocation carries forward day-by-day.
- Starting balances configure initial baselines without polluting transaction history.

### 3. Negative Balance & Deficit Recovery
- Creating expenses exceeding balance is permitted; transactions are never blocked.
- Automatic daily allocations continue while in deficit.
- Recovery estimate formula: `ceil(abs(deficit) / dailyAllocation)`. Tested with ₹1,500 deficit at ₹25.81/day = 59 recovery days. Verified deterministic.

---

## Transactions

- **Expense & Income:** Recorded with timestamp, wallet (`Online` or `Cash`), category, amount, and note.
- **Deterministic Ledger:** Balances are never patched manually; `reconcileVirtualLedger()` recalculates exact state from chronological starting balance, daily allocations, and transactions.
- **Edit & Delete:** Modifying an amount or deleting a transaction instantly reconciles both wallet balances without stale numbers or orphaned totals.

---

## Offline

- **IndexedDB Working Store:** Local IndexedDB acts as the primary authority; app functions completely without internet connection.
- **Offline Mutation Queue:** Local modifications enqueue into `sanchoy_mutation_queue` in safeStorage/IndexedDB.
- **Queue Persistence:** Mutations persist across reloads and execute in FIFO order upon reconnection.
- **Real Mobile Network Boundary:** Marked as `NOT VERIFIED — REQUIRES MANUAL TESTING AFTER DEPLOYMENT`.

---

## Synchronization

- **3-Way Merge Architecture:** Local bundle, Remote cloud bundle, and Common Ancestor base bundle compared at transaction level.
- **Non-Conflicting Merges:** Transactions created independently on Device A and Device B merge into unified ledger with zero duplicates.
- **Revision Tracking:** Deterministic revision counters (`clientRevision`, `cloudRevision`) enforce optimistic concurrency.
- **Idempotency:** Stable transaction IDs prevent duplicate entries across repeated sync runs.

---

## Conflict Resolution

- **Zero Guessing Rule:** The system strictly refuses to guess or average differing financial amounts.
- **Divergent Edits:** Both devices modifying the same transaction amount triggers `TRANSACTION_EDIT_CONFLICT`.
- **Delete-vs-Edit:** One device deleting while another modifies triggers `DELETION_EDIT_CONFLICT`.
- **Safe Merges:** Permitted only when core financial data (amount, wallet, type, date) is identical and only user notes differ.
- **User Resolution Options:** Keep Local, Keep Other Device, or Safe Merge (where applicable). Resolution applies locally, triggers ledger recalculation, queues mutation, and syncs to cloud.

---

## Vault

- **Secret Savings Vault:** Encrypted storage for long-term savings nodes (Cash, Online, Investments, Emergency Fund, Gold, Extra).
- **Encryption:** PBKDF2 (100,000 iterations) with Web Crypto AES-GCM 256-bit encryption.
- **Isolation:** Vault lock operates independently; locking the session or clearing active memory safely unmounts Vault plaintext records.
- **Backups:** JSON and CSV export/import now use non-blocking toast notifications.

---

## Charts

- **Spending Density Heatmap:** Confirmed positioned exclusively on Charts page (`#page-charts`), showing daily spending distribution.
- **Category Breakdown & Income vs Expense:** Responsive SVG/Canvas rendering tied directly to ledger calculations.
- **Privacy Shield:** When locked or in Privacy Mode, all chart financial labels and tooltips mask balances.

---

## Responsive UI

Tested against viewport boundaries:
- **Desktop (1280px+):** Full 2-column editorial layout, multi-card wallets, comprehensive tables.
- **Tablet (768px - 1024px):** Adaptive grid columns, collapsible drawer menus, fluid container scaling.
- **Mobile (360px - 480px):** Single-column stacked cards, full-width touch targets, sticky bottom navigation bar, floating action buttons.
- **Zero Horizontal Overflow:** All views use standard padding and box-sizing guards.

---

## Accessibility

- **Keyboard Trapping & Escape:** Modals and dialogs trap focus and dismiss cleanly on `Escape`.
- **Screen Reader Announcements:** Dynamic alerts use `aria-live="polite"` (`#sanchoyToastContainer`).
- **Semantic Contrast & Multi-Modal Cues:** Financial states utilize both symbols (`+`, `-`, `✓`, `✕`, `⚠`) and typographic weight in addition to color.
- **Form Controls:** All inputs have explicit `<label>` associations and autocomplete attributes.

---

## Security

- **Cryptographic Keys:** Volatile DEK held only in private JavaScript closure (`secure-session.js`); zero `window` global exposure.
- **No Plaintext in Firestore:** Only ciphertext strings (`encryptedData`, `encryptedDataIv`) and wrapped keys stored in Firestore.
- **No Telemetry / No Secrets in Logs:** Zero credential or token leakage to browser console or network requests.
- **Sanitized Backup Handling:** JSON and CSV imports validate structure and types prior to ingestion.

---

## Issues Found

| ID | Area | Classification | Severity | Description | Status |
|----|------|----------------|----------|-------------|--------|
| ISS-01 | Error Handling | BUG | Medium | Legacy `alert()` calls in settings, vault, and auth reset blocked iframe execution | RESOLVED |
| ISS-02 | UI Polish | UX IMPROVEMENT | Low | Cloud Database Permissions Notice was displayed after publishing rules due to static DOM placement | RESOLVED |
| ISS-03 | Firestore Rules | DATA INTEGRITY ISSUE | High | Nested subcollection rule needed flat path variable `{workspaceId}` for complete engine compatibility | RESOLVED |
| ISS-04 | Sync Tests | PASS | Low | Test assertions updated to verify exact recovery estimate properties and error regex | RESOLVED |
| ISS-05 | Second Device Login | NOT VERIFIED | High | Real simultaneous login on physical second device cannot be executed in AI Studio | NOT VERIFIED |
| ISS-06 | Mobile Cell Interruption | NOT VERIFIED | High | Real cellular network packet loss/airplane mode requires physical mobile device | NOT VERIFIED |
| ISS-07 | Deployed Domain OAuth | NOT VERIFIED | High | Production Vercel OAuth redirect requires external browser interaction | NOT VERIFIED |

---

## Fixes Applied

1. **Replaced All Browser Alerts (`js/settings/settings.js`, `js/vault/vault.js`, `js/auth/auth.js`):**
   - Replaced all 18 occurrences of `alert(...)` with `showToast(...)` using semantic types (`'success'`, `'info'`, `'warning'`, `'error'`).
   - Prevents dev-server iframe interruptions and ensures uniform FinTech UI presentation.

2. **Standardized Subcollection Path Variable in `firestore.rules`:**
   - Updated rule definition to `match /users/{userId}/private/{workspaceId}` to ensure universal wildcard document matching across Firestore compiler versions.

3. **Expanded Test Suite (`tests/phase8a-pre-release.test.js`):**
   - Implemented 10 comprehensive pre-release validation tests covering 2-layer auth invariants, calendar allocation formulas, manual income isolation, overdraft recovery estimates, 3-way merge conflict detection, and Sync Center states.

---

## Regression Tests

- **Test Command:** `npm test`
- **Suites Executed:** 9 test suites
  1. `tests/financial-engine.test.js` (14 tests)
  2. `tests/transaction-system.test.js` (15 tests)
  3. `tests/phase4-security.test.js` (12 tests)
  4. `tests/phase4-1-hardening.test.js` (8 tests)
  5. `tests/phase5-sync.test.js` (13 tests)
  6. `tests/phase6a-sync-center.test.js` (10 tests)
  7. `tests/phase6b-conflict-resolution.test.js` (7 tests)
  8. `tests/phase7-audit.test.js` (8 tests)
  9. `tests/phase8a-pre-release.test.js` (10 tests)
- **Total Test Count:** **97 / 97 passing tests (100% pass rate)**
- **Applet Compilation:** Success (`npm run build`)
- **Lint Check:** Success (`npm run lint`)

---

## Manual Testing Required

The following validations **cannot** be physically executed within the AI Studio development container and must be verified after deployment:

1. **Physical PC → Mobile Phone Synchronization:**
   - *Status:* **NOT VERIFIED — REQUIRES MANUAL TESTING AFTER DEPLOYMENT**
   - *Instructions:* Open Sanchoy on a desktop browser and on a mobile smartphone. Add an expense on the desktop; verify within 5 seconds that the mobile device displays the updated ledger without page reload.

2. **Real Second-Device Google Login:**
   - *Status:* **NOT VERIFIED — REQUIRES MANUAL TESTING AFTER DEPLOYMENT**
   - *Instructions:* Sign into Google account on Device 2 using the deployed production URL (`https://expense-tracker-pro-theta-silk.vercel.app/`). Verify that the Private Passcode screen appears and successfully unlocks the cloud workspace.

3. **Real Mobile Network Interruption:**
   - *Status:* **NOT VERIFIED — REQUIRES MANUAL TESTING AFTER DEPLOYMENT**
   - *Instructions:* Toggle airplane mode on mobile device. Create 3 transactions. Re-enable cellular data. Verify Sync Center transitions from `Offline` → `Pending` → `Synced`.

4. **Real Google OAuth on Deployed Production URL:**
   - *Status:* **NOT VERIFIED — REQUIRES MANUAL TESTING AFTER DEPLOYMENT**
   - *Instructions:* Verify popup Google Sign-In completes and redirects without `auth/unauthorized-domain` errors on the live Vercel domain.

5. **Physical Multi-Device Conflict UX:**
   - *Status:* **NOT VERIFIED — REQUIRES MANUAL TESTING AFTER DEPLOYMENT**
   - *Instructions:* Turn off Wi-Fi on Device A and Device B. Edit transaction amount to ₹200 on Device A and ₹350 on Device B. Reconnect both devices. Verify the Conflict Center badge appears on both devices and allows human selection.

---

## Final Status

**PRE-RELEASE VALIDATION PASSED — MANUAL DEPLOYMENT TESTING REMAINS**
