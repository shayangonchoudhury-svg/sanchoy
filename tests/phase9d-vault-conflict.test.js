// Phase 9D: Vault Multi-Device Conflict Resolution Test Suite
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeFinancialWorkspaces,
  mergeVaultRecords,
  checkVaultSafeMerge,
  constructVaultSafeMerge
} from '../js/sync/merge.js';

import {
  getActiveConflicts,
  preserveConflict,
  removeConflictItem,
  clearConflicts
} from '../js/sync/conflict.js';

import {
  executeResolution,
  evaluateVaultDifferences
} from '../js/ui/conflict-resolution.js';

import {
  getVaultSavings,
  saveVaultSavingsAsync,
  applyVaultConflictResolution
} from '../js/vault/vault.js';

import {
  calculateVaultBalance,
  calculateHoldingsSummary,
  VAULT_TYPES
} from '../js/financial/vault-ledger.js';

import {
  getOfflineQueue,
  clearOfflineQueue,
  VAULT_MUTATION_TYPES
} from '../js/sync/queue.js';

import { getBalances } from '../js/transactions/transactions.js';
import { safeStorage } from '../js/core/state.js';

function resetStorage() {
  safeStorage.removeItem('sanchoy_device_id');
  safeStorage.removeItem('sanchoy_sync_meta');
  safeStorage.removeItem('sanchoy_mutation_queue');
  safeStorage.removeItem('sanchoy_active_conflicts');
  safeStorage.removeItem('sanchoy_txs');
  safeStorage.removeItem('sanchoy_vault_records_cache');
}

// ==========================================
// 1. VAULT EDIT-VS-EDIT CONFLICT DETECTION
// ==========================================

test('PHASE 9D - 1: Vault edit-vs-edit conflict detected between diverged devices', () => {
  const baseRecord = {
    id: 'vault-base-1',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1000,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    category: 'General Savings',
    description: 'Laptop',
    date: '2026-10-01'
  };

  const deviceARecord = {
    ...baseRecord,
    amount: 1200
  };

  const deviceBRecord = {
    ...baseRecord,
    amount: 1300
  };

  const result = mergeVaultRecords([deviceARecord], [deviceBRecord], [baseRecord]);

  assert.equal(result.conflicts.length, 1, 'Must detect exactly 1 conflict');
  assert.equal(result.conflicts[0].type, 'VAULT_EDIT_CONFLICT');
  assert.equal(result.conflicts[0].entityId, 'vault-base-1');
  assert.equal(result.conflicts[0].local.amount, 1200);
  assert.equal(result.conflicts[0].remote.amount, 1300);
});

// ==========================================
// 2. VAULT DELETE-VS-EDIT CONFLICT DETECTION
// ==========================================

test('PHASE 9D - 2: Vault delete-vs-edit conflict detected without silent data loss', () => {
  const baseRecord = {
    id: 'vault-del-1',
    type: VAULT_TYPES.DEPOSIT,
    amount: 2000,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    category: 'General Savings',
    description: 'Emergency Fund',
    date: '2026-10-01'
  };

  // Device A deletes the record (empty local list)
  const localRecords = [];

  // Device B edits the record (remote changed amount)
  const remoteRecords = [{
    ...baseRecord,
    amount: 2500,
    description: 'Updated Emergency Fund'
  }];

  const result = mergeVaultRecords(localRecords, remoteRecords, [baseRecord]);

  assert.equal(result.conflicts.length, 1, 'Must detect delete-vs-edit conflict');
  assert.equal(result.conflicts[0].type, 'VAULT_DELETION_CONFLICT');
  assert.equal(result.conflicts[0].entityId, 'vault-del-1');
  assert.equal(result.conflicts[0].local, null);
  assert.equal(result.conflicts[0].remote.amount, 2500);
});

// ==========================================
// 3. KEEP LOCAL RESOLUTION
// ==========================================

