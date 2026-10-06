// Sanchoy Financial Intelligence Chart Data Adapter
// Pure data transformation layer connecting intelligence.js derived metrics to Chart.js datasets.
// Zero financial calculations inside UI; strictly consumes authoritative engine metrics.

import { round } from '../utils/utils.js';
import {
  FINANCIAL_DNA_DIMENSIONS,
  ANALYTICAL_WINDOWS
} from '../financial/intelligence.js';

/**
 * Human-readable friendly names for the 7 Financial DNA dimensions
 */
export const DNA_DIMENSION_LABELS = {
  liquidityResilience: 'Liquidity Resilience',
  savingBehavior: 'Saving Behavior',
  savingsMomentum: 'Savings Momentum',
  spendingControl: 'Spending Control',
  consistency: 'Consistency',
  stability: 'Stability',
  recovery: 'Recovery'
};

/**
 * Maps deterministic status strings to clean, non-judgmental display badges
 */
export function formatDNAStatus(key, status) {
  if (!status || status === 'insufficient_data') {
    return {
      label: 'Building Pattern',
      tone: 'muted',
      badgeClass: 'text-[var(--text-muted)] bg-[var(--surface-inset)] border-[var(--border-subtle)]'
    };
  }

  const map = {
    // Liquidity Resilience
    resilient: { label: 'Resilient', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    moderate: { label: 'Moderate', tone: 'accent', badgeClass: 'text-[var(--accent)] bg-[var(--accent-glow)] border-[var(--accent)]' },
    strained: { label: 'Strained', tone: 'warning', badgeClass: 'text-[var(--warning)] bg-[var(--warning-bg)] border-[var(--warning-border)]' },

    // Saving Behavior
    capital_growth: { label: 'Capital Growth', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    steady_accumulator: { label: 'Steady Growth', tone: 'accent', badgeClass: 'text-[var(--accent)] bg-[var(--accent-glow)] border-[var(--accent)]' },
    low_accumulation: { label: 'Conserving', tone: 'muted', badgeClass: 'text-[var(--text-muted)] bg-[var(--surface-inset)] border-[var(--border-subtle)]' },

    // Savings Momentum
    accelerating: { label: 'Accelerating', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    positive_growth: { label: 'Positive Growth', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    stable_preservation: { label: 'Stable Reserve', tone: 'accent', badgeClass: 'text-[var(--accent)] bg-[var(--accent-glow)] border-[var(--accent)]' },
    decelerating: { label: 'Decelerating', tone: 'muted', badgeClass: 'text-[var(--text-muted)] bg-[var(--surface-inset)] border-[var(--border-subtle)]' },
    negative_growth: { label: 'Contracting', tone: 'warning', badgeClass: 'text-[var(--warning)] bg-[var(--warning-bg)] border-[var(--warning-border)]' },

    // Spending Control
    excellent_containment: { label: 'High Discipline', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    balanced_discipline: { label: 'Balanced', tone: 'accent', badgeClass: 'text-[var(--accent)] bg-[var(--accent-glow)] border-[var(--accent)]' },
    elevated_spending: { label: 'Elevated Spend', tone: 'warning', badgeClass: 'text-[var(--warning)] bg-[var(--warning-bg)] border-[var(--warning-border)]' },
    deficit_drift: { label: 'Deficit Drift', tone: 'danger', badgeClass: 'text-[var(--expense)] bg-[var(--expense-bg)] border-[var(--expense-border)]' },

    // Consistency
    highly_consistent: { label: 'High Cadence', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    regular_activity: { label: 'Regular Activity', tone: 'accent', badgeClass: 'text-[var(--accent)] bg-[var(--accent-glow)] border-[var(--accent)]' },
    periodic_gaps: { label: 'Periodic Gaps', tone: 'muted', badgeClass: 'text-[var(--text-muted)] bg-[var(--surface-inset)] border-[var(--border-subtle)]' },
    sparse_recording: { label: 'Sparse Activity', tone: 'muted', badgeClass: 'text-[var(--text-muted)] bg-[var(--surface-inset)] border-[var(--border-subtle)]' },

    // Stability
    highly_stable: { label: 'Calm & Stable', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    moderate_variance: { label: 'Moderate Spikes', tone: 'accent', badgeClass: 'text-[var(--accent)] bg-[var(--accent-glow)] border-[var(--accent)]' },
    volatile_spikes: { label: 'Volatile Spikes', tone: 'warning', badgeClass: 'text-[var(--warning)] bg-[var(--warning-bg)] border-[var(--warning-border)]' },

    // Recovery
    no_deficits_observed: { label: 'Deficit-Free', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    rapid_rebound: { label: 'Rapid Rebound', tone: 'income', badgeClass: 'text-[var(--income)] bg-[var(--income-bg)] border-[var(--income-border)]' },
    steady_recovery: { label: 'Steady Recovery', tone: 'accent', badgeClass: 'text-[var(--accent)] bg-[var(--accent-glow)] border-[var(--accent)]' },
    extended_drag: { label: 'Gradual Recovery', tone: 'warning', badgeClass: 'text-[var(--warning)] bg-[var(--warning-bg)] border-[var(--warning-border)]' }
  };

  return map[status] || {
    label: status.replace(/_/g, ' '),
    tone: 'muted',
    badgeClass: 'text-[var(--text-muted)] bg-[var(--surface-inset)] border-[var(--border-subtle)]'
  };
}

// ==================================================
// 1. FINANCIAL DNA ADAPTER
// ==================================================

/**
 * Transforms Financial DNA into radar/polar chart datasets and summary items.
 */
export function prepareFinancialDNAChartData(intelligenceResult, tokens) {
  if (!intelligenceResult || !intelligenceResult.financialDNA) {
    return {
      labels: [],
      scores: [],
      hasAnyScore: false,
      items: [],
      chartConfig: null
    };
  }

  const dna = intelligenceResult.financialDNA;
  const labels = [];
  const scores = [];
  const items = [];
  let validScoresCount = 0;

  FINANCIAL_DNA_DIMENSIONS.forEach(dimKey => {
    const dim = dna[dimKey] || {
      score: null,
      status: 'insufficient_data',
      isSufficient: false,
      confidence: 0,
      reason: 'More history required.',
      metrics: {}
    };

    const label = DNA_DIMENSION_LABELS[dimKey] || dimKey;
    labels.push(label);

    const hasOverallSufficiency = intelligenceResult?.dataSufficiency?.overall !== false;
    const isDimensionSufficient = dim.isSufficient && hasOverallSufficiency;
    const hasScore = isDimensionSufficient && typeof dim.score === 'number' && !isNaN(dim.score);
    if (hasScore) {
      scores.push(dim.score);
      validScoresCount++;
    } else {
      // In radar chart, 0 placeholder with indicator
      scores.push(0);
    }

    const statusFmt = formatDNAStatus(dimKey, dim.status);

    items.push({
      key: dimKey,
      label,
      score: hasScore ? dim.score : null,
      status: dim.status,
      statusLabel: statusFmt.label,
      statusTone: statusFmt.tone,
      badgeClass: statusFmt.badgeClass,
      reason: dim.reason || 'Sufficient history required.',
      confidence: dim.confidence || 0,
      isSufficient: dim.isSufficient || false,
      metrics: dim.metrics || {}
    });
  });

  const hasOverallSufficiency = intelligenceResult?.dataSufficiency?.overall !== false;
  const hasAnyScore = hasOverallSufficiency && validScoresCount > 0;

  return {
    labels,
    scores,
    hasAnyScore,
    items,
    validScoresCount,
    // Radar dataset payload
    chartData: {
      labels,
      datasets: [
        {
          label: 'Financial DNA',
          data: scores,
          backgroundColor: tokens.radarBg || 'rgba(94, 168, 145, 0.20)',
          borderColor: tokens.accent || '#5ea891',
          pointBackgroundColor: tokens.accent || '#5ea891',
          pointBorderColor: tokens.tooltipTitle || '#ffffff',
          pointHoverBackgroundColor: '#ffffff',
          pointHoverBorderColor: tokens.accent || '#5ea891',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    }
  };
}

// ==================================================
// 2. CASH FLOW ADAPTER (Income vs Expenses)
// ==================================================

/**
 * Transforms daily timeline into Income vs Expenses time-series.
 * Enforces zero-guesswork: strictly real inflows vs real expenses.
 * Never counts internal transfers as expenses or income.
 */
export function prepareCashFlowChartData(intelligenceResult, tokens) {
  const raw = intelligenceResult?.raw;
  const timeline = raw?.dailyExpensesList !== undefined ? (intelligenceResult?.window ? intelligenceResult : null) : null;
  const days = intelligenceResult?.window?.observedDays || 0;

  // Check if we have active daily timeline in intelligenceResult
  // The daily timeline is either passed or reconstructed
  let entries = [];
  if (intelligenceResult?.raw?.dailyExpensesList && intelligenceResult.raw.dailyExpensesList.length > 0) {
    // If daily snapshots were passed in intelligenceResult.raw (we will expose dailyTimeline)
    // Or we extract from raw metrics
  }

  // Let's ensure intelligenceResult attaches dailyTimeline if available
  const timelineList = intelligenceResult?.dailyTimeline || [];

  if (!timelineList || timelineList.length === 0) {
    return {
      labels: [],
      incomeData: [],
      expenseData: [],
      totalInflows: raw?.totalIncome || 0,
      totalExpenses: raw?.totalExpenses || 0,
      netSavings: (raw?.totalIncome || 0) - (raw?.totalExpenses || 0),
      hasData: (raw?.totalIncome > 0 || raw?.totalExpenses > 0)
    };
  }

  // Determine aggregation: daily if <= 31 days, weekly/monthly if > 31 days
  const isAggregated = timelineList.length > 31;
  const labels = [];
  const incomeData = [];
  const expenseData = [];

  if (!isAggregated) {
    timelineList.forEach(day => {
      const d = day.date || '';
      // Label like "Sep 15"
      const dateParts = d.split('-');
      const label = dateParts.length === 3 ? `${dateParts[1]}/${dateParts[2]}` : d;
      labels.push(label);
      incomeData.push(round(day.inflows.total));
      expenseData.push(round(day.expenses.total));
    });
  } else {
    // Group into 7-day intervals (weeks) or calendar months
    let currentBucket = { label: '', income: 0, expense: 0, count: 0 };
    timelineList.forEach((day, idx) => {
      currentBucket.income += day.inflows.total;
      currentBucket.expense += day.expenses.total;
      currentBucket.count++;

      const isLast = idx === timelineList.length - 1;
      const isWeekEnd = currentBucket.count === 7 || isLast;

      if (isWeekEnd) {
        const d = day.date || '';
        const dateParts = d.split('-');
        const label = dateParts.length === 3 ? `${dateParts[1]}/${dateParts[2]}` : d;
        labels.push(label);
        incomeData.push(round(currentBucket.income));
        expenseData.push(round(currentBucket.expense));
        currentBucket = { label: '', income: 0, expense: 0, count: 0 };
      }
    });
  }

  const totalInflows = round(incomeData.reduce((acc, v) => acc + v, 0));
  const totalExpenses = round(expenseData.reduce((acc, v) => acc + v, 0));
  const netSavings = round(totalInflows - totalExpenses);
  const hasData = totalInflows > 0 || totalExpenses > 0;

  return {
    labels,
    incomeData,
    expenseData,
    totalInflows,
    totalExpenses,
    netSavings,
    hasData,
    chartData: {
      labels,
      datasets: [
        {
          label: 'Expenses (−)',
          data: expenseData,
          borderColor: tokens.expense || '#f87171',
          backgroundColor: tokens.expenseBg || 'rgba(248, 113, 113, 0.10)',
          tension: 0.3,
          borderWidth: 2,
          fill: true,
          pointRadius: isAggregated ? 3 : 2,
          pointHoverRadius: 5
        },
        {
          label: 'Income & Allowance (+)',
          data: incomeData,
          borderColor: tokens.income || '#34d399',
          backgroundColor: tokens.incomeBg || 'rgba(52, 211, 153, 0.10)',
          tension: 0.3,
          borderWidth: 2,
          fill: true,
          pointRadius: isAggregated ? 3 : 2,
          pointHoverRadius: 5
        }
      ]
    }
  };
}

// ==================================================
// 3. SPENDING BEHAVIOR ADAPTER
// ==================================================

/**
 * Transforms transactions and timeline into:
 * A. Category Spending (Doughnut)
 * B. Spending Velocity (Cumulative accumulation over time)
 * C. Spending Volatility (Daily variance vs mean)
 */
export function prepareSpendingBehaviorData(intelligenceResult, transactions = [], vaultRecords = [], tokens) {
  const activeWindow = intelligenceResult?.window;
  const startDateStr = activeWindow?.startDateStr || '';
  const endDateStr = activeWindow?.endDateStr || '';
  const raw = intelligenceResult?.raw;
  const timeline = intelligenceResult?.dailyTimeline || [];

  // A. Category Spending (strictly within active window, only real expenses)
  const categoryTotals = {};
  (transactions || []).forEach(tx => {
    if (tx.type !== 'expense') return;
    const d = (tx.date || '').slice(0, 10);
    if (startDateStr && d < startDateStr) return;
    if (endDateStr && d > endDateStr) return;

    const cat = tx.category || 'General';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(tx.amount) || 0);
  });

  // Include direct Vault spends in category allocations
  (vaultRecords || []).forEach(r => {
    const isSpend = r.type === 'spend' || r.type === 'VAULT_SPEND' || r.type === 'vault_spend';
    if (!isSpend || r.deleted) return;
    const d = (r.date || '').slice(0, 10);
    if (startDateStr && d < startDateStr) return;
    if (endDateStr && d > endDateStr) return;

    const cat = r.category || 'Protected Reserve Spend';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(r.amount) || 0);
  });

  const sortedCats = Object.entries(categoryTotals)
    .filter(([_, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);

  const catLabels = sortedCats.map(([cat]) => cat);
  const catData = sortedCats.map(([_, amt]) => round(amt));
  const totalCategorySpend = round(catData.reduce((acc, v) => acc + v, 0));
  const hasCategoryData = catData.length > 0;

  // B. Spending Velocity (Cumulative accumulation across the timeline)
  const velocityLabels = [];
  const cumulativeActual = [];
  const linearPaceBaseline = [];

  let runningSum = 0;
  const avgDaily = raw?.averageDailyExpense || 0;

  timeline.forEach((day, idx) => {
    runningSum += (day.expenses?.total || 0);
    const d = day.date || '';
    const dateParts = d.split('-');
    const label = dateParts.length === 3 ? `${dateParts[1]}/${dateParts[2]}` : d;

    velocityLabels.push(label);
    cumulativeActual.push(round(runningSum));
    linearPaceBaseline.push(round(avgDaily * (idx + 1)));
  });

  // C. Spending Volatility (Daily expenses vs mean)
  const volatilityLabels = velocityLabels;
  const dailyExpenses = timeline.map(day => round(day.expenses?.total || 0));
  const meanLine = timeline.map(() => round(avgDaily));
  const volatilityValue = raw?.expenseVolatility || 0;
  const stabilityScore = intelligenceResult?.financialDNA?.stability?.score ?? null;

  return {
    category: {
      labels: hasCategoryData ? catLabels : ['No Expenses in Period'],
      data: hasCategoryData ? catData : [1],
      total: totalCategorySpend,
      hasData: hasCategoryData,
      chartData: {
        labels: hasCategoryData ? catLabels : ['No Expenses Yet'],
        datasets: [
          {
            data: hasCategoryData ? catData : [1],
            backgroundColor: hasCategoryData ? tokens.categories : [tokens.grid],
            borderColor: tokens.border,
            borderWidth: 2,
            hoverOffset: 4
          }
        ]
      }
    },
    velocity: {
      labels: velocityLabels,
      cumulativeActual,
      linearPaceBaseline,
      totalSpend: round(runningSum),
      avgDaily: round(avgDaily),
      hasData: runningSum > 0,
      chartData: {
        labels: velocityLabels,
        datasets: [
          {
            label: 'Cumulative Actual Spend',
            data: cumulativeActual,
            borderColor: tokens.expense || '#f87171',
            backgroundColor: tokens.expenseBg || 'rgba(248, 113, 113, 0.10)',
            tension: 0.25,
            borderWidth: 2.5,
            fill: true,
            pointRadius: timeline.length > 31 ? 1 : 2
          },
          {
            label: 'Average Daily Pace',
            data: linearPaceBaseline,
            borderColor: tokens.accentSecondary || '#c48b59',
            borderDash: [5, 5],
            borderWidth: 1.75,
            fill: false,
            pointRadius: 0
          }
        ]
      }
    },
    volatility: {
      labels: volatilityLabels,
      dailyExpenses,
      meanLine,
      volatilityValue: round(volatilityValue),
      rawVolatility: volatilityValue,
      stabilityScore,
      hasData: dailyExpenses.some(v => v > 0),
      chartData: {
        labels: volatilityLabels,
        datasets: [
          {
            type: 'bar',
            label: 'Daily Expenses',
            data: dailyExpenses,
            backgroundColor: tokens.expenseBg || 'rgba(248, 113, 113, 0.25)',
            borderColor: tokens.expense || '#f87171',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            type: 'line',
            label: 'Average Daily Spend',
            data: meanLine,
            borderColor: tokens.accent || '#5ea891',
            borderDash: [4, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
          }
        ]
      }
    }
  };
}

// ==================================================
// 4. WALLET INTELLIGENCE ADAPTER
// ==================================================

/**
 * Transforms wallet metrics:
 * A. Online vs Cash current distribution
 * B. Wallet Balance Trend over time
 * C. Wallet Spending Utilization
 * Strictly excludes Vault from Liquid Balances!
 */
export function prepareWalletIntelligenceData(intelligenceResult, tokens) {
  const raw = intelligenceResult?.raw;
  const timeline = intelligenceResult?.dailyTimeline || [];

  const onlineBalance = round(raw?.onlineBalance || 0);
  const cashBalance = round(raw?.cashBalance || 0);
  const liquidBalance = round(raw?.currentLiquidBalance || (onlineBalance + cashBalance));

  const totalPositive = Math.max(0, onlineBalance) + Math.max(0, cashBalance);
  const onlinePct = totalPositive > 0 ? Math.round((Math.max(0, onlineBalance) / totalPositive) * 100) : 50;
  const cashPct = totalPositive > 0 ? (100 - onlinePct) : 50;

  const labels = [];
  const onlineTrend = [];
  const cashTrend = [];
  const liquidTrend = [];

  let totalOnlineSpend = 0;
  let totalCashSpend = 0;

  timeline.forEach(day => {
    const d = day.date || '';
    const dateParts = d.split('-');
    const label = dateParts.length === 3 ? `${dateParts[1]}/${dateParts[2]}` : d;

    labels.push(label);
    onlineTrend.push(round(day.onlineBalance));
    cashTrend.push(round(day.cashBalance));
    liquidTrend.push(round(day.liquidBalance));

    totalOnlineSpend += (day.expenses?.online || 0);
    totalCashSpend += (day.expenses?.cash || 0);
  });

  const hasData = timeline.length > 0;

  return {
    distribution: {
      onlineBalance,
      cashBalance,
      liquidBalance,
      onlinePct,
      cashPct,
      chartData: {
        labels: ['Online Wallet', 'Cash Wallet'],
        datasets: [
          {
            data: [Math.max(0, onlineBalance), Math.max(0, cashBalance)],
            backgroundColor: [tokens.accent || '#5ea891', tokens.accentSecondary || '#c48b59'],
            borderColor: tokens.border,
            borderWidth: 2,
            hoverOffset: 4
          }
        ]
      }
    },
    trend: {
      labels,
      onlineTrend,
      cashTrend,
      liquidTrend,
      hasData,
      chartData: {
        labels,
        datasets: [
          {
            label: 'Online Wallet',
            data: onlineTrend,
            borderColor: tokens.accent || '#5ea891',
            backgroundColor: 'transparent',
            tension: 0.25,
            borderWidth: 2,
            pointRadius: timeline.length > 31 ? 1 : 2
          },
          {
            label: 'Cash Wallet',
            data: cashTrend,
            borderColor: tokens.accentSecondary || '#c48b59',
            backgroundColor: 'transparent',
            tension: 0.25,
            borderWidth: 2,
            pointRadius: timeline.length > 31 ? 1 : 2
          }
        ]
      }
    },
    utilization: {
      totalOnlineSpend: round(totalOnlineSpend),
      totalCashSpend: round(totalCashSpend),
      totalSpend: round(totalOnlineSpend + totalCashSpend),
      onlineRatio: (totalOnlineSpend + totalCashSpend) > 0
        ? Math.round((totalOnlineSpend / (totalOnlineSpend + totalCashSpend)) * 100)
        : 50
    }
  };
}

// ==================================================
// 5. SAVINGS & WEALTH ADAPTER
// ==================================================

/**
 * Transforms wealth metrics:
 * A. Liquid Balance Trajectory (Online + Cash)
 * B. Vault Growth (Sovereign protected reserve)
 * C. Net Holdings Trend (Liquid + Vault = Total Sanchoy Holdings)
 */
export function prepareSavingsWealthData(intelligenceResult, tokens) {
  const raw = intelligenceResult?.raw;
  const timeline = intelligenceResult?.dailyTimeline || [];

  const labels = [];
  const liquidTrajectory = [];
  const vaultTrajectory = [];
  const holdingsTrend = [];

  timeline.forEach(day => {
    const d = day.date || '';
    const dateParts = d.split('-');
    const label = dateParts.length === 3 ? `${dateParts[1]}/${dateParts[2]}` : d;

    labels.push(label);
    liquidTrajectory.push(round(day.liquidBalance));
    vaultTrajectory.push(round(day.vaultBalance));
    holdingsTrend.push(round(day.totalHoldings));
  });

  const currentLiquid = round(raw?.currentLiquidBalance || 0);
  const currentVault = round(raw?.vaultBalance || 0);
  const currentHoldings = round(currentLiquid + currentVault);
  const hasData = timeline.length > 0;

  return {
    currentLiquid,
    currentVault,
    currentHoldings,
    labels,
    liquidTrajectory,
    vaultTrajectory,
    holdingsTrend,
    hasData,
    chartData: {
      labels,
      datasets: [
        {
          label: 'Total Sanchoy Holdings',
          data: holdingsTrend,
          borderColor: tokens.income || '#34d399',
          backgroundColor: tokens.incomeBg || 'rgba(52, 211, 153, 0.08)',
          tension: 0.3,
          borderWidth: 2.5,
          fill: true,
          pointRadius: timeline.length > 31 ? 1 : 2
        },
        {
          label: 'Liquid Wallets (Online + Cash)',
          data: liquidTrajectory,
          borderColor: tokens.accent || '#5ea891',
          borderDash: [3, 3],
          borderWidth: 1.75,
          fill: false,
          pointRadius: 0
        },
        {
          label: 'Protected Vault Reserve',
          data: vaultTrajectory,
          borderColor: tokens.accentSecondary || '#c48b59',
          borderDash: [2, 2],
          borderWidth: 1.75,
          fill: false,
          pointRadius: 0
        }
      ]
    }
  };
}

// ==================================================
// 6. HISTORICAL PATTERNS & FINGERPRINT
// ==================================================

/**
 * Aggregates deterministic transaction and vault history by month.
 * Provides monthly comparison: Inflows, Expenses, Net Savings, Activity Days, End Balance.
 */
export function prepareHistoricalFingerprintData(transactions = [], vaultRecords = [], reconciledLedger = null, tokens) {
  const monthsMap = new Map();

  function getMonthKey(dateStr) {
    if (!dateStr) return '';
    return dateStr.slice(0, 7); // 'YYYY-MM'
  }

  function formatMonthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
  }

  // Aggregate expenses and manual income from transactions
  (transactions || []).forEach(tx => {
    const k = getMonthKey(tx.date);
    if (!k) return;
    if (!monthsMap.has(k)) {
      monthsMap.set(k, { key: k, label: formatMonthLabel(k), income: 0, expenses: 0, vaultSpend: 0, activeDays: new Set() });
    }
    const entry = monthsMap.get(k);
    const amt = Number(tx.amount) || 0;
    entry.activeDays.add((tx.date || '').slice(0, 10));

    if (tx.type === 'expense') {
      entry.expenses += amt;
    } else if (tx.type === 'income') {
      entry.income += amt;
    }
  });

  // Include allowance allocations from reconciled ledger if present
  if (reconciledLedger && Array.isArray(reconciledLedger.events)) {
    reconciledLedger.events.forEach(ev => {
      if (ev.type === 'allocation') {
        const k = getMonthKey(ev.date);
        if (!k) return;
        if (!monthsMap.has(k)) {
          monthsMap.set(k, { key: k, label: formatMonthLabel(k), income: 0, expenses: 0, vaultSpend: 0, activeDays: new Set() });
        }
        monthsMap.get(k).income += (Number(ev.amount) || 0);
      }
    });
  }

  // Include vault spends
  (vaultRecords || []).forEach(r => {
    if (r.deleted) return;
    const d = r.date || (r.month ? `${r.month}-01` : '');
    const k = getMonthKey(d);
    if (!k) return;
    if (!monthsMap.has(k)) {
      monthsMap.set(k, { key: k, label: formatMonthLabel(k), income: 0, expenses: 0, vaultSpend: 0, activeDays: new Set() });
    }
    const entry = monthsMap.get(k);
    if (r.type === 'spend') {
      entry.vaultSpend += (Number(r.amount) || 0);
      entry.expenses += (Number(r.amount) || 0);
    }
  });

  // Sort chronologically
  const sortedMonths = Array.from(monthsMap.keys())
    .sort()
    .slice(-6); // Last 6 months for clean display

  const months = sortedMonths.map(k => {
    const item = monthsMap.get(k);
    const net = round(item.income - item.expenses);
    return {
      key: k,
      label: item.label,
      income: round(item.income),
      expenses: round(item.expenses),
      netSavings: net,
      activeDaysCount: item.activeDays.size
    };
  });

  const labels = months.map(m => m.label);
  const incomeData = months.map(m => m.income);
  const expenseData = months.map(m => m.expenses);
  const netData = months.map(m => m.netSavings);
  const hasData = months.some(m => m.income > 0 || m.expenses > 0);

  return {
    months,
    labels,
    incomeData,
    expenseData,
    netData,
    hasData,
    chartData: {
      labels,
      datasets: [
        {
          label: 'Total Expenses',
          data: expenseData,
          backgroundColor: tokens.expenseBg || 'rgba(248, 113, 113, 0.35)',
          borderColor: tokens.expense || '#f87171',
          borderWidth: 1.5,
          borderRadius: 4
        },
        {
          label: 'Total Inflow',
          data: incomeData,
          backgroundColor: tokens.incomeBg || 'rgba(52, 211, 153, 0.35)',
          borderColor: tokens.income || '#34d399',
          borderWidth: 1.5,
          borderRadius: 4
        }
      ]
    }
  };
}
