// Sanchoy Financial Intelligence Visualization Engine
// Deterministic Charts Workspace powered by intelligence.js & chart-adapter.js
// Light & Dark theme synchronized, responsive, zero fake numbers or duplicate financial formulas.

import { state } from '../core/state.js';
import { round, escapeHtml } from '../utils/utils.js';
import { events } from '../core/events.js';
import { renderExpenseHeatmap } from '../analytics/analytics.js';
import { getAllowanceConfig, getStartingBalances } from '../financial/allowance.js';
import { getTxs } from '../transactions/transactions.js';
import { getVaultSavings } from '../vault/vault.js';
import {
  calculateFinancialIntelligence,
  ANALYTICAL_WINDOWS
} from '../financial/intelligence.js';
import {
  prepareFinancialDNAChartData,
  prepareCashFlowChartData,
  prepareSpendingBehaviorData,
  prepareWalletIntelligenceData,
  prepareSavingsWealthData,
  prepareHistoricalFingerprintData
} from './chart-adapter.js';

// Chart instance cache to manage lifecycle and clean destruction
const chartInstances = {
  dna: null,
  cashFlow: null,
  category: null,
  velocity: null,
  volatility: null,
  walletDist: null,
  walletTrends: null,
  holdings: null,
  historical: null
};

let cachedTxs = [];
let activeWindowKey = ANALYTICAL_WINDOWS.LAST_30_DAYS;
let hasInitializedListeners = false;

/**
 * Returns theme-synchronized chart design tokens
 */
export function getChartTokens() {
  const isDark = document.documentElement.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark';

  if (isDark) {
    return {
      isDark: true,
      text: '#b1bdb9',
      textMuted: '#75837e',
      grid: 'rgba(243, 241, 236, 0.07)',
      border: 'rgba(243, 241, 236, 0.10)',
      expense: '#f87171',
      expenseBg: 'rgba(248, 113, 113, 0.12)',
      expenseBorder: 'rgba(248, 113, 113, 0.30)',
      income: '#34d399',
      incomeBg: 'rgba(52, 211, 153, 0.12)',
      incomeBorder: 'rgba(52, 211, 153, 0.30)',
      accent: '#5ea891',
      accentSecondary: '#c48b59',
      radarBg: 'rgba(94, 168, 145, 0.22)',
      radarGrid: 'rgba(243, 241, 236, 0.08)',
      categories: [
        '#5ea891', // Sage
        '#c48b59', // Copper
        '#568ea6', // Steel Slate
        '#889d96', // Eucalyptus
        '#748ca3', // Muted Denim
        '#bfa15f', // Amber Gold
        '#9381a8', // Muted Heather
        '#c2786b'  // Terracotta
      ],
      tooltipBg: '#18221f',
      tooltipBorder: 'rgba(243, 241, 236, 0.15)',
      tooltipTitle: '#f3f1ec',
      tooltipBody: '#b1bdb9'
    };
  }

  // Light theme: "Premium FinTech"
  return {
    isDark: false,
    text: '#485450',
    textMuted: '#798682',
    grid: 'rgba(23, 32, 29, 0.06)',
    border: 'rgba(23, 32, 29, 0.10)',
    expense: '#c93b3b',
    expenseBg: 'rgba(201, 59, 59, 0.08)',
    expenseBorder: 'rgba(201, 59, 59, 0.25)',
    income: '#1b8755',
    incomeBg: 'rgba(27, 135, 85, 0.08)',
    incomeBorder: 'rgba(27, 135, 85, 0.25)',
    accent: '#2d6a57',
    accentSecondary: '#a8623d',
    radarBg: 'rgba(45, 106, 87, 0.16)',
    radarGrid: 'rgba(23, 32, 29, 0.07)',
    categories: [
      '#2d6a57', // Forest Sage
      '#a8623d', // Terracotta
      '#3b6978', // Deep Teal
      '#788883', // Muted Slate
      '#5a6b7c', // Slate Blue
      '#847545', // Olive Mineral
      '#6d597a', // Muted Plum
      '#9e574c'  // Clay Red
    ],
    tooltipBg: '#ffffff',
    tooltipBorder: 'rgba(23, 32, 29, 0.12)',
    tooltipTitle: '#151e1b',
    tooltipBody: '#485450'
  };
}

/**
 * Safely destroys a cached Chart.js instance
 */
