# Sanchoy Vault Completeness Audit

## Executive Summary

A comprehensive, code-level inspection of the Sanchoy codebase reveals that the **Secret Savings Vault is INCOMPLETE**.

The Vault currently functions not as an active financial savings account integrated with the dual-ledger engine, but as an **isolated, manual monthly wealth log / journal**. Users can enter monthly savings snapshots partitioned across 7 categories (Cash Savings, Online Savings, Extra Savings, Emergency Fund, Investments, Gold Savings, Other Savings) with optional notes. 

While the Vault features an independent Web Crypto encryption layer (PBKDF2 with 100,000 iterations + AES-GCM 256-bit) and renders dedicated Chart.js visualizers, it has **zero integration with the daily transaction ledger, zero transfer mechanisms between wallets and Vault, zero mutation queueing for multi-device sync, and zero conflict resolution logic**.

---

## Current Vault UI

| Component / Feature | Implementation State | Code Location | Details |
|---|---|---|---|
| **Vault Total Balance** | **IMPLEMENTED** | `index.html:707`, `js/vault/vault.js:312-318` | Displays arithmetic sum of all recorded monthly savings nodes (`vault-total-savings`). |
| **Empty State** | **IMPLEMENTED** | `js/vault/vault.js:394-405` | Renders styled placeholder with "Seed Example Data" button when no records exist. |
| **Deposit / Add Money** | **NOT IMPLEMENTED** | N/A | There is no deposit action. Only an "Add Savings Node" modal (`#vaultRecordModal`) that captures static monthly amounts. |
| **Withdrawal** | **NOT IMPLEMENTED** | N/A | No mechanism to withdraw money from the Vault exists. |
| **Transfer from Online Wallet** | **NOT IMPLEMENTED** | N/A | No transfer mechanism exists; entering "Online Savings" in a node does not deduct from the Online wallet. |
| **Transfer from Cash Wallet** | **NOT IMPLEMENTED** | N/A | No transfer mechanism exists; entering "Cash Savings" in a node does not deduct from the Cash wallet. |
| **Transfer to Online / Cash Wallet** | **NOT IMPLEMENTED** | N/A | No reverse transfer exists. |
| **Transaction / History View** | **PARTIALLY IMPLEMENTED** | `index.html:776`, `js/vault/vault.js:362-491` | Displays a vertical timeline (`vault-timeline-list`) of **monthly snapshot cards**, not chronological financial transactions. |
| **Vault Settings** | **PARTIALLY IMPLEMENTED** | `index.html:690, 747-756`, `js/vault/vault.js:954-988` | Theme toggle (`#toggleVaultThemeBtn`), JSON backup (`#vaultBackupBtn`), CSV export (`#vaultCsvBtn`), and restore (`#vaultRestoreBtn`). |
| **Lock / Unlock State** | **IMPLEMENTED** | `js/vault/vault.js:154-293, 790-797` | Password authentication modal (`#vaultAuthPass`), SHA-256 hash check, PBKDF2 key derivation, memory wipe on lock. |
| **Loading States** | **NOT IMPLEMENTED** | N/A | Decryption and rendering occur without dedicated progress/loading spinners. |
| **Error States** | **PARTIALLY IMPLEMENTED** | `js/vault/vault.js:180, 270` | Inline incorrect password notification (`#vaultAuthError`) and toast notifications for corrupted backup files. |
| **Confirmation States** | **PARTIALLY IMPLEMENTED** | `js/vault/vault.js:714, 768` | Browser `confirm()` prompts for deleting records and merging restored backups. |
| **Mobile Layout** | **IMPLEMENTED** | `index.html:673-808`, `js/vault/vault.js:415-487` | Responsive layout with stacked cards, mobile grid collapse, and full-width inputs. |

---

## Current Financial Model

- **Is Vault part of the financial ledger?**
  **NO.** The transaction engine (`js/financial/ledger.js`, `js/transactions/transactions.js`) does not reference the `savings_vault` store or Vault balances in any calculation.
