# SANCHOY PHASE 6B — CONFLICT RESOLUTION EXPERIENCE

## 1. Executive Summary

Phase 6B introduces the interactive, user-facing **Conflict Resolution Experience** for the Sanchoy application.

### Important Architectural Assertion
> **Phase 6B uses the existing Phase 5 conflict and merge architecture. It does not introduce a parallel conflict engine, custom queue, or separate identity system.**

When multi-device divergence is detected and preserved by Phase 5, Phase 6B empowers the user to review the conflicting states side-by-side (or stacked on mobile), inspect differing fields, and explicitly choose how to resolve them with **zero silent data loss** and **zero financial estimation**.

---

## 2. Supported Conflict Types & Resolution Modes

### Type A — Edit vs Edit
- **Divergence:** Both Device A and Device B modified the same existing transaction with differing attributes (e.g. amount ₹500 on Device A vs ₹800 on Device B).
- **Available Actions:**
  - `Keep This Version` (Keep Local)
  - `Keep Other Version` (Keep Remote/Cloud)
  - `Apply Merged Version` (Available ONLY when amounts, types, wallets, and dates are identical and only description text differs)

### Type B — Delete vs Edit
- **Divergence:** One device deleted the transaction while the other device modified it.
- **Available Actions:**
  - `Keep Deleted` (Confirms deletion across devices)
  - `Keep Modified` (Re-activates and keeps the modified transaction)
  - Automatic merge is strictly disabled on delete-vs-edit collisions.

### Zero Guessing & Financial Integrity Guarantee
- Sanchoy **NEVER** averages financial values (₹500 vs ₹800 does not become ₹650).
- Sanchoy **NEVER** estimates or guesses which device is "more correct."
- All core financial changes require explicit user selection.

---

## 3. Conflict Lifecycle Architecture

```
[Concurrent Edits Detected in Phase 5 Sync Engine]
                     │
                     ▼
[Preserved in safeStorage: sanchoy_active_conflicts]
                     │
                     ▼
[Sync Center: "! Conflict" ──► "Review Conflicts"]
                     │
                     ▼
[Conflict List Modal (js/ui/conflict-resolution.js)]
   ├── Human-readable transaction cards (Zero raw IDs exposed)
   └── "Review Difference" Button
                     │
                     ▼
[Detailed Conflict Comparison Screen]
   ├── Desktop: 2-column balanced panels (This Device vs Other Device)
   ├── Mobile: Stacked comparison cards (Changed vs Same badges)
   └── Field difference highlight (Amount, Category, Wallet, Date, Note)
                     │
                     ▼
[User Choice: Keep Local / Keep Other / Safe Merge]
                     │
                     ▼
[Confirmation Dialog (Explains ledger recalculation)]
                     │
                     ▼
[Application of Resolution]
   ├── 1. Updates transactions array via saveTxs()
   ├── 2. Reconciles virtual ledger & derived balances deterministically
   ├── 3. Enqueues RESOLVE_CONFLICT mutation in offline queue
   ├── 4. Removes resolved conflict item via removeConflictItem()
   └── 5. Triggers cloud synchronization via syncWorkspaceToCloud()
                     │
                     ▼
[Result Notification Dialog]
   ├── If online: "Conflict Resolved ✓"
   └── If offline: "Resolution Saved Locally ○ (Safely stored on device)"
```

---

## 4. UI Architecture & Responsive Comparison

### 4.1 Desktop (2-Column Balanced Comparison)
- Two equal-width cards: **This Device (Local)** on the left and **Other Device (Cloud)** on the right.
- Changed fields are clearly indicated without favoring either device.
- Direct action buttons: `Keep This Version` and `Keep Other Version`.

### 4.2 Mobile (Stacked Field Cards)
- Individual field cards displaying:
  - Field label (e.g. `Amount`, `Category`, `Wallet`)
  - Status badge (`Changed` or `Same`)
  - Sub-grid showing values for "This Device" and "Other Device"
- Preserves the mobile bottom navigation bar (`Home | Charts | + | Vault | Settings`).

### 4.3 Safe Merge Preview
- If `checkSafeMergeability()` evaluates to true (amounts, types, wallets, categories, and dates match), a deterministic merge node appears showing the combined description.
- Requires explicit user confirmation before applying.

---

## 5. Security & Session Integrity

- **Locked Workspace (`AUTHENTICATED_LOCKED`):**
  - When the session is locked or the active DEK is cleared, conflict review displays a lock notice: *"Financial transaction details are encrypted. Please unlock your workspace with your Private Passcode to review conflict differences."*
  - Zero plaintext amounts or descriptions are exposed.
  - Active lock events (`auth:lock`) immediately close any open conflict modals.
- **Signed-Out State (`SIGNED_OUT`):**
  - All decrypted memory is cleared; conflict UI cannot be accessed without authenticating.
- **Zero Plaintext in Firestore:**
  - Resolutions update the encrypted cloud workspace (`/users/{uid}/private/workspace`) as standard AES-GCM ciphertext.

---

## 6. Files Created & Modified

### Files Created
1. `/js/ui/conflict-resolution.js` — Conflict resolution presentation, difference evaluation, safe merge validator, and confirmation workflows.
2. `/tests/phase6b-conflict-resolution.test.js` — Automated test suite verifying conflict retrieval, independent item resolution, safe merge rejection of differing amounts, ledger recalculation, and mutation queuing.
3. `/docs/PHASE_6B_CONFLICT_RESOLUTION.md` — This architectural documentation.

### Files Modified
1. `/js/sync/conflict.js` — Added `removeConflictItem(entityId)` to safely resolve individual conflicts while retaining remaining unresolved conflicts.
2. `/js/ui/sync-center.js` — Connected `#syncCenterReviewConflictsBtn` to `openConflictListModal()`.
3. `/package.json` — Added `tests/phase6b-conflict-resolution.test.js` to `npm test`.

---

## 7. Verification & Test Results

- **Pre-existing tests before Phase 6B:** 70 passed
- **New Phase 6B tests:** 7 added
- **Total passing tests:** **77/77 tests passed (100% pass rate)**:
  - `15/15` Financial Engine & Daily Allowance tests
  - `15/15` Transaction System & Reconciliation tests
  - `7/7` Phase 4 Dual-Layer Cryptography tests
  - `12/12` Phase 4.1 Security Hardening tests
  - `13/13` Phase 5 Multi-Device Synchronization tests
  - `8/8` Phase 6A Sync Center & Status System tests
  - `7/7` Phase 6B Conflict Resolution & Financial Integrity tests:
    - Multiple conflict items preserved and retrieved safely
    - Independent item resolution via `removeConflictItem()`
    - Safe merge rejection when amounts differ (Zero Guessing Rule)
    - Safe merge rejection on delete-vs-edit collisions
    - Safe merge acceptance when only notes differ
    - Deterministic financial ledger recalculation upon resolution
    - Mutation queue entry created on resolution
- **Compilation:** Clean compilation with `npm run build`.
- **Linting:** Clean lint check with `npm run lint`.
- **Runtime Check:** Applet running cleanly on port 3000.