function destroyChart(key) {
  if (chartInstances[key]) {
    try {
      chartInstances[key].destroy();
    } catch (e) {
      console.warn(`[Sanchoy Charts] Error destroying chart ${key}:`, e);
    }
    chartInstances[key] = null;
  }
}

/**
 * Formats currency with tabular formatting and privacy mask support
 */
function fmtMoney(amount, isPrivacyMasked = false) {
  if (isPrivacyMasked || !state.sessionUnlocked) {
    return '₹ XXXX';
  }
  const n = Number(amount) || 0;
  const sign = n < 0 ? '−' : '';
  return `${sign}₹${Math.abs(round(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Master Render Entrypoint
 * Executes 1 deterministic intelligence calculation and propagates to all 6 sections.
 */
export function renderCharts(txs = null, windowKey = null) {
  if (windowKey) {
    activeWindowKey = windowKey;
  }
  if (txs) {
    cachedTxs = txs;
  } else if (!cachedTxs || cachedTxs.length === 0) {
    cachedTxs = getTxs();
  }

  // Ensure DOM is ready and Chart.js is present
  if (typeof Chart === 'undefined') {
    console.warn('[Sanchoy Charts] Chart.js library not loaded yet');
    return;
  }

  initChartsControls();

  const tokens = getChartTokens();
  Chart.defaults.font.family = "'Plus Jakarta Sans', -apple-system, sans-serif";
  Chart.defaults.color = tokens.text;

  // Single authoritative financial intelligence calculation
  const allowanceConfig = getAllowanceConfig();
  const initialBalances = getStartingBalances();
  const vaultRecords = getVaultSavings();

  const intel = calculateFinancialIntelligence({
    transactions: cachedTxs,
    allowanceConfig,
    initialBalances,
    vaultRecords,
    period: activeWindowKey
  });

  // Update window active buttons
  updateWindowSelectorUI(activeWindowKey);

  // 1. Render Section 1: Financial DNA
  renderSectionFinancialDNA(intel, tokens);

  // 2. Render Section 2: Cash Flow
  renderSectionCashFlow(intel, tokens);

  // 3. Render Section 3: Spending Behavior
  renderSectionSpendingBehavior(intel, cachedTxs, vaultRecords, tokens);

  // 4. Render Section 4: Wallet Intelligence
  renderSectionWalletIntelligence(intel, tokens);

  // 5. Render Section 5: Savings & Wealth
  renderSectionSavingsWealth(intel, tokens);

  // 6. Render Section 6: Historical Patterns & Density Heatmap
  renderSectionHistoricalPatterns(intel, cachedTxs, vaultRecords, tokens);

  // Apply privacy mask if session is locked
  updateChartsPrivacyMask();
}

/**
 * Updates UI state of analytical window range selector buttons (7D, 30D, 90D, 6M, 1Y)
 */
function updateWindowSelectorUI(activeKey) {
  document.querySelectorAll('[data-analytics-window]').forEach(btn => {
    const key = btn.getAttribute('data-analytics-window');
    if (key === activeKey) {
      btn.classList.add('bg-[var(--surface)]', 'text-[var(--text-primary)]', 'shadow-xs', 'border-[var(--border)]');
      btn.classList.remove('text-[var(--text-muted)]', 'hover:text-[var(--text-primary)]');
    } else {
      btn.classList.remove('bg-[var(--surface)]', 'text-[var(--text-primary)]', 'shadow-xs', 'border-[var(--border)]');
      btn.classList.add('text-[var(--text-muted)]', 'hover:text-[var(--text-primary)]');
    }
  });
}

// ==================================================
// SECTION 1: FINANCIAL DNA
// ==================================================

function renderSectionFinancialDNA(intel, tokens) {
  const canvas = document.getElementById('chartFinancialDNA');
  const emptyContainer = document.getElementById('financialDNAEmptyState');
  const listContainer = document.getElementById('financialDNAList');

  const dnaData = prepareFinancialDNAChartData(intel, tokens);

  // Render interpretation list
  if (listContainer) {
    listContainer.innerHTML = dnaData.items.map(item => {
      const scoreDisplay = item.score !== null ? `${item.score}<span class="text-[10px] text-[var(--text-muted)]">/100</span>` : '—';
      return `
        <div class="p-3 sm:p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] hover:bg-[var(--surface-hover)] transition-all">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-xs font-semibold text-[var(--text-primary)]">${escapeHtml(item.label)}</span>
            <div class="flex items-center gap-2">
              <span class="inline-flex px-2 py-0.5 text-[10px] font-mono rounded-md border ${item.badgeClass}">
                ${escapeHtml(item.statusLabel)}
              </span>
              <span class="text-xs font-mono font-bold text-[var(--text-primary)] min-w-[42px] text-right">
                ${scoreDisplay}
              </span>
            </div>
          </div>
          <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">${escapeHtml(item.reason)}</p>
        </div>
      `;
    }).join('');
  }

  if (!canvas) return;
  destroyChart('dna');

  if (!dnaData.hasAnyScore) {
    canvas.classList.add('hidden');
    if (emptyContainer) {
      emptyContainer.classList.remove('hidden');
      emptyContainer.innerHTML = `
        <div class="text-center py-12 px-6">
          <div class="w-12 h-12 mx-auto rounded-full bg-[var(--surface-inset)] flex items-center justify-center text-[var(--accent)] mb-3">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
            </svg>
          </div>
          <h4 class="font-serif-editorial text-lg font-bold text-[var(--text-primary)]">Your Financial DNA is still forming</h4>
          <p class="text-xs text-[var(--text-muted)] mt-1.5 max-w-sm mx-auto leading-relaxed">
            Keep recording financial activity to build a meaningful pattern across all seven behavioral dimensions.
          </p>
        </div>
      `;
    }
    return;
  }

  canvas.classList.remove('hidden');
  if (emptyContainer) emptyContainer.classList.add('hidden');

  const ctx = canvas.getContext('2d');
  chartInstances.dna = new Chart(ctx, {
    type: 'radar',
    data: dnaData.chartData,
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tokens.tooltipBg,
          borderColor: tokens.tooltipBorder,
          borderWidth: 1,
          titleColor: tokens.tooltipTitle,
          bodyColor: tokens.tooltipBody,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => {
              const item = dnaData.items[ctx.dataIndex];
              if (!item || item.score === null) return ` ${ctx.label}: Awaiting data`;
              return ` ${ctx.label}: ${item.score}/100 (${item.statusLabel})`;
            }
          }
        }
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            display: false,
            stepSize: 25
          },
          grid: {
            color: tokens.radarGrid
          },
          angleLines: {
            color: tokens.radarGrid
          },
          pointLabels: {
            color: tokens.textMuted,
            font: {
              size: 11,
              weight: '600',
              family: "'Plus Jakarta Sans', sans-serif"
            }
          }
        }
      }
    }
  });
}

// ==================================================
// SECTION 2: CASH FLOW
// ==================================================

function renderSectionCashFlow(intel, tokens) {
  const canvas = document.getElementById('chartCashFlow') || document.getElementById('lineChart');
  const emptyContainer = document.getElementById('cashFlowEmptyState');
  const statInflow = document.getElementById('cashFlowTotalInflow');
  const statExpense = document.getElementById('cashFlowTotalExpense');
  const statNet = document.getElementById('cashFlowNetPosition');

  const data = prepareCashFlowChartData(intel, tokens);

  if (statInflow) statInflow.textContent = fmtMoney(data.totalInflows);
  if (statExpense) statExpense.textContent = fmtMoney(data.totalExpenses);
  if (statNet) {
    statNet.textContent = fmtMoney(data.netSavings);
    if (data.netSavings > 0) {
      statNet.className = 'text-base font-bold font-mono text-[var(--income)]';
    } else if (data.netSavings < 0) {
      statNet.className = 'text-base font-bold font-mono text-[var(--expense)]';
    } else {
      statNet.className = 'text-base font-bold font-mono text-[var(--text-primary)]';
    }
  }

  if (!canvas) return;
  destroyChart('cashFlow');

  if (!data.hasData) {
    canvas.classList.add('hidden');
    if (emptyContainer) {
      emptyContainer.classList.remove('hidden');
      emptyContainer.innerHTML = `
        <div class="text-center py-16 px-6">
          <p class="text-sm font-semibold text-[var(--text-primary)]">Not enough cash flow history yet</p>
          <p class="text-xs text-[var(--text-muted)] mt-1">Record transactions or configure allowances to visualize cash flow dynamics.</p>
        </div>
      `;
    }
    return;
  }

  canvas.classList.remove('hidden');
  if (emptyContainer) emptyContainer.classList.add('hidden');

  const ctx = canvas.getContext('2d');
  chartInstances.cashFlow = new Chart(ctx, {
    type: 'line',
    data: data.chartData,
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10,
            padding: 16,
            font: { size: 11, weight: '600' },
            color: tokens.text
          }
        },
        tooltip: {
          backgroundColor: tokens.tooltipBg,
          borderColor: tokens.tooltipBorder,
          borderWidth: 1,
          titleColor: tokens.tooltipTitle,
          bodyColor: tokens.tooltipBody,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`
          }
        }
      },
      scales: {
        y: {
          grid: { color: tokens.grid },
          ticks: {
            color: tokens.textMuted,
            font: { size: 10 },
            callback: (v) => '₹' + v
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            color: tokens.textMuted,
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10
          }
        }
      }
    }
  });
}