- **Is Vault included in Total Liquid Virtual Balance?**
  **NO.** `Total Liquid Virtual Balance` on the dashboard is strictly `Online Wallet Balance + Cash Wallet Balance`.
- **Is Vault treated as a third balance?**
  **NO.** It is a standalone aggregate displayed exclusively inside the `#page-vault` view.
- **Is Vault completely independent from wallet balances?**
  **YES.** Adding, editing, or deleting a ₹50,000 Vault record causes zero change to Online or Cash balances.
- **Can money actually move between wallets and Vault?**
  **NO.** There are no transfer actions, functions, or database hooks connecting wallets to Vault.
- **Are transfers represented as transactions?**
  **NO.** No transfer transaction types exist in `EVENT_TYPES` or `EXPENSE_CATEGORIES`.
- **Does transferring money change wallet balances?**
  **N/A.** Transfers do not exist.
- **Is Vault balance recalculated deterministically?**
  **NO.** The balance is simply `Array.reduce` summing the user-entered field values across stored monthly records. There is no chronological replay or ledger calculation.
- **Can Vault become negative?**
  **NO.** The UI inputs specify `min="0"`, and there is no overdraft or negative balance mechanism in the Vault.
- **Is Vault subject to the allowance engine?**
  **NO.** Daily automatic virtual allowance accrues strictly to Cash and Online wallets.
- **Does automatic allowance ever enter Vault?**
  **NO.**
- **Does manual income ever enter Vault automatically?**
  **NO.**

---

## Current Encryption

- **Status:** **IMPLEMENTED**
- **Algorithm:** **AES-GCM 256-bit** (`{ name: 'AES-GCM', length: 256 }`).
- **Key Derivation:** **PBKDF2** with **100,000 iterations**, SHA-256 (`deriveKey(password, salt)`).
- **Salt:** Generated as a 16-byte cryptographically secure random value (`crypto.getRandomValues(new Uint8Array(16))`) and stored in IndexedDB `app_settings` under key `vault_salt`.
- **IV:** 12-byte cryptographically secure random value generated per record, encoded as hex string.
- **Key Storage:** Stored in volatile runtime memory (`state.vaultCryptoKey`). Never written to `localStorage`, `sessionStorage`, or IndexedDB.
- **Local Storage Encryption:** **YES.** In IndexedDB `savings_vault`, records are stored as `{ id, month, iv: ivHex, data: ctHex }`. Plaintext values (`cashSavings`, `onlineSavings`, `notes`, etc.) are stripped prior to storage.
- **Cloud Upload Encryption:** **YES.**
- **Double Encryption:** **YES.** Vault records are first encrypted individually with the Vault PBKDF2/AES-GCM key inside IndexedDB. When `gatherLocalFinancialWorkspace()` bundles local data for cloud sync, the entire workspace bundle (containing the ciphertext Vault records) is encrypted a second time with the Workspace Data Encryption Key (DEK).
- **Memory Purge on Lock:** **YES.** Calling `lockVault()` sets `state.vaultUnlocked = false`, sets `state.vaultCryptoKey = null`, and resets `state.decryptedVaultRecords = []`.

---

## Current Cloud Sync

- **Workspace Serialization:** **IMPLEMENTED.** `gatherLocalFinancialWorkspace()` in `js/migration/local-to-cloud.js` reads all records from IndexedDB `savings_vault` and embeds them into `bundle.vaultRecords`. `restoreFinancialWorkspaceLocally()` restores them to IndexedDB.
- **Mutation Queue Support:** **NOT IMPLEMENTED.** `js/sync/queue.js` only handles `transaction`, `allowanceConfig`, `startingBalances`, and `RESOLVE_CONFLICT`. Neither `saveVaultSavings` nor `deleteVaultRecord` calls `enqueueMutation()`.
- **Sync Triggering:** **PARTIALLY IMPLEMENTED.** Vault mutations do not trigger `syncWorkspaceToCloud()`. Changes to the Vault only sync to the cloud if a subsequent wallet transaction triggers sync, if "Sync Now" is clicked, or upon initial workspace migration.
- **Revision Handling:** Vault data is bundled inside the global workspace revision (`clientRevision`), but does not have independent entity-level revision counters.
- **Stable IDs:** **YES.** Records use timestamps as IDs (`vault_${Date.now()}`).

