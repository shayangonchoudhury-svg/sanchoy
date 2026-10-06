// Sanchoy Deterministic Financial Intelligence & Analytics Engine
// Authoritative derived metrics layer for Financial DNA and Savings DNA.
// Pure deterministic calculations without external calls or AI speculation.

import { WALLET_TYPES, normalizeWalletType } from './wallets.js';
import { toLocalDateString, generateDateSequence, getDailyAllocation } from './allowance.js';
import { calculateRecoveryEstimate } from './recovery.js';
import { EVENT_TYPES, reconcileVirtualLedger } from './ledger.js';
import {
  VAULT_TYPES,
  calculateVaultBalance,
  reconstructVaultHistory,
  calculateVaultAnalytics,
  calculateHoldingsSummary
} from './vault-ledger.js';

export const ANALYTICAL_WINDOWS = {
  CURRENT_PERIOD: 'current_period',
  LAST_7_DAYS: 'last_7_days',
  LAST_30_DAYS: 'last_30_days',
  PREVIOUS_30_DAYS: 'previous_30_days',
  LAST_90_DAYS: 'last_90_days',
  LAST_180_DAYS: 'last_180_days',
  LAST_365_DAYS: 'last_365_days'
};

export const FINANCIAL_DNA_DIMENSIONS = [
  'liquidityResilience',
  'savingBehavior',
  'savingsMomentum',
  'spendingControl',
  'consistency',
  'stability',
  'recovery'
];

export const SAVINGS_DNA_DIMENSIONS = [
  'reserveStrength',
  'savingsMomentum',
  'contributionConsistency',
  'retention',
  'withdrawalDiscipline',
  'vaultSpendingPattern'
];

// ==================================================
// MATH & STATISTICAL HELPERS (Pure Deterministic)
// ==================================================

export function calculateMean(numbers = []) {
  if (!Array.isArray(numbers) || numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, n) => acc + (Number(n) || 0), 0);
  return sum / numbers.length;
}

export function calculateMedian(numbers = []) {
  if (!Array.isArray(numbers) || numbers.length === 0) return 0;
  const sorted = [...numbers].map(n => Number(n) || 0).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calculateStandardDeviation(numbers = [], meanValue = null) {
  if (!Array.isArray(numbers) || numbers.length <= 1) return 0;
  const mean = meanValue !== null ? meanValue : calculateMean(numbers);
  const variance = numbers.reduce((acc, n) => {
    const diff = (Number(n) || 0) - mean;
    return acc + diff * diff;
  }, 0) / numbers.length;
  return Math.sqrt(variance);
}

export function clamp(value, min = 0, max = 100) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return Math.max(min, Math.min(max, value));
}

// ==================================================
// TIME WINDOW RESOLUTION
// ==================================================

/**
 * Resolves an analytical time window relative to a target date string.
 * Avoids timezone boundaries by using midday local Date calculations.
 *
 * @param {string} windowKey - 'current_period' | 'last_30_days' | 'previous_30_days' | 'last_90_days'
 * @param {string} [targetDateStr] - 'YYYY-MM-DD' (defaults to today)
 * @returns {{ key: string, label: string, startDateStr: string, endDateStr: string, observedDays: number }}
 */
export function resolveAnalyticalWindow(windowKey = ANALYTICAL_WINDOWS.LAST_30_DAYS, targetDateStr = null) {
  const effectiveTarget = targetDateStr || toLocalDateString(new Date());
  const [year, month, day] = effectiveTarget.split('-').map(Number);

  let startDate;
  let endDate = new Date(year, month - 1, day, 12, 0, 0);
  let label = 'Last 30 Days';

  switch (windowKey) {
    case ANALYTICAL_WINDOWS.CURRENT_PERIOD: {
      // First day of current month to target date
      startDate = new Date(year, month - 1, 1, 12, 0, 0);
      label = 'Current Month to Date';
      break;
    }
    case ANALYTICAL_WINDOWS.LAST_7_DAYS: {
      startDate = new Date(year, month - 1, day - 6, 12, 0, 0);
      label = 'Last 7 Days';
      break;
    }
    case ANALYTICAL_WINDOWS.PREVIOUS_30_DAYS: {
      // 30 days immediately preceding the last 30-day window
      const prevEnd = new Date(year, month - 1, day - 30, 12, 0, 0);
      startDate = new Date(year, month - 1, day - 59, 12, 0, 0);
      endDate = prevEnd;
      label = 'Previous 30 Days';
      break;
    }
    case ANALYTICAL_WINDOWS.LAST_90_DAYS: {
      startDate = new Date(year, month - 1, day - 89, 12, 0, 0);
      label = 'Last 90 Days';
      break;
    }
    case ANALYTICAL_WINDOWS.LAST_180_DAYS: {
      startDate = new Date(year, month - 1, day - 179, 12, 0, 0);
      label = 'Last 6 Months';
      break;
    }
    case ANALYTICAL_WINDOWS.LAST_365_DAYS: {
      startDate = new Date(year, month - 1, day - 364, 12, 0, 0);
      label = 'Last 1 Year';
      break;
    }
    case ANALYTICAL_WINDOWS.LAST_30_DAYS:
    default: {
      startDate = new Date(year, month - 1, day - 29, 12, 0, 0);
      label = 'Last 30 Days';
      break;
    }
  }

  const startDateStr = toLocalDateString(startDate);
  const endDateStr = toLocalDateString(endDate);
  const dateSeq = generateDateSequence(startDateStr, endDateStr);

  return {
    key: windowKey,
    label,
    startDateStr,
    endDateStr,
    observedDays: dateSeq.length
  };
}

// ==================================================
// DAILY FINANCIAL TIMELINE BUILDER
// ==================================================

/**
 * Builds an authoritative daily timeline across the observed window.
 * Computes end-of-day balances, real spending, real inflows, and internal transfers.
 *
 * Accounting Rules Enforced:
 * - Online / Cash Wallet Expenses are real expenses.
 * - Spend-from-Vault (VAULT_SPEND) is a real expense.
 * - Online <-> Vault & Cash <-> Vault transfers are strictly INTERNAL MOVEMENT (never expenses or income).
 * - Automatic Daily Allocations and Manual Incomes are positive inflows.
 */
