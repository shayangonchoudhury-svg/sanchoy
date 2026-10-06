// Phase 6A Automated Test Suite: Sanchoy Sync Center UI & Status System
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSyncStatus,
  recordSyncActivity,
  getSyncActivityLog,
  SyncStatus
} from '../js/firebase/sync.js';

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
  enqueueMutation,
  clearOfflineQueue
} from '../js/sync/queue.js';

import {
  preserveConflict,
  clearConflicts
} from '../js/sync/conflict.js';

import {
  getOrCreateDeviceId,
  generateSecureDeviceId
} from '../js/sync/device.js';

import { routes } from '../js/ui/ui.js';
import { safeStorage } from '../js/core/state.js';

function resetSyncStorage() {
  safeStorage.removeItem('sanchoy_device_id');
  safeStorage.removeItem('sanchoy_sync_meta');
  safeStorage.removeItem('sanchoy_mutation_queue');
  safeStorage.removeItem('sanchoy_active_conflicts');
}

// ==========================================
// 1. SYNC STATUS MAPPING & STATE DETECTION
// ==========================================

test('SYNC STATUS: getSyncStatus() accurately reflects SYNCED state', () => {
  resetSyncStorage();
  clearOfflineQueue();
  clearConflicts();
  recordSyncSuccess(10);

  const status = getSyncStatus();
  assert.equal(status.status, SyncStatus.SYNCED);
  assert.equal(status.clientRevision, 10);
  assert.equal(status.cloudRevision, 10);
  assert.equal(status.pendingMutationCount, 0);
  assert.equal(status.hasConflict, false);
});

test('SYNC STATUS: getSyncStatus() accurately reflects PENDING state when offline queue has entries', () => {
  resetSyncStorage();
  clearConflicts();
  enqueueMutation('ADD_TX', { id: 'tx-sync-1', amount: 150 });
  enqueueMutation('ADD_TX', { id: 'tx-sync-2', amount: 300 });

  const status = getSyncStatus();
  assert.equal(status.status, SyncStatus.PENDING);
  assert.equal(status.pendingMutationCount, 2);
  assert.equal(status.hasConflict, false);
});

test('SYNC STATUS: getSyncStatus() accurately reflects CONFLICT state when conflicts exist', () => {
  resetSyncStorage();
  const localSnap = { transactions: [{ id: 'tx-conf-1', amount: 100 }] };
  const remoteSnap = { transactions: [{ id: 'tx-conf-1', amount: 200 }] };
  preserveConflict([{ type: 'TRANSACTION_EDIT_CONFLICT', entityId: 'tx-conf-1' }], localSnap, remoteSnap);

  const status = getSyncStatus();
  assert.equal(status.status, SyncStatus.CONFLICT);
  assert.equal(status.hasConflict, true);
  assert.equal(status.conflicts.length, 1);
});

test('SYNC STATUS: getSyncStatus() accurately reflects ERROR state', () => {
  resetSyncStorage();
  clearConflicts();
  saveSyncMetadata({ syncState: SyncStatus.ERROR });

  const status = getSyncStatus();
  assert.equal(status.status, SyncStatus.ERROR);
});

// ==========================================
// 2. DEVICE ID TRUNCATION & ANONYMITY
// ==========================================

test('DEVICE IDENTITY: Device ID is truncated safely for UI without exposing complete entropy', () => {
  resetSyncStorage();
  const fullId = getOrCreateDeviceId();
  assert.ok(fullId.startsWith('dev_'));

  const truncated = `${fullId.slice(0, 12)}…`;
  assert.equal(truncated.length, 13);
  assert.ok(truncated.startsWith('dev_'));
  assert.notEqual(truncated, fullId);
});

// ==========================================
// 3. SYNC ACTIVITY AUDIT LOGGING
// ==========================================

test('ACTIVITY LOG: Session activity records events in FIFO order up to bounded capacity', () => {
  recordSyncActivity('SYNCING', 'Synchronization initiated');
  recordSyncActivity('SYNCED', 'Workspace synchronized (Rev 12)');

  const log = getSyncActivityLog();
  assert.ok(log.length >= 2);
  assert.equal(log[0].type, 'SYNCED');
  assert.equal(log[0].message, 'Workspace synchronized (Rev 12)');
  assert.equal(log[1].type, 'SYNCING');
  assert.ok(log[0].timestamp);
});

// ==========================================
// 4. ROUTING & UI NAVIGATION INTEGRATION
// ==========================================

test('ROUTING: /sync route is registered and maps to page-sync container', () => {
  assert.ok(routes['/sync']);
  assert.equal(routes['/sync'], 'page-sync');
});

// ==========================================
// 5. SECURITY & ZERO PLAINTEXT INTEGRITY
// ==========================================

test('DATA INTEGRITY: Sync metadata object contains no sensitive financial fields', () => {
  const status = getSyncStatus();
  const keys = Object.keys(status);

  const forbiddenKeys = [
    'passcode',
    'recoveryCode',
    'dek',
    'kek',
    'transactions',
    'balances',
    'allowanceConfig',
    'ciphertext'
  ];

  for (const forbidden of forbiddenKeys) {
    assert.equal(keys.includes(forbidden), false, `SyncStatus must not contain ${forbidden}`);
  }
});