// ==================================================
// SECTION 3: SPENDING BEHAVIOR
// ==================================================

function renderSectionSpendingBehavior(intel, transactions, vaultRecords, tokens) {
  const spending = prepareSpendingBehaviorData(intel, transactions, vaultRecords, tokens);

  // A. Category Spending (Doughnut)
  const catCanvas = document.getElementById('chartCategorySpend') || document.getElementById('pieChart');
  const catTotalEl = document.getElementById('categorySpendTotal');
  if (catTotalEl) catTotalEl.textContent = fmtMoney(spending.category.total);

  if (catCanvas) {
    destroyChart('category');
    const ctx = catCanvas.getContext('2d');
    chartInstances.category = new Chart(ctx, {
      type: 'doughnut',
      data: spending.category.chartData,
      options: {
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 12,
              font: { size: 11, weight: '600' },
              color: tokens.text
            }
          },
          tooltip: {
            backgroundColor: tokens.tooltipBg,
            borderColor: tokens.tooltipBorder,
            borderWidth: 1,
            titleColor: tokens.tooltipTitle,
            bodyColor: tokens.tooltipBody,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => {
                if (!spending.category.hasData) return ' No recorded expenses';
                return ` ${ctx.label}: ${fmtMoney(ctx.raw)}`;
              }
            }
          }
        }
      }
    });
  }

  // B. Spending Velocity (Line)
  const velCanvas = document.getElementById('chartSpendingVelocity');
  if (velCanvas) {
    destroyChart('velocity');
    const ctx = velCanvas.getContext('2d');
    chartInstances.velocity = new Chart(ctx, {
      type: 'line',
      data: spending.velocity.chartData,
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 12,
              font: { size: 11, weight: '600' },
              color: tokens.text
            }
          },
          tooltip: {
            backgroundColor: tokens.tooltipBg,
            borderColor: tokens.tooltipBorder,
            borderWidth: 1,
            titleColor: tokens.tooltipTitle,
            bodyColor: tokens.tooltipBody,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`
            }
          }
        },
        scales: {
          y: {
            grid: { color: tokens.grid },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 },
              callback: (v) => '₹' + v
            }
          },
          x: {
            grid: { display: false },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            }
          }
        }
      }
    });
  }

  // C. Spending Volatility (Bar & Mean Line)
  const volCanvas = document.getElementById('chartSpendingVolatility');
  const volScoreBadge = document.getElementById('volatilityScoreBadge');
  if (volScoreBadge) {
    if (spending.volatility.stabilityScore !== null) {
      volScoreBadge.textContent = `Stability: ${spending.volatility.stabilityScore}/100`;
      volScoreBadge.className = 'inline-flex px-2 py-0.5 text-[10px] font-mono rounded-md border border-[var(--border)] text-[var(--accent)] bg-[var(--surface-subtle)]';
    } else {
      volScoreBadge.textContent = 'Awaiting History';
      volScoreBadge.className = 'inline-flex px-2 py-0.5 text-[10px] font-mono rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--surface-subtle)]';
    }
  }

  if (volCanvas) {
    destroyChart('volatility');
    const ctx = volCanvas.getContext('2d');
    chartInstances.volatility = new Chart(ctx, {
      data: spending.volatility.chartData,
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 12,
              font: { size: 11, weight: '600' },
              color: tokens.text
            }
          },
          tooltip: {
            backgroundColor: tokens.tooltipBg,
            borderColor: tokens.tooltipBorder,
            borderWidth: 1,
            titleColor: tokens.tooltipTitle,
            bodyColor: tokens.tooltipBody,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`
            }
          }
        },
        scales: {
          y: {
            grid: { color: tokens.grid },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 },
              callback: (v) => '₹' + v
            }
          },
          x: {
            grid: { display: false },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            }
          }
        }
      }
    });
  }
}

