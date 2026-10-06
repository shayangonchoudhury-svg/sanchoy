// Phase 9C Automated Test Suite: Sanchoy Vault Multi-Device Sync Integration
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VAULT_TYPES,
  generateVaultRecordId,
  calculateVaultBalance,
  calculateHoldingsSummary
} from '../js/financial/vault-ledger.js';

import {
  VAULT_MUTATION_TYPES,
  getOfflineQueue,
  saveOfflineQueue,
  enqueueMutation,
  removeMutations,
  clearOfflineQueue
} from '../js/sync/queue.js';

import {
  mergeFinancialWorkspaces
} from '../js/sync/merge.js';

import {
  getSyncStatus,
  SyncStatus
} from '../js/firebase/sync.js';

import {
  gatherLocalFinancialWorkspace,
  restoreFinancialWorkspaceLocally
} from '../js/migration/local-to-cloud.js';

import {
  depositToVault,
  withdrawFromVault,
  spendFromVault,
  getVaultSavings,
  setDecryptedVaultRecords
} from '../js/vault/vault.js';

import { safeStorage } from '../js/core/state.js';

function resetStorage() {
  safeStorage.removeItem('sanchoy_device_id');
  safeStorage.removeItem('sanchoy_sync_meta');
  safeStorage.removeItem('sanchoy_mutation_queue');
  safeStorage.removeItem('sanchoy_active_conflicts');
  safeStorage.removeItem('sanchoy_vault_records_cache');
  setDecryptedVaultRecords([]);
}

// ==========================================
// 1. VAULT MUTATION QUEUE ENTRY GENERATION
// ==========================================

test('PHASE 9C - 1: Vault mutation creates a durable queue entry with required attributes', () => {
  resetStorage();
  clearOfflineQueue();

  const record = {
    id: generateVaultRecordId(),
    type: VAULT_TYPES.DEPOSIT,
    amount: 500,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-01'
  };

  const mut = enqueueMutation(VAULT_MUTATION_TYPES.CREATE, record, record.id);
  assert.ok(mut.mutationId.startsWith('mut_'));
  assert.ok(mut.deviceId.startsWith('dev_'));
  assert.equal(mut.type, 'vault:create');
  assert.equal(mut.entityId, record.id);
  assert.deepEqual(mut.payload, record);
  assert.ok(mut.timestamp);
  assert.equal(mut.retryCount, 0);

  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].mutationId, mut.mutationId);
});

// ==========================================
// 2. PRIMARY OPERATIONS QUEUE ENQUEUE
// ==========================================

test('PHASE 9C - 2: Deposit to Vault queues a vault:create mutation', async () => {
  resetStorage();
  clearOfflineQueue();

  const balances = { online: 1000, cash: 500, vault: 0 };
  const res = await depositToVault({
    amount: 300,
    sourceWallet: 'online',
    date: '2026-10-02',
    description: 'Savings deposit',
    currentBalances: balances
  });

  assert.equal(res.success, true);
  const queue = getOfflineQueue();
  assert.ok(queue.length >= 1);
  const lastMut = queue[queue.length - 1];
  assert.equal(lastMut.type, VAULT_MUTATION_TYPES.CREATE);
  assert.equal(lastMut.entityId, res.record.id);
  assert.equal(lastMut.payload.type, VAULT_TYPES.DEPOSIT);
  assert.equal(lastMut.payload.amount, 300);
});

test('PHASE 9C - 3: Withdrawal from Vault queues a vault:create mutation', async () => {
  resetStorage();
  clearOfflineQueue();

  // Seed vault with starting deposit
  const depositRecord = {
    id: 'vault_seed_1',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1000,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-01'
  };
  setDecryptedVaultRecords([depositRecord]);
  clearOfflineQueue();

  const balances = { online: 700, cash: 300, vault: 1000 };
  const res = await withdrawFromVault({
    amount: 250,
    destinationWallet: 'cash',
    date: '2026-10-03',
    description: 'Cash withdrawal from Vault',
    currentBalances: balances
  });

  assert.equal(res.success, true);
  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  const mut = queue[0];
  assert.equal(mut.type, VAULT_MUTATION_TYPES.CREATE);
  assert.equal(mut.entityId, res.record.id);
  assert.equal(mut.payload.type, VAULT_TYPES.WITHDRAWAL);
  assert.equal(mut.payload.amount, 250);
});