test('PHASE 9D - 3: Keep Local resolution preserves local record and updates state', async () => {
  resetStorage();
  clearConflicts();
  clearOfflineQueue();

  const localRecord = {
    id: 'vault-conflict-keep-local',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1200,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    category: 'General Savings',
    description: 'Local Choice',
    date: '2026-10-01'
  };

  const remoteRecord = {
    ...localRecord,
    amount: 1300,
    description: 'Remote Choice'
  };

  // Setup active conflict
  preserveConflict([{
    type: 'VAULT_EDIT_CONFLICT',
    entityType: 'vault',
    entityId: localRecord.id,
    local: localRecord,
    remote: remoteRecord
  }], {}, {});

  assert.equal(getActiveConflicts()[0].conflicts.length, 1);

  // Execute Keep Local resolution
  await executeResolution(localRecord.id, localRecord);

  // Verify storage has the local record
  const currentSavings = getVaultSavings();
  const saved = currentSavings.find(r => r.id === localRecord.id);
  assert.ok(saved);
  assert.equal(saved.amount, 1200);
  assert.equal(saved.description, 'Local Choice');

  // Verify conflict was cleared
  assert.equal(getActiveConflicts().length, 0);

  // Verify mutation queue enqueued vault:update
  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, VAULT_MUTATION_TYPES.UPDATE);
  assert.equal(queue[0].entityId, localRecord.id);
});

// ==========================================
// 4. KEEP OTHER RESOLUTION
// ==========================================

test('PHASE 9D - 4: Keep Other resolution applies remote record and updates state', async () => {
  resetStorage();
  clearConflicts();
  clearOfflineQueue();

  const localRecord = {
    id: 'vault-conflict-keep-other',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1200,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    category: 'General Savings',
    description: 'Local Choice',
    date: '2026-10-01'
  };

  const remoteRecord = {
    ...localRecord,
    amount: 1500,
    description: 'Remote Cloud Winner'
  };

  preserveConflict([{
    type: 'VAULT_EDIT_CONFLICT',
    entityType: 'vault',
    entityId: localRecord.id,
    local: localRecord,
    remote: remoteRecord
  }], {}, {});

  // Resolve with remote record
  await executeResolution(localRecord.id, remoteRecord);

  const currentSavings = getVaultSavings();
  const saved = currentSavings.find(r => r.id === localRecord.id);
  assert.ok(saved);
  assert.equal(saved.amount, 1500);
  assert.equal(saved.description, 'Remote Cloud Winner');

  // Conflict cleared
  assert.equal(getActiveConflicts().length, 0);

  // Mutation queue enqueued vault:update
  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, VAULT_MUTATION_TYPES.UPDATE);
  assert.equal(queue[0].entityId, localRecord.id);
});

// ==========================================
// 5. SAFE FIELD-LEVEL MERGE WHERE SUPPORTED
// ==========================================

test('PHASE 9D - 5: Safe field-level merge when financial fields match and metadata differs', () => {
  const baseRecord = {
    id: 'vault-safe-merge',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1000,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    category: 'General Savings',
    description: 'Laptop',
    date: '2026-10-01'
  };

  // Device A modifies description only
  const deviceARecord = {
    ...baseRecord,
    description: 'MacBook Pro Fund'
  };

  // Device B modifies category only
  const deviceBRecord = {
    ...baseRecord,
    category: 'Electronics'
  };

  const canMerge = checkVaultSafeMerge(deviceARecord, deviceBRecord, baseRecord);
  assert.equal(canMerge, true, 'Non-conflicting field edits must be safely mergeable');

  const merged = constructVaultSafeMerge(deviceARecord, deviceBRecord, baseRecord);
  assert.equal(merged.amount, 1000);
  assert.equal(merged.category, 'Electronics');
  assert.equal(merged.description, 'MacBook Pro Fund');
});

// ==========================================
// 6. FINANCIAL AMOUNT CONFLICT CANNOT AUTO-RESOLVE
// ==========================================

test('PHASE 9D - 6: Financial amount conflict cannot silently auto-resolve (Zero Guessing)', () => {
  const localRecord = {
    id: 'vault-amt-diff',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1200,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    category: 'General Savings',
    description: 'Fund',
    date: '2026-10-01'
  };

  const remoteRecord = {
    ...localRecord,
    amount: 1300
  };

  const canMerge = checkVaultSafeMerge(localRecord, remoteRecord);
  assert.equal(canMerge, false, 'Differing financial amounts must NEVER auto-merge');
});

// ==========================================
// 7. RESOLUTION RECALCULATES VAULT BALANCE
// ==========================================

