// Phase 5 Automated Test Suite: Multi-Device Synchronization & Conflict Resolution
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSecureDeviceId,
  getOrCreateDeviceId
} from '../js/sync/device.js';

import {
  getSyncMetadata,
  saveSyncMetadata,
  advanceLocalRevision,
  recordSyncSuccess,
  recordConflictState,
  SyncState
} from '../js/sync/revision.js';

import {
  getOfflineQueue,
  saveOfflineQueue,
  enqueueMutation,
  removeMutations,
  clearOfflineQueue,
  generateMutationId
} from '../js/sync/queue.js';

import {
  mergeFinancialWorkspaces
} from '../js/sync/merge.js';

import {
  preserveConflict,
  clearConflicts,
  getActiveConflicts
} from '../js/sync/conflict.js';

import {
  generateTransactionId
} from '../js/transactions/transactions.js';

// Mock storage reset between test cases
import { safeStorage } from '../js/core/state.js';

function resetSyncState() {
  safeStorage.removeItem('sanchoy_device_id');
  safeStorage.removeItem('sanchoy_sync_meta');
  safeStorage.removeItem('sanchoy_mutation_queue');
  safeStorage.removeItem('sanchoy_active_conflicts');
}

// ==========================================
// 1. DEVICE IDENTITY TESTS
// ==========================================

test('DEVICE IDENTITY: Generates secure, anonymous, high-entropy device ID with dev_ prefix', () => {
  resetSyncState();
  const devId1 = generateSecureDeviceId();
  const devId2 = generateSecureDeviceId();

  assert.ok(devId1.startsWith('dev_'));
  assert.ok(devId2.startsWith('dev_'));
  assert.notEqual(devId1, devId2, 'Device IDs must be unique');
  assert.ok(devId1.length >= 20, 'Device ID must have sufficient length');
});

test('DEVICE IDENTITY: Stable persistence across calls on the same client', () => {
  resetSyncState();
  const id1 = getOrCreateDeviceId();
  const id2 = getOrCreateDeviceId();
  assert.equal(id1, id2, 'Device ID must remain stable across calls');
});

// ==========================================
// 2. TRANSACTION STABLE IDENTITY & IDEMPOTENCY
// ==========================================

test('TRANSACTION IDENTITY: Stable cryptographic ID generation', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = generateTransactionId();
    assert.ok(id.startsWith('tx_'));
    assert.equal(ids.has(id), false, 'ID collision detected');
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
});

test('IDEMPOTENCY: Mutation IDs generated uniquely per mutation', () => {
  const m1 = generateMutationId();
  const m2 = generateMutationId();
  assert.ok(m1.startsWith('mut_'));
  assert.notEqual(m1, m2);
});

// ==========================================
// 3. OFFLINE QUEUE TESTS
// ==========================================

test('OFFLINE QUEUE: Enqueue, retrieval, and removal survive storage operations', () => {
  resetSyncState();
  assert.equal(getOfflineQueue().length, 0);

  const mut1 = enqueueMutation('ADD_TX', { id: 'tx-101', amount: 450 });
  const mut2 = enqueueMutation('ADD_TX', { id: 'tx-102', amount: 120 });

  let queue = getOfflineQueue();
  assert.equal(queue.length, 2);
  assert.equal(queue[0].mutationId, mut1.mutationId);
  assert.equal(queue[1].mutationId, mut2.mutationId);

  // Remove first mutation
  removeMutations([mut1.mutationId]);
  queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].mutationId, mut2.mutationId);

  // Clear queue
  clearOfflineQueue();
  assert.equal(getOfflineQueue().length, 0);
});

// ==========================================
// 4. REVISION MODEL TESTS
// ==========================================

test('REVISION: Local revision advances deterministically on mutation', () => {
  resetSyncState();
  const initial = getSyncMetadata();
  assert.equal(initial.clientRevision, 1);

  advanceLocalRevision();
  const after1 = getSyncMetadata();
  assert.equal(after1.clientRevision, 2);
  assert.equal(after1.syncState, SyncState.PENDING);

  advanceLocalRevision();
  const after2 = getSyncMetadata();
  assert.equal(after2.clientRevision, 3);
});

test('REVISION: Cloud sync confirmation aligns client and cloud revisions to SYNCED', () => {
  resetSyncState();
  advanceLocalRevision();
  advanceLocalRevision();

  recordSyncSuccess(5);
  const meta = getSyncMetadata();
  assert.equal(meta.clientRevision, 5);
  assert.equal(meta.cloudRevision, 5);
  assert.equal(meta.syncState, SyncState.SYNCED);
  assert.ok(meta.lastSyncedAt);
});

// ==========================================
// 5. THREE-WAY FINANCIAL LEDGER MERGE TESTS
// ==========================================

test('MERGE: Independent transactions from Device A and Device B merge cleanly with zero loss', () => {
  const baseWorkspace = {
    transactions: [
      { id: 'tx-shared', amount: 100, type: 'expense', category: 'Food', method: 'Cash', desc: 'Lunch', date: '2026-09-01T10:00:00Z' }
    ],
    allowanceConfig: { monthlyOnline: 3000, monthlyCash: 1000, configured: true, version: 1 }
  };

  // Device A added tx-A
  const deviceAWorkspace = {
    ...baseWorkspace,
    transactions: [
      ...baseWorkspace.transactions,
      { id: 'tx-A', amount: 250, type: 'expense', category: 'Shopping', method: 'Online', desc: 'Book', date: '2026-09-02T12:00:00Z' }
    ]
  };

  // Device B added tx-B
  const deviceBWorkspace = {
    ...baseWorkspace,
    transactions: [
      ...baseWorkspace.transactions,
      { id: 'tx-B', amount: 50, type: 'income', category: 'Gift', method: 'Cash', desc: 'Cash gift', date: '2026-09-02T14:00:00Z' }
    ]
  };

  const result = mergeFinancialWorkspaces(deviceAWorkspace, deviceBWorkspace, baseWorkspace);

  assert.equal(result.success, true);
  assert.equal(result.hasConflict, false);
  assert.equal(result.mergedBundle.transactions.length, 3);

  const txIds = result.mergedBundle.transactions.map(t => t.id);
  assert.ok(txIds.includes('tx-shared'));
  assert.ok(txIds.includes('tx-A'));
  assert.ok(txIds.includes('tx-B'));
});