export function buildDailyTimeline({
  allLedgerEvents = [],
  vaultRecords = [],
  startDateStr,
  endDateStr,
  initialBalances = { online: 0, cash: 0 }
}) {
  const dates = generateDateSequence(startDateStr, endDateStr);
  if (!dates.length) return [];

  // Index ledger events by date
  const eventsByDate = new Map();
  allLedgerEvents.forEach(ev => {
    const d = (ev.date || '').slice(0, 10);
    if (!eventsByDate.has(d)) eventsByDate.set(d, []);
    eventsByDate.get(d).push(ev);
  });

  // Index vault records by date
  const vaultByDate = new Map();
  (vaultRecords || []).forEach(r => {
    if (!r || r.deleted) return;
    const d = r.date ? r.date.slice(0, 10) : (r.month ? `${r.month}-01` : '');
    if (!d) return;
    if (!vaultByDate.has(d)) vaultByDate.set(d, []);
    vaultByDate.get(d).push(r);
  });

  // Pre-calculate starting balance prior to startDateStr
  const hasInitOnlineEvent = allLedgerEvents.some(ev => ev.type === EVENT_TYPES.STARTING_BALANCE && ev.wallet === WALLET_TYPES.ONLINE);
  const hasInitCashEvent = allLedgerEvents.some(ev => ev.type === EVENT_TYPES.STARTING_BALANCE && ev.wallet === WALLET_TYPES.CASH);

  let runningOnline = hasInitOnlineEvent ? 0 : (Number(initialBalances.online) || 0);
  let runningCash = hasInitCashEvent ? 0 : (Number(initialBalances.cash) || 0);
  let runningVault = 0;

  // Replay all events prior to startDateStr
  allLedgerEvents.forEach(ev => {
    const d = (ev.date || '').slice(0, 10);
    if (d >= startDateStr) return; // Only process events strictly before the window

    const amt = Number(ev.amount) || 0;
    if (ev.wallet === WALLET_TYPES.ONLINE) {
      if (ev.type === EVENT_TYPES.ALLOCATION || ev.type === EVENT_TYPES.MANUAL_INCOME || ev.type === EVENT_TYPES.STARTING_BALANCE) {
        runningOnline += amt;
      } else if (ev.type === EVENT_TYPES.EXPENSE) {
        runningOnline -= amt;
      } else if (ev.type === EVENT_TYPES.VAULT_TRANSFER) {
        if (ev.direction === 'in') runningOnline += amt;
        else if (ev.direction === 'out') runningOnline -= amt;
      }
    } else if (ev.wallet === WALLET_TYPES.CASH) {
      if (ev.type === EVENT_TYPES.ALLOCATION || ev.type === EVENT_TYPES.MANUAL_INCOME || ev.type === EVENT_TYPES.STARTING_BALANCE) {
        runningCash += amt;
      } else if (ev.type === EVENT_TYPES.EXPENSE) {
        runningCash -= amt;
      } else if (ev.type === EVENT_TYPES.VAULT_TRANSFER) {
        if (ev.direction === 'in') runningCash += amt;
        else if (ev.direction === 'out') runningCash -= amt;
      }
    }
  });

  // Replay Vault records prior to startDateStr
  (vaultRecords || []).forEach(r => {
    if (!r || r.deleted) return;
    const d = r.date ? r.date.slice(0, 10) : (r.month ? `${r.month}-01` : '');
    if (!d || d >= startDateStr) return;

    const amt = Number(r.amount) || 0;
    if (r.type === VAULT_TYPES.DEPOSIT) {
      runningVault += amt;
    } else if (r.type === VAULT_TYPES.WITHDRAWAL || r.type === VAULT_TYPES.SPEND) {
      runningVault -= amt;
    } else if (!r.type) {
      const sum = Number(r.cashSavings || 0) + Number(r.onlineSavings || 0) + Number(r.extraSavings || 0) +
        Number(r.emergencySavings || 0) + Number(r.investments || 0) + Number(r.goldSavings || 0) + Number(r.otherSavings || 0);
      runningVault += sum;
    }
  });
  runningVault = Math.max(0, runningVault);

  // Now step through each date in the analytical window
  const dailySnapshots = dates.map(dateStr => {
    const dayEvents = eventsByDate.get(dateStr) || [];
    const dayVault = vaultByDate.get(dateStr) || [];

    let dayOnlineExpense = 0;
    let dayCashExpense = 0;
    let dayVaultSpend = 0;

    let dayOnlineIncome = 0;
    let dayCashIncome = 0;
    let dayOnlineAllocation = 0;
    let dayCashAllocation = 0;

    let dayTransferToVault = 0;
    let dayTransferFromVault = 0;

    dayEvents.forEach(ev => {
      const amt = Number(ev.amount) || 0;
      if (ev.wallet === WALLET_TYPES.ONLINE) {
        if (ev.type === EVENT_TYPES.ALLOCATION) {
          dayOnlineAllocation += amt;
          runningOnline += amt;
        } else if (ev.type === EVENT_TYPES.MANUAL_INCOME) {
          dayOnlineIncome += amt;
          runningOnline += amt;
        } else if (ev.type === EVENT_TYPES.STARTING_BALANCE) {
          runningOnline += amt;
        } else if (ev.type === EVENT_TYPES.EXPENSE) {
          dayOnlineExpense += amt;
          runningOnline -= amt;
        } else if (ev.type === EVENT_TYPES.VAULT_TRANSFER) {
          if (ev.direction === 'out') {
            dayTransferToVault += amt;
            runningOnline -= amt;
          } else if (ev.direction === 'in') {
            dayTransferFromVault += amt;
            runningOnline += amt;
          }
        }
      } else if (ev.wallet === WALLET_TYPES.CASH) {
        if (ev.type === EVENT_TYPES.ALLOCATION) {
          dayCashAllocation += amt;
          runningCash += amt;
        } else if (ev.type === EVENT_TYPES.MANUAL_INCOME) {
          dayCashIncome += amt;
          runningCash += amt;
        } else if (ev.type === EVENT_TYPES.STARTING_BALANCE) {
          runningCash += amt;
        } else if (ev.type === EVENT_TYPES.EXPENSE) {
          dayCashExpense += amt;
          runningCash -= amt;
        } else if (ev.type === EVENT_TYPES.VAULT_TRANSFER) {
          if (ev.direction === 'out') {
            dayTransferToVault += amt;
            runningCash -= amt;
          } else if (ev.direction === 'in') {
            dayTransferFromVault += amt;
            runningCash += amt;
          }
        }
      }
    });

    let dayVaultDeposit = 0;
    let dayVaultWithdrawal = 0;

    dayVault.forEach(r => {
      const amt = Number(r.amount) || 0;
      if (r.type === VAULT_TYPES.DEPOSIT) {
        dayVaultDeposit += amt;
        runningVault += amt;
      } else if (r.type === VAULT_TYPES.WITHDRAWAL) {
        dayVaultWithdrawal += amt;
        runningVault -= amt;
      } else if (r.type === VAULT_TYPES.SPEND) {
        dayVaultSpend += amt;
        runningVault -= amt;
      } else if (!r.type) {
        const sum = Number(r.cashSavings || 0) + Number(r.onlineSavings || 0) + Number(r.extraSavings || 0) +
          Number(r.emergencySavings || 0) + Number(r.investments || 0) + Number(r.goldSavings || 0) + Number(r.otherSavings || 0);
        dayVaultDeposit += sum;
        runningVault += sum;
      }
    });
    runningVault = Math.max(0, runningVault);

    const totalRealExpense = dayOnlineExpense + dayCashExpense + dayVaultSpend;
    const totalRealIncome = dayOnlineIncome + dayCashIncome;
    const totalAllocation = dayOnlineAllocation + dayCashAllocation;
    const totalPositiveInflow = totalRealIncome + totalAllocation;
    const liquidBalance = runningOnline + runningCash;
    const totalHoldings = liquidBalance + runningVault;

    // Has user-initiated or financial activity occurred on this day?
    const hasActivity = totalRealExpense > 0 ||
      totalRealIncome > 0 ||
      totalAllocation > 0 ||
      dayTransferToVault > 0 ||
      dayTransferFromVault > 0 ||
      dayVaultDeposit > 0 ||
      dayVaultWithdrawal > 0 ||
      dayVaultSpend > 0;

    return {
      date: dateStr,
      onlineBalance: runningOnline,
      cashBalance: runningCash,
      liquidBalance,
      vaultBalance: runningVault,
      totalHoldings,
      expenses: {
        online: dayOnlineExpense,
        cash: dayCashExpense,
        vaultSpend: dayVaultSpend,
        total: totalRealExpense
      },
      inflows: {
        manualIncome: totalRealIncome,
        allocation: totalAllocation,
        total: totalPositiveInflow
      },
      transfers: {
        toVault: dayTransferToVault,
        fromVault: dayTransferFromVault,
        vaultDeposits: dayVaultDeposit,
        vaultWithdrawals: dayVaultWithdrawal,
        totalVolume: dayTransferToVault + dayTransferFromVault
      },
      isDeficit: liquidBalance < 0,
      hasActivity
    };
  });

  return dailySnapshots;
}