// ==================================================
// SECTION 4: WALLET INTELLIGENCE
// ==================================================

function renderSectionWalletIntelligence(intel, tokens) {
  const wallet = prepareWalletIntelligenceData(intel, tokens);

  // Distribution Doughnut
  const distCanvas = document.getElementById('chartWalletDistribution');
  const onlineBalEl = document.getElementById('walletOnlineBalanceValue');
  const cashBalEl = document.getElementById('walletCashBalanceValue');
  const onlinePctEl = document.getElementById('walletOnlinePctValue');
  const cashPctEl = document.getElementById('walletCashPctValue');

  if (onlineBalEl) onlineBalEl.textContent = fmtMoney(wallet.distribution.onlineBalance);
  if (cashBalEl) cashBalEl.textContent = fmtMoney(wallet.distribution.cashBalance);
  if (onlinePctEl) onlinePctEl.textContent = `${wallet.distribution.onlinePct}%`;
  if (cashPctEl) cashPctEl.textContent = `${wallet.distribution.cashPct}%`;

  if (distCanvas) {
    destroyChart('walletDist');
    const ctx = distCanvas.getContext('2d');
    chartInstances.walletDist = new Chart(ctx, {
      type: 'doughnut',
      data: wallet.distribution.chartData,
      options: {
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 10,
              font: { size: 11, weight: '600' },
              color: tokens.text
            }
          },
          tooltip: {
            backgroundColor: tokens.tooltipBg,
            borderColor: tokens.tooltipBorder,
            borderWidth: 1,
            titleColor: tokens.tooltipTitle,
            bodyColor: tokens.tooltipBody,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${fmtMoney(ctx.raw)}`
            }
          }
        }
      }
    });
  }

  // Trend Lines
  const trendCanvas = document.getElementById('chartWalletTrends');
  if (trendCanvas) {
    destroyChart('walletTrends');
    const ctx = trendCanvas.getContext('2d');
    chartInstances.walletTrends = new Chart(ctx, {
      type: 'line',
      data: wallet.trend.chartData,
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 12,
              font: { size: 11, weight: '600' },
              color: tokens.text
            }
          },
          tooltip: {
            backgroundColor: tokens.tooltipBg,
            borderColor: tokens.tooltipBorder,
            borderWidth: 1,
            titleColor: tokens.tooltipTitle,
            bodyColor: tokens.tooltipBody,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`
            }
          }
        },
        scales: {
          y: {
            grid: { color: tokens.grid },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 },
              callback: (v) => '₹' + v
            }
          },
          x: {
            grid: { display: false },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            }
          }
        }
      }
    });
  }

  // Utilization Bar
  const utilOnlineSpend = document.getElementById('walletUtilOnlineSpend');
  const utilCashSpend = document.getElementById('walletUtilCashSpend');
  const utilBar = document.getElementById('walletUtilBar');
  if (utilOnlineSpend) utilOnlineSpend.textContent = fmtMoney(wallet.utilization.totalOnlineSpend);
  if (utilCashSpend) utilCashSpend.textContent = fmtMoney(wallet.utilization.totalCashSpend);
  if (utilBar) utilBar.style.width = `${wallet.utilization.onlineRatio}%`;
}