test('PHASE 9C - 4: Spend from Vault queues a vault:create mutation', async () => {
  resetStorage();
  clearOfflineQueue();

  const depositRecord = {
    id: 'vault_seed_2',
    type: VAULT_TYPES.DEPOSIT,
    amount: 2000,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-01'
  };
  setDecryptedVaultRecords([depositRecord]);
  clearOfflineQueue();

  const balances = { online: 500, cash: 300, vault: 2000 };
  const res = await spendFromVault({
    amount: 450,
    category: 'Shopping',
    description: 'Noise Cancelling Headphones',
    date: '2026-10-04',
    currentBalances: balances
  });

  assert.equal(res.success, true);
  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  const mut = queue[0];
  assert.equal(mut.type, VAULT_MUTATION_TYPES.CREATE);
  assert.equal(mut.entityId, res.record.id);
  assert.equal(mut.payload.type, VAULT_TYPES.SPEND);
  assert.equal(mut.payload.amount, 450);
});

// ==========================================
// 3. OFFLINE BEHAVIOR & RELOAD SURVIVAL
// ==========================================

test('PHASE 9C - 5: Vault mutations survive offline storage and simulated page reload', () => {
  resetStorage();
  clearOfflineQueue();

  enqueueMutation(VAULT_MUTATION_TYPES.CREATE, { id: 'v_offline_1', amount: 500 });
  enqueueMutation(VAULT_MUTATION_TYPES.UPDATE, { id: 'v_offline_1', amount: 600 });
  enqueueMutation(VAULT_MUTATION_TYPES.DELETE, { id: 'v_offline_2' });

  // Simulate complete memory clear / browser reload by reading directly from safeStorage
  const rawQueue = safeStorage.getItem('sanchoy_mutation_queue');
  assert.ok(rawQueue, 'Queue must exist in persistent safeStorage');
  const restored = JSON.parse(rawQueue);
  assert.equal(restored.length, 3);
  assert.equal(restored[0].type, 'vault:create');
  assert.equal(restored[1].type, 'vault:update');
  assert.equal(restored[2].type, 'vault:delete');
});

test('PHASE 9C - 6: Queue removal and retry mechanisms operate cleanly on Vault mutations', () => {
  resetStorage();
  clearOfflineQueue();

  const m1 = enqueueMutation(VAULT_MUTATION_TYPES.CREATE, { id: 'v_ret_1', amount: 100 });
  const m2 = enqueueMutation(VAULT_MUTATION_TYPES.CREATE, { id: 'v_ret_2', amount: 200 });

  assert.equal(getOfflineQueue().length, 2);

  // Acknowledge m1 after sync success
  removeMutations([m1.mutationId]);
  const queue = getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].mutationId, m2.mutationId);
});

// ==========================================
// 4. ENCRYPTED WORKSPACE SERIALIZATION
// ==========================================

test('PHASE 9C - 7: Vault data is included in the unified local workspace export', async () => {
  resetStorage();

  const testVaultRecords = [
    { id: 'v_sync_1', type: VAULT_TYPES.DEPOSIT, amount: 1500, sourceWallet: 'online', date: '2026-10-01' },
    { id: 'v_sync_2', type: VAULT_TYPES.SPEND, amount: 200, category: 'Food', date: '2026-10-02' }
  ];
  setDecryptedVaultRecords(testVaultRecords);
  safeStorage.setItem('sanchoy_vault_records_cache', JSON.stringify(testVaultRecords));

  const workspace = await gatherLocalFinancialWorkspace();
  assert.ok(workspace);
  assert.ok(Array.isArray(workspace.vaultRecords));
  assert.equal(workspace.vaultRecords.length, 2);
  assert.equal(workspace.vaultRecords[0].id, 'v_sync_1');
  assert.equal(workspace.vaultRecords[1].id, 'v_sync_2');
});

test('PHASE 9C - 8: Restoring financial workspace reconstructs Vault cache and records', async () => {
  resetStorage();

  const remoteBundle = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    balances: { online: 500, cash: 300 },
    transactions: [],
    categories: [],
    budgets: [],
    vaultRecords: [
      { id: 'v_cloud_1', type: VAULT_TYPES.DEPOSIT, amount: 2500, sourceWallet: 'online', date: '2026-10-01' },
      { id: 'v_cloud_2', type: VAULT_TYPES.WITHDRAWAL, amount: 500, destinationWallet: 'online', date: '2026-10-02' }
    ]
  };

  await restoreFinancialWorkspaceLocally(remoteBundle);

  const restoredCache = JSON.parse(safeStorage.getItem('sanchoy_vault_records_cache') || '[]');
  assert.equal(restoredCache.length, 2);
  assert.equal(restoredCache[0].id, 'v_cloud_1');
  assert.equal(restoredCache[1].id, 'v_cloud_2');

  const activeVault = getVaultSavings();
  assert.equal(activeVault.length, 2);
  const balance = calculateVaultBalance(activeVault);
  assert.equal(balance, 2000, 'Restored vault records must deterministically calculate to ₹2,000');
});

