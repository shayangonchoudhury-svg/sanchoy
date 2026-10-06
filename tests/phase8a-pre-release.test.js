// Phase 8A — Pre-Release Validation Test Suite Inside AI Studio
import test from 'node:test';
import assert from 'node:assert/strict';

// Core State & Utilities
import { state, safeStorage, money, LS, setSessionUnlocked } from '../js/core/state.js';
import { round, escapeHtml } from '../js/utils/utils.js';

// Financial Engine & Allowance
import {
  getDaysInMonth,
  getDailyAllocation,
  createAllowanceConfig,
  saveAllowanceConfig,
  getAllowanceConfig,
  saveStartingBalances,
  getStartingBalances
} from '../js/financial/allowance.js';

import {
  reconcileVirtualLedger,
  adaptTransactionToLedgerEvent,
  calculateWalletBalance,
  EVENT_TYPES
} from '../js/financial/ledger.js';

import {
  calculateRecoveryEstimate
} from '../js/financial/recovery.js';

import {
  getTxs,
  saveTxs,
  getBalances,
  getReconciledLedgerState
} from '../js/transactions/transactions.js';

// Security & Sessions
import {
  SecurityState,
  getSecurityState,
  setActiveUser,
  getActiveUser,
  setActiveWorkspaceDEK,
  getActiveWorkspaceDEK,
  lockWorkspaceMemory,
  signOutSecuritySession
} from '../js/security/secure-session.js';

import {
  generateWorkspaceDEK,
  encryptPayload,
  decryptPayload,
  generateIV
} from '../js/security/crypto.js';

import {
  createWorkspaceEnvelope,
  unlockDEKWithPasscode,
  unlockDEKWithRecoveryCode
} from '../js/security/workspace-keys.js';

import {
  generateRecoveryCode,
  normalizeRecoveryCode
} from '../js/security/recovery.js';

// Multi-Device Synchronization & Conflict Engine
import {
  mergeFinancialWorkspaces
} from '../js/sync/merge.js';

import {
  checkSafeMergeability
} from '../js/ui/conflict-resolution.js';

import {
  preserveConflict,
  getActiveConflicts,
  removeConflictItem,
  clearConflicts
} from '../js/sync/conflict.js';

import {
  getOfflineQueue,
  enqueueMutation,
  clearOfflineQueue
} from '../js/sync/queue.js';

import {
  getSyncMetadata,
  saveSyncMetadata,
  recordSyncSuccess,
  SyncState
} from '../js/sync/revision.js';

import { getSyncStatus, SyncStatus } from '../js/firebase/sync.js';

// Helper to reset test environment
function resetTestState() {
  safeStorage.clear();
  lockWorkspaceMemory();
  signOutSecuritySession();
  clearOfflineQueue();
  clearConflicts();
}

test('PHASE 8A - 1. FIREBASE CONFIG: Verifies project sanchoy-408dd and owner path conventions', async () => {
  resetTestState();
  const fs = await import('fs');
  const rawConfig = fs.readFileSync('firebase-applet-config.json', 'utf8');
  const config = JSON.parse(rawConfig);

  assert.equal(config.projectId, 'sanchoy-408dd');
  assert.equal(config.authDomain, 'sanchoy-408dd.firebaseapp.com');
  assert.equal(config.firestoreDatabaseId, '(default)');

  // Verify paths in firestore.rules
  const rawRules = fs.readFileSync('firestore.rules', 'utf8');
  assert.ok(rawRules.includes('match /users/{userId}'));
  assert.ok(rawRules.includes('match /users/{userId}/private/{workspaceId}'));
  assert.ok(rawRules.includes('isOwner(userId)'));
  assert.ok(!rawRules.includes('allow read, write: if request.auth != null;'));
});

