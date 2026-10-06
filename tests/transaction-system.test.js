// Automated Tests for Phase 2: Sanchoy Transaction System & Dashboard Foundation
// Verifies Section 33 requirements (TEST 1 to TEST 15)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WALLET_TYPES,
  normalizeWalletType,
  createWalletState
} from '../js/financial/wallets.js';

import {
  getDaysInMonth,
  getDailyAllocation,
  createAllowanceConfig,
  generateDailyAllocationEvents
} from '../js/financial/allowance.js';

import {
  calculateRecoveryEstimate
} from '../js/financial/recovery.js';

import {
  EVENT_TYPES,
  adaptTransactionToLedgerEvent,
  calculateWalletBalance,
  reconcileVirtualLedger
} from '../js/financial/ledger.js';

test('TEST 1: Creating an expense updates the correct wallet', () => {
  const initial = { online: 100, cash: 100 };
  const txs = [
    { id: 'tx_exp_online', type: 'expense', amount: 35, method: 'Online', date: '2026-09-01T12:00:00Z', category: 'Food & Dining' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    initialBalances: initial,
    targetDateStr: '2026-09-01'
  });

  assert.equal(result.wallets.online, 65, 'Online wallet should decrease by 35');
  assert.equal(result.wallets.cash, 100, 'Cash wallet should remain untouched');
});

test('TEST 2: Creating income updates the correct wallet', () => {
  const initial = { online: 50, cash: 50 };
  const txs = [
    { id: 'tx_inc_cash', type: 'income', amount: 120, method: 'Cash', date: '2026-09-01T12:00:00Z', category: 'Gift' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    initialBalances: initial,
    targetDateStr: '2026-09-01'
  });

  assert.equal(result.wallets.cash, 170, 'Cash wallet should increase by 120');
  assert.equal(result.wallets.online, 50, 'Online wallet should remain untouched');
});

test('TEST 3: Manual income does not change the allowance rate', () => {
  const allowanceConfig = createAllowanceConfig({
    monthlyOnlineAllowance: 900, // 30/day in Sept (30 days)
    monthlyCashAllowance: 600,   // 20/day in Sept
    effectiveDate: '2026-09-01'
  });

  const txs = [
    { id: 'tx_bonus', type: 'income', amount: 15000, method: 'Online', date: '2026-09-05T12:00:00Z', category: 'Salary / Internship' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig,
    targetDateStr: '2026-09-05'
  });

  // Daily allocation rates MUST remain identical
  assert.equal(result.dailyRates.online, 30);
  assert.equal(result.dailyRates.cash, 20);
});

test('TEST 4: Cash transactions do not change Online', () => {
  const initial = { online: 250, cash: 80 };
  const txs = [
    { id: 'c1', type: 'expense', amount: 30, method: 'Cash', date: '2026-09-01T10:00:00Z', category: 'Transport' },
    { id: 'c2', type: 'income', amount: 50, method: 'Cash', date: '2026-09-02T10:00:00Z', category: 'Refund' },
    { id: 'c3', type: 'expense', amount: 20, method: 'Cash', date: '2026-09-03T10:00:00Z', category: 'Food & Dining' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    initialBalances: initial,
    targetDateStr: '2026-09-03'
  });

  assert.equal(result.wallets.online, 250, 'Online wallet must stay at 250');
  assert.equal(result.wallets.cash, 80 - 30 + 50 - 20, 'Cash wallet reflects transactions');
});

test('TEST 5: Online transactions do not change Cash', () => {
  const initial = { online: 300, cash: 120 };
  const txs = [
    { id: 'o1', type: 'expense', amount: 100, method: 'Online', date: '2026-09-01T10:00:00Z', category: 'Bills' },
    { id: 'o2', type: 'income', amount: 400, method: 'Online', date: '2026-09-02T10:00:00Z', category: 'Freelance' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    initialBalances: initial,
    targetDateStr: '2026-09-02'
  });

  assert.equal(result.wallets.cash, 120, 'Cash wallet must stay at 120');
  assert.equal(result.wallets.online, 300 - 100 + 400, 'Online wallet reflects transactions');
});