// ==================================================
// SECTION 5: SAVINGS & WEALTH
// ==================================================

function renderSectionSavingsWealth(intel, tokens) {
  const wealth = prepareSavingsWealthData(intel, tokens);

  const liquidEl = document.getElementById('analyticsLiquidBalance');
  const vaultEl = document.getElementById('analyticsVaultBalance');
  const holdingsEl = document.getElementById('analyticsTotalHoldings');

  if (liquidEl) liquidEl.textContent = fmtMoney(wealth.currentLiquid);
  if (vaultEl) vaultEl.textContent = fmtMoney(wealth.currentVault);
  if (holdingsEl) holdingsEl.textContent = fmtMoney(wealth.currentHoldings);

  const canvas = document.getElementById('chartNetHoldings');
  if (!canvas) return;
  destroyChart('holdings');

  const ctx = canvas.getContext('2d');
  chartInstances.holdings = new Chart(ctx, {
    type: 'line',
    data: wealth.chartData,
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10,
            padding: 14,
            font: { size: 11, weight: '600' },
            color: tokens.text
          }
        },
        tooltip: {
          backgroundColor: tokens.tooltipBg,
          borderColor: tokens.tooltipBorder,
          borderWidth: 1,
          titleColor: tokens.tooltipTitle,
          bodyColor: tokens.tooltipBody,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`
          }
        }
      },
      scales: {
        y: {
          grid: { color: tokens.grid },
          ticks: {
            color: tokens.textMuted,
            font: { size: 10 },
            callback: (v) => '₹' + v
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            color: tokens.textMuted,
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          }
        }
      }
    }
  });
}

// ==================================================
// SECTION 6: HISTORICAL PATTERNS
// ==================================================

function renderSectionHistoricalPatterns(intel, transactions, vaultRecords, tokens) {
  const reconciledLedger = intel?.reconciledLedger;
  const fp = prepareHistoricalFingerprintData(transactions, vaultRecords, reconciledLedger, tokens);

  const canvas = document.getElementById('chartHistoricalFingerprint');
  if (canvas) {
    destroyChart('historical');
    const ctx = canvas.getContext('2d');
    chartInstances.historical = new Chart(ctx, {
      type: 'bar',
      data: fp.chartData,
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 12,
              font: { size: 11, weight: '600' },
              color: tokens.text
            }
          },
          tooltip: {
            backgroundColor: tokens.tooltipBg,
            borderColor: tokens.tooltipBorder,
            borderWidth: 1,
            titleColor: tokens.tooltipTitle,
            bodyColor: tokens.tooltipBody,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`
            }
          }
        },
        scales: {
          y: {
            grid: { color: tokens.grid },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 },
              callback: (v) => '₹' + v
            }
          },
          x: {
            grid: { display: false },
            ticks: {
              color: tokens.textMuted,
              font: { size: 10 }
            }
          }
        }
      }
    });
  }

  // Render Spending Density Calendar Heatmap
  renderExpenseHeatmap(transactions);
}