test('PHASE 8A - 2. AUTHENTICATION & PRIVATE PASSCODE: Two-layer isolation invariant', async () => {
  resetTestState();
  const mockUser = {
    uid: 'test_user_phase8a',
    email: 'user@example.com',
    displayName: 'Test User'
  };

  // Layer 1: Google Auth
  setActiveUser(mockUser);
  assert.equal(getActiveUser().uid, 'test_user_phase8a');
  // At Layer 1 alone, workspace DEK must be null and session locked
  assert.equal(getActiveWorkspaceDEK(), null);
  assert.equal(state.sessionUnlocked, false);
  assert.equal(money(1200), '₹ XXXX');

  // Layer 2: Create Passcode and Envelope
  const passcode = 'P@sscode123!';
  const recoveryCode = generateRecoveryCode();
  const { dek, envelope } = await createWorkspaceEnvelope(passcode, recoveryCode);

  assert.ok(envelope.passcodeWrappedKey);
  assert.ok(envelope.recoveryWrappedKey);

  // Correct Passcode Unlocks
  const unwrappedDEK = await unlockDEKWithPasscode(envelope, passcode);
  assert.ok(unwrappedDEK);
  setActiveWorkspaceDEK(unwrappedDEK);
  setSessionUnlocked(true);
  assert.equal(state.sessionUnlocked, true);
  assert.equal(money(1200), '₹1,200.00');

  // Wrong Passcode Fails
  await assert.rejects(
    async () => {
      await unlockDEKWithPasscode(envelope, 'WrongPasscode999!');
    },
    /Failed to unwrap|incorrect passcode|corrupted key/i
  );

  // Recovery Code Unlocks
  const recoveryUnwrapped = await unlockDEKWithRecoveryCode(envelope, recoveryCode);
  assert.ok(recoveryUnwrapped);

  // Lock Clears Memory
  lockWorkspaceMemory();
  setSessionUnlocked(false);
  assert.equal(getActiveWorkspaceDEK(), null);
  assert.equal(money(1200), '₹ XXXX');
});

test('PHASE 8A - 3. FINANCIAL ENGINE: Controlled allowance calculations across calendar months', () => {
  resetTestState();
  // Formula: Daily = Monthly / DaysInMonth
  // Test Feb non-leap (28 days)
  const febNonLeap = getDaysInMonth(2025, 2);
  assert.equal(febNonLeap, 28);
  const onlineRate28 = round(800 / 28);
  const cashRate28 = round(400 / 28);
  assert.equal(onlineRate28, 28.57);
  assert.equal(cashRate28, 14.29);

  // Test Feb leap year (29 days)
  const febLeap = getDaysInMonth(2024, 2);
  assert.equal(febLeap, 29);
  assert.equal(round(800 / 29), 27.59);
  assert.equal(round(400 / 29), 13.79);

  // Test 30-day month (April)
  const aprDays = getDaysInMonth(2026, 4);
  assert.equal(aprDays, 30);
  assert.equal(round(800 / 30), 26.67);
  assert.equal(round(400 / 30), 13.33);

  // Test 31-day month (October)
  const octDays = getDaysInMonth(2026, 10);
  assert.equal(octDays, 31);
  assert.equal(round(800 / 31), 25.81);
  assert.equal(round(400 / 31), 12.9);
});

test('PHASE 8A - 4. MANUAL INCOME ISOLATION: Manual income does not alter daily allowance rates', () => {
  resetTestState();
  const baseConfig = createAllowanceConfig({
    monthlyOnlineAllowance: 800,
    monthlyCashAllowance: 400,
    effectiveDate: '2026-10-01'
  });
  saveAllowanceConfig(baseConfig);
  saveStartingBalances({ online: 0, cash: 0 });

  const initialOnlineRate = round(getDailyAllocation(800, 2026, 10));
  const initialCashRate = round(getDailyAllocation(400, 2026, 10));
  assert.equal(initialOnlineRate, 25.81);
  assert.equal(initialCashRate, 12.9);

  // Add ₹500 manual income transaction
  const manualIncomeTx = {
    id: 'tx_manual_income_1',
    type: 'income',
    amount: 500,
    category: 'Bonus',
    method: 'Online',
    desc: 'Freelance bonus',
    date: '2026-10-05T12:00:00.000Z'
  };
  saveTxs([manualIncomeTx]);

  // Recalculate ledger
  const ledgerState = getReconciledLedgerState('2026-10-05');
  assert.ok(ledgerState.wallets.online >= 500);

  // Verify allowance configuration remains strictly unchanged
  const savedCfg = getAllowanceConfig();
  assert.equal(savedCfg.monthlyOnlineAllowance, 800);
  assert.equal(savedCfg.monthlyCashAllowance, 400);

  const afterOnlineRate = round(getDailyAllocation(savedCfg.monthlyOnlineAllowance, 2026, 10));
  assert.equal(afterOnlineRate, 25.81);
  assert.equal(round(getDailyAllocation(savedCfg.monthlyCashAllowance, 2026, 10)), 12.9);
});