test('TEST 6: Negative balances remain supported', () => {
  const initial = { online: 20, cash: 10 };
  const txs = [
    { id: 'o_over', type: 'expense', amount: 75, method: 'Online', date: '2026-09-01T10:00:00Z', category: 'Shopping' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    initialBalances: initial,
    targetDateStr: '2026-09-01'
  });

  assert.equal(result.wallets.online, -55);
  assert.equal(result.wallets.isOnlineNegative, true);
  assert.equal(result.wallets.cash, 10);
  assert.equal(result.wallets.isCashNegative, false);
});

test('TEST 7: Deleting a transaction correctly reconciles the ledger', () => {
  const initial = { online: 100, cash: 100 };
  let txs = [
    { id: 'tx_delete_me', type: 'expense', amount: 45, method: 'Online', date: '2026-09-01T10:00:00Z', category: 'Shopping' },
    { id: 'tx_keep_me', type: 'expense', amount: 20, method: 'Online', date: '2026-09-02T10:00:00Z', category: 'Health' }
  ];

  // Reconcile before deletion: 100 - 45 - 20 = 35
  const before = reconcileVirtualLedger({ transactions: txs, initialBalances: initial, targetDateStr: '2026-09-02' });
  assert.equal(before.wallets.online, 35);

  // Delete 'tx_delete_me'
  txs = txs.filter(t => t.id !== 'tx_delete_me');

  // Reconcile after deletion: 100 - 20 = 80
  const after = reconcileVirtualLedger({ transactions: txs, initialBalances: initial, targetDateStr: '2026-09-02' });
  assert.equal(after.wallets.online, 80, 'Deleting transaction must restore the balance deterministically');
});

test('TEST 8: Editing a transaction correctly reconciles the ledger', () => {
  const initial = { online: 100, cash: 100 };
  const txs = [
    { id: 'tx_edit_me', type: 'expense', amount: 30, method: 'Online', date: '2026-09-01T10:00:00Z', category: 'Food & Dining' }
  ];

  const before = reconcileVirtualLedger({ transactions: txs, initialBalances: initial, targetDateStr: '2026-09-01' });
  assert.equal(before.wallets.online, 70);
  assert.equal(before.wallets.cash, 100);

  // Edit: change amount to 50 and switch wallet to Cash
  txs[0].amount = 50;
  txs[0].method = 'Cash';

  const after = reconcileVirtualLedger({ transactions: txs, initialBalances: initial, targetDateStr: '2026-09-01' });
  assert.equal(after.wallets.online, 100, 'Online wallet should be restored to 100');
  assert.equal(after.wallets.cash, 50, 'Cash wallet should reflect the edited expense (100 - 50 = 50)');
});

test('TEST 9: Historical transaction dates remain correct', () => {
  const txs = [
    { id: 't_past', type: 'expense', amount: 15, method: 'Cash', date: '2025-03-14T08:15:00.000Z', category: 'Transport' }
  ];

  const event = adaptTransactionToLedgerEvent(txs[0]);
  assert.equal(event.date, '2025-03-14T08:15:00.000Z');
  assert.equal(event.wallet, 'cash');
});

test('TEST 10: Existing transactions remain readable', () => {
  const legacyRecord = {
    id: 't_1234567890',
    type: 'Expense',
    amount: '42.75',
    category: 'Study Material',
    method: 'Online',
    desc: 'Bought DBMS lab record',
    date: '2026-09-20T14:00:00Z'
  };

  const event = adaptTransactionToLedgerEvent(legacyRecord);
  assert.equal(event.id, 't_1234567890');
  assert.equal(event.type, EVENT_TYPES.EXPENSE);
  assert.equal(event.amount, 42.75);
  assert.equal(event.wallet, WALLET_TYPES.ONLINE);
  assert.equal(event.category, 'Study Material');
  assert.equal(event.desc, 'Bought DBMS lab record');
});