// ==================================================
// RAW ANALYTICS AGGREGATOR
// ==================================================

/**
 * Exposes deterministic raw metrics for future charts and intelligence consumption.
 * All metrics strictly derived from authoritative financial events.
 */
export function calculateRawFinancialMetrics({
  dailyTimeline = [],
  reconciledLedger = null,
  vaultRecords = [],
  targetDateStr = null
}) {
  const timeline = dailyTimeline || [];
  const observedDays = timeline.length;

  let totalManualIncome = 0;
  let totalAllowance = 0;
  let totalOnlineExpenses = 0;
  let totalCashExpenses = 0;
  let totalVaultSpending = 0;

  let vaultDeposits = 0;
  let vaultWithdrawals = 0;
  let walletTransferVolume = 0;

  let activeFinancialDays = 0;
  let currentStreak = 0;
  let longestActivityStreak = 0;

  const dailyExpensesList = [];
  const dailyLiquidBalances = [];

  let minLiquid = timeline.length ? timeline[0].liquidBalance : 0;
  let maxLiquid = timeline.length ? timeline[0].liquidBalance : 0;

  // Deficit episode tracker
  let negativeBalanceEpisodes = 0;
  let inEpisode = false;
  let episodeDurations = [];
  let currentEpisodeDuration = 0;

  timeline.forEach(day => {
    totalManualIncome += day.inflows.manualIncome;
    totalAllowance += day.inflows.allocation;

    totalOnlineExpenses += day.expenses.online;
    totalCashExpenses += day.expenses.cash;
    totalVaultSpending += day.expenses.vaultSpend;

    vaultDeposits += day.transfers.vaultDeposits;
    vaultWithdrawals += day.transfers.vaultWithdrawals;
    walletTransferVolume += day.transfers.totalVolume;

    dailyExpensesList.push(day.expenses.total);
    dailyLiquidBalances.push(day.liquidBalance);

    if (day.liquidBalance < minLiquid) minLiquid = day.liquidBalance;
    if (day.liquidBalance > maxLiquid) maxLiquid = day.liquidBalance;

    // Track active days and longest activity streak
    if (day.hasActivity) {
      activeFinancialDays++;
      currentStreak++;
      if (currentStreak > longestActivityStreak) longestActivityStreak = currentStreak;
    } else {
      currentStreak = 0;
    }

    // Track deficit episodes
    if (day.isDeficit) {
      currentEpisodeDuration++;
      if (!inEpisode) {
        inEpisode = true;
        negativeBalanceEpisodes++;
      }
    } else {
      if (inEpisode) {
        episodeDurations.push(currentEpisodeDuration);
        currentEpisodeDuration = 0;
        inEpisode = false;
      }
    }
  });

  if (inEpisode && currentEpisodeDuration > 0) {
    episodeDurations.push(currentEpisodeDuration);
  }

  const totalIncome = totalAllowance + totalManualIncome;
  const totalExpenses = totalOnlineExpenses + totalCashExpenses + totalVaultSpending;
  const netVaultGrowth = vaultDeposits - vaultWithdrawals - totalVaultSpending;

  const averageDailyExpense = observedDays > 0 ? (totalExpenses / observedDays) : 0;
  const medianDailyExpense = calculateMedian(dailyExpensesList);
  const expenseVolatility = calculateStandardDeviation(dailyExpensesList, averageDailyExpense);

  const averageLiquidBalance = observedDays > 0 ? calculateMean(dailyLiquidBalances) : 0;

  // End of period authoritative balances from reconciled ledger if present
  const endSnapshot = timeline.length ? timeline[timeline.length - 1] : null;
  const onlineBalance = reconciledLedger?.wallets?.online !== undefined
    ? reconciledLedger.wallets.online
    : (endSnapshot ? endSnapshot.onlineBalance : 0);
  const cashBalance = reconciledLedger?.wallets?.cash !== undefined
    ? reconciledLedger.wallets.cash
    : (endSnapshot ? endSnapshot.cashBalance : 0);
  const currentLiquidBalance = onlineBalance + cashBalance;

  const vaultBalance = calculateVaultBalance(vaultRecords);

  // Recovery estimates for any active deficit
  const totalDailyAllocationRate = (reconciledLedger?.dailyRates?.online || 0) + (reconciledLedger?.dailyRates?.cash || 0);
  let averageRecoveryEstimate = 0;
  if (currentLiquidBalance < 0 && totalDailyAllocationRate > 0) {
    averageRecoveryEstimate = Math.ceil(Math.abs(currentLiquidBalance) / totalDailyAllocationRate);
  } else if (episodeDurations.length > 0) {
    averageRecoveryEstimate = Math.round(calculateMean(episodeDurations));
  }

  return {
    totalIncome,
    totalExpenses,
    totalAllowance,
    totalManualIncome,

    averageDailyExpense,
    medianDailyExpense,
    expenseVolatility,

    averageLiquidBalance,
    currentLiquidBalance,
    minimumLiquidBalance: minLiquid,
    maximumLiquidBalance: maxLiquid,

    onlineBalance,
    cashBalance,

    vaultBalance,
    vaultDeposits,
    vaultWithdrawals,
    vaultSpending: totalVaultSpending,
    netVaultGrowth,

    walletTransferVolume,

    activeFinancialDays,
    longestActivityStreak,

    negativeBalanceEpisodes,
    averageRecoveryEstimate
  };
}

// ==================================================
// FINANCIAL DNA: SEVEN DESCRIPTIVE DIMENSIONS
// ==================================================

/**
 * 1. Liquidity Resilience
 * Measures liquid capacity (Online + Cash) relative to normal spending rate.
 * Vault is explicitly excluded from liquid balance.
 */