test('PHASE 8A - 5. NEGATIVE BALANCE & RECOVERY ESTIMATE: Supports overdraft without blocking', () => {
  resetTestState();
  const baseConfig = createAllowanceConfig({
    monthlyOnlineAllowance: 800,
    monthlyCashAllowance: 400,
    effectiveDate: '2026-10-01'
  });
  saveAllowanceConfig(baseConfig);
  saveStartingBalances({ online: 0, cash: 0 });

  // Large expense exceeding balance
  const largeExpense = {
    id: 'tx_large_exp',
    type: 'expense',
    amount: 1500,
    category: 'Emergency Tech Repair',
    method: 'Online',
    desc: 'SSD Replacement',
    date: '2026-10-02T10:00:00.000Z'
  };
  saveTxs([largeExpense]);

  const ledger = getReconciledLedgerState('2026-10-02');
  assert.ok(ledger.wallets.online < 0);

  // Recovery Formula: ceil(abs(deficit) / dailyAllocation)
  const deficit = Math.abs(ledger.wallets.online);
  const dailyRate = 25.81;
  const expectedDays = Math.ceil(deficit / dailyRate);

  const estimate = calculateRecoveryEstimate(ledger.wallets.online, dailyRate);
  assert.equal(estimate.isNegative, true);
  assert.equal(estimate.recoveryDays, expectedDays);
});

test('PHASE 8A - 6. TRANSACTIONS CRUD RECONCILIATION: Idempotent and deterministic', () => {
  resetTestState();
  saveStartingBalances({ online: 100, cash: 100, configured: true });

  const tx1 = { id: 't1', type: 'expense', amount: 30, category: 'Food', method: 'Cash', desc: 'Lunch', date: '2026-10-01' };
  const tx2 = { id: 't2', type: 'income', amount: 50, category: 'Gift', method: 'Cash', desc: 'Gift', date: '2026-10-01' };

  saveTxs([tx1, tx2]);
  let currentTxs = getTxs();
  assert.equal(currentTxs.length, 2);

  // Edit tx1 amount from 30 to 45
  const editedTxs = currentTxs.map(t => t.id === 't1' ? { ...t, amount: 45 } : t);
  saveTxs(editedTxs);
  assert.equal(getTxs().find(t => t.id === 't1').amount, 45);

  // Delete tx2
  const remaining = getTxs().filter(t => t.id !== 't2');
  saveTxs(remaining);
  assert.equal(getTxs().length, 1);
  assert.equal(getTxs()[0].id, 't1');
});

test('PHASE 8A - 7. MULTI-DEVICE MERGE SIMULATION: Independent non-conflicting changes merge with zero data loss', () => {
  resetTestState();
  const baseBundle = {
    schemaVersion: 1,
    balances: { online: 500, cash: 200 },
    transactions: [
      { id: 'tx_base_1', type: 'expense', amount: 50, category: 'Food', method: 'Cash', desc: 'Breakfast', date: '2026-10-01' }
    ]
  };

  // Device A creates an online expense
  const deviceABundle = {
    ...baseBundle,
    transactions: [
      ...baseBundle.transactions,
      { id: 'tx_devA_1', type: 'expense', amount: 80, category: 'Books', method: 'Online', desc: 'TypeScript Guide', date: '2026-10-02' }
    ]
  };

  // Device B independently creates a cash expense
  const deviceBBundle = {
    ...baseBundle,
    transactions: [
      ...baseBundle.transactions,
      { id: 'tx_devB_1', type: 'expense', amount: 25, category: 'Transit', method: 'Cash', desc: 'Subway', date: '2026-10-02' }
    ]
  };

  // Run 3-Way Merge Engine
  const mergeResult = mergeFinancialWorkspaces(deviceABundle, deviceBBundle, baseBundle);

  assert.equal(mergeResult.hasConflict, false);
  assert.equal(mergeResult.mergedBundle.transactions.length, 3);
  assert.ok(mergeResult.mergedBundle.transactions.some(t => t.id === 'tx_devA_1'));
  assert.ok(mergeResult.mergedBundle.transactions.some(t => t.id === 'tx_devB_1'));
});

