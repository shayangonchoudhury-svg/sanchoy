# SANCHOY PHASE 6A — SYNC CENTER UI & STATUS SYSTEM

## 1. Executive Summary

Phase 6A introduces the user-facing **Sync Center** and refines the synchronization status experience across the Sanchoy application.

### Important Architectural Boundary
> **Phase 6A does not implement conflict resolution. It only exposes existing synchronization and conflict state.**

Phase 6A strictly consumes the Phase 5 multi-device synchronization engine without rewriting, replacing, or duplicating any underlying cryptographic or ledger architecture.

---

## 2. UI Architecture & Entry Points

```
[Authenticated Header]
  └── Sync Status Badge (Button, Keyboard Accessible)
        ├── ✓ Synced
        ├── ↻ Syncing… (animate-ping)
        ├── ○ Offline · 2
        ├── ! Conflict
        └── × Sync Error
        └── On Click ──► Route: /sync (Sync Center)

[User Profile Popover]
  ├── Google Identity Status
  ├── Cloud Sync Status (with pending mutation counter)
  ├── Last Synced Timestamp
  ├── Truncated Anonymous Device ID (dev_XXXXXXXX…)
  └── "Open Sync Center" Button ──► Route: /sync (Sync Center)

[System Settings Modal]
  └── "Cloud Synchronization" Node
        └── "Open Sync Center" Button ──► Route: /sync (Sync Center)

[Route: /sync ──► section#page-sync]
  └── Sync Center Page View
```

---

## 3. Sync Center Information Architecture

The Sync Center (`js/ui/sync-center.js`) is organized into clean, responsive cards adhering to Sanchoy's design tokens:

### 3.1 Status Overview Cards (3-Column Grid, Responsive Stack on Mobile)
1. **Sync Status Card:**
   - Visual status pill (`✓ Synced`, `↻ Syncing…`, `○ Offline`, `! Conflict`, `× Sync Error`).
   - Plain-language non-technical description.
   - Exact formatted timestamp of last successful synchronization.
2. **Pending Changes Card:**
   - Live mutation count from the IndexedDB offline queue.
   - Plain-language explanation that offline mutations are durably preserved on-device and will synchronize automatically.
3. **Integrity & Conflicts Card:**
   - Live count of detected conflict items from `sanchoy_active_conflicts`.
   - "Review Conflicts" button (opens an informational notice modal explaining that both versions are preserved with zero data loss, and side-by-side reconciliation will be provided in the upcoming resolution phase).

### 3.2 Manual Actions Toolbar
- **"Sync Now" Button:**
  - Safely invokes `syncWorkspaceToCloud('sync_center_click')`.
  - Non-blocking, provides instant feedback via toast messages.
  - Automatically disabled when offline, syncing, locked, or signed out.

### 3.3 Anonymous Device Information
- **Browser:** Safe user-agent detection (Chrome, Firefox, Safari, Edge).
- **Platform:** Operating system family (Windows, macOS, Linux, Android, iOS).
- **Device ID:** Truncated 12-character anonymous cryptographic prefix (`dev_XXXXXXXX…`). Contains zero personal, network, or hardware fingerprinting data.

### 3.4 Recent Synchronization Activity
- In-memory session audit trail (bounded to 20 recent events).
- Captures `SYNCING`, `SYNCED`, `OFFLINE`, `ONLINE`, `CONFLICT`, and `ERROR` events with local timestamps.

---

## 4. State Safety: Locked & Signed-Out States

- **Locked State (`AUTHENTICATED_LOCKED`):**
  - When the workspace is locked (or active DEK is cleared), the Sync Center displays an informational notice: *"Financial encryption keys are cleared from active application context. Cloud synchronization will continue automatically once you unlock your workspace with your Private Passcode."*
  - Zero decrypted transactions, balances, allowances, or Vault records are rendered.
- **Signed-Out State (`SIGNED_OUT`):**
  - Displays a clean notice that the app is operating in local-only mode with a button redirecting to Google Sign-In.

---

## 5. Mobile Responsiveness & Accessibility

- **Responsive Stacking:** On small viewports (<640px), cards stack vertically with appropriate touch padding.
- **Preserved Navigation:** Mobile bottom navigation bar (`Home | Charts | + | Vault | Settings`) remains completely undisturbed. Sync Center is reached via the header badge, profile popover, or settings.
- **Non-Color Dependent Indicators:** Every status state includes explicit iconography, plain text, and distinct `aria-label` attributes (`✓ Synced`, `↻ Syncing…`, `○ Offline`, `! Conflict`, `× Sync Error`).
- **Contrast & Focus:** All action buttons have `:focus-visible` outlines and adhere to both Light (Premium FinTech) and Dark (Futuristic OS) theme palettes.

---

## 6. Files Created & Modified

### Files Created
1. `/js/ui/sync-center.js` — Sync Center view controller and conflict notice modal.
2. `/tests/phase6a-sync-center.test.js` — Automated test suite verifying status mapping, activity logging, route registration, and metadata security.
3. `/docs/PHASE_6A_SYNC_CENTER.md` — This architectural and operational documentation.

### Files Modified
1. `/index.html` — Added `<section id="page-sync" class="page ..."></section>`.
2. `/js/ui/ui.js` — Registered `/sync` $\rightarrow$ `page-sync` in the application routing table.
3. `/js/app.js` — Added `page-sync` handler in page navigation lifecycle to render the Sync Center dynamically.
4. `/js/firebase/sync.js` — Added session activity tracking (`recordSyncActivity`, `getSyncActivityLog`), environment-safe `onLine` checking for Node tests, and enhanced header badge keyboard accessibility.
5. `/js/ui/profile-popover.js` — Added "Open Sync Center" quick action and last synced timestamp display.
6. `/js/ui/settings-modal.js` — Added "Cloud Synchronization" section with "Open Sync Center" button.
7. `/package.json` — Added `tests/phase6a-sync-center.test.js` to automated test script.

---

## 7. Verification & Test Results

- **Pre-existing tests:** 62 passed
- **New Phase 6A tests:** 8 added
- **Total passing tests:** **70/70 tests passed (100% pass rate)**:
  - 15/15 Financial Engine & Daily Allowance tests
  - 15/15 Transaction System & Reconciliation tests
  - 7/7 Phase 4 Dual-Layer Cryptography tests
  - 12/12 Phase 4.1 Security Hardening tests
  - 13/13 Phase 5 Multi-Device Synchronization & Merge tests
  - 8/8 Phase 6A Sync Center & Status System tests
- **Compilation:** Clean compilation with `npm run build`.
- **Linting:** Clean lint check with `npm run lint`.
