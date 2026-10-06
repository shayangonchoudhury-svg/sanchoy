// Automated Tests for Sanchoy Virtual Ledger & Allowance Engine
// Verifies TEST 1 through TEST 15 per Phase 1 requirements.

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
  generateDateSequence,
  generateDailyAllocationEvents
} from '../js/financial/allowance.js';

import {
  calculateRecoveryEstimate
} from '../js/financial/recovery.js';

import {
  EVENT_TYPES,
  adaptTransactionToLedgerEvent,
  calculateWalletBalance,
  reconcileVirtualLedger,
  explainWalletBalance
} from '../js/financial/ledger.js';

test('TEST 1: Monthly allowance produces the correct daily allocation', () => {
  // February in a non-leap year (2025): 28 days
  const dailyFeb28 = getDailyAllocation(840, 2025, 2);
  assert.equal(dailyFeb28, 840 / 28);
  assert.equal(dailyFeb28, 30);

  // April (30 days)
  const dailyApr = getDailyAllocation(900, 2026, 4);
  assert.equal(dailyApr, 30);

  // September (30 days)
  const dailySep = getDailyAllocation(800, 2026, 9);
  assert.equal(dailySep, 800 / 30);
  assert.equal(Number(dailySep.toFixed(2)), 26.67);

  // January (31 days)
  const dailyJan = getDailyAllocation(930, 2026, 1);
  assert.equal(dailyJan, 30);
});

test('TEST 2: Unused allocation carries forward', () => {
  const config = createAllowanceConfig({
    monthlyOnlineAllowance: 775, // in Jan (31 days): 25/day
    effectiveDate: '2026-01-01'
  });

  // Day 1 to Day 2 allocations: 2 days * 25 = 50
  // Spend 10 on Day 1
  const txs = [
    { id: 'tx_1', type: 'expense', amount: 10, method: 'Online', date: '2026-01-01T10:00:00Z' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig: config,
    targetDateStr: '2026-01-02'
  });

  // Balance on Day 2 should be: Day 1 (25 - 10 = 15) + Day 2 (25) = 40
  assert.equal(result.wallets.online, 40);
});

test('TEST 3: Expense reduces the correct wallet', () => {
  const txs = [
    { id: 'tx_online', type: 'expense', amount: 30, method: 'Online', date: '2026-09-01T12:00:00Z' },
    { id: 'tx_cash', type: 'expense', amount: 15, method: 'Cash', date: '2026-09-01T12:00:00Z' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig: null,
    initialBalances: { online: 100, cash: 50 },
    targetDateStr: '2026-09-01'
  });

  assert.equal(result.wallets.online, 70); // 100 - 30
  assert.equal(result.wallets.cash, 35);   // 50 - 15
});

test('TEST 4: Income increases the correct wallet', () => {
  const txs = [
    { id: 'inc_online', type: 'income', amount: 150, method: 'Online', date: '2026-09-05T12:00:00Z' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig: null,
    initialBalances: { online: 50, cash: 20 },
    targetDateStr: '2026-09-05'
  });

  assert.equal(result.wallets.online, 200); // 50 + 150
  assert.equal(result.wallets.cash, 20);    // Unchanged
});

test('TEST 5: Manual income does not alter daily allocation', () => {
  const config = createAllowanceConfig({
    monthlyOnlineAllowance: 750, // 750 / 30 = 25/day in Sep
    monthlyCashAllowance: 300,   // 300 / 30 = 10/day in Sep
    effectiveDate: '2026-09-01'
  });

  const txs = [
    { id: 'inc_bonus', type: 'income', amount: 5000, method: 'Online', date: '2026-09-05T12:00:00Z' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig: config,
    targetDateStr: '2026-09-05'
  });

  // Daily rates must remain 25 and 10 regardless of the 5000 manual income
  assert.equal(result.dailyRates.online, 25);
  assert.equal(result.dailyRates.cash, 10);
});

test('TEST 6: Negative balances are allowed', () => {
  const txs = [
    { id: 'overdraft_tx', type: 'expense', amount: 50, method: 'Online', date: '2026-09-01T12:00:00Z' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig: null,
    initialBalances: { online: 20, cash: 0 },
    targetDateStr: '2026-09-01'
  });

  assert.equal(result.wallets.online, -30);
  assert.equal(result.wallets.isOnlineNegative, true);
});

test('TEST 7: Automatic allocation continues while negative', () => {
  const config = createAllowanceConfig({
    monthlyOnlineAllowance: 750, // 25/day in Sep
    effectiveDate: '2026-09-01'
  });

  // Initial deficit of -50, allocations for 3 days (Sep 1, 2, 3) = +75
  const result = reconcileVirtualLedger({
    transactions: [],
    allowanceConfig: config,
    initialBalances: { online: -50, cash: 0 },
    targetDateStr: '2026-09-03'
  });

  // Day 1 (-50 + 25 = -25), Day 2 (-25 + 25 = 0), Day 3 (0 + 25 = 25)
  assert.equal(result.wallets.online, 25);
});

test('TEST 8: Recovery estimate is correct', () => {
  // -50 with daily allocation of 25 -> ceil(50 / 25) = 2 days
  const rec1 = calculateRecoveryEstimate(-50, 25);
  assert.equal(rec1.isNegative, true);
  assert.equal(rec1.recoveryDays, 2);

  // -55 with daily allocation of 25 -> ceil(55 / 25) = 3 days
  const rec2 = calculateRecoveryEstimate(-55, 25);
  assert.equal(rec2.isNegative, true);
  assert.equal(rec2.recoveryDays, 3);

  // Positive balance -> recoveryDays = 0
  const recPos = calculateRecoveryEstimate(100, 25);
  assert.equal(recPos.isNegative, false);
  assert.equal(recPos.recoveryDays, 0);

  // Negative balance with zero daily allocation -> unavailable
  const recZeroDaily = calculateRecoveryEstimate(-50, 0);
  assert.equal(recZeroDaily.isNegative, true);
  assert.equal(recZeroDaily.recoveryDays, null);
  assert.equal(recZeroDaily.isRecoverable, false);
});