test('PHASE 9D - 7: Resolution recalculates Vault balance deterministically and never drops below zero', async () => {
  resetStorage();

  const record1 = {
    id: 'vault-rec-1',
    type: VAULT_TYPES.DEPOSIT,
    amount: 2000,
    date: '2026-10-01'
  };

  await saveVaultSavingsAsync([record1]);
  assert.equal(calculateVaultBalance(getVaultSavings()), 2000);

  // Conflict resolution replaces record1 with amount: 3500
  const resolvedRecord = {
    ...record1,
    amount: 3500
  };

  await applyVaultConflictResolution('vault-rec-1', resolvedRecord);
  const updatedSavings = getVaultSavings();
  assert.equal(calculateVaultBalance(updatedSavings), 3500);

  // Verify Total Holdings formula: Liquid (Online + Cash) + Vault
  const balances = getBalances();
  const summary = calculateHoldingsSummary(balances.online, balances.cash, 3500);
  assert.equal(summary.vault, 3500);
  assert.equal(summary.totalHoldings, balances.online + balances.cash + 3500);
  assert.equal(summary.liquidBalance, balances.online + balances.cash);

  // Even with an extreme withdrawal exceeding deposits, Vault balance never becomes negative
  const extremeWithdrawal = {
    id: 'vault-rec-2',
    type: VAULT_TYPES.WITHDRAWAL,
    amount: 50000,
    date: '2026-10-02'
  };
  await applyVaultConflictResolution('vault-rec-2', extremeWithdrawal);
  assert.equal(calculateVaultBalance(getVaultSavings()), 0, 'Vault balance must never be negative');
});

// ==========================================
// 8. RESOLUTION DOES NOT DUPLICATE RECORDS
// ==========================================

test('PHASE 9D - 8: Resolution updates the target record without creating duplicates', async () => {
  resetStorage();

  const initialRecord = {
    id: 'vault-dedup-target',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1000,
    category: 'Travel',
    description: 'Initial',
    date: '2026-10-01'
  };

  await saveVaultSavingsAsync([initialRecord]);
  assert.equal(getVaultSavings().length, 1);

  const resolved = {
    ...initialRecord,
    amount: 1500,
    description: 'Resolved Description'
  };

  await applyVaultConflictResolution('vault-dedup-target', resolved);

  const finalRecords = getVaultSavings();
  assert.equal(finalRecords.length, 1, 'Should have exactly 1 record, zero duplicates');
  assert.equal(finalRecords[0].amount, 1500);
  assert.equal(finalRecords[0].description, 'Resolved Description');
});

// ==========================================
// 9. RESOLUTION CREATES APPROPRIATE MUTATION
// ==========================================

test('PHASE 9D - 9: Resolution enqueues vault:delete on deletion and vault:update on edit', async () => {
  resetStorage();
  clearConflicts();
  clearOfflineQueue();

  // Test deletion resolution
  preserveConflict([{
    type: 'VAULT_DELETION_CONFLICT',
    entityType: 'vault',
    entityId: 'vault-del-res',
    local: null,
    remote: { id: 'vault-del-res', amount: 500, type: VAULT_TYPES.DEPOSIT }
  }], {}, {});

  await executeResolution('vault-del-res', null);

  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, VAULT_MUTATION_TYPES.DELETE);
  assert.equal(queue[0].entityId, 'vault-del-res');
});

// ==========================================
// 10. RESOLUTION WORKS WITH EXISTING QUEUE
// ==========================================

test('PHASE 9D - 10: Resolution mutations survive offline queue and integrate with sync infrastructure', async () => {
  resetStorage();
  clearConflicts();
  clearOfflineQueue();

  const record = {
    id: 'vault-offline-queue-check',
    type: VAULT_TYPES.DEPOSIT,
    amount: 800,
    date: '2026-10-01'
  };

  preserveConflict([{
    type: 'VAULT_EDIT_CONFLICT',
    entityType: 'vault',
    entityId: record.id,
    local: record,
    remote: { ...record, amount: 900 }
  }], {}, {});

  // Simulate resolving while offline
  await executeResolution(record.id, record);

  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, VAULT_MUTATION_TYPES.UPDATE);
  assert.equal(queue[0].payload.amount, 800);
  assert.ok(queue[0].mutationId, 'Mutation must have a unique ID');
  assert.ok(queue[0].timestamp, 'Mutation must have a timestamp');
});
