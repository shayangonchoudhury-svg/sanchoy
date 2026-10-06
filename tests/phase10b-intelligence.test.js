import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateFinancialIntelligence,
  calculateRawFinancialMetrics,
  calculateFinancialDNA,
  calculateSavingsDNA,
  resolveAnalyticalWindow,
  buildDailyTimeline,
  calculateMean,
  calculateMedian,
  calculateStandardDeviation,
  ANALYTICAL_WINDOWS,
  FINANCIAL_DNA_DIMENSIONS,
  SAVINGS_DNA_DIMENSIONS
} from '../js/financial/intelligence.js';

import { VAULT_TYPES } from '../js/financial/vault-ledger.js';

// ==================================================
// PHASE 10B — DETERMINISTIC FINANCIAL INTELLIGENCE ENGINE TESTS
// ==================================================

test('TEST 1: Mathematical helpers are pure, accurate, and deterministic', () => {
  assert.equal(calculateMean([10, 20, 30]), 20);
  assert.equal(calculateMean([]), 0);

  assert.equal(calculateMedian([5, 1, 9]), 5);
  assert.equal(calculateMedian([1, 2, 3, 4]), 2.5);
  assert.equal(calculateMedian([]), 0);

  const std = calculateStandardDeviation([10, 10, 10]);
  assert.equal(std, 0);

  const std2 = calculateStandardDeviation([10, 20]);
  assert.equal(Number(std2.toFixed(2)), 5);
});