// ==========================================
// 5. SYNC CENTER VISIBILITY
// ==========================================

test('PHASE 9C - 9: Sync Center status accurately reflects pending Vault mutations in local queue', () => {
  resetStorage();
  clearOfflineQueue();

  enqueueMutation(VAULT_MUTATION_TYPES.CREATE, { id: 'v_pend_1', amount: 500 });
  const status = getSyncStatus();
  assert.equal(status.status, SyncStatus.PENDING);
  assert.equal(status.pendingMutationCount, 1);
});

// ==========================================
// 6. MULTI-DEVICE MERGE & FINANCIAL INVARIANT PRESERVATION
// ==========================================

test('PHASE 9C - 10: Multi-device merge preserves Vault ledger, Liquid Balance, and Total Holdings', () => {
  // Device A created a Vault deposit of ₹2,000 and spend of ₹500
  const deviceABundle = {
    balances: { online: 500, cash: 300 },
    transactions: [],
    vaultRecords: [
      { id: 'tx_v_dep', type: VAULT_TYPES.DEPOSIT, amount: 2000, sourceWallet: 'online', date: '2026-10-01' },
      { id: 'tx_v_spd', type: VAULT_TYPES.SPEND, amount: 500, category: 'Shopping', date: '2026-10-02' }
    ]
  };

  // Device B only had the deposit of ₹2,000
  const deviceBBundle = {
    balances: { online: 500, cash: 300 },
    transactions: [],
    vaultRecords: [
      { id: 'tx_v_dep', type: VAULT_TYPES.DEPOSIT, amount: 2000, sourceWallet: 'online', date: '2026-10-01' }
    ]
  };

  // Merge Device A into Device B
  const mergeResult = mergeFinancialWorkspaces(deviceBBundle, deviceABundle, null);
  assert.equal(mergeResult.success, true);
  assert.equal(mergeResult.hasConflict, false);

  const mergedVault = mergeResult.mergedBundle.vaultRecords;
  assert.equal(mergedVault.length, 2);
  assert.ok(mergedVault.some(r => r.id === 'tx_v_dep'));
  assert.ok(mergedVault.some(r => r.id === 'tx_v_spd'));

  // Calculate balances from merged bundle
  const vaultBalance = calculateVaultBalance(mergedVault);
  assert.equal(vaultBalance, 1500, 'Device B must reflect ₹1,500 Vault balance after sync');

  // Verify Accounting Rules:
  // Liquid = Online (₹500) + Cash (₹300) = ₹800
  // Total Holdings = Liquid (₹800) + Vault (₹1,500) = ₹2,300
  const summary = calculateHoldingsSummary(500, 300, vaultBalance);
  assert.equal(summary.liquidBalance, 800, 'Total Liquid Virtual Balance must strictly equal ₹800');
  assert.equal(summary.totalHoldings, 2300, 'Total Sanchoy Holdings must strictly equal ₹2,300');
});

test('PHASE 9C - 11: Idempotent merge with legacy monthly snapshot nodes preserves legacy data', () => {
  const localBundle = {
    vaultRecords: [
      { id: 'legacy_2026_09', month: '2026-09', cashSavings: 1000, onlineSavings: 2000 },
      { id: 'v_dep_new', type: VAULT_TYPES.DEPOSIT, amount: 500, sourceWallet: 'cash', date: '2026-10-01' }
    ]
  };

  const remoteBundle = {
    vaultRecords: [
      { id: 'legacy_2026_09', month: '2026-09', cashSavings: 1000, onlineSavings: 2000 },
      { id: 'legacy_2026_08', month: '2026-08', cashSavings: 500, onlineSavings: 1500 }
    ]
  };

  const mergeResult = mergeFinancialWorkspaces(localBundle, remoteBundle, null);
  assert.equal(mergeResult.success, true);
  assert.equal(mergeResult.mergedBundle.vaultRecords.length, 3);

  const balance = calculateVaultBalance(mergeResult.mergedBundle.vaultRecords);
  // Legacy 09: 3000, Legacy 08: 2000, Deposit: 500 => Total 5500
  assert.equal(balance, 5500);
});
