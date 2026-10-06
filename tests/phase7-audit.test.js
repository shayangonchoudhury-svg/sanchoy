// Phase 7 Master End-to-End System Audit & Regression Test Suite
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
  getReconciledLedgerState,
  addTransaction,
  deleteTransaction
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
  generateRecoveryCode,
  normalizeRecoveryCode
} from '../js/security/recovery.js';

// Multi-Device Sync & Merge
import {
  getOrCreateDeviceId,
  generateSecureDeviceId
} from '../js/sync/device.js';

import {
  getSyncMetadata,
  saveSyncMetadata,
  advanceLocalRevision,
  recordSyncSuccess,
  SyncState
} from '../js/sync/revision.js';

import {
  getOfflineQueue,
  enqueueMutation,
  clearOfflineQueue
} from '../js/sync/queue.js';

import {
  mergeFinancialWorkspaces
} from '../js/sync/merge.js';

import {
  getActiveConflicts,
  preserveConflict,
  removeConflictItem,
  clearConflicts
} from '../js/sync/conflict.js';

import {
  checkSafeMergeability,
  constructSafeMerge
} from '../js/ui/conflict-resolution.js';

import {
  getSyncStatus,
  SyncStatus
} from '../js/firebase/sync.js';

import { routes } from '../js/ui/ui.js';

function resetStorage() {
  safeStorage.removeItem('et_master_password_hash');
  safeStorage.removeItem('sanchoy_device_id');
  safeStorage.removeItem('sanchoy_sync_meta');
  safeStorage.removeItem('sanchoy_mutation_queue');
  safeStorage.removeItem('sanchoy_active_conflicts');
  safeStorage.removeItem('et_txs_v1');
  safeStorage.removeItem('sanchoy_starting_balances_v1');
  safeStorage.removeItem('sanchoy_allowance_config_v1');
  signOutSecuritySession();
}

// ==========================================
// 1. ALLOWANCE ENGINE EXACTNESS & CALENDAR RULES
// ==========================================

test('AUDIT - ALLOWANCE: Calendar days calculation across standard, leap, and short months', () => {
  assert.equal(getDaysInMonth(2026, 1), 31);  // Jan 2026
  assert.equal(getDaysInMonth(2026, 2), 28);  // Feb 2026 non-leap
  assert.equal(getDaysInMonth(2024, 2), 29);  // Feb 2024 leap year
  assert.equal(getDaysInMonth(2026, 4), 30);  // Apr 2026
  assert.equal(getDaysInMonth(2026, 8), 31);  // Aug 2026
  assert.equal(getDaysInMonth(2026, 9), 30);  // Sep 2026
});

test('AUDIT - ALLOWANCE: Exact mathematical formula Monthly / DaysInMonth without premature rounding', () => {
  // ₹800 in 30-day month = 26.6666...
  const rate30 = getDailyAllocation(800, 2026, 9);
  assert.equal(rate30, 800 / 30);
  assert.equal(round(rate30), 26.67);

  // ₹800 in 31-day month = 25.8064...
  const rate31 = getDailyAllocation(800, 2026, 8);
  assert.equal(rate31, 800 / 31);
  assert.equal(round(rate31), 25.81);

  // ₹800 in 28-day month = 28.5714...
  const rate28 = getDailyAllocation(800, 2026, 2);
  assert.equal(rate28, 800 / 28);
  assert.equal(round(rate28), 28.57);
});

// ==========================================
// 2. FINANCIAL LEDGER RECONCILIATION & RECOVERY
// ==========================================

test('AUDIT - FINANCIAL: Complete ledger reconciliation formula Starting + Allocations + Income - Expenses = Balance', () => {
  resetStorage();

  const starting = { online: 1000, cash: 500 };
  const txs = [
    { id: 'tx-1', amount: 250, type: 'expense', method: 'Online', category: 'Food', date: '2026-09-02T10:00:00Z' },
    { id: 'tx-2', amount: 150, type: 'income', method: 'Cash', category: 'Gift', date: '2026-09-02T11:00:00Z' },
    { id: 'tx-3', amount: 50, type: 'expense', method: 'Cash', category: 'Transport', date: '2026-09-02T12:00:00Z' }
  ];

  const config = {
    monthlyOnlineAllowance: 0,
    monthlyCashAllowance: 0,
    effectiveDate: '2026-09-01'
  };

  const ledger = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig: config,
    initialBalances: starting,
    asOfDate: '2026-09-02'
  });

  // Online: 1000 - 250 = 750
  assert.equal(round(ledger.wallets.online), 750);
  // Cash: 500 + 150 - 50 = 600
  assert.equal(round(ledger.wallets.cash), 600);
  // Total: 750 + 600 = 1350
  assert.equal(round(ledger.wallets.total), 1350);
});