// ==================================================
// CONTROLS & LISTENERS
// ==================================================

export function initChartsControls() {
  if (hasInitializedListeners) return;
  hasInitializedListeners = true;

  // Window selector buttons click handler
  document.querySelectorAll('[data-analytics-window]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetWindow = btn.getAttribute('data-analytics-window');
      if (targetWindow && targetWindow !== activeWindowKey) {
        activeWindowKey = targetWindow;
        renderCharts(cachedTxs, activeWindowKey);
      }
    });
  });

  // Theme change listener
  events.on('theme:change', () => {
    renderCharts(cachedTxs, activeWindowKey);
  });
}

/**
 * Toggles privacy blurring on sensitive charts and financial values
 */
export function updateChartsPrivacyMask() {
  const chartCanvases = [
    'chartFinancialDNA',
    'chartCashFlow',
    'lineChart',
    'chartCategorySpend',
    'pieChart',
    'chartSpendingVelocity',
    'chartSpendingVolatility',
    'chartWalletDistribution',
    'chartWalletTrends',
    'chartNetHoldings',
    'chartHistoricalFingerprint'
  ];

  chartCanvases.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!state.sessionUnlocked) {
      el.classList.add('blur-md', 'select-none', 'pointer-events-none');
    } else {
      el.classList.remove('blur-md', 'select-none', 'pointer-events-none');
    }
  });

  // Also toggle text elements with privacy sensitive amounts
  const privacyTextIds = [
    'cashFlowTotalInflow',
    'cashFlowTotalExpense',
    'cashFlowNetPosition',
    'categorySpendTotal',
    'walletOnlineBalanceValue',
    'walletCashBalanceValue',
    'walletUtilOnlineSpend',
    'walletUtilCashSpend',
    'analyticsLiquidBalance',
    'analyticsVaultBalance',
    'analyticsTotalHoldings'
  ];

  privacyTextIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!state.sessionUnlocked) {
      el.classList.add('blur-xs', 'select-none');
    } else {
      el.classList.remove('blur-xs', 'select-none');
    }
  });
}