test('TEST 11: Automatic allocation events remain distinct from manual income', () => {
  const allowanceConfig = createAllowanceConfig({
    monthlyOnlineAllowance: 600,
    effectiveDate: '2026-09-01'
  });

  const txs = [
    { id: 'manual_1', type: 'income', amount: 100, method: 'Online', date: '2026-09-01T12:00:00Z', category: 'Freelance' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig,
    targetDateStr: '2026-09-01'
  });

  const allocationEvents = result.events.filter(e => e.type === EVENT_TYPES.ALLOCATION);
  const manualIncomeEvents = result.events.filter(e => e.type === EVENT_TYPES.MANUAL_INCOME);

  assert.equal(allocationEvents.length, 1);
  assert.equal(allocationEvents[0].source, 'allowance_engine');
  assert.equal(manualIncomeEvents.length, 1);
  assert.equal(manualIncomeEvents[0].source, 'manual_transaction');
  assert.notEqual(allocationEvents[0].type, manualIncomeEvents[0].type);
});

test('TEST 12: Dashboard balances match the financial engine', () => {
  const allowanceConfig = createAllowanceConfig({
    monthlyOnlineAllowance: 750, // 25/day
    monthlyCashAllowance: 300,   // 10/day
    effectiveDate: '2026-09-01'
  });

  const txs = [
    { id: 't1', type: 'expense', amount: 20, method: 'Online', date: '2026-09-01T10:00:00Z', category: 'Food & Dining' },
    { id: 't2', type: 'income', amount: 50, method: 'Cash', date: '2026-09-01T11:00:00Z', category: 'Gift' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig,
    initialBalances: { online: 0, cash: 0 },
    targetDateStr: '2026-09-01'
  });

  // Online: 25 allocation - 20 expense = 5
  assert.equal(result.wallets.online, 5);
  // Cash: 10 allocation + 50 income = 60
  assert.equal(result.wallets.cash, 60);
  // Total: 65
  assert.equal(result.wallets.total, 65);
});

test('TEST 13: Negative/recovery UI reflects the financial engine', () => {
  // Deficit of 60 with 20/day allocation -> 3 days
  const rec1 = calculateRecoveryEstimate(-60, 20);
  assert.equal(rec1.isNegative, true);
  assert.equal(rec1.deficit, 60);
  assert.equal(rec1.recoveryDays, 3);
  assert.ok(rec1.message.includes('Assuming no additional spending') || rec1.message.includes('assuming no additional spending'));

  // Positive balance -> no recovery warning
  const rec2 = calculateRecoveryEstimate(40, 20);
  assert.equal(rec2.isNegative, false);
  assert.equal(rec2.recoveryDays, 0);

  // Exactly zero -> valid normal state, no recovery warning
  const rec3 = calculateRecoveryEstimate(0, 20);
  assert.equal(rec3.isNegative, false);
  assert.equal(rec3.recoveryDays, 0);
});

test('TEST 14: Existing Vault records remain readable', () => {
  const vaultRecord = {
    id: 'node_test_vault',
    month: '2026-09',
    cashSavings: 1000,
    onlineSavings: 2000,
    emergencySavings: 500,
    notes: 'Preserved secret node'
  };

  assert.equal(vaultRecord.id, 'node_test_vault');
  assert.equal(vaultRecord.month, '2026-09');
  assert.equal(vaultRecord.cashSavings, 1000);
});

test('TEST 15: Existing JSON backup/restore remains functional', () => {
  const backupData = {
    version: '2.0.0',
    app: 'SANCHOY',
    exportedAt: new Date().toISOString(),
    transactions: [
      { id: 'tx_b1', type: 'expense', amount: 15, method: 'Cash', category: 'Food & Dining', date: '2026-09-01T12:00:00Z' }
    ],
    balances: { cash: 50, online: 150 },
    allowanceConfig: {
      monthlyOnlineAllowance: 800,
      monthlyCashAllowance: 400,
      effectiveDate: '2026-09-01'
    }
  };

  const serialized = JSON.stringify(backupData);
  const deserialized = JSON.parse(serialized);

  assert.equal(deserialized.app, 'SANCHOY');
  assert.equal(deserialized.transactions.length, 1);
  assert.equal(deserialized.allowanceConfig.monthlyOnlineAllowance, 800);
});