test('AUDIT - RECOVERY: Deterministic days calculation ceil(abs(deficit) / dailyAllocation)', () => {
  const estimate = calculateRecoveryEstimate(-100, 25);
  assert.equal(estimate.isNegative, true);
  assert.equal(estimate.deficit, 100);
  assert.equal(estimate.recoveryDays, 4); // 100 / 25 = 4 days
  assert.equal(estimate.isRecoverable, true);

  const oddEstimate = calculateRecoveryEstimate(-105, 25);
  assert.equal(oddEstimate.recoveryDays, 5); // ceil(105 / 25) = ceil(4.2) = 5 days
});

// ==========================================
// 3. SECURITY BOUNDARIES & VOLATILE KEY CONTROL
// ==========================================

test('AUDIT - SECURITY: Lock removes DEK from application security context and masks financial displays', () => {
  resetStorage();

  setActiveUser({ uid: 'usr_audit_1', email: 'audit@sanchoy.io' });
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_LOCKED);

  const mockDEK = { type: 'secret', algorithm: { name: 'AES-GCM' } };
  setActiveWorkspaceDEK(mockDEK);

  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_UNLOCKED);
  assert.equal(getActiveWorkspaceDEK(), mockDEK);
  assert.equal(state.sessionUnlocked, true);
  assert.equal(money(1500), '₹1,500.00');

  // Trigger Lock
  lockWorkspaceMemory();

  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_LOCKED);
  assert.equal(getActiveWorkspaceDEK(), null); // DEK must be cleared from memory
  assert.equal(state.sessionUnlocked, false);
  assert.equal(money(1500), '₹ XXXX'); // Must be masked

  // Trigger Sign-out
  signOutSecuritySession();
  assert.equal(getSecurityState(), SecurityState.SIGNED_OUT);
  assert.equal(getActiveUser(), null);
});

// ==========================================
// 4. MULTI-DEVICE 3-WAY MERGE ZERO-LOSS AUDIT
// ==========================================

test('AUDIT - MULTI-DEVICE: Independent changes on Device A and Device B merge with zero data loss', () => {
  const base = {
    transactions: [
      { id: 'tx-shared', amount: 100, type: 'expense', method: 'Online', desc: 'Coffee' }
    ]
  };

  const devA = {
    transactions: [
      ...base.transactions,
      { id: 'tx-dev-a', amount: 50, type: 'expense', method: 'Cash', desc: 'Snack' }
    ]
  };

  const devB = {
    transactions: [
      ...base.transactions,
      { id: 'tx-dev-b', amount: 200, type: 'income', method: 'Online', desc: 'Gift' }
    ]
  };

  const mergeResult = mergeFinancialWorkspaces(devA, devB, base);
  assert.equal(mergeResult.success, true);
  assert.equal(mergeResult.hasConflict, false);
  assert.equal(mergeResult.mergedBundle.transactions.length, 3);
});

// ==========================================
// 5. CONFLICT RESOLUTION ZERO GUESSING AUDIT
// ==========================================

test('AUDIT - CONFLICT: Zero Guessing Rule strictly rejects automated merging of differing amounts', () => {
  const local = { id: 'tx-c1', amount: 500, type: 'expense', method: 'Online' };
  const remote = { id: 'tx-c1', amount: 800, type: 'expense', method: 'Online' };

  const canMerge = checkSafeMergeability(local, remote, false);
  assert.equal(canMerge, false, 'Engine must NEVER average or guess between differing amounts');
});

test('AUDIT - CONFLICT: Delete vs Edit collision strictly requires explicit human choice', () => {
  const local = null;
  const remote = { id: 'tx-c2', amount: 650, type: 'expense', method: 'Online' };

  const canMerge = checkSafeMergeability(local, remote, true);
  assert.equal(canMerge, false, 'Delete vs edit collisions must never auto-merge');
});

// ==========================================
// 6. ROUTE INTEGRITY & NAVIGATION AUDIT
// ==========================================

test('AUDIT - ROUTING: All declared routes map to existing view containers', () => {
  const expectedRoutes = ['/', '/tracker', '/analytics', '/vault', '/auth', '/sync'];
  for (const r of expectedRoutes) {
    assert.ok(routes[r], `Route ${r} must be defined in routes table`);
    assert.ok(routes[r].startsWith('page-'), `Route ${r} must map to a page-* container`);
  }
});

// ==========================================
// 7. OFFLINE DURABILITY AUDIT
// ==========================================

test('AUDIT - OFFLINE: Offline mutations persist in queue and survive sequential operations', () => {
  resetStorage();
  clearOfflineQueue();

  enqueueMutation('ADD_TX', { id: 'tx-off-1', amount: 120 });
  enqueueMutation('EDIT_TX', { id: 'tx-off-1', amount: 140 });

  const queue = getOfflineQueue();
  assert.equal(queue.length, 2);
  assert.equal(queue[0].type, 'ADD_TX');
  assert.equal(queue[1].type, 'EDIT_TX');

  clearOfflineQueue();
  assert.equal(getOfflineQueue().length, 0);
});