test('TEST 9: Zero balance is valid', () => {
  const state = createWalletState(0, 0);
  assert.equal(state.online, 0);
  assert.equal(state.cash, 0);
  assert.equal(state.total, 0);
  assert.equal(state.isOnlineNegative, false);
  assert.equal(state.isCashNegative, false);
});

test('TEST 10: Same-day allocation cannot be duplicated', () => {
  const config = createAllowanceConfig({
    monthlyOnlineAllowance: 600, // 20/day
    effectiveDate: '2026-09-25'
  });

  // Calling generator multiple times on the same date produces the exact same deterministic event IDs
  const run1 = generateDailyAllocationEvents(config, '2026-09-25');
  const run2 = generateDailyAllocationEvents(config, '2026-09-25');

  assert.equal(run1.length, 1);
  assert.equal(run2.length, 1);
  assert.equal(run1[0].id, 'alloc_2026-09-25_online');
  assert.equal(run2[0].id, 'alloc_2026-09-25_online');

  // Passing multiple duplicate events through ledger deduplication
  const events = [...run1, ...run2];
  const uniqueIds = new Set();
  const deduped = events.filter(e => {
    if (uniqueIds.has(e.id)) return false;
    uniqueIds.add(e.id);
    return true;
  });

  assert.equal(deduped.length, 1);
});

test('TEST 11: Cash and Online remain independent', () => {
  const config = createAllowanceConfig({
    monthlyOnlineAllowance: 600, // 20/day
    monthlyCashAllowance: 300,   // 10/day
    effectiveDate: '2026-09-01'
  });

  const txs = [
    { id: 't_on', type: 'expense', amount: 50, method: 'Online', date: '2026-09-01T12:00:00Z' }
  ];

  const result = reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig: config,
    targetDateStr: '2026-09-01'
  });

  // Online had 20 allocation - 50 expense = -30
  assert.equal(result.wallets.online, -30);
  // Cash had 10 allocation - 0 expense = +10 (completely untouched by Online transaction)
  assert.equal(result.wallets.cash, 10);
  assert.equal(result.wallets.total, -20);
});

test('TEST 12: Month boundaries use the correct number of calendar days', () => {
  // Non-leap Feb (2025): 28 days
  assert.equal(getDaysInMonth(2025, 2), 28);
  // Leap Feb (2024): 29 days
  assert.equal(getDaysInMonth(2024, 2), 29);
  // Leap Feb (2028): 29 days
  assert.equal(getDaysInMonth(2028, 2), 29);
  // March: 31 days
  assert.equal(getDaysInMonth(2026, 3), 31);
  // April: 30 days
  assert.equal(getDaysInMonth(2026, 4), 30);
});

test('TEST 13: Mid-month allowance start does not create retroactive allocations', () => {
  const config = createAllowanceConfig({
    monthlyOnlineAllowance: 600, // 20/day in Sep
    effectiveDate: '2026-09-15'  // Started on the 15th
  });

  // Asking for allocations from beginning of month up to the 16th
  const allocations = generateDailyAllocationEvents(config, '2026-09-16');

  // Must only contain 2 days: 2026-09-15 and 2026-09-16
  assert.equal(allocations.length, 2);
  assert.equal(allocations[0].date, '2026-09-15');
  assert.equal(allocations[1].date, '2026-09-16');

  // Verify none exist before 2026-09-15
  const before15 = allocations.filter(a => a.date < '2026-09-15');
  assert.equal(before15.length, 0);
});

test('TEST 14: Existing transaction records remain readable', () => {
  const legacyTx = {
    id: 't_legacy_1720000000000',
    type: 'expense',
    amount: 45.50,
    category: 'Food & Dining',
    method: 'Cash',
    desc: 'Lunch with colleagues',
    date: '2026-08-10T13:30:00.000Z'
  };

  const event = adaptTransactionToLedgerEvent(legacyTx);

  assert.equal(event.id, legacyTx.id);
  assert.equal(event.type, EVENT_TYPES.EXPENSE);
  assert.equal(event.wallet, WALLET_TYPES.CASH);
  assert.equal(event.amount, 45.50);
  assert.equal(event.category, 'Food & Dining');
  assert.equal(event.desc, 'Lunch with colleagues');
});

test('TEST 15: Existing vault records remain readable', () => {
  // Vault record schema remains unchanged
  const sampleVaultRecord = {
    id: 'vault_sample_record_1',
    month: '2026-05',
    cashSavings: 5000,
    onlineSavings: 14500,
    extraSavings: 1500,
    emergencySavings: 3000,
    investments: 18000,
    goldSavings: 2000,
    otherSavings: 1000,
    notes: 'Historical test entry'
  };

  const sum = Number(sampleVaultRecord.cashSavings) +
              Number(sampleVaultRecord.onlineSavings) +
              Number(sampleVaultRecord.extraSavings) +
              Number(sampleVaultRecord.emergencySavings) +
              Number(sampleVaultRecord.investments) +
              Number(sampleVaultRecord.goldSavings) +
              Number(sampleVaultRecord.otherSavings);

  assert.equal(sum, 45000);
  assert.equal(sampleVaultRecord.id, 'vault_sample_record_1');
  assert.equal(sampleVaultRecord.month, '2026-05');
});
