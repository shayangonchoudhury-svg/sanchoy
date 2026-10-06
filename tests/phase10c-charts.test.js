import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateFinancialIntelligence,
  ANALYTICAL_WINDOWS
} from '../js/financial/intelligence.js';

import {
  DNA_DIMENSION_LABELS,
  formatDNAStatus,
  prepareFinancialDNAChartData,
  prepareCashFlowChartData,
  prepareSpendingBehaviorData,
  prepareWalletIntelligenceData,
  prepareSavingsWealthData,
  prepareHistoricalFingerprintData
} from '../js/charts/chart-adapter.js';

import { VAULT_TYPES } from '../js/financial/vault-ledger.js';

// Mock chart tokens
const mockTokens = {
  text: '#b1bdb9',
  textMuted: '#75837e',
  grid: 'rgba(243, 241, 236, 0.07)',
  border: 'rgba(243, 241, 236, 0.10)',
  expense: '#f87171',
  expenseBg: 'rgba(248, 113, 113, 0.10)',
  income: '#34d399',
  incomeBg: 'rgba(52, 211, 153, 0.10)',
  accent: '#5ea891',
  accentSecondary: '#c48b59',
  radarBg: 'rgba(94, 168, 145, 0.20)',
  categories: ['#5ea891', '#c48b59', '#568ea6', '#889d96']
};

// ==================================================
// PHASE 10C — FINANCIAL INTELLIGENCE CHARTS & ADAPTER TESTS
// ==================================================