test('MERGE: No duplicate transactions created when both devices already have identical transactions', () => {
  const commonTx = { id: 'tx-common', amount: 80, type: 'expense', category: 'Transport', method: 'Online', desc: 'Metro', date: '2026-09-01T08:00:00Z' };

  const bundle1 = { transactions: [commonTx] };
  const bundle2 = { transactions: [commonTx] };

  const result = mergeFinancialWorkspaces(bundle1, bundle2, null);
  assert.equal(result.mergedBundle.transactions.length, 1);
  assert.equal(result.mergedBundle.transactions[0].id, 'tx-common');
});

test('MERGE: Same-transaction conflict detected and preserved when both devices modify differently', () => {
  const baseWorkspace = {
    transactions: [
      { id: 'tx-conflict-1', amount: 100, type: 'expense', category: 'Food', method: 'Cash', desc: 'Dinner', date: '2026-09-01T19:00:00Z' }
    ]
  };

  // Device A changed amount to 120
  const bundleA = {
    transactions: [
      { id: 'tx-conflict-1', amount: 120, type: 'expense', category: 'Food', method: 'Cash', desc: 'Dinner with tip', date: '2026-09-01T19:00:00Z' }
    ]
  };

  // Device B changed amount to 150
  const bundleB = {
    transactions: [
      { id: 'tx-conflict-1', amount: 150, type: 'expense', category: 'Food', method: 'Cash', desc: 'Dinner premium', date: '2026-09-01T19:00:00Z' }
    ]
  };

  const result = mergeFinancialWorkspaces(bundleA, bundleB, baseWorkspace);

  assert.equal(result.hasConflict, true);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, 'TRANSACTION_EDIT_CONFLICT');
  assert.equal(result.conflicts[0].entityId, 'tx-conflict-1');
  assert.equal(result.conflicts[0].local.amount, 120);
  assert.equal(result.conflicts[0].remote.amount, 150);
});

test('MERGE: Deletion on Device A is honored without resurrecting if Device B did not modify it', () => {
  const baseWorkspace = {
    transactions: [
      { id: 'tx-del', amount: 30, type: 'expense', category: 'Food', method: 'Cash', desc: 'Coffee', date: '2026-09-01T09:00:00Z' },
      { id: 'tx-keep', amount: 60, type: 'expense', category: 'Transport', method: 'Online', desc: 'Fuel', date: '2026-09-01T11:00:00Z' }
    ]
  };

  // Device A deleted tx-del
  const bundleA = {
    transactions: [
      { id: 'tx-keep', amount: 60, type: 'expense', category: 'Transport', method: 'Online', desc: 'Fuel', date: '2026-09-01T11:00:00Z' }
    ]
  };

  // Device B has unchanged base
  const bundleB = { ...baseWorkspace };

  const result = mergeFinancialWorkspaces(bundleA, bundleB, baseWorkspace);
  assert.equal(result.hasConflict, false);
  assert.equal(result.mergedBundle.transactions.length, 1);
  assert.equal(result.mergedBundle.transactions[0].id, 'tx-keep');
});

// ==========================================
// 6. CONFLICT PRESERVATION TESTS
// ==========================================

test('CONFLICT: Preserves local and remote snapshots without data destruction', () => {
  resetSyncState();
  const localSnap = { transactions: [{ id: 'tx-1', amount: 50 }] };
  const remoteSnap = { transactions: [{ id: 'tx-1', amount: 90 }] };
  const conflictList = [{ type: 'TRANSACTION_EDIT_CONFLICT', entityId: 'tx-1' }];

  preserveConflict(conflictList, localSnap, remoteSnap);

  const active = getActiveConflicts();
  assert.equal(active.length, 1);
  assert.equal(active[0].conflicts[0].entityId, 'tx-1');
  assert.deepEqual(active[0].localSnapshot, localSnap);
  assert.deepEqual(active[0].remoteSnapshot, remoteSnap);

  const meta = getSyncMetadata();
  assert.equal(meta.syncState, SyncState.CONFLICT);

  // Clear conflict
  clearConflicts();
  assert.equal(getActiveConflicts().length, 0);
  assert.equal(getSyncMetadata().syncState, SyncState.SYNCED);
});

// ==========================================
// 7. VAULT INTEGRITY DURING MULTI-DEVICE MERGE
// ==========================================

test('VAULT INTEGRITY: Vault records survive multi-device merge without data corruption', () => {
  const localBundle = {
    transactions: [],
    vaultRecords: [
      { id: 'vault-aug-2026', month: '2026-08', iv: 'aabb', data: '1122' }
    ]
  };

  const remoteBundle = {
    transactions: [],
    vaultRecords: [
      { id: 'vault-sep-2026', month: '2026-09', iv: 'ccdd', data: '3344' }
    ]
  };

  const result = mergeFinancialWorkspaces(localBundle, remoteBundle, null);
  assert.equal(result.mergedBundle.vaultRecords.length, 2);
  const vaultIds = result.mergedBundle.vaultRecords.map(r => r.id);
  assert.ok(vaultIds.includes('vault-aug-2026'));
  assert.ok(vaultIds.includes('vault-sep-2026'));
});