---

## Current Offline Behavior

- **Offline Availability:** **IMPLEMENTED.** Vault records are read from and saved to local IndexedDB (`savings_vault`), allowing full offline access and editing.
- **Offline Durability:** **PARTIALLY IMPLEMENTED.** Vault edits survive browser restarts and offline states locally, but because they are not queued in `sanchoy_mutation_queue`, the Sync Center does not reflect pending Vault changes (`pendingMutationCount` remains 0).

---

## Current Conflict Handling

- **Conflict System:** **NOT IMPLEMENTED for Vault.**
- **Merge Engine Behavior:** In `js/sync/merge.js:212-221`:
  ```javascript
  function mergeVaultRecords(localRecords = [], remoteRecords = []) {
    const map = new Map();
    for (const r of (remoteRecords || [])) {
      if (r && r.id) map.set(r.id, r);
    }
    for (const r of (localRecords || [])) {
      if (r && r.id) map.set(r.id, r);
    }
    return Array.from(map.values());
  }
  ```
- **Consequence:** If the same monthly Vault record is edited on two different devices, `mergeVaultRecords` performs a **blind local-overwrite** based on ID. Zero conflict records are produced, zero conflict notifications are shown, and the user is never prompted to resolve divergent amounts in savings nodes.

---

## Existing Tests

The codebase currently contains **4 tests** that touch Vault functionality:

1. **`tests/financial-engine.test.js:300`** (`TEST 15: Existing vault records remain readable`):
   - *What it verifies:* Verifies that a static mock object with Vault properties (`cashSavings`, `onlineSavings`, etc.) can have its numbers summed mathematically. Does not test actual database operations or Vault methods.
2. **`tests/transaction-system.test.js:278`** (`TEST 14: Existing Vault records remain readable`):
   - *What it verifies:* Verifies property existence (`id`, `month`, `cashSavings`) on an in-memory mock record.
3. **`tests/phase4-1-hardening.test.js:333`** (`VAULT: Secret Savings Vault independent PBKDF2/AES-GCM encryption survives within workspace bundle`):
   - *What it verifies:* Genuinely tests Vault cryptography: derives an AES-GCM key from a master password, encrypts a record, verifies plaintext properties are stripped from ciphertext, decrypts with the correct key, and verifies that an incorrect key returns `null` (fail closed).
4. **`tests/phase5-sync.test.js:294`** (`VAULT INTEGRITY: Vault records survive multi-device merge without data corruption`):
   - *What it verifies:* Tests that `mergeFinancialWorkspaces` includes Vault records from two distinct device bundles in the merged output.

### Missing Test Categories
- No tests for adding, editing, or deleting Vault records via `saveVaultSavings`.
- No tests for Vault memory clearing on lock.
- No tests for Month-over-Month percentage growth calculation edge cases.
- No tests for Vault timeline search and sort filtering.
- No tests for Vault backup JSON export and restore schema validation.
- No tests for Vault concurrent edit collisions across multiple devices.

---

## Missing Functionality