export function evaluateLiquidityResilience(rawMetrics, observedDays) {
  const { currentLiquidBalance, averageDailyExpense } = rawMetrics;

  if (observedDays === 0 || (averageDailyExpense === 0 && rawMetrics.totalIncome === 0 && currentLiquidBalance === 0)) {
    return {
      dimension: 'liquidityResilience',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'Insufficient transaction history to establish daily spending cadence.',
      metrics: { currentLiquidBalance, averageDailyExpense, runwayDays: null }
    };
  }

  if (currentLiquidBalance < 0) {
    return {
      dimension: 'liquidityResilience',
      score: 0,
      status: 'negative_liquidity',
      confidence: 1.0,
      isSufficient: true,
      reason: 'Liquid balance is currently negative across digital/cash wallets.',
      metrics: { currentLiquidBalance, averageDailyExpense, runwayDays: 0 }
    };
  }

  if (averageDailyExpense <= 0) {
    return {
      dimension: 'liquidityResilience',
      score: 75,
      status: 'positive_idle',
      confidence: 0.6,
      isSufficient: true,
      reason: 'Positive liquid capital preserved with zero recorded expenditures in period.',
      metrics: { currentLiquidBalance, averageDailyExpense: 0, runwayDays: Infinity }
    };
  }

  const runwayDays = currentLiquidBalance / averageDailyExpense;
  let score;
  let status;

  if (runwayDays === 0) {
    score = 10;
    status = 'depleted';
  } else if (runwayDays < 7) {
    score = clamp(Math.round(10 + (runwayDays / 7) * 30), 10, 40);
    status = 'vulnerable';
  } else if (runwayDays < 21) {
    score = clamp(Math.round(40 + ((runwayDays - 7) / 14) * 30), 40, 70);
    status = 'moderate';
  } else if (runwayDays < 45) {
    score = clamp(Math.round(70 + ((runwayDays - 21) / 24) * 20), 70, 90);
    status = 'resilient';
  } else {
    score = clamp(Math.round(90 + Math.min(10, ((runwayDays - 45) / 45) * 10)), 90, 100);
    status = 'robust';
  }

  const confidence = Math.min(1.0, (observedDays / 30) * 0.8 + 0.2);

  return {
    dimension: 'liquidityResilience',
    score,
    status,
    confidence: Number(confidence.toFixed(2)),
    isSufficient: true,
    reason: `Estimated liquid runway represents ${Math.round(runwayDays)} day${Math.round(runwayDays) === 1 ? '' : 's'} of typical spending.`,
    metrics: {
      currentLiquidBalance,
      averageDailyExpense: Number(averageDailyExpense.toFixed(2)),
      runwayDays: Number(runwayDays.toFixed(1))
    }
  };
}

/**
 * 2. Saving Behavior
 * Measures Net Vault Contribution (deposits - withdrawals) relative to positive financial inflows.
 * Vault transfers are internal movement, not expenses.
 */
export function evaluateSavingBehavior(rawMetrics) {
  const { vaultDeposits, vaultWithdrawals, vaultSpending, totalIncome } = rawMetrics;
  const netContribution = vaultDeposits - vaultWithdrawals;

  if (vaultDeposits === 0 && vaultWithdrawals === 0 && totalIncome === 0) {
    return {
      dimension: 'savingBehavior',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'No vault transfer activity or recorded inflows in analytical period.',
      metrics: { netContribution: 0, savingsRate: null, totalIncome: 0 }
    };
  }

  if (totalIncome <= 0) {
    if (netContribution > 0) {
      return {
        dimension: 'savingBehavior',
        score: 65,
        status: 'active_contributor',
        confidence: 0.6,
        isSufficient: true,
        reason: 'Positive vault accumulation recorded without periodic virtual allocation.',
        metrics: { netContribution, savingsRate: null, totalIncome: 0 }
      };
    }
    return {
      dimension: 'savingBehavior',
      score: 30,
      status: 'neutral_reserve',
      confidence: 0.5,
      isSufficient: true,
      reason: 'Zero positive inflows recorded to benchmark savings performance against.',
      metrics: { netContribution, savingsRate: 0, totalIncome: 0 }
    };
  }

  const savingsRate = netContribution / totalIncome;
  let score;
  let status;

  if (netContribution < 0) {
    score = clamp(Math.round(25 - Math.min(20, Math.abs(savingsRate) * 40)), 5, 25);
    status = 'net_withdrawing';
  } else if (netContribution === 0) {
    score = 30;
    status = 'neutral_reserve';
  } else if (savingsRate < 0.10) {
    score = clamp(Math.round(40 + (savingsRate / 0.10) * 20), 40, 60);
    status = 'occasional_saver';
  } else if (savingsRate < 0.25) {
    score = clamp(Math.round(60 + ((savingsRate - 0.10) / 0.15) * 20), 60, 80);
    status = 'consistent_saver';
  } else if (savingsRate < 0.50) {
    score = clamp(Math.round(80 + ((savingsRate - 0.25) / 0.25) * 15), 80, 95);
    status = 'dedicated_saver';
  } else {
    score = clamp(Math.round(95 + Math.min(5, (savingsRate - 0.50) * 10)), 95, 100);
    status = 'heavy_saver';
  }

  return {
    dimension: 'savingBehavior',
    score,
    status,
    confidence: 0.9,
    isSufficient: true,
    reason: `Net vault savings rate represents ${(savingsRate * 100).toFixed(1)}% of total positive financial inflows.`,
    metrics: {
      vaultDeposits,
      vaultWithdrawals,
      vaultSpending,
      netContribution,
      totalIncome,
      savingsRate: Number(savingsRate.toFixed(4))
    }
  };
}

/**
 * 3. Savings Momentum
 * Compares recent Vault growth against the previous comparable period.
 */
export function evaluateSavingsMomentum(recentRawMetrics, previousRawMetrics) {
  const recentGrowth = recentRawMetrics?.netVaultGrowth ?? 0;
  const prevGrowth = previousRawMetrics?.netVaultGrowth ?? 0;

  const recentVaultActivity = (recentRawMetrics?.vaultDeposits || 0) + (recentRawMetrics?.vaultWithdrawals || 0) + (recentRawMetrics?.vaultSpending || 0);
  const prevVaultActivity = (previousRawMetrics?.vaultDeposits || 0) + (previousRawMetrics?.vaultWithdrawals || 0) + (previousRawMetrics?.vaultSpending || 0);

  if (recentVaultActivity === 0 && prevVaultActivity === 0) {
    return {
      dimension: 'savingsMomentum',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'No vault transfer or savings activity across current and previous periods.',
      metrics: { recentGrowth: 0, prevGrowth: 0, growthDelta: 0 }
    };
  }

  const growthDelta = recentGrowth - prevGrowth;
  let score;
  let status;

  if (prevVaultActivity === 0 && recentGrowth > 0) {
    score = 80;
    status = 'accelerating';
  } else if (prevVaultActivity === 0 && recentGrowth <= 0) {
    score = 30;
    status = 'contracting';
  } else if (growthDelta > 0) {
    const scale = Math.abs(prevGrowth) || Math.abs(recentGrowth) || 1;
    score = clamp(Math.round(65 + Math.min(35, (growthDelta / scale) * 35)), 65, 100);
    status = 'accelerating';
  } else if (growthDelta === 0) {
    score = 60;
    status = 'steady';
  } else {
    const scale = Math.abs(prevGrowth) || 1;
    score = clamp(Math.round(50 - Math.min(40, (Math.abs(growthDelta) / scale) * 40)), 10, 50);
    status = 'decelerating';
  }

  return {
    dimension: 'savingsMomentum',
    score,
    status,
    confidence: 0.85,
    isSufficient: true,
    reason: growthDelta >= 0
      ? `Vault growth expanded by ₹${growthDelta.toFixed(2)} compared with previous period.`
      : `Vault growth contracted by ₹${Math.abs(growthDelta).toFixed(2)} compared with previous period.`,
    metrics: {
      recentGrowth,
      prevGrowth,
      growthDelta
    }
  };
}