test('PHASE 10C - 1: Financial DNA adapter extracts 7 dimensions with non-judgmental statuses', () => {
  const intel = calculateFinancialIntelligence({
    transactions: [
      { id: '1', amount: 100, type: 'expense', method: 'online', category: 'Food', date: '2026-09-15' },
      { id: '2', amount: 300, type: 'income', method: 'online', category: 'Freelance', date: '2026-09-16' }
    ],
    initialBalances: { online: 2000, cash: 500 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const dnaData = prepareFinancialDNAChartData(intel, mockTokens);

  assert.equal(dnaData.labels.length, 7, 'Must have exactly 7 dimensions');
  assert.equal(dnaData.items.length, 7);
  assert.ok(Array.isArray(dnaData.scores));
  assert.equal(dnaData.scores.length, 7);

  // Check required non-judgmental status format
  dnaData.items.forEach(item => {
    assert.ok(item.label, 'Item must have a readable label');
    assert.ok(item.status, 'Item must have a status string');
    assert.ok(item.statusLabel, 'Item must have a clean status display string');
    // Ensure no judgmental terms
    const forbidden = ['bad', 'poor person', 'failure', 'irresponsible', 'pathetic', 'guilty'];
    forbidden.forEach(term => {
      assert.ok(!item.statusLabel.toLowerCase().includes(term), `Status must not contain "${term}"`);
    });
  });
});

test('PHASE 10C - 2: Financial DNA handles insufficient data cleanly without fabricating scores', () => {
  const emptyIntel = calculateFinancialIntelligence({
    transactions: [],
    initialBalances: { online: 0, cash: 0 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const dnaData = prepareFinancialDNAChartData(emptyIntel, mockTokens);

  assert.equal(dnaData.hasAnyScore, false, 'hasAnyScore should be false when data is insufficient');
  assert.equal(dnaData.validScoresCount, 0);

  // Check that all unmeasured dimensions show 'Building Pattern' or deficit-free
  const lr = dnaData.items.find(i => i.key === 'liquidityResilience');
  assert.equal(lr.score, null, 'Score must remain strictly null for insufficient data');
  assert.equal(lr.statusLabel, 'Building Pattern');

  const recovery = dnaData.items.find(i => i.key === 'recovery');
  assert.equal(recovery.score, null);
  assert.equal(recovery.statusLabel, 'Deficit-Free');
});

test('PHASE 10C - 3: Cash Flow adapter strictly excludes internal transfers from expenses and income', () => {
  const vaultRecords = [
    { id: 'v1', type: VAULT_TYPES.DEPOSIT, amount: 600, sourceWallet: 'online', date: '2026-09-12' },
    { id: 'v2', type: VAULT_TYPES.WITHDRAWAL, amount: 200, destinationWallet: 'online', date: '2026-09-18' }
  ];

  const transactions = [
    { id: 't1', amount: 150, type: 'expense', method: 'online', category: 'Groceries', date: '2026-09-14' },
    { id: 't2', amount: 400, type: 'income', method: 'cash', category: 'Gift', date: '2026-09-20' }
  ];

  const intel = calculateFinancialIntelligence({
    transactions,
    vaultRecords,
    initialBalances: { online: 1500, cash: 800 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const cashFlow = prepareCashFlowChartData(intel, mockTokens);

  assert.equal(cashFlow.hasData, true);
  // Total expenses must be exactly 150 (not 150 + 600)
  assert.equal(cashFlow.totalExpenses, 150, 'Vault deposit must not be counted as expense');
  // Total inflows must be exactly 400 (not 400 + 200)
  assert.equal(cashFlow.totalInflows, 400, 'Vault withdrawal must not be counted as income');
  assert.equal(cashFlow.netSavings, 250);
});

test('PHASE 10C - 4: Spending Behavior category aggregation uses only real categories and includes Vault spend', () => {
  const transactions = [
    { id: 't1', amount: 120, type: 'expense', category: 'Food & Dining', date: '2026-09-10' },
    { id: 't2', amount: 80, type: 'expense', category: 'Transportation', date: '2026-09-12' }
  ];

  const vaultRecords = [
    { id: 'v_spend', type: VAULT_TYPES.SPEND, amount: 250, category: 'Electronics', date: '2026-09-15' }
  ];

  const intel = calculateFinancialIntelligence({
    transactions,
    vaultRecords,
    initialBalances: { online: 2000, cash: 500 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const spending = prepareSpendingBehaviorData(intel, transactions, vaultRecords, mockTokens);

  assert.equal(spending.category.hasData, true);
  assert.equal(spending.category.total, 450);
  assert.ok(spending.category.labels.includes('Food & Dining'));
  assert.ok(spending.category.labels.includes('Transportation'));
  assert.ok(spending.category.labels.includes('Electronics'));
});

test('PHASE 10C - 5: Spending Velocity computes deterministic cumulative progression', () => {
  const transactions = [
    { id: 't1', amount: 100, type: 'expense', method: 'online', date: '2026-09-10' },
    { id: 't2', amount: 200, type: 'expense', method: 'online', date: '2026-09-20' }
  ];

  const intel = calculateFinancialIntelligence({
    transactions,
    initialBalances: { online: 3000, cash: 0 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const spending = prepareSpendingBehaviorData(intel, transactions, [], mockTokens);
  const vel = spending.velocity;

  assert.equal(vel.hasData, true);
  assert.equal(vel.totalSpend, 300);
  assert.equal(vel.cumulativeActual[vel.cumulativeActual.length - 1], 300);
  assert.equal(vel.cumulativeActual.length, 30);

  // Cumulative actual spend is monotonically non-decreasing
  for (let i = 1; i < vel.cumulativeActual.length; i++) {
    assert.ok(vel.cumulativeActual[i] >= vel.cumulativeActual[i - 1], 'Velocity must be monotonically non-decreasing');
  }
});

test('PHASE 10C - 6: Spending Volatility exposes authoritative intelligence volatility metric', () => {
  const transactions = [
    { id: 't1', amount: 500, type: 'expense', method: 'online', date: '2026-09-15' }
  ];

  const intel = calculateFinancialIntelligence({
    transactions,
    initialBalances: { online: 3000, cash: 0 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const spending = prepareSpendingBehaviorData(intel, transactions, [], mockTokens);
  const vol = spending.volatility;

  assert.equal(vol.hasData, true);
  assert.equal(vol.rawVolatility, intel.raw.expenseVolatility);
  assert.equal(vol.dailyExpenses.length, 30);
  assert.equal(vol.meanLine.length, 30);
});

test('PHASE 10C - 7: Wallet Intelligence strictly separates Online and Cash and excludes Vault from Liquid Balance', () => {
  const vaultRecords = [
    { id: 'v1', type: VAULT_TYPES.DEPOSIT, amount: 1000, sourceWallet: 'online', date: '2026-09-10' }
  ];

  const intel = calculateFinancialIntelligence({
    transactions: [],
    vaultRecords,
    initialBalances: { online: 3000, cash: 500 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const walletData = prepareWalletIntelligenceData(intel, mockTokens);

  // Online started at 3000, deposited 1000 to vault -> 2000
  // Cash = 500
  // Liquid balance = 2500 (Vault 1000 is NOT included!)
  assert.equal(walletData.distribution.onlineBalance, 2000);
  assert.equal(walletData.distribution.cashBalance, 500);
  assert.equal(walletData.distribution.liquidBalance, 2500);

  // Ratio: Online is 2000 / 2500 = 80%, Cash is 20%
  assert.equal(walletData.distribution.onlinePct, 80);
  assert.equal(walletData.distribution.cashPct, 20);

  // Trends must have 30 days
  assert.equal(walletData.trend.onlineTrend.length, 30);
  assert.equal(walletData.trend.cashTrend.length, 30);
  assert.equal(walletData.trend.liquidTrend.length, 30);
});

test('PHASE 10C - 8: Savings & Wealth tracks Liquid Trajectory, Vault, and Net Sanchoy Holdings', () => {
  const vaultRecords = [
    { id: 'v1', type: VAULT_TYPES.DEPOSIT, amount: 800, sourceWallet: 'online', date: '2026-09-12' },
    { id: 'v2', type: VAULT_TYPES.SPEND, amount: 150, category: 'Medical', date: '2026-09-22' }
  ];

  const transactions = [
    { id: 't1', amount: 200, type: 'expense', method: 'cash', date: '2026-09-15' }
  ];

  const intel = calculateFinancialIntelligence({
    transactions,
    vaultRecords,
    initialBalances: { online: 2000, cash: 1000 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const wealth = prepareSavingsWealthData(intel, mockTokens);

  // Online: 2000 - 800 (vault deposit) = 1200
  // Cash: 1000 - 200 (expense) = 800
  // Liquid = 2000
  // Vault: 800 - 150 = 650
  // Total Holdings = 2000 + 650 = 2650
  assert.equal(wealth.currentLiquid, 2000);
  assert.equal(wealth.currentVault, 650);
  assert.equal(wealth.currentHoldings, 2650);
  assert.equal(wealth.labels.length, 30);
  assert.equal(wealth.holdingsTrend[wealth.holdingsTrend.length - 1], 2650);
});

test('PHASE 10C - 9: Analytical window controls support 7D, 30D, 90D, 6M, 1Y without data regression', () => {
  const ranges = [
    ANALYTICAL_WINDOWS.LAST_7_DAYS,
    ANALYTICAL_WINDOWS.LAST_30_DAYS,
    ANALYTICAL_WINDOWS.LAST_90_DAYS,
    ANALYTICAL_WINDOWS.LAST_180_DAYS,
    ANALYTICAL_WINDOWS.LAST_365_DAYS
  ];

  ranges.forEach(rangeKey => {
    const intel = calculateFinancialIntelligence({
      transactions: [{ id: '1', amount: 50, type: 'expense', method: 'online', date: '2026-10-01' }],
      initialBalances: { online: 1000, cash: 500 },
      targetDate: '2026-10-05',
      period: rangeKey
    });

    assert.ok(intel.window.observedDays > 0, `Range ${rangeKey} must produce positive observed days`);
    assert.ok(intel.dailyTimeline.length === intel.window.observedDays);
  });
});

test('PHASE 10C - 10: Historical fingerprint aggregates monthly records deterministically', () => {
  const transactions = [
    { id: 't1', amount: 500, type: 'income', method: 'online', date: '2026-08-10' },
    { id: 't2', amount: 200, type: 'expense', method: 'online', date: '2026-08-15' },
    { id: 't3', amount: 800, type: 'income', method: 'online', date: '2026-09-05' },
    { id: 't4', amount: 350, type: 'expense', method: 'cash', date: '2026-09-20' }
  ];

  const fingerprint = prepareHistoricalFingerprintData(transactions, [], null, mockTokens);

  assert.equal(fingerprint.hasData, true);
  assert.ok(fingerprint.months.length >= 2);

  const aug = fingerprint.months.find(m => m.key === '2026-08');
  assert.ok(aug);
  assert.equal(aug.income, 500);
  assert.equal(aug.expenses, 200);
  assert.equal(aug.netSavings, 300);

  const sep = fingerprint.months.find(m => m.key === '2026-09');
  assert.ok(sep);
  assert.equal(sep.income, 800);
  assert.equal(sep.expenses, 350);
  assert.equal(sep.netSavings, 450);
});

test('PHASE 10C - 11: Empty workspace generates valid empty state adapters without runtime throws', () => {
  const emptyIntel = calculateFinancialIntelligence({
    transactions: [],
    vaultRecords: [],
    initialBalances: { online: 0, cash: 0 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const dna = prepareFinancialDNAChartData(emptyIntel, mockTokens);
  assert.equal(dna.hasAnyScore, false);

  const cashFlow = prepareCashFlowChartData(emptyIntel, mockTokens);
  assert.equal(cashFlow.hasData, false);

  const spending = prepareSpendingBehaviorData(emptyIntel, [], [], mockTokens);
  assert.equal(spending.category.hasData, false);
  assert.equal(spending.velocity.hasData, false);
  assert.equal(spending.volatility.hasData, false);

  const wallets = prepareWalletIntelligenceData(emptyIntel, mockTokens);
  assert.equal(wallets.distribution.liquidBalance, 0);

  const wealth = prepareSavingsWealthData(emptyIntel, mockTokens);
  assert.equal(wealth.currentHoldings, 0);

  const fp = prepareHistoricalFingerprintData([], [], null, mockTokens);
  assert.equal(fp.hasData, false);
});