1. **Wallet-to-Vault Liquidity Transfers:** No ability to move funds from Cash or Online wallets into the Vault or withdraw funds back into liquid wallets.
2. **First-Class Transfer Transaction Types:** No ledger support for internal balance reallocation.
3. **Mutation Queue Integration:** Vault modifications bypass `js/sync/queue.js`, rendering Vault changes invisible to Sync Center pending counts.
4. **Automated Cloud Sync Triggering:** Creating or deleting a Vault node does not automatically invoke `syncWorkspaceToCloud()`.
5. **Conflict Detection & Resolution:** Concurrent edits to Vault nodes on separate devices resolve via silent local overwrite rather than the Phase 6B conflict resolution workflow.
6. **Unified Wealth Reporting:** No combined view calculating Total Net Worth (Liquid Wallets + Vault Reserves).

---

## UX Gaps

1. **Conceptual Disconnect:** The UI markets the Vault as a "Secret Savings Vault" for securing wealth, but users cannot actually "save" money from their monthly allowance or daily balances into it. It behaves as a separate manual bookkeeping journal.
2. **Redundant Authentication Friction:** Unlocking Sanchoy requires the Private Passcode (Layer 2). Accessing the Vault currently prompts for a "Master Password" verification modal, creating confusing double-authentication friction if the user expects their Sanchoy passcode to unlock their entire workspace.
3. **Silent Cloud Synchronization:** Users editing Vault records receive no visual confirmation in the Sync Center header pill that their savings records are queued or syncing.
4. **No Reversal / Audit Trail:** Deleting a monthly savings node is irreversible via the ledger; there is no chronological event log of when funds were added to or removed from the Vault.

---

## Financial Model Options

Before any code modifications or feature extensions are implemented, an architectural choice must be made between two distinct financial paradigms:

---

### MODEL A: Vault is a Third Balance Within the Sanchoy Financial Ledger

In this model, the Vault is an integrated account balance alongside `Online` and `Cash` within the deterministic ledger.

- **Balance Calculation:** `Vault Balance = Starting Vault Balance + Transfers In - Transfers Out`. Derived strictly by chronological ledger replay in `js/financial/ledger.js`.
- **Transfers:** First-class transactions (`type: 'transfer'`, `sourceWallet: 'online'`, `destinationWallet: 'vault'`).
- **Transaction History:** Transfers appear in the main transaction list and recent activity feeds with directional indicators (e.g., `Online → Vault (Savings)`).
- **Total Liquid Virtual Balance:** Clearly delineated between:
  - *Liquid Spending Capital:* `Online Wallet + Cash Wallet`
  - *Illiquid / Reserve Wealth:* `Vault Savings`
  - *Total Net Capital:* `Online + Cash + Vault`
- **Financial Health & Runway:** Recovery calculations can clearly show liquid deficit while indicating whether emergency reserves in the Vault cover the overdraft.
- **Charts:** Unified cashflow visualizers displaying liquid expenses vs. savings allocations over time.
- **Allowance:** Daily virtual allowance remains liquid (into Online/Cash), but allows optional automated savings rules (e.g., auto-route 15% of daily allowance to Vault).
- **Offline Sync & Conflicts:** **Inherits existing Phase 5 and Phase 6B architecture completely.** Transfers are standard ledger mutations that automatically use the mutation queue, 3-way merge, and existing conflict resolution UI.
- **Encryption:** Vault transactions are encrypted under the Workspace DEK (AES-GCM 256-bit). Double encryption can be removed or retained for node metadata.
- **User Experience:** Highly cohesive. Saving money feels real because moving ₹1,000 into the Vault immediately deducts ₹1,000 from the user's spending wallet.

---

### MODEL B: Vault is an Encrypted Savings Balance Separate from the Normal Liquid-Wallet Ledger

In this model, the Vault remains an independent, isolated wealth container for tracking off-ledger assets, long-term reserves, and static milestones.