/**
 * 4. Spending Control
 * Measures real expenses (Online + Cash + Vault Spending) relative to positive financial inflows.
 * Internal transfers (wallets <-> vault) are strictly excluded.
 */
export function evaluateSpendingControl(rawMetrics) {
  const { totalExpenses, totalIncome } = rawMetrics;

  if (totalIncome === 0 && totalExpenses === 0) {
    return {
      dimension: 'spendingControl',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'No expenditures or positive inflows recorded in this period.',
      metrics: { totalExpenses: 0, totalIncome: 0, spendingRatio: null }
    };
  }

  if (totalIncome <= 0 && totalExpenses > 0) {
    return {
      dimension: 'spendingControl',
      score: 15,
      status: 'unbacked_spending',
      confidence: 0.85,
      isSufficient: true,
      reason: 'Expenditures recorded in the absence of positive allowance or manual income.',
      metrics: { totalExpenses, totalIncome: 0, spendingRatio: Infinity }
    };
  }

  const spendingRatio = totalExpenses / totalIncome;
  let score;
  let status;

  if (spendingRatio <= 0.50) {
    score = clamp(Math.round(90 + (1 - spendingRatio / 0.50) * 10), 90, 100);
    status = 'high_surplus';
  } else if (spendingRatio <= 0.80) {
    score = clamp(Math.round(75 + ((0.80 - spendingRatio) / 0.30) * 15), 75, 90);
    status = 'controlled_surplus';
  } else if (spendingRatio <= 1.00) {
    score = clamp(Math.round(60 + ((1.00 - spendingRatio) / 0.20) * 15), 60, 75);
    status = 'balanced_spending';
  } else if (spendingRatio <= 1.25) {
    score = clamp(Math.round(40 + ((1.25 - spendingRatio) / 0.25) * 20), 40, 60);
    status = 'mild_overspend';
  } else {
    score = clamp(Math.round(40 - Math.min(40, (spendingRatio - 1.25) * 40)), 0, 40);
    status = 'deficit_spending';
  }

  return {
    dimension: 'spendingControl',
    score,
    status,
    confidence: 0.9,
    isSufficient: true,
    reason: `Real expenses consumed ${(spendingRatio * 100).toFixed(1)}% of total positive financial inflows.`,
    metrics: {
      totalExpenses,
      totalIncome,
      spendingRatio: Number(spendingRatio.toFixed(4)),
      netCashFlow: totalIncome - totalExpenses
    }
  };
}

/**
 * 5. Consistency
 * Measures financial activity days (expense, income, allowance, vault activity).
 * Zero-spend days are NOT treated as negative behavior.
 */
export function evaluateConsistency(rawMetrics, observedDays) {
  const { activeFinancialDays, longestActivityStreak } = rawMetrics;

  if (observedDays === 0) {
    return {
      dimension: 'consistency',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'No observed days in analytical period.',
      metrics: { activeFinancialDays: 0, observedDays: 0, activityRatio: null }
    };
  }

  const activityRatio = activeFinancialDays / observedDays;
  const score = clamp(Math.round(activityRatio * 100), 0, 100);

  let status;
  if (activityRatio >= 0.80) status = 'highly_active';
  else if (activityRatio >= 0.50) status = 'regular_activity';
  else if (activityRatio >= 0.25) status = 'periodic_activity';
  else status = 'sparse_activity';

  return {
    dimension: 'consistency',
    score,
    status,
    confidence: Math.min(1.0, observedDays / 30),
    isSufficient: true,
    reason: `Recorded active financial transactions or allocations on ${activeFinancialDays} of ${observedDays} observed days.`,
    metrics: {
      activeFinancialDays,
      observedDays,
      activityRatio: Number(activityRatio.toFixed(4)),
      longestActivityStreak
    }
  };
}

/**
 * 6. Stability
 * Measures volatility relative to the user's own typical historical behavior.
 * Uses coefficient of variation (CV) to eliminate arbitrary external norms.
 */
export function evaluateStability(rawMetrics, dailyTimeline = []) {
  const observedDays = dailyTimeline.length;

  if (observedDays < 3) {
    return {
      dimension: 'stability',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'Requires at least 3 days of observed records to establish personal volatility baseline.',
      metrics: { dailyExpenseMean: 0, expenseVolatility: 0, coefficientOfVariation: null }
    };
  }

  const dailyExpenses = dailyTimeline.map(d => d.expenses.total);
  const spendingAmounts = dailyExpenses.filter(e => e > 0);

  if (spendingAmounts.length === 0) {
    return {
      dimension: 'stability',
      score: 95,
      status: 'highly_stable',
      confidence: 0.8,
      isSufficient: true,
      reason: 'Zero expenditure variance observed over analytical period.',
      metrics: { dailyExpenseMean: 0, expenseVolatility: 0, coefficientOfVariation: 0, spendingDaysCount: 0 }
    };
  }

  if (spendingAmounts.length < 3) {
    return {
      dimension: 'stability',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'Requires at least 3 active spending days to establish personal expenditure volatility baseline.',
      metrics: { dailyExpenseMean: calculateMean(spendingAmounts), expenseVolatility: 0, coefficientOfVariation: null, spendingDaysCount: spendingAmounts.length }
    };
  }

  const meanExpense = calculateMean(spendingAmounts);
  const stdDevExpense = calculateStandardDeviation(spendingAmounts, meanExpense);
  const cv = stdDevExpense / (meanExpense || 1);

  // Lower relative CV yields higher stability score
  const score = clamp(Math.round(100 / (1 + (cv * 0.75))), 0, 100);

  let status;
  if (cv < 0.35) status = 'highly_stable';
  else if (cv < 0.75) status = 'moderate_stability';
  else if (cv < 1.50) status = 'variable_flow';
  else status = 'high_volatility';

  const liquidBalances = dailyTimeline.map(d => d.liquidBalance);
  const meanBalance = calculateMean(liquidBalances);
  const stdDevBalance = calculateStandardDeviation(liquidBalances, meanBalance);

  return {
    dimension: 'stability',
    score,
    status,
    confidence: Math.min(1.0, (spendingAmounts.length / 10) * 0.6 + 0.4),
    isSufficient: true,
    reason: `Normalized expenditure coefficient of variation across spending days is ${cv.toFixed(2)}.`,
    metrics: {
      dailyExpenseMean: Number(meanExpense.toFixed(2)),
      expenseVolatility: Number(stdDevExpense.toFixed(2)),
      coefficientOfVariation: Number(cv.toFixed(4)),
      spendingDaysCount: spendingAmounts.length,
      liquidBalanceStdDev: Number(stdDevBalance.toFixed(2))
    }
  };
}