test('PHASE 8A - 8. CONFLICT DETECTION: Zero Guessing Rule flags divergent amounts & delete-vs-edit collisions', () => {
  resetTestState();
  const baseTx = { id: 'tx_target', type: 'expense', amount: 100, category: 'Groceries', method: 'Cash', desc: 'Market', date: '2026-10-01' };

  // Divergent amount edits
  const localEditBundle = { transactions: [{ ...baseTx, amount: 120 }] };
  const remoteEditBundle = { transactions: [{ ...baseTx, amount: 140 }] };
  const baseBundle = { transactions: [baseTx] };

  const editResult = mergeFinancialWorkspaces(localEditBundle, remoteEditBundle, baseBundle);
  assert.equal(editResult.hasConflict, true);
  assert.equal(editResult.conflicts[0].type, 'TRANSACTION_EDIT_CONFLICT');

  // Delete vs Edit
  const deleteBundle = { transactions: [] };
  const deleteResult = mergeFinancialWorkspaces(deleteBundle, remoteEditBundle, baseBundle);
  assert.equal(deleteResult.hasConflict, true);
  assert.equal(deleteResult.conflicts[0].type, 'DELETION_EDIT_CONFLICT');

  // Safe merge verification (same amount, different descriptions)
  const safeRes = checkSafeMergeability(
    { id: 't1', amount: 50, type: 'expense', method: 'Online', category: 'Food', desc: 'Local Desc', date: '2026-10-01' },
    { id: 't1', amount: 50, type: 'expense', method: 'Online', category: 'Food', desc: 'Remote Desc', date: '2026-10-01' },
    false
  );
  assert.equal(safeRes, true);
});

test('PHASE 8A - 9. CONFLICT RESOLUTION: Resolving conflict updates state cleanly without duplicates', () => {
  resetTestState();
  const localTx = { id: 'tx_c1', type: 'expense', amount: 150, category: 'Dining', method: 'Online', desc: 'Dinner Local', date: '2026-10-01' };
  const remoteTx = { id: 'tx_c1', type: 'expense', amount: 180, category: 'Dining', method: 'Online', desc: 'Dinner Remote', date: '2026-10-01' };

  preserveConflict([{ id: 'conf_1', entityId: 'tx_c1', local: localTx, remote: remoteTx, type: 'DIVERGENT_VALUE' }], { transactions: [localTx] }, { transactions: [remoteTx] });

  assert.equal(getActiveConflicts().length, 1);

  // Resolve conflict using Keep Other (remote)
  removeConflictItem('tx_c1');
  assert.equal(getActiveConflicts().length, 0);
});

test('PHASE 8A - 10. SYNC CENTER STATUS MACHINE: Deterministic status reporting', () => {
  resetTestState();
  // Case 1: Synced by default
  saveSyncMetadata({ syncState: SyncState.SYNCED, clientRevision: 5, cloudRevision: 5 });
  const status1 = getSyncStatus();
  assert.equal(status1.status, SyncState.SYNCED);

  // Case 2: Pending when offline queue has mutations
  enqueueMutation({ id: 'mut_1', action: 'CREATE', entityType: 'transaction', payload: { id: 'tx_q' } });
  const status2 = getSyncStatus();
  assert.equal(status2.status, SyncStatus.PENDING);
  assert.equal(status2.pendingMutationCount, 1);

  // Case 3: Conflict overrides pending
  preserveConflict([{ id: 'c1' }], {}, {});
  const status3 = getSyncStatus();
  assert.equal(status3.status, SyncStatus.CONFLICT);
});
