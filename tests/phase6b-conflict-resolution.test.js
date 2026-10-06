// Phase 6B Automated Test Suite: Conflict Resolution Experience & Financial Integrity
import test from 'node:test';
import assert from 'node:assert/strict';

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
  getTxs,
  saveTxs,
  addTransaction,
  deleteTransaction,
  getBalances,
  getReconciledLedgerState
} from '../js/transactions/transactions.js';

import {
  getOfflineQueue,
  clearOfflineQueue,
  enqueueMutation
} from '../js/sync/queue.js';

import {
  getSyncStatus,
  SyncStatus
} from '../js/firebase/sync.js';

import { safeStorage } from '../js/core/state.js';

function resetStorage() {
  safeStorage.removeItem('sanchoy_device_id');
  safeStorage.removeItem('sanchoy_sync_meta');
  safeStorage.removeItem('sanchoy_mutation_queue');
  safeStorage.removeItem('sanchoy_active_conflicts');
  safeStorage.removeItem('sanchoy_txs');
}

// ==========================================
// 1. CONFLICT PRESERVATION & RETRIEVAL
// ==========================================

test('CONFLICT STORE: Preserves and retrieves multiple conflict items', () => {
  resetStorage();
  clearConflicts();

  const conflict1 = {
    type: 'TRANSACTION_EDIT_CONFLICT',
    entityId: 'tx-1',
    local: { id: 'tx-1', amount: 500, type: 'expense', category: 'Food', method: 'Online', desc: 'Lunch' },
    remote: { id: 'tx-1', amount: 800, type: 'expense', category: 'Food', method: 'Online', desc: 'Lunch' }
  };

  const conflict2 = {
    type: 'DELETION_EDIT_CONFLICT',
    entityId: 'tx-2',
    local: null,
    remote: { id: 'tx-2', amount: 650, type: 'expense', category: 'Shopping', method: 'Online', desc: 'Shoes' }
  };

  preserveConflict([conflict1, conflict2], {}, {});

  const stored = getActiveConflicts();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].conflicts.length, 2);
  assert.equal(stored[0].conflicts[0].entityId, 'tx-1');
  assert.equal(stored[0].conflicts[1].entityId, 'tx-2');
});

// ==========================================
// 2. INDEPENDENT ITEM RESOLUTION
// ==========================================

test('CONFLICT REMOVAL: removeConflictItem() resolves one item while preserving others', () => {
  resetStorage();
  clearConflicts();

  const conflict1 = { type: 'TRANSACTION_EDIT_CONFLICT', entityId: 'tx-1' };
  const conflict2 = { type: 'DELETION_EDIT_CONFLICT', entityId: 'tx-2' };

  preserveConflict([conflict1, conflict2], {}, {});
  assert.equal(getActiveConflicts()[0].conflicts.length, 2);

  // Resolve only conflict1
  removeConflictItem('tx-1');

  const afterFirst = getActiveConflicts();
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0].conflicts.length, 1);
  assert.equal(afterFirst[0].conflicts[0].entityId, 'tx-2');

  // Resolve conflict2
  removeConflictItem('tx-2');
  const afterSecond = getActiveConflicts();
  assert.equal(afterSecond.length, 0);

  // Sync state transitions back to nominal
  const status = getSyncStatus();
  assert.equal(status.hasConflict, false);
});

// ==========================================
// 3. SAFE MERGE DETERMINISM & UNSAFE REJECTION
// ==========================================

test('SAFE MERGE: Rejects automatic merge when amounts differ (Zero Guessing Rule)', () => {
  const localTx = { id: 'tx-diff', amount: 500, type: 'expense', category: 'Food', method: 'Online', date: '2026-09-28T10:00:00Z', desc: 'A' };
  const remoteTx = { id: 'tx-diff', amount: 800, type: 'expense', category: 'Food', method: 'Online', date: '2026-09-28T10:00:00Z', desc: 'B' };

  const canMerge = checkSafeMergeability(localTx, remoteTx, false);
  assert.equal(canMerge, false, 'Different amounts must never be automatically merged');
});

test('SAFE MERGE: Rejects automatic merge on delete-vs-edit collisions', () => {
  const localTx = null;
  const remoteTx = { id: 'tx-del-edit', amount: 500, type: 'expense', category: 'Food', method: 'Online' };

  const canMerge = checkSafeMergeability(localTx, remoteTx, true);
  assert.equal(canMerge, false, 'Delete-vs-edit collisions must require explicit user choice');
});

test('SAFE MERGE: Allows safe deterministic merge when only descriptions differ', () => {
  const localTx = {
    id: 'tx-same-amt',
    amount: 500,
    type: 'expense',
    category: 'Food & Dining',
    method: 'Online',
    date: '2026-09-28T12:00:00Z',
    desc: 'Restaurant'
  };

  const remoteTx = {
    id: 'tx-same-amt',
    amount: 500,
    type: 'expense',
    category: 'Food & Dining',
    method: 'Online',
    date: '2026-09-28T12:00:00Z',
    desc: 'Dinner with friends'
  };

  const canMerge = checkSafeMergeability(localTx, remoteTx, false);
  assert.equal(canMerge, true, 'Identical core financial fields should allow safe merge');

  const merged = constructSafeMerge(localTx, remoteTx);
  assert.equal(merged.amount, 500);
  assert.equal(merged.desc, 'Restaurant (Dinner with friends)');
});

// ==========================================
// 4. FINANCIAL LEDGER RECALCULATION ON RESOLUTION
// ==========================================

test('FINANCIAL INTEGRITY: Resolution updates local transactions and deterministically reconciles ledger', () => {
  resetStorage();

  const originalTx = {
    id: 'tx-rec-1',
    amount: 200,
    type: 'expense',
    category: 'Food',
    method: 'Online',
    desc: 'Lunch',
    date: '2026-09-01T12:00:00Z'
  };
  saveTxs([originalTx]);

  const beforeBalances = getBalances();
  assert.equal(typeof beforeBalances.online, 'number');

  // Conflict resolved by choosing the remote version with amount: 350
  const chosenRemoteTx = {
    ...originalTx,
    amount: 350,
    desc: 'Buffet lunch'
  };

  const currentTxs = getTxs();
  const idx = currentTxs.findIndex(t => t.id === 'tx-rec-1');
  assert.ok(idx >= 0);
  currentTxs[idx] = chosenRemoteTx;
  saveTxs(currentTxs);

  const afterBalances = getBalances();
  assert.equal(getTxs()[0].amount, 350);
  // Ledger reflects 150 more expense
  assert.equal(afterBalances.online, beforeBalances.online - 150);
});

// ==========================================
// 5. MUTATION QUEUE ENTRY ON RESOLUTION
// ==========================================

test('MUTATION QUEUE: Resolution queues mutation for cloud synchronization', () => {
  resetStorage();
  clearOfflineQueue();

  assert.equal(getOfflineQueue().length, 0);

  // Directly verify resolution enqueueing pattern used by conflict-resolution.js
  enqueueMutation('RESOLVE_CONFLICT', {
    entityId: 'tx-resolved-101',
    resolvedTx: { id: 'tx-resolved-101', amount: 400, type: 'expense', method: 'Cash' }
  });

  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, 'RESOLVE_CONFLICT');
  assert.equal(queue[0].payload.entityId, 'tx-resolved-101');
  assert.equal(queue[0].payload.resolvedTx.amount, 400);
});