/**
 * 7. Recovery
 * Analyzes negative-balance episodes and recovery performance.
 * Does NOT treat "never went negative" as an arbitrary score; explicitly marks stability.
 */
export function evaluateRecovery(rawMetrics, dailyTimeline = [], allowanceConfig = null) {
  const { negativeBalanceEpisodes, currentLiquidBalance } = rawMetrics;

  if (!dailyTimeline.length) {
    return {
      dimension: 'recovery',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'No timeline observations available to evaluate recovery mechanics.',
      metrics: { negativeBalanceEpisodes: 0, currentDeficit: 0, estimatedRecoveryDays: null }
    };
  }

  if (negativeBalanceEpisodes === 0 && currentLiquidBalance >= 0) {
    return {
      dimension: 'recovery',
      score: null,
      status: 'no_deficits_observed',
      confidence: 1.0,
      isSufficient: true,
      reason: 'No negative balance episodes have been observed in this analytical window.',
      metrics: {
        negativeBalanceEpisodes: 0,
        currentDeficit: 0,
        estimatedRecoveryDays: 0,
        actualRecoveryDuration: 0
      }
    };
  }

  // Active negative balance recovery
  if (currentLiquidBalance < 0) {
    const totalDailyRate = allowanceConfig
      ? (getDailyAllocation(allowanceConfig.monthlyOnlineAllowance || 0, new Date().getFullYear(), new Date().getMonth() + 1) +
         getDailyAllocation(allowanceConfig.monthlyCashAllowance || 0, new Date().getFullYear(), new Date().getMonth() + 1))
      : 0;

    const recoveryEstimate = calculateRecoveryEstimate(currentLiquidBalance, totalDailyRate);

    if (!recoveryEstimate.isRecoverable) {
      return {
        dimension: 'recovery',
        score: 5,
        status: 'unsupported_deficit',
        confidence: 0.95,
        isSufficient: true,
        reason: 'Current liquid balance is negative and automatic daily recovery allocation is zero.',
        metrics: {
          negativeBalanceEpisodes,
          currentDeficit: Math.abs(currentLiquidBalance),
          estimatedRecoveryDays: null,
          dailyAllocation: totalDailyRate
        }
      };
    }

    const estDays = recoveryEstimate.recoveryDays || 1;
    const score = clamp(Math.round(70 - Math.min(60, estDays * 2)), 10, 70);

    return {
      dimension: 'recovery',
      score,
      status: 'active_recovery',
      confidence: 0.9,
      isSufficient: true,
      reason: `Active liquid deficit of ₹${Math.abs(currentLiquidBalance).toFixed(2)} with estimated recovery in ${estDays} day${estDays === 1 ? '' : 's'}.`,
      metrics: {
        negativeBalanceEpisodes,
        currentDeficit: Math.abs(currentLiquidBalance),
        estimatedRecoveryDays: estDays,
        dailyAllocation: totalDailyRate
      }
    };
  }

  // Past resolved episodes
  const avgEstimate = rawMetrics.averageRecoveryEstimate || 3;
  let score;
  let status;

  if (avgEstimate <= 3) {
    score = 95;
    status = 'swift_recovery';
  } else if (avgEstimate <= 7) {
    score = 80;
    status = 'prompt_recovery';
  } else if (avgEstimate <= 15) {
    score = 65;
    status = 'managed_recovery';
  } else {
    score = 45;
    status = 'extended_recovery';
  }

  return {
    dimension: 'recovery',
    score,
    status,
    confidence: 0.85,
    isSufficient: true,
    reason: `Resolved historical negative balance episodes within an average of ${avgEstimate} days.`,
    metrics: {
      negativeBalanceEpisodes,
      currentDeficit: 0,
      estimatedRecoveryDays: 0,
      actualRecoveryDuration: avgEstimate
    }
  };
}

/**
 * Calculates complete Financial DNA across all seven dimensions
 */
export function calculateFinancialDNA({
  rawMetrics,
  dailyTimeline,
  previousRawMetrics,
  allowanceConfig,
  observedDays
}) {
  return {
    liquidityResilience: evaluateLiquidityResilience(rawMetrics, observedDays),
    savingBehavior: evaluateSavingBehavior(rawMetrics),
    savingsMomentum: evaluateSavingsMomentum(rawMetrics, previousRawMetrics),
    spendingControl: evaluateSpendingControl(rawMetrics),
    consistency: evaluateConsistency(rawMetrics, observedDays),
    stability: evaluateStability(rawMetrics, dailyTimeline),
    recovery: evaluateRecovery(rawMetrics, dailyTimeline, allowanceConfig)
  };
}

// ==================================================
// SAVINGS DNA: SIX VAULT-SPECIFIC DIMENSIONS
// ==================================================

/**
 * 1. Reserve Strength
 * Compares current Vault reserve to monthly spending rate and total holdings.
 */
export function evaluateReserveStrength(rawMetrics) {
  const { vaultBalance, averageDailyExpense, currentLiquidBalance } = rawMetrics;
  const totalHoldings = currentLiquidBalance + vaultBalance;

  if (vaultBalance === 0) {
    return {
      dimension: 'reserveStrength',
      score: 0,
      status: 'unfunded_reserve',
      confidence: 0.9,
      isSufficient: true,
      reason: 'No protected capital currently held in Sovereign Vault.',
      metrics: { vaultBalance: 0, monthsOfReserve: 0, totalHoldingsShare: 0 }
    };
  }

  const monthlyExpenseRunway = averageDailyExpense > 0 ? (averageDailyExpense * 30) : 1000;
  const monthsOfReserve = vaultBalance / monthlyExpenseRunway;
  const holdingsShare = totalHoldings > 0 ? (vaultBalance / totalHoldings) : 1.0;

  let score;
  let status;

  if (monthsOfReserve < 0.5) {
    score = clamp(Math.round(20 + (monthsOfReserve / 0.5) * 20), 20, 40);
    status = 'nascent_reserve';
  } else if (monthsOfReserve < 2.0) {
    score = clamp(Math.round(40 + ((monthsOfReserve - 0.5) / 1.5) * 30), 40, 70);
    status = 'established_reserve';
  } else if (monthsOfReserve < 6.0) {
    score = clamp(Math.round(70 + ((monthsOfReserve - 2.0) / 4.0) * 20), 70, 90);
    status = 'strong_reserve';
  } else {
    score = clamp(Math.round(90 + Math.min(10, ((monthsOfReserve - 6.0) / 6.0) * 10)), 90, 100);
    status = 'fortified_reserve';
  }

  return {
    dimension: 'reserveStrength',
    score,
    status,
    confidence: 0.9,
    isSufficient: true,
    reason: `Vault reserve represents ${monthsOfReserve.toFixed(1)} months of average living expenses (${(holdingsShare * 100).toFixed(1)}% of total net holdings).`,
    metrics: {
      vaultBalance,
      monthsOfReserve: Number(monthsOfReserve.toFixed(2)),
      totalHoldingsShare: Number(holdingsShare.toFixed(4))
    }
  };
}