test('TEST 2: Empty workspace handles data sufficiency cleanly without fabricating scores', () => {
  const result = calculateFinancialIntelligence({
    transactions: [],
    allowanceConfig: null,
    initialBalances: { online: 0, cash: 0 },
    vaultRecords: [],
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  assert.ok(result.raw, 'Must return raw metrics object');
  assert.equal(result.raw.totalIncome, 0);
  assert.equal(result.raw.totalExpenses, 0);
  assert.equal(result.raw.currentLiquidBalance, 0);
  assert.equal(result.raw.vaultBalance, 0);

  // Financial DNA dimensions contract check
  FINANCIAL_DNA_DIMENSIONS.forEach(dim => {
    const d = result.financialDNA[dim];
    assert.ok(d, `Dimension ${dim} must exist`);
    assert.ok('score' in d);
    assert.ok('status' in d);
    assert.ok('confidence' in d);
    assert.ok('isSufficient' in d);
    assert.ok('reason' in d);
    assert.ok('metrics' in d);
  });

  // Insufficient data dimensions must have null score
  assert.equal(result.financialDNA.liquidityResilience.score, null);
  assert.equal(result.financialDNA.liquidityResilience.status, 'insufficient_data');

  assert.equal(result.financialDNA.savingBehavior.score, null);
  assert.equal(result.financialDNA.savingBehavior.status, 'insufficient_data');

  assert.equal(result.financialDNA.savingsMomentum.score, null);
  assert.equal(result.financialDNA.savingsMomentum.status, 'insufficient_data');

  assert.equal(result.financialDNA.spendingControl.score, null);
  assert.equal(result.financialDNA.spendingControl.status, 'insufficient_data');

  // Recovery with no deficits must communicate stability, not a false perfect score
  assert.equal(result.financialDNA.recovery.score, null);
  assert.equal(result.financialDNA.recovery.status, 'no_deficits_observed');
});

test('TEST 3: Internal transfers are never counted as expenses or income', () => {
  // Transfer Online -> Vault ₹500, Cash -> Vault ₹200, Vault -> Online ₹100
  const vaultRecords = [
    {
      id: 'vr_1',
      type: VAULT_TYPES.DEPOSIT,
      amount: 500,
      sourceWallet: 'online',
      destinationWallet: 'vault',
      date: '2026-09-15'
    },
    {
      id: 'vr_2',
      type: VAULT_TYPES.DEPOSIT,
      amount: 200,
      sourceWallet: 'cash',
      destinationWallet: 'vault',
      date: '2026-09-18'
    },
    {
      id: 'vr_3',
      type: VAULT_TYPES.WITHDRAWAL,
      amount: 100,
      sourceWallet: 'vault',
      destinationWallet: 'online',
      date: '2026-09-22'
    }
  ];

  const result = calculateFinancialIntelligence({
    transactions: [],
    allowanceConfig: null,
    initialBalances: { online: 1000, cash: 500 },
    vaultRecords,
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  // Real expenses and real income must remain ZERO
  assert.equal(result.raw.totalExpenses, 0, 'Internal transfers must not be counted as totalExpenses');
  assert.equal(result.raw.totalIncome, 0, 'Internal transfers must not be counted as totalIncome');

  // Vault metrics must reflect accurate movements
  assert.equal(result.raw.vaultDeposits, 700);
  assert.equal(result.raw.vaultWithdrawals, 100);
  assert.equal(result.raw.vaultSpending, 0);
  assert.equal(result.raw.netVaultGrowth, 600);
  assert.equal(result.raw.walletTransferVolume, 800);

  // Balances must reconcile correctly
  // Online: 1000 - 500 + 100 = 600
  // Cash: 500 - 200 = 300
  // Vault: 600
  // Total Liquid = 900
  assert.equal(result.raw.onlineBalance, 600);
  assert.equal(result.raw.cashBalance, 300);
  assert.equal(result.raw.currentLiquidBalance, 900);
  assert.equal(result.raw.vaultBalance, 600);
});

test('TEST 4: Real expenses include Online, Cash, and Spend-from-Vault', () => {
  const transactions = [
    { id: 'tx_1', amount: 150, type: 'expense', method: 'online', date: '2026-09-10' },
    { id: 'tx_2', amount: 80, type: 'expense', method: 'cash', date: '2026-09-12' }
  ];

  const vaultRecords = [
    { id: 'v_dep', type: VAULT_TYPES.DEPOSIT, amount: 500, sourceWallet: 'online', date: '2026-09-01' },
    { id: 'v_spd', type: VAULT_TYPES.SPEND, amount: 200, category: 'Shopping', date: '2026-09-20' }
  ];

  const result = calculateFinancialIntelligence({
    transactions,
    allowanceConfig: null,
    initialBalances: { online: 1000, cash: 500 },
    vaultRecords,
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  // Total Real Expenses = 150 (online) + 80 (cash) + 200 (vault spend) = 430
  assert.equal(result.raw.totalExpenses, 430);
  assert.equal(result.raw.vaultSpending, 200);

  // Online wallet balance: 1000 - 500 (deposit to vault) - 150 (expense) = 350
  // Cash wallet balance: 500 - 80 (expense) = 420
  // Vault balance: 500 - 200 (spend) = 300
  assert.equal(result.raw.onlineBalance, 350);
  assert.equal(result.raw.cashBalance, 420);
  assert.equal(result.raw.vaultBalance, 300);
  assert.equal(result.raw.currentLiquidBalance, 770);
});

test('TEST 5: All 23 raw metrics are present and well-formed', () => {
  const requiredMetrics = [
    'totalIncome',
    'totalExpenses',
    'totalAllowance',
    'totalManualIncome',
    'averageDailyExpense',
    'medianDailyExpense',
    'expenseVolatility',
    'averageLiquidBalance',
    'currentLiquidBalance',
    'minimumLiquidBalance',
    'maximumLiquidBalance',
    'onlineBalance',
    'cashBalance',
    'vaultBalance',
    'vaultDeposits',
    'vaultWithdrawals',
    'vaultSpending',
    'netVaultGrowth',
    'walletTransferVolume',
    'activeFinancialDays',
    'longestActivityStreak',
    'negativeBalanceEpisodes',
    'averageRecoveryEstimate'
  ];

  const result = calculateFinancialIntelligence({
    transactions: [
      { id: '1', amount: 100, type: 'expense', method: 'online', date: '2026-09-20' }
    ],
    initialBalances: { online: 500, cash: 200 },
    targetDate: '2026-10-05'
  });

  requiredMetrics.forEach(key => {
    assert.ok(key in result.raw, `Missing raw metric: ${key}`);
    assert.notEqual(result.raw[key], undefined, `Raw metric ${key} cannot be undefined`);
  });
});

test('TEST 6: Consistency metric does not penalize zero-spend days', () => {
  // In a 30-day window (2026-09-06 to 2026-10-05), user logs transactions on 15 days, 15 days are zero-spend
  const transactions = [];
  for (let i = 10; i <= 24; i++) {
    const dayStr = String(i).padStart(2, '0');
    transactions.push({
      id: `tx_${i}`,
      amount: 50,
      type: 'expense',
      method: 'online',
      date: `2026-09-${dayStr}`
    });
  }

  const result = calculateFinancialIntelligence({
    transactions,
    initialBalances: { online: 2000, cash: 0 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const consistency = result.financialDNA.consistency;
  assert.equal(consistency.isSufficient, true);
  assert.equal(consistency.metrics.activeFinancialDays, 15);
  assert.equal(consistency.metrics.observedDays, 30);
  assert.equal(consistency.metrics.activityRatio, 0.5);
  assert.equal(consistency.score, 50);
  assert.equal(consistency.status, 'regular_activity');
});

test('TEST 7: Liquidity Resilience accurately computes runway relative to spending', () => {
  // Liquid balance = ₹3,000. Spending = ₹100/day over 30 days = ₹3,000 total.
  // Average daily expense = 100. Runway = 3000 / 100 = 30 days.
  const transactions = [];
  for (let i = 6; i <= 30; i++) {
    const dStr = String(i).padStart(2, '0');
    transactions.push({ id: `tx_${i}`, amount: 120, type: 'expense', method: 'online', date: `2026-09-${dStr}` });
  }

  const result = calculateFinancialIntelligence({
    transactions,
    initialBalances: { online: 6000, cash: 0 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const lr = result.financialDNA.liquidityResilience;
  assert.equal(lr.isSufficient, true);
  assert.ok(lr.score >= 70 && lr.score <= 90, `Score ${lr.score} should be in resilient range (70-90)`);
  assert.equal(lr.status, 'resilient');
  assert.ok(lr.metrics.runwayDays > 20);
});

test('TEST 8: Negative balances trigger Recovery analysis and correct score mapping', () => {
  // User starts at ₹100, spends ₹500, creating deficit of -₹400
  const transactions = [
    { id: '1', amount: 500, type: 'expense', method: 'online', date: '2026-09-15' }
  ];

  const allowanceConfig = {
    monthlyOnlineAllowance: 600, // ₹20/day
    monthlyCashAllowance: 0
  };

  const result = calculateFinancialIntelligence({
    transactions,
    allowanceConfig,
    initialBalances: { online: 100, cash: 0 },
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const recovery = result.financialDNA.recovery;
  assert.equal(recovery.isSufficient, true);
  assert.ok(result.raw.negativeBalanceEpisodes >= 1);
  assert.ok(recovery.metrics.negativeBalanceEpisodes >= 1);
});

test('TEST 9: Savings Momentum compares current vs previous period growth', () => {
  // Previous period: deposited ₹300
  // Recent period: deposited ₹800
  const vaultRecords = [
    { id: 'v1', type: VAULT_TYPES.DEPOSIT, amount: 300, sourceWallet: 'online', date: '2026-08-15' },
    { id: 'v2', type: VAULT_TYPES.DEPOSIT, amount: 800, sourceWallet: 'online', date: '2026-09-25' }
  ];

  const result = calculateFinancialIntelligence({
    transactions: [],
    initialBalances: { online: 5000, cash: 1000 },
    vaultRecords,
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  const momentum = result.financialDNA.savingsMomentum;
  assert.equal(momentum.isSufficient, true);
  assert.equal(momentum.status, 'accelerating');
  assert.ok(momentum.score >= 65);
  assert.equal(momentum.metrics.recentGrowth, 800);
  assert.equal(momentum.metrics.prevGrowth, 300);
  assert.equal(momentum.metrics.growthDelta, 500);
});

test('TEST 10: Savings DNA six dimensions compute deterministically', () => {
  const vaultRecords = [
    { id: 'v1', type: VAULT_TYPES.DEPOSIT, amount: 1000, sourceWallet: 'online', date: '2026-09-10' },
    { id: 'v2', type: VAULT_TYPES.WITHDRAWAL, amount: 100, destinationWallet: 'online', date: '2026-09-15' },
    { id: 'v3', type: VAULT_TYPES.SPEND, amount: 150, category: 'Shopping', date: '2026-09-20' }
  ];

  const result = calculateFinancialIntelligence({
    transactions: [],
    initialBalances: { online: 2000, cash: 1000 },
    vaultRecords,
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  });

  SAVINGS_DNA_DIMENSIONS.forEach(dim => {
    const d = result.savingsDNA[dim];
    assert.ok(d, `Savings DNA dimension ${dim} must exist`);
    assert.ok('score' in d);
    assert.ok('status' in d);
    assert.ok('confidence' in d);
    assert.ok('isSufficient' in d);
    assert.ok('metrics' in d);
  });

  // Retention: (1000 - 250) / 1000 = 75% retained -> healthy retention
  assert.equal(result.savingsDNA.retention.isSufficient, true);
  assert.equal(result.savingsDNA.retention.status, 'healthy_retention');
  assert.equal(result.savingsDNA.retention.metrics.retentionRate, 0.75);

  // Withdrawal discipline: 100 / 1000 = 10% -> disciplined preservation
  assert.equal(result.savingsDNA.withdrawalDiscipline.isSufficient, true);
  assert.equal(result.savingsDNA.withdrawalDiscipline.status, 'disciplined_preservation');

  // Vault spending: 150 spent in Shopping
  assert.equal(result.savingsDNA.vaultSpendingPattern.isSufficient, true);
  assert.equal(result.savingsDNA.vaultSpendingPattern.metrics.topSpendingCategory, 'Shopping');
});

test('TEST 11: Stability dimension detects volatile spikes vs calm spending', () => {
  // User A: Constant identical spend of ₹100 each day (low volatility, 15 days in window)
  const constantTxs = [];
  for (let i = 10; i <= 24; i++) {
    const dStr = String(i).padStart(2, '0');
    constantTxs.push({ id: `c_${i}`, amount: 100, type: 'expense', method: 'online', date: `2026-09-${dStr}` });
  }

  const resultStable = calculateFinancialIntelligence({
    transactions: constantTxs,
    initialBalances: { online: 5000, cash: 0 },
    targetDate: '2026-10-05'
  });

  // User B: Highly volatile spend (spike of 2000 vs 50)
  const volatileTxs = [
    { id: 'v_1', amount: 50, type: 'expense', method: 'online', date: '2026-09-08' },
    { id: 'v_2', amount: 2000, type: 'expense', method: 'online', date: '2026-09-15' },
    { id: 'v_3', amount: 50, type: 'expense', method: 'online', date: '2026-09-22' }
  ];

  const resultVolatile = calculateFinancialIntelligence({
    transactions: volatileTxs,
    initialBalances: { online: 5000, cash: 0 },
    targetDate: '2026-10-05'
  });

  const stableScore = resultStable.financialDNA.stability.score;
  const volatileScore = resultVolatile.financialDNA.stability.score;

  assert.ok(stableScore > volatileScore, `Stable score (${stableScore}) must exceed volatile score (${volatileScore})`);
  assert.equal(resultStable.financialDNA.stability.status, 'highly_stable');
});

test('TEST 12: Pure determinism: identical inputs produce 100% identical outputs', () => {
  const params = {
    transactions: [
      { id: '1', amount: 200, type: 'expense', method: 'online', date: '2026-09-10' },
      { id: '2', amount: 500, type: 'income', method: 'cash', date: '2026-09-15' }
    ],
    allowanceConfig: { monthlyOnlineAllowance: 1500, monthlyCashAllowance: 600 },
    initialBalances: { online: 800, cash: 400 },
    vaultRecords: [
      { id: 'v1', type: VAULT_TYPES.DEPOSIT, amount: 250, sourceWallet: 'online', date: '2026-09-12' }
    ],
    targetDate: '2026-10-05',
    period: ANALYTICAL_WINDOWS.LAST_30_DAYS
  };

  const run1 = calculateFinancialIntelligence(params);
  const run2 = calculateFinancialIntelligence(params);

  assert.deepEqual(run1, run2, 'Engine outputs must be 100% deterministic');
});