- **Balance Calculation:** Computed as the sum of recorded asset nodes (`investments + gold + emergency fund + cash savings + online savings`). Independent of transactions and allowances.
- **Transfers:** No ledger transfers. Money recorded in the Vault does not deduct from Online or Cash wallets.
- **Transaction History:** Maintained on a dedicated monthly timeline inside `#page-vault`; completely separate from daily bookkeeping transactions.
- **Total Liquid Virtual Balance:** Unaffected by Vault entries. Remains strictly `Online + Cash`.
- **Financial Health & Runway:** Excludes Vault assets from liquid budget caps and recovery day estimates.
- **Charts:** Independent visualizers (`vaultDoughnutChart`, `vaultLineChart`) isolated to the Vault screen.
- **Allowance:** Zero interaction with the allowance engine.
- **Offline Sync & Conflicts:** **Requires custom sync infrastructure.** Must add `VAULT_SAVE` and `VAULT_DELETE` mutation actions to `js/sync/queue.js`, create a 3-way merge conflict detection algorithm for Vault records, and build a dedicated conflict comparison UI for Vault node fields.
- **Encryption:** Maintains independent defense-in-depth encryption using a distinct password-derived key (PBKDF2 100,000 iterations), keeping Vault data unreadable even if the primary workspace session is unlocked.
- **User Experience:** Operates as a confidential "Wealth & Investment Journal" or portfolio tracker. Users track overall wealth milestones without impacting their day-to-day allowance spending discipline.

---

## Recommended Next Design Decision

Before writing any implementation code or altering schemas, the following decisions must be made:

1. **Financial Architecture Selection:**
   - Choose **Model A** (Vault as an integrated 3rd ledger balance with active transfers) OR **Model B** (Vault as an independent, isolated wealth journal).
2. **Authentication / Key Derivation Model:**
   - Decide whether Vault authentication should be **unified with the Layer 2 Sanchoy Private Passcode** or remain a **separate, distinct secondary password**.
3. **Synchronization & Conflict Policy:**
   - If Model B is retained, decide whether Vault records require **full multi-device conflict resolution** or if the current simple Map union remains acceptable.

---

## Final Status

**INCOMPLETE**

*(The Vault possesses a working UI, responsive styling, and independent Web Crypto AES-GCM encryption, but lacks financial ledger integration, transfer capabilities, mutation queue synchronization, and conflict resolution).*

---

### Audit Summary

- **Files Inspected:**
  - `js/vault/vault.js`
  - `js/financial/ledger.js`
  - `js/financial/allowance.js`
  - `js/transactions/transactions.js`
  - `js/storage/database.js`
  - `js/migration/local-to-cloud.js`
  - `js/sync/merge.js`
  - `js/sync/queue.js`
  - `js/sync/conflict.js`
  - `js/ui/conflict-resolution.js`
  - `index.html`
- **Files Containing Vault Implementation:**
  - `js/vault/vault.js` (Core UI, encryption, local storage operations, charting)
  - `js/storage/database.js` (IndexedDB `savings_vault` object store definition)
  - `js/migration/local-to-cloud.js` (Workspace bundle gathering and restoring)
  - `js/sync/merge.js` (Union merge function `mergeVaultRecords`)
  - `index.html` (`#page-vault` container and `#vaultRecordModal`)
- **Automated Tests Found:**
  - `tests/financial-engine.test.js` (Test 15: Mock schema readability)
  - `tests/transaction-system.test.js` (Test 14: Mock property readability)
  - `tests/phase4-1-hardening.test.js` (Section 6: PBKDF2/AES-GCM encryption and wrong-key failure)
  - `tests/phase5-sync.test.js` (Section 7: 3-way merge preservation)
- **Primary Missing Functionality:**
  - Wallet ↔ Vault transfers
  - Ledger integration
  - Offline mutation queueing for Vault operations
  - Automated cloud sync triggering upon Vault changes
  - Multi-device conflict resolution for colliding savings nodes
- **Exact Decisions Required Before Implementation:**
  - Architectural choice: Model A (Integrated Ledger Balance) vs. Model B (Isolated Wealth Journal)
  - Authentication choice: Unified Sanchoy Passcode vs. Independent Master Password
  - Sync policy: Full Phase 6B conflict resolution for Vault vs. Map-union sync