/**
 * 2. Savings Momentum (Vault-Specific)
 */
export function evaluateVaultSavingsMomentum(rawMetrics, previousRawMetrics) {
  return evaluateSavingsMomentum(rawMetrics, previousRawMetrics);
}

/**
 * 3. Contribution Consistency
 * Analyzes the frequency and regularity of additions to the Vault.
 */
export function evaluateContributionConsistency(vaultRecords = [], observedDays = 30) {
  const activeRecords = (vaultRecords || []).filter(r => r && !r.deleted);
  const deposits = activeRecords.filter(r => r.type === VAULT_TYPES.DEPOSIT || !r.type);

  if (!deposits.length) {
    return {
      dimension: 'contributionConsistency',
      score: null,
      status: 'no_deposits',
      confidence: 0.8,
      isSufficient: false,
      reason: 'No deposits recorded into Protected Savings in historical ledger.',
      metrics: { depositCount: 0, averageDepositAmount: 0 }
    };
  }

  const depositAmounts = deposits.map(d => Number(d.amount || d.onlineSavings || d.cashSavings || 0));
  const avgDeposit = calculateMean(depositAmounts);
  const depositCount = deposits.length;

  let score;
  let status;

  if (depositCount === 1) {
    score = 45;
    status = 'single_deposit';
  } else if (depositCount < 4) {
    score = clamp(Math.round(50 + (depositCount / 4) * 20), 50, 70);
    status = 'periodic_depositor';
  } else if (depositCount < 8) {
    score = clamp(Math.round(70 + ((depositCount - 4) / 4) * 20), 70, 90);
    status = 'regular_contributor';
  } else {
    score = clamp(Math.round(90 + Math.min(10, ((depositCount - 8) / 8) * 10)), 90, 100);
    status = 'systematic_contributor';
  }

  return {
    dimension: 'contributionConsistency',
    score,
    status,
    confidence: 0.85,
    isSufficient: true,
    reason: `Recorded ${depositCount} separate protected deposits averaging ₹${avgDeposit.toFixed(2)}.`,
    metrics: {
      depositCount,
      averageDepositAmount: Number(avgDeposit.toFixed(2))
    }
  };
}

/**
 * 4. Retention
 * Measures proportion of deposited capital that remains untouched in the Vault.
 */
export function evaluateRetention(rawMetrics) {
  const { vaultDeposits, vaultWithdrawals, vaultSpending } = rawMetrics;

  if (vaultDeposits === 0) {
    return {
      dimension: 'retention',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'No vault deposits recorded in analytical window.',
      metrics: { vaultDeposits: 0, totalOutflows: 0, retentionRate: null }
    };
  }

  const totalOutflows = vaultWithdrawals + vaultSpending;
  const capitalRetained = vaultDeposits - totalOutflows;
  const retentionRate = Math.max(0, capitalRetained / vaultDeposits);

  let score;
  let status;

  if (retentionRate >= 0.90) {
    score = clamp(Math.round(90 + ((retentionRate - 0.90) / 0.10) * 10), 90, 100);
    status = 'high_capital_retention';
  } else if (retentionRate >= 0.60) {
    score = clamp(Math.round(65 + ((retentionRate - 0.60) / 0.30) * 25), 65, 90);
    status = 'healthy_retention';
  } else if (retentionRate >= 0.20) {
    score = clamp(Math.round(35 + ((retentionRate - 0.20) / 0.40) * 30), 35, 65);
    status = 'moderate_retention';
  } else {
    score = clamp(Math.round((retentionRate / 0.20) * 35), 0, 35);
    status = 'high_drain';
  }

  return {
    dimension: 'retention',
    score,
    status,
    confidence: 0.9,
    isSufficient: true,
    reason: `Preserved ${(retentionRate * 100).toFixed(1)}% of capital deposited into Vault in this period.`,
    metrics: {
      vaultDeposits,
      totalOutflows,
      capitalRetained,
      retentionRate: Number(retentionRate.toFixed(4))
    }
  };
}

/**
 * 5. Withdrawal Discipline
 * Evaluates the proportion of reserve drawn back into active virtual wallets.
 */
export function evaluateWithdrawalDiscipline(rawMetrics) {
  const { vaultDeposits, vaultWithdrawals } = rawMetrics;

  if (vaultDeposits === 0 && vaultWithdrawals === 0) {
    return {
      dimension: 'withdrawalDiscipline',
      score: null,
      status: 'insufficient_data',
      confidence: 0,
      isSufficient: false,
      reason: 'No deposit or withdrawal transactions recorded in period.',
      metrics: { vaultWithdrawals: 0, withdrawalRatio: null }
    };
  }

  if (vaultWithdrawals === 0) {
    return {
      dimension: 'withdrawalDiscipline',
      score: 100,
      status: 'untouched_reserve',
      confidence: 0.95,
      isSufficient: true,
      reason: 'Zero withdrawals executed from Protected Savings into liquid wallets.',
      metrics: { vaultWithdrawals: 0, withdrawalRatio: 0 }
    };
  }

  const withdrawalRatio = vaultWithdrawals / (vaultDeposits || vaultWithdrawals);
  let score;
  let status;

  if (withdrawalRatio < 0.15) {
    score = clamp(Math.round(85 + (1 - withdrawalRatio / 0.15) * 15), 85, 100);
    status = 'disciplined_preservation';
  } else if (withdrawalRatio < 0.40) {
    score = clamp(Math.round(60 + ((0.40 - withdrawalRatio) / 0.25) * 25), 60, 85);
    status = 'measured_withdrawals';
  } else if (withdrawalRatio < 0.80) {
    score = clamp(Math.round(30 + ((0.80 - withdrawalRatio) / 0.40) * 30), 30, 60);
    status = 'frequent_drawdown';
  } else {
    score = clamp(Math.round(30 - Math.min(30, (withdrawalRatio - 0.80) * 50)), 0, 30);
    status = 'heavy_drawdown';
  }

  return {
    dimension: 'withdrawalDiscipline',
    score,
    status,
    confidence: 0.9,
    isSufficient: true,
    reason: `Withdrawals returned ${(withdrawalRatio * 100).toFixed(1)}% of protected capital back into liquid wallets.`,
    metrics: {
      vaultWithdrawals,
      withdrawalRatio: Number(withdrawalRatio.toFixed(4))
    }
  };
}

/**
 * 6. Vault Spending Pattern
 * Analyzes direct purchases made from the Vault (VAULT_SPEND).
 */
export function evaluateVaultSpendingPattern(rawMetrics, vaultRecords = []) {
  const { vaultSpending, vaultBalance, vaultDeposits } = rawMetrics;
  const activeRecords = (vaultRecords || []).filter(r => r && !r.deleted);
  const spendRecords = activeRecords.filter(r => r.type === VAULT_TYPES.SPEND);

  if (!spendRecords.length) {
    return {
      dimension: 'vaultSpendingPattern',
      score: null,
      status: 'no_vault_expenditures',
      confidence: 1.0,
      isSufficient: true,
      reason: 'No direct external expenditures recorded against the Protected Savings Vault.',
      metrics: {
        vaultSpending: 0,
        spendCount: 0,
        averageSpendAmount: 0,
        topSpendingCategory: null
      }
    };
  }

  const spendCount = spendRecords.length;
  const averageSpendAmount = vaultSpending / spendCount;

  // Category concentration
  const catMap = {};
  spendRecords.forEach(r => {
    const c = r.category || 'Other';
    catMap[c] = (catMap[c] || 0) + (Number(r.amount) || 0);
  });
  let topCategory = 'Other';
  let topCatAmount = 0;
  Object.entries(catMap).forEach(([cat, amt]) => {
    if (amt > topCatAmount) {
      topCategory = cat;
      topCatAmount = amt;
    }
  });

  const totalCapacity = vaultBalance + vaultSpending;
  const spendRatio = totalCapacity > 0 ? (vaultSpending / totalCapacity) : 1.0;

  let score;
  let status;

  if (spendRatio < 0.20) {
    score = clamp(Math.round(80 + (1 - spendRatio / 0.20) * 15), 80, 95);
    status = 'targeted_capital_deployment';
  } else if (spendRatio < 0.50) {
    score = clamp(Math.round(55 + ((0.50 - spendRatio) / 0.30) * 25), 55, 80);
    status = 'moderate_reserve_spending';
  } else {
    score = clamp(Math.round(55 - Math.min(45, (spendRatio - 0.50) * 60)), 10, 55);
    status = 'excessive_reserve_drain';
  }

  return {
    dimension: 'vaultSpendingPattern',
    score,
    status,
    confidence: 0.9,
    isSufficient: true,
    reason: `Logged ${spendCount} direct spend transactions (Top category: ${topCategory}) consuming ${(spendRatio * 100).toFixed(1)}% of reserve.`,
    metrics: {
      vaultSpending,
      spendCount,
      averageSpendAmount: Number(averageSpendAmount.toFixed(2)),
      topSpendingCategory: topCategory,
      spendRatio: Number(spendRatio.toFixed(4))
    }
  };
}

/**
 * Calculates complete Savings DNA across all six dimensions
 */
export function calculateSavingsDNA({
  rawMetrics,
  previousRawMetrics,
  vaultRecords = [],
  observedDays = 30
}) {
  return {
    reserveStrength: evaluateReserveStrength(rawMetrics),
    savingsMomentum: evaluateVaultSavingsMomentum(rawMetrics, previousRawMetrics),
    contributionConsistency: evaluateContributionConsistency(vaultRecords, observedDays),
    retention: evaluateRetention(rawMetrics),
    withdrawalDiscipline: evaluateWithdrawalDiscipline(rawMetrics),
    vaultSpendingPattern: evaluateVaultSpendingPattern(rawMetrics, vaultRecords)
  };
}

// ==================================================
// MASTER FINANCIAL INTELLIGENCE ENGINE
// ==================================================

/**
 * Master entrypoint for Sanchoy Deterministic Financial Intelligence.
 *
 * @param {object} params
 * @param {Array<object>} [params.transactions] - User transaction records
 * @param {object|Array<object>} [params.allowanceConfig] - Virtual allowance configuration(s)
 * @param {object} [params.initialBalances] - { online: number, cash: number }
 * @param {Array<object>} [params.vaultRecords] - Vault ledger records
 * @param {string} [params.targetDate] - Target date 'YYYY-MM-DD'
 * @param {string} [params.period] - Analytical window key
 * @returns {object} Full intelligence output
 */
export function calculateFinancialIntelligence({
  transactions = [],
  allowanceConfig = null,
  initialBalances = { online: 0, cash: 0 },
  vaultRecords = [],
  targetDate = null,
  period = ANALYTICAL_WINDOWS.LAST_30_DAYS
} = {}) {
  const targetDateStr = targetDate || toLocalDateString(new Date());

  // 1. Reconcile complete virtual ledger
  const reconciledLedger = reconcileVirtualLedger({
    transactions,
    allowanceConfig,
    initialBalances,
    targetDateStr,
    vaultTransactions: vaultRecords
  });

  // 2. Resolve active and previous analytical windows
  const activeWindow = resolveAnalyticalWindow(period, targetDateStr);
  const previousWindow = resolveAnalyticalWindow(ANALYTICAL_WINDOWS.PREVIOUS_30_DAYS, targetDateStr);

  // 3. Build daily timelines
  const dailyTimeline = buildDailyTimeline({
    allLedgerEvents: reconciledLedger.events,
    vaultRecords,
    startDateStr: activeWindow.startDateStr,
    endDateStr: activeWindow.endDateStr,
    initialBalances
  });

  const previousTimeline = buildDailyTimeline({
    allLedgerEvents: reconciledLedger.events,
    vaultRecords,
    startDateStr: previousWindow.startDateStr,
    endDateStr: previousWindow.endDateStr,
    initialBalances
  });

  // 4. Calculate raw metrics for active and previous periods
  const raw = calculateRawFinancialMetrics({
    dailyTimeline,
    reconciledLedger,
    vaultRecords,
    targetDateStr
  });

  const previousRaw = calculateRawFinancialMetrics({
    dailyTimeline: previousTimeline,
    reconciledLedger,
    vaultRecords,
    targetDateStr: previousWindow.endDateStr
  });

  // 5. Evaluate Financial DNA (7 dimensions)
  const financialDNA = calculateFinancialDNA({
    rawMetrics: raw,
    dailyTimeline,
    previousRawMetrics: previousRaw,
    allowanceConfig: reconciledLedger.activeConfig,
    observedDays: activeWindow.observedDays
  });

  // 6. Evaluate Savings DNA (6 dimensions)
  const savingsDNA = calculateSavingsDNA({
    rawMetrics: raw,
    previousRawMetrics: previousRaw,
    vaultRecords,
    observedDays: activeWindow.observedDays
  });

  // 7. Overall data sufficiency summary
  const hasTransactions = transactions && transactions.length > 0;
  const hasVault = vaultRecords && vaultRecords.length > 0;
  const hasAllowance = !!reconciledLedger.activeConfig;

  const dataSufficiency = {
    overall: hasTransactions || hasVault || hasAllowance,
    transactionCount: transactions ? transactions.length : 0,
    vaultRecordCount: vaultRecords ? vaultRecords.length : 0,
    activeDays: raw.activeFinancialDays,
    observedDays: activeWindow.observedDays,
    hasAllowance
  };

  return {
    window: activeWindow,
    raw,
    financialDNA,
    savingsDNA,
    dataSufficiency,
    dailyTimeline,
    reconciledLedger
  };
}
