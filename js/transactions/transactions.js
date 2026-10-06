// Core Transactions, Balances & Ledger Controller
import { state, LS, safeStorage, money } from '../core/state.js';
import { events } from '../core/events.js';
import { round, escapeHtml } from '../utils/utils.js';
import { getIcon, getCategoryIcon } from '../ui/icons.js';
import { renderAnalysis } from '../analytics/analytics.js';
import { renderCharts } from '../charts/charts.js';
import { getStoredHash, openCreatePasswordModal, openUnlockModal } from '../auth/auth.js';
import { reconcileVirtualLedger } from '../financial/ledger.js';
import { getVaultSavings, calculateVaultBalance, calculateHoldingsSummary } from '../vault/vault.js';
import { showToast } from '../ui/toast.js';
import {
  getAllowanceConfig,
  saveAllowanceConfig,
  createAllowanceConfig,
  getStartingBalances,
  saveStartingBalances,
  getDaysInMonth,
  getDailyAllocation
} from '../financial/allowance.js';
import { WALLET_TYPES } from '../financial/wallets.js';

export const EXPENSE_CATEGORIES = [
  'Food & Dining',
  'Shopping',
  'Transport',
  'Entertainment',
  'Bills',
  'Health',
  'Study Material',
  'Other'
];

export const INCOME_CATEGORIES = [
  'Allowance / Pocket Money',
  'Salary / Internship',
  'Freelance',
  'Gift',
  'Refund',
  'Other Income'
];

let currentRecentFilter = 'all';

export function getReconciledLedgerState() {
  const txs = getTxs();
  const allowanceConfig = getAllowanceConfig();
  const startingBalances = getStartingBalances();
  const vaultTransactions = getVaultSavings();
  return reconcileVirtualLedger({
    transactions: txs,
    allowanceConfig,
    initialBalances: startingBalances,
    vaultTransactions
  });
}

export function getBalances() {
  const ledgerState = getReconciledLedgerState();
  return {
    cash: round(ledgerState.wallets.cash),
    online: round(ledgerState.wallets.online)
  };
}

export function getHoldingsSummary() {
  const balances = getBalances();
  const vaultRecords = getVaultSavings();
  const vaultBalance = calculateVaultBalance(vaultRecords);
  return calculateHoldingsSummary(balances.online, balances.cash, vaultBalance);
}

export function generateTransactionId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `tx_${hex}`;
  }
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function saveBalances(b) {
  try {
    const currentReconciled = getBalances();
    const deltaCash = (Number(b?.cash) || 0) - currentReconciled.cash;
    const deltaOnline = (Number(b?.online) || 0) - currentReconciled.online;
    const currentStart = getStartingBalances();
    saveStartingBalances({
      cash: round(currentStart.cash + deltaCash),
      online: round(currentStart.online + deltaOnline)
    });
    safeStorage.setItem(LS.balances, JSON.stringify(b));
  } catch (e) {}
  renderBalances();
  events.emit('balances:change', b);
}

export function getTxs() {
  try {
    const raw = safeStorage.getItem(LS.transactions);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(t => {
      if (!t || typeof t !== 'object') return null;

      let safeDate = new Date().toISOString();
      if (t.date) {
        try {
          const d = new Date(t.date);
          if (!isNaN(d.getTime())) {
            safeDate = d.toISOString();
          }
        } catch (err) {}
      }

      return {
        id: String(t.id || generateTransactionId()),
        type: String(t.type || 'expense').toLowerCase() === 'income' ? 'income' : 'expense',
        amount: Math.abs(Number(t.amount)) || 0,
        category: String(t.category || 'Other'),
        method: String(t.method || 'Cash') === 'Online' ? 'Online' : 'Cash',
        desc: String(t.desc || ''),
        date: safeDate
      };
    }).filter(Boolean);
  } catch (e) {
    console.error('Error parsing transactions:', e);
    return [];
  }
}

export function saveTxs(arr) {
  try {
    safeStorage.setItem(LS.transactions, JSON.stringify(arr));
  } catch (e) {}
  events.emit('transactions:change', arr);

  // Trigger non-blocking cloud sync and offline mutation queue if authenticated
  try {
    import('../sync/queue.js').then(q => {
      q.enqueueMutation('SYNC_TRANSACTIONS', { count: arr.length });
    }).catch(() => {});
    import('../firebase/sync.js').then(m => m.syncWorkspaceToCloud('transactions_change')).catch(() => {});
  } catch (syncErr) {}
}

export function getMonthlyBudget() {
  try {
    return Number(safeStorage.getItem(LS.budget) || 0);
  } catch (e) {
    return 0;
  }
}

export function saveMonthlyBudget(val) {
  try {
    safeStorage.setItem(LS.budget, Number(val));
  } catch (e) {}
  refreshAllViews();
}

export function renderBalances() {
  const ledgerState = getReconciledLedgerState();
  const { wallets, dailyRates, recovery, activeConfig } = ledgerState;

  const cashEl = document.getElementById('cashAmt');
  const onlineEl = document.getElementById('onlineAmt');
  const totalEl = document.getElementById('totalAmt');

  if (cashEl) {
    cashEl.textContent = money(wallets.cash);
    if (wallets.isCashNegative) {
      cashEl.classList.add('text-[var(--danger)]');
      cashEl.classList.remove('text-[var(--text-primary)]');
    } else {
      cashEl.classList.remove('text-[var(--danger)]');
      cashEl.classList.add('text-[var(--text-primary)]');
    }
  }

  if (onlineEl) {
    onlineEl.textContent = money(wallets.online);
    if (wallets.isOnlineNegative) {
      onlineEl.classList.add('text-[var(--danger)]');
      onlineEl.classList.remove('text-[var(--text-primary)]');
    } else {
      onlineEl.classList.remove('text-[var(--danger)]');
      onlineEl.classList.add('text-[var(--text-primary)]');
    }
  }

  if (totalEl) {
    totalEl.textContent = money(wallets.total);
    if (wallets.isTotalNegative) {
      totalEl.classList.add('text-[var(--danger)]');
      totalEl.classList.remove('text-[var(--text-primary)]');
    } else {
      totalEl.classList.remove('text-[var(--danger)]');
      totalEl.classList.add('text-[var(--text-primary)]');
    }
  }

  // Update Holdings summary on dashboard (Online + Cash + Vault)
  try {
    const holdings = getHoldingsSummary();
    const dashVault = document.getElementById('dashboardVaultAmt');
    const dashHoldings = document.getElementById('dashboardHoldingsAmt');
    if (dashVault) {
      dashVault.textContent = money(holdings.vaultBalance);
    }
    if (dashHoldings) {
      dashHoldings.textContent = money(holdings.totalHoldings);
    }
  } catch (e) {}

  // Update allocation badges and deficit recovery notices
  const cashBadge = document.getElementById('cashRateBadge');
  const onlineBadge = document.getElementById('onlineRateBadge');
  const totalBadge = document.getElementById('allowanceTotalBadge');
  const cashRecovery = document.getElementById('cashRecoveryNotice');
  const onlineRecovery = document.getElementById('onlineRecoveryNotice');
  const totalNotice = document.getElementById('totalStatusNotice');

  if (cashBadge) {
    if (activeConfig && activeConfig.monthlyCashAllowance > 0) {
      cashBadge.textContent = `+₹${round(dailyRates.cash)}/day`;
      cashBadge.classList.remove('hidden');
    } else {
      cashBadge.classList.add('hidden');
    }
  }

  if (onlineBadge) {
    if (activeConfig && activeConfig.monthlyOnlineAllowance > 0) {
      onlineBadge.textContent = `+₹${round(dailyRates.online)}/day`;
      onlineBadge.classList.remove('hidden');
    } else {
      onlineBadge.classList.add('hidden');
    }
  }

  if (totalBadge) {
    if (activeConfig && activeConfig.totalMonthlyAllowance > 0) {
      totalBadge.textContent = `₹${activeConfig.totalMonthlyAllowance}/mo`;
      totalBadge.classList.remove('hidden');
    } else {
      totalBadge.classList.add('hidden');
    }
  }

  if (cashRecovery) {
    if (wallets.isCashNegative) {
      const recDays = recovery.cash.recoveryDays;
      const recText = recDays 
        ? `Deficit: ₹${round(recovery.cash.deficit)} • ~${recDays}d recovery`
        : `Deficit: ₹${round(recovery.cash.deficit)}`;
      cashRecovery.innerHTML = `<span class="inline-flex items-center gap-1">${getIcon('warning', { size: 'w-3 h-3', className: 'text-[var(--expense)]' })} ${recText}</span>`;
      cashRecovery.classList.remove('hidden');
    } else {
      cashRecovery.innerHTML = '';
    }
  }

  if (onlineRecovery) {
    if (wallets.isOnlineNegative) {
      const recDays = recovery.online.recoveryDays;
      const recText = recDays 
        ? `Deficit: ₹${round(recovery.online.deficit)} • ~${recDays}d recovery`
        : `Deficit: ₹${round(recovery.online.deficit)}`;
      onlineRecovery.innerHTML = `<span class="inline-flex items-center gap-1">${getIcon('warning', { size: 'w-3 h-3', className: 'text-[var(--expense)]' })} ${recText}</span>`;
      onlineRecovery.classList.remove('hidden');
    } else {
      onlineRecovery.innerHTML = '';
    }
  }

  if (totalNotice) {
    if (wallets.isTotalNegative) {
      totalNotice.textContent = 'Net Virtual Deficit';
      totalNotice.className = 'text-[10px] font-bold text-[var(--danger)] mt-1 min-h-[14px]';
    } else {
      totalNotice.textContent = 'Liquid Virtual Total';
      totalNotice.className = 'text-[10px] font-medium text-[var(--text-muted)] mt-1 min-h-[14px]';
    }
  }

  // Dynamic Deficit Recovery Banner
  const deficitBanner = document.getElementById('deficitRecoveryBanner');
  if (deficitBanner) {
    if (wallets.isOnlineNegative || wallets.isCashNegative) {
      let bannerHtml = '';
      if (wallets.isOnlineNegative) {
        const days = recovery.online.recoveryDays;
        const daysText = days ? `${days} day${days === 1 ? '' : 's'}` : 'Allocation paused';
        bannerHtml += `
          <div class="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--warning-bg)] border border-[var(--warning)]">
            <div class="p-1 rounded-lg bg-[var(--warning)]/15 text-[var(--warning)] shrink-0">
              ${getIcon('warning', { size: 'w-5 h-5' })}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="font-bold text-xs text-[var(--warning)] uppercase tracking-wide">ONLINE WALLET DEFICIT</span>
                <span class="font-bold font-mono text-sm text-[var(--danger)]">-₹${round(recovery.online.deficit)}</span>
              </div>
              <p class="text-xs text-[var(--text-primary)] mt-0.5">Estimated recovery in <strong class="font-bold text-[var(--warning)]">${daysText}</strong>.</p>
              <p class="text-[10px] text-[var(--text-muted)] mt-1">Assuming no additional spending and daily allocation continues. Virtual allocations proceed automatically; transactions are not blocked.</p>
            </div>
          </div>
        `;
      }
      if (wallets.isCashNegative) {
        const days = recovery.cash.recoveryDays;
        const daysText = days ? `${days} day${days === 1 ? '' : 's'}` : 'Allocation paused';
        bannerHtml += `
          <div class="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--warning-bg)] border border-[var(--warning)]">
            <div class="p-1 rounded-lg bg-[var(--warning)]/15 text-[var(--warning)] shrink-0">
              ${getIcon('warning', { size: 'w-5 h-5' })}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="font-bold text-xs text-[var(--warning)] uppercase tracking-wide">CASH WALLET DEFICIT</span>
                <span class="font-bold font-mono text-sm text-[var(--danger)]">-₹${round(recovery.cash.deficit)}</span>
              </div>
              <p class="text-xs text-[var(--text-primary)] mt-0.5">Estimated recovery in <strong class="font-bold text-[var(--warning)]">${daysText}</strong>.</p>
              <p class="text-[10px] text-[var(--text-muted)] mt-1">Assuming no additional spending and daily allocation continues. Virtual allocations proceed automatically; transactions are not blocked.</p>
            </div>
          </div>
        `;
      }
      deficitBanner.innerHTML = bannerHtml;
      deficitBanner.classList.remove('hidden');
    } else {
      deficitBanner.innerHTML = '';
      deficitBanner.classList.add('hidden');
    }
  }

  // Update Allowance Architecture Summary Card
  const onSummary = document.getElementById('allowanceOnlineSummary');
  const cashSummary = document.getElementById('allowanceCashSummary');
  const onRate = document.getElementById('allowanceOnlineDailyRate');
  const cashRate = document.getElementById('allowanceCashDailyRate');

  if (onSummary && activeConfig) {
    onSummary.textContent = `₹${round(activeConfig.monthlyOnlineAllowance)} / month`;
  }
  if (cashSummary && activeConfig) {
    cashSummary.textContent = `₹${round(activeConfig.monthlyCashAllowance)} / month`;
  }
  if (onRate) {
    onRate.textContent = `+₹${round(dailyRates.online)} / day`;
  }
  if (cashRate) {
    cashRate.textContent = `+₹${round(dailyRates.cash)} / day`;
  }
}

export function applyTxToBalances(tx, reverse = false) {
  // Maintained for backward compatibility. Authoritative balance is reconciled by ledger.
}

export function addTransaction(tx) {
  const txs = getTxs();
  txs.push(tx);
  saveTxs(txs);
  refreshAllViews();
  if (typeof showToast === 'function') {
    const isExpense = tx.type === 'expense';
    showToast(`${isExpense ? 'Expense logged: −₹' : 'Income logged: +₹'}${round(tx.amount)}`, 'success');
  }
}

export function deleteTransaction(id) {
  const txs = getTxs();
  const idx = txs.findIndex(t => t.id === id);
  if (idx === -1) return;
  txs.splice(idx, 1);
  saveTxs(txs);
  refreshAllViews();
  if (typeof showToast === 'function') {
    showToast('Transaction removed from virtual ledger', 'info');
  }
}

export function refreshAllViews() {
  const txs = getTxs();
  const budget = getMonthlyBudget();
  renderBalances();
  renderRecent();
  renderAnalysis(txs, budget, (suggested) => {
    saveMonthlyBudget(suggested);
  });
  renderOverview(state.currentRange);
}

export function renderRecent(filter = currentRecentFilter) {
  currentRecentFilter = filter;

  // Update filter segmented control styling
  document.querySelectorAll('#recentTxFilters button').forEach(b => {
    if (b.dataset.filter === filter) {
      b.className = "sanchoy-segmented-item active text-[10px] sm:text-xs font-bold";
    } else {
      b.className = "sanchoy-segmented-item text-[10px] sm:text-xs font-semibold";
    }
  });

  const el = document.getElementById('recentTx');
  if (!el) return;

  if (filter === 'allocations') {
    // Show reconciled ledger events, both manual transactions and automatic daily allocations
    const ledgerState = getReconciledLedgerState();
    const events = (ledgerState.events || []).slice().reverse();

    if (!events.length) {
      el.innerHTML = '<div class="text-xs text-[var(--text-muted)] py-8 text-center font-medium">No ledger activity found.</div>';
      return;
    }

    el.innerHTML = '';
    events.slice(0, 50).forEach(ev => {
      const isAlloc = ev.type === 'ALLOCATION';
      const isExpense = ev.type === 'EXPENSE';
      const node = document.createElement('div');
      node.className = "flex justify-between items-center p-3 sm:p-3.5 rounded-xl sanchoy-card hover:translate-y-[-1px] transition-all duration-200 gap-3 border border-[var(--border-subtle)] hover:border-[var(--border)]";

      if (isAlloc) {
        node.innerHTML = `
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
              ${getIcon('lightning', { size: 'w-4 h-4' })}
            </div>
            <div class="min-w-0">
              <h4 class="font-bold text-[var(--text-primary)] text-xs truncate">Automatic Daily Allocation</h4>
              <span class="text-[10px] text-[var(--text-muted)] block mt-0.5">${ev.date} · ${ev.wallet === 'online' ? 'Online Wallet' : 'Cash Wallet'}</span>
            </div>
          </div>
          <div class="flex flex-col items-end gap-0.5 shrink-0">
            <span class="font-bold font-mono tabular-nums text-xs sm:text-sm text-[var(--accent)]">
              +${money(ev.amount)}
            </span>
            <span class="text-[9px] font-bold text-[var(--accent)] sanchoy-surface-inset px-1.5 py-0.5 rounded font-mono">Engine</span>
          </div>
        `;
      } else {
        const d = new Date(ev.date);
        node.innerHTML = `
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg sanchoy-surface-inset text-[var(--text-secondary)] flex items-center justify-center shrink-0">
              ${getCategoryIcon(ev.category, isExpense, { size: 'w-4 h-4' })}
            </div>
            <div class="min-w-0">
              <h4 class="font-bold text-[var(--text-primary)] text-xs truncate max-w-[140px] sm:max-w-[200px]">${escapeHtml(ev.desc || (isExpense ? 'Expense' : 'Income'))}</h4>
              <div class="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                <span>${escapeHtml(ev.category || 'Manual')}</span>
                <span>·</span>
                <span>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1 shrink-0">
            <span class="font-bold font-mono tabular-nums text-xs sm:text-sm ${isExpense ? 'text-[var(--expense)]' : 'text-[var(--income)]'}">
              ${isExpense ? '−' : '+'}${money(ev.amount)}
            </span>
            <div class="flex items-center gap-1.5">
              <span class="text-[9px] font-semibold text-[var(--text-muted)] sanchoy-surface-inset px-1.5 py-0.5 rounded">${ev.wallet === 'online' ? 'Online' : 'Cash'}</span>
              <button class="sanchoy-btn sanchoy-btn-secondary text-[10px] py-0.5 px-2" data-id="${ev.referenceId}">Edit</button>
              <button class="sanchoy-btn sanchoy-btn-ghost text-[10px] py-0.5 px-2 text-[var(--danger)] hover:bg-[var(--expense-bg)]" data-del="${ev.referenceId}">Del</button>
            </div>
          </div>
        `;
      }
      el.appendChild(node);
    });

    el.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => openEditModal(b.dataset.id)));
    el.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', () => openDeleteConfirmModal(b.dataset.del)));
    return;
  }

  // Filter user transactions
  let txs = getTxs().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (filter === 'expense') {
    txs = txs.filter(t => t.type === 'expense');
  } else if (filter === 'income') {
    txs = txs.filter(t => t.type === 'income');
  }

  if (!txs.length) {
    el.innerHTML = '<div class="text-xs text-[var(--text-muted)] py-8 text-center font-medium">No transactions found. Click + to record your first entry.</div>';
    return;
  }

  el.innerHTML = '';
  txs.slice(0, 50).forEach(tx => {
    const isExpense = tx.type === 'expense';
    const d = new Date(tx.date);
    const node = document.createElement('div');
    node.className = "flex justify-between items-center py-2.5 px-3 sm:px-3.5 rounded-xl sanchoy-card hover:translate-y-[-1px] transition-all duration-200 gap-3 border border-[var(--border-subtle)] hover:border-[var(--border)]";
    node.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-8 h-8 rounded-lg sanchoy-surface-inset text-[var(--text-secondary)] flex items-center justify-center shrink-0">
          ${getCategoryIcon(tx.category, isExpense, { size: 'w-4 h-4' })}
        </div>
        <div class="min-w-0">
          <h4 class="font-bold text-[var(--text-primary)] text-xs truncate max-w-[140px] sm:max-w-[220px] leading-tight">${escapeHtml(tx.desc || (isExpense ? 'Expense' : 'Income'))}</h4>
          <div class="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5 leading-none">
            <span>${escapeHtml(tx.category)}</span>
            <span>·</span>
            <span>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1 shrink-0">
        <span class="font-extrabold font-mono tabular-nums text-xs sm:text-sm tracking-tight ${isExpense ? 'text-[var(--expense)]' : 'text-[var(--income)]'}">
          ${isExpense ? '−' : '+'}${money(tx.amount)}
        </span>
        <div class="flex items-center gap-1">
          <span class="text-[9px] font-semibold text-[var(--text-muted)] sanchoy-surface-inset px-1.5 py-0.5 rounded leading-none">${tx.method}</span>
          <button class="sanchoy-btn sanchoy-btn-secondary text-[10px] py-0.5 px-1.5 leading-none" data-id="${tx.id}">Edit</button>
          <button class="sanchoy-btn sanchoy-btn-ghost text-[10px] py-0.5 px-1.5 leading-none text-[var(--danger)] hover:bg-[var(--expense-bg)]" data-del="${tx.id}">Del</button>
        </div>
      </div>
    `;
    el.appendChild(node);
  });

  el.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => openEditModal(b.dataset.id)));
  el.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', () => openDeleteConfirmModal(b.dataset.del)));
}

export function renderOverview(range = 'daily') {
  state.currentRange = range;
  const content = document.getElementById('overviewContent');
  if (!content) return;
  const txs = getTxs();
  content.innerHTML = '';

  if (range === 'daily') {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    days.forEach(d => {
      const key = d.toISOString().slice(0, 10);
      const dayTotals = txs.filter(t => t.date.slice(0, 10) === key).reduce((acc, t) => {
        if (t.type === 'expense') acc.exp += Number(t.amount);
        else acc.inc += Number(t.amount);
        return acc;
      }, { exp: 0, inc: 0 });

      const node = document.createElement('div');
      node.className = "flex justify-between items-center sanchoy-card p-3 sm:p-3.5 rounded-xl gap-4 border border-[var(--border-subtle)] hover:border-[var(--border)] transition-colors";
      node.innerHTML = `
        <div class="flex-1 min-w-0">
          <span class="font-bold text-[var(--text-primary)] text-xs sm:text-sm block">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <div class="w-full h-1.5 rounded-full mt-2 overflow-hidden sanchoy-surface-inset">
            <div class="bg-[var(--accent)] h-full rounded-full transition-all duration-500" style="width: ${Math.min(((dayTotals.inc + dayTotals.exp) / 2000) * 100, 100)}%"></div>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[var(--expense)] font-bold font-mono tabular-nums text-xs sm:text-sm">−${money(dayTotals.exp)}</div>
          <div class="text-[var(--income)] font-bold font-mono tabular-nums text-[10px] sm:text-xs mt-0.5">+${money(dayTotals.inc)}</div>
        </div>
      `;
      content.appendChild(node);
    });
  } else if (range === 'weekly') {
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const weekTotals = txs.filter(t => {
        const diff = Math.floor((now - new Date(t.date)) / (1000 * 60 * 60 * 24));
        return diff >= i * 7 && diff < (i + 1) * 7;
      }).reduce((acc, t) => {
        if (t.type === 'expense') acc.exp += Number(t.amount);
        else acc.inc += Number(t.amount);
        return acc;
      }, { exp: 0, inc: 0 });

      const node = document.createElement('div');
      node.className = "flex justify-between items-center sanchoy-card p-3 sm:p-3.5 rounded-xl gap-4 border border-[var(--border-subtle)] hover:border-[var(--border)] transition-colors";
      node.innerHTML = `
        <div class="flex-1 min-w-0">
          <span class="font-bold text-[var(--text-primary)] text-xs sm:text-sm block">Week ${8 - i}</span>
          <div class="w-full h-1.5 rounded-full mt-2 overflow-hidden sanchoy-surface-inset">
            <div class="bg-[var(--accent)] h-full rounded-full transition-all duration-500" style="width: ${Math.min(((weekTotals.inc + weekTotals.exp) / 10000) * 100, 100)}%"></div>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[var(--expense)] font-bold font-mono tabular-nums text-xs sm:text-sm">−${money(weekTotals.exp)}</div>
          <div class="text-[var(--income)] font-bold font-mono tabular-nums text-[10px] sm:text-xs mt-0.5">+${money(weekTotals.inc)}</div>
        </div>
      `;
      content.appendChild(node);
    }
  } else if (range === 'monthly') {
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = m.getMonth();
      const year = m.getFullYear();
      const totals = txs.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === month && d.getFullYear() === year;
      }).reduce((acc, t) => {
        if (t.type === 'expense') acc.exp += Number(t.amount);
        else acc.inc += Number(t.amount);
        return acc;
      }, { exp: 0, inc: 0 });

      const node = document.createElement('div');
      node.className = "flex justify-between items-center sanchoy-card p-3 sm:p-3.5 rounded-xl gap-4 border border-[var(--border-subtle)] hover:border-[var(--border)] transition-colors";
      node.innerHTML = `
        <div class="flex-1 min-w-0">
          <span class="font-bold text-[var(--text-primary)] text-xs sm:text-sm block">${m.toLocaleString(undefined, { month: 'short', year: 'numeric' })}</span>
          <div class="w-full h-1.5 rounded-full mt-2 overflow-hidden sanchoy-surface-inset">
            <div class="bg-[var(--accent)] h-full rounded-full transition-all duration-500" style="width: ${Math.min(((totals.inc + totals.exp) / 30000) * 100, 100)}%"></div>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[var(--expense)] font-bold font-mono tabular-nums text-xs sm:text-sm">−${money(totals.exp)}</div>
          <div class="text-[var(--income)] font-bold font-mono tabular-nums text-[10px] sm:text-xs mt-0.5">+${money(totals.inc)}</div>
        </div>
      `;
      content.appendChild(node);
    }
  } else {
    const now = new Date();
    for (let i = 3; i >= 0; i--) {
      const y = now.getFullYear() - i;
      const totals = txs.filter(t => {
        const d = new Date(t.date);
        return d.getFullYear() === y;
      }).reduce((acc, t) => {
        if (t.type === 'expense') acc.exp += Number(t.amount);
        else acc.inc += Number(t.amount);
        return acc;
      }, { exp: 0, inc: 0 });

      const node = document.createElement('div');
      node.className = "flex justify-between items-center sanchoy-card p-3 sm:p-3.5 rounded-xl gap-4 border border-[var(--border-subtle)] hover:border-[var(--border)] transition-colors";
      node.innerHTML = `
        <div class="flex-1 min-w-0">
          <span class="font-bold text-[var(--text-primary)] text-xs sm:text-sm block">${y}</span>
          <div class="w-full h-1.5 rounded-full mt-2 overflow-hidden sanchoy-surface-inset">
            <div class="bg-[var(--accent)] h-full rounded-full transition-all duration-500" style="width: ${Math.min(((totals.inc + totals.exp) / 120000) * 100, 100)}%"></div>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[var(--expense)] font-bold font-mono tabular-nums text-xs sm:text-sm">−${money(totals.exp)}</div>
          <div class="text-[var(--income)] font-bold font-mono tabular-nums text-[10px] sm:text-xs mt-0.5">+${money(totals.inc)}</div>
        </div>
      `;
      content.appendChild(node);
    }
  }
}

export function openDeleteConfirmModal(id) {
  const txs = getTxs();
  const tx = txs.find(t => t.id === id);
  if (!tx) return;

  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  const isExpense = tx.type === 'expense';
  content.innerHTML = `
    <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3 mb-4">
      <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-serif-editorial">Delete Transaction</h3>
      <button id="closeDelModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="space-y-4">
      <div class="p-4 rounded-xl neu-inset bg-[var(--expense-bg)] border border-[var(--expense-border)]">
        <p class="text-xs text-[var(--text-primary)] leading-relaxed">
          Are you sure you want to delete this <strong class="${isExpense ? 'text-[var(--expense)]' : 'text-[var(--income)]'} font-black">${isExpense ? 'Expense' : 'Income'}</strong> record?
        </p>
        <div class="mt-2.5 flex items-center justify-between text-xs">
          <span class="font-bold text-[var(--text-primary)] truncate max-w-[180px]">${escapeHtml(tx.desc || tx.category)}</span>
          <span class="font-extrabold font-mono ${isExpense ? 'text-[var(--expense)]' : 'text-[var(--income)]'}">
            ${isExpense ? '−' : '+'}${money(tx.amount)}
          </span>
        </div>
        <div class="text-[10px] text-[var(--text-muted)] mt-1 flex gap-2">
          <span>${tx.method} Wallet</span>
          <span>•</span>
          <span>${new Date(tx.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>
      <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
        Deleting this transaction will immediately reverse its effect on your ${tx.method} Wallet in the virtual ledger.
      </p>
      <div class="flex gap-2 pt-2">
        <button id="confirmDelBtn" type="button" class="flex-1 py-2.5 px-4 neu-btn-danger text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer">
          Yes, Delete Record
        </button>
        <button id="cancelDelBtn" type="button" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  modal.style.display = 'flex';

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  document.getElementById('closeDelModal').addEventListener('click', hide);
  document.getElementById('cancelDelBtn').addEventListener('click', hide);
  document.getElementById('confirmDelBtn').addEventListener('click', () => {
    deleteTransaction(id);
    hide();
  });
}

export function openNewTransactionModal(initialType = 'expense') {
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  let currentType = initialType === 'income' ? 'income' : 'expense';

  const renderContent = () => {
    const isExpense = currentType === 'expense';
    const categories = isExpense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const todayStr = new Date().toISOString().slice(0, 10);

    content.innerHTML = `
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3 mb-4">
        <div>
          <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-serif-editorial">New Transaction</h3>
          <p class="text-[11px] text-[var(--text-muted)] mt-0.5">Record a virtual ledger entry for your wallets</p>
        </div>
        <button id="closeNewTxModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="space-y-4">
        <!-- Error Alert Container -->
        <div id="newTxModalError" class="hidden p-2.5 rounded-xl bg-[var(--expense-bg)] border border-[var(--expense-border)] text-xs font-bold text-[var(--expense)]"></div>

        <!-- Type Selector -->
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">Transaction Type</label>
          <div class="grid grid-cols-2 gap-2 neu-inset p-1 rounded-xl">
            <button id="btnSelectExpense" type="button" class="py-2 px-3 rounded-lg font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 ${isExpense ? 'bg-rose-500 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}">
              <span class="text-sm font-black">−</span> Expense
            </button>
            <button id="btnSelectIncome" type="button" class="py-2 px-3 rounded-lg font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 ${!isExpense ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}">
              <span class="text-sm font-black">+</span> Income
            </button>
          </div>
        </div>

        <!-- Amount and Date -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Amount (₹) *</label>
            <div class="relative">
              <span class="absolute left-3 top-2.5 text-xs font-black ${isExpense ? 'text-[var(--expense)]' : 'text-[var(--income)]'}">${isExpense ? '−₹' : '+₹'}</span>
              <input id="modalTxAmount" type="number" step="0.01" min="0.01" placeholder="0.00" class="neu-input w-full pl-9 pr-3 py-2.5 text-xs font-black text-[var(--text-primary)]" autofocus />
            </div>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Date *</label>
            <input id="modalTxDate" type="date" value="${todayStr}" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)]" />
          </div>
        </div>

        <!-- Category and Wallet -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Category *</label>
            <select id="modalTxCategory" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)] font-semibold">
              ${categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Target Virtual Wallet *</label>
            <select id="modalTxWallet" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)] font-semibold">
              <option value="Online">Online Wallet</option>
              <option value="Cash">Cash Wallet</option>
            </select>
          </div>
        </div>

        <!-- Description Note -->
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Description / Note <span class="text-[var(--text-muted)] font-normal">(Optional)</span></label>
          <input id="modalTxDesc" type="text" placeholder="${isExpense ? 'E.g., Groceries, Coffee, Uber ride...' : 'E.g., Monthly allowance, Project bonus, Gift...'}" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)]" />
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2 pt-2">
          <button id="modalSaveTxBtn" type="button" class="flex-1 py-2.5 px-4 ${isExpense ? 'neu-btn-danger' : 'neu-btn-primary'} text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer">
            ${isExpense ? 'Save Expense' : 'Save Income'}
          </button>
          <button id="modalCancelTxBtn" type="button" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    `;

    // Wire up modal events
    document.getElementById('closeNewTxModal').addEventListener('click', hide);
    document.getElementById('modalCancelTxBtn').addEventListener('click', hide);

    document.getElementById('btnSelectExpense').addEventListener('click', () => {
      currentType = 'expense';
      renderContent();
    });

    document.getElementById('btnSelectIncome').addEventListener('click', () => {
      currentType = 'income';
      renderContent();
    });

    document.getElementById('modalSaveTxBtn').addEventListener('click', () => {
      const errBox = document.getElementById('newTxModalError');
      const amountVal = parseFloat(document.getElementById('modalTxAmount').value || 0);
      const dateVal = document.getElementById('modalTxDate').value;
      const categoryVal = document.getElementById('modalTxCategory').value;
      const walletVal = document.getElementById('modalTxWallet').value;
      const descVal = document.getElementById('modalTxDesc').value || '';

      if (!amountVal || isNaN(amountVal) || amountVal <= 0) {
        errBox.textContent = 'Please enter a valid amount greater than 0.';
        errBox.classList.remove('hidden');
        document.getElementById('modalTxAmount').focus();
        return;
      }

      if (!dateVal) {
        errBox.textContent = 'Please select a valid date.';
        errBox.classList.remove('hidden');
        return;
      }

      const tx = {
        id: 't_' + Date.now(),
        type: currentType,
        amount: round(amountVal),
        category: categoryVal,
        method: walletVal === 'Online' ? 'Online' : 'Cash',
        desc: descVal.trim(),
        date: new Date(dateVal).toISOString()
      };

      addTransaction(tx);
      hide();
    });
  };

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  modal.classList.add('show');
  modal.style.display = 'flex';
  renderContent();
}

export function openEditModal(id) {
  const txs = getTxs();
  const tx = txs.find(t => t.id === id);
  if (!tx) return;

  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  let currentType = tx.type === 'income' ? 'income' : 'expense';

  const renderContent = () => {
    const isExpense = currentType === 'expense';
    const baseCats = isExpense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    // Preserve custom or historical category if not in baseCats
    const categories = baseCats.includes(tx.category) ? baseCats : [tx.category, ...baseCats];
    const txDateStr = new Date(tx.date).toISOString().slice(0, 10);

    content.innerHTML = `
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3 mb-4">
        <div>
          <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-serif-editorial">Edit Transaction</h3>
          <p class="text-[11px] text-[var(--text-muted)] mt-0.5">Modifications instantly reconcile the virtual ledger</p>
        </div>
        <button id="closeEditModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="space-y-4">
        <div id="editTxModalError" class="hidden p-2.5 rounded-xl bg-[var(--expense-bg)] border border-[var(--expense-border)] text-xs font-bold text-[var(--expense)]"></div>

        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">Type</label>
          <div class="grid grid-cols-2 gap-2 neu-inset p-1 rounded-xl">
            <button id="editBtnExpense" type="button" class="py-2 px-3 rounded-lg font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 ${isExpense ? 'bg-rose-500 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}">
              <span class="text-sm font-black">−</span> Expense
            </button>
            <button id="editBtnIncome" type="button" class="py-2 px-3 rounded-lg font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 ${!isExpense ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}">
              <span class="text-sm font-black">+</span> Income
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Amount (₹) *</label>
            <input id="editAmount" value="${tx.amount}" type="number" step="0.01" min="0.01" class="neu-input w-full p-2.5 text-xs font-black text-[var(--text-primary)]"/>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Date *</label>
            <input id="editDate" type="date" value="${txDateStr}" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)]"/>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Category *</label>
            <select id="editCategory" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)] font-semibold">
              ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === tx.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Wallet *</label>
            <select id="editMethod" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)] font-semibold">
              <option value="Online" ${tx.method === 'Online' ? 'selected' : ''}>Online Wallet</option>
              <option value="Cash" ${tx.method === 'Cash' ? 'selected' : ''}>Cash Wallet</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Description / Note</label>
          <input id="editDesc" value="${escapeHtml(tx.desc || '')}" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)]"/>
        </div>

        <div class="flex gap-2 pt-2">
          <button id="saveEdit" type="button" class="flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer">Save Changes</button>
          <button id="cancelEdit" type="button" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all cursor-pointer">Cancel</button>
        </div>
      </div>
    `;

    document.getElementById('closeEditModal').addEventListener('click', hide);
    document.getElementById('cancelEdit').addEventListener('click', hide);

    document.getElementById('editBtnExpense').addEventListener('click', () => {
      currentType = 'expense';
      renderContent();
    });

    document.getElementById('editBtnIncome').addEventListener('click', () => {
      currentType = 'income';
      renderContent();
    });

    document.getElementById('saveEdit').addEventListener('click', () => {
      const errBox = document.getElementById('editTxModalError');
      const newAmount = parseFloat(document.getElementById('editAmount').value || 0);
      const newDate = document.getElementById('editDate').value;
      const newCategory = document.getElementById('editCategory').value;
      const newMethod = document.getElementById('editMethod').value;
      const newDesc = document.getElementById('editDesc').value;

      if (!newAmount || isNaN(newAmount) || newAmount <= 0) {
        errBox.textContent = 'Please enter a valid amount greater than 0.';
        errBox.classList.remove('hidden');
        return;
      }

      if (!newDate) {
        errBox.textContent = 'Please enter a valid date.';
        errBox.classList.remove('hidden');
        return;
      }

      const txsArr = getTxs();
      const targetIdx = txsArr.findIndex(t => t.id === id);
      if (targetIdx === -1) {
        hide();
        return;
      }

      const oldTx = txsArr[targetIdx];
      oldTx.type = currentType;
      oldTx.amount = round(newAmount);
      oldTx.date = new Date(newDate).toISOString();
      oldTx.category = newCategory;
      oldTx.method = newMethod;
      oldTx.desc = (newDesc || '').trim();

      saveTxs(txsArr);
      refreshAllViews();
      if (typeof showToast === 'function') {
        showToast('Transaction updated & reconciled', 'success');
      }
      hide();
    });
  };

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  modal.classList.add('show');
  modal.style.display = 'flex';
  renderContent();
}

export function initTransactionControls() {
  // Primary Central + Button & Action Bar Triggers
  const openNewTxModalBtn = document.getElementById('openNewTxModalBtn');
  if (openNewTxModalBtn) {
    openNewTxModalBtn.addEventListener('click', () => openNewTransactionModal('expense'));
  }

  const quickAddExpenseBtn = document.getElementById('quickAddExpenseBtn');
  if (quickAddExpenseBtn) {
    quickAddExpenseBtn.addEventListener('click', () => openNewTransactionModal('expense'));
  }

  const quickAddIncomeBtn = document.getElementById('quickAddIncomeBtn');
  if (quickAddIncomeBtn) {
    quickAddIncomeBtn.addEventListener('click', () => openNewTransactionModal('income'));
  }

  const mobileFabNewTx = document.getElementById('mobileFabNewTx');
  if (mobileFabNewTx) {
    mobileFabNewTx.addEventListener('click', () => openNewTransactionModal('expense'));
  }

  // Recent Transactions Filter Tabs
  document.querySelectorAll('#recentTxFilters button').forEach(fb => {
    fb.addEventListener('click', () => {
      renderRecent(fb.dataset.filter);
    });
  });

  // Range Selector Tabs
  document.querySelectorAll('#rangeTabs .tab').forEach(tb => {
    tb.addEventListener('click', () => {
      document.querySelectorAll('#rangeTabs .tab').forEach(b => {
        b.className = "tab px-1 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all text-center truncate";
      });
      tb.className = "tab active px-1 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold text-[var(--text-primary)] bg-[var(--surface-inset)] shadow-inner transition-all text-center truncate";
      renderOverview(tb.dataset.range);
    });
  });

  // Allowance Configuration Buttons
  const allowanceBtn = document.getElementById('allowanceBtn');
  if (allowanceBtn) {
    allowanceBtn.addEventListener('click', () => openAllowanceModal());
  }

  const configureAllowanceQuickBtn = document.getElementById('configureAllowanceQuickBtn');
  if (configureAllowanceQuickBtn) {
    configureAllowanceQuickBtn.addEventListener('click', () => openAllowanceModal());
  }

  // Edit Starting Balance Buttons
  const triggerStartingModal = async () => {
    const stored = await getStoredHash();
    if (!stored) {
      openCreatePasswordModal();
      return;
    }
    if (!state.sessionUnlocked) {
      openUnlockModal(() => {
        openStartingBalanceModal();
      });
    } else {
      openStartingBalanceModal();
    }
  };

  const editBalanceBtn = document.getElementById('editBalanceBtn');
  if (editBalanceBtn) {
    editBalanceBtn.addEventListener('click', triggerStartingModal);
  }

  const editStartingBalanceQuickBtn = document.getElementById('editStartingBalanceQuickBtn');
  if (editStartingBalanceQuickBtn) {
    editStartingBalanceQuickBtn.addEventListener('click', triggerStartingModal);
  }

  // Inline Add Tx Form (if present on page)
  const addTxBtn = document.getElementById('addTx');
  if (addTxBtn) {
    addTxBtn.addEventListener('click', () => {
      const typeToggleActive = document.querySelector('#typeToggle button.active');
      const type = typeToggleActive ? typeToggleActive.dataset.type : 'expense';
      const amount = parseFloat(document.getElementById('amount')?.value || 0);
      const category = document.getElementById('category')?.value || 'Other';
      const method = document.getElementById('method')?.value || 'Online';
      const desc = document.getElementById('desc')?.value || '';
      const dateVal = document.getElementById('txDate')?.value || new Date().toISOString().slice(0, 10);

      if (!amount || isNaN(amount) || amount <= 0) {
        document.getElementById('amount')?.focus();
        return;
      }

      const tx = {
        id: 't_' + Date.now(),
        type,
        amount: round(amount),
        category,
        method: method === 'Cash' ? 'Cash' : 'Online',
        desc: desc.trim(),
        date: new Date(dateVal).toISOString()
      };

      addTransaction(tx);

      const amountEl = document.getElementById('amount');
      const descEl = document.getElementById('desc');
      if (amountEl) amountEl.value = '';
      if (descEl) descEl.value = '';
    });
  }

  // Inline Record type toggle dynamic category synchronization
  const typeToggleBtns = document.querySelectorAll('#typeToggle button');
  if (typeToggleBtns.length) {
    const updateInlineCategories = (type) => {
      const catSelect = document.getElementById('category');
      if (!catSelect) return;
      const cats = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
      catSelect.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    };

    typeToggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        typeToggleBtns.forEach(b => {
          b.className = "py-2 px-4 rounded-lg font-bold text-sm text-slate-600 hover:bg-white/50 transition-all duration-200";
        });
        if (btn.dataset.type === 'expense') {
          btn.className = "active py-2 px-4 rounded-lg font-bold text-sm bg-rose-500 text-white shadow-sm transition-all duration-200";
        } else {
          btn.className = "active py-2 px-4 rounded-lg font-bold text-sm bg-emerald-500 text-white shadow-sm transition-all duration-200";
        }
        btn.parentElement.dataset.type = btn.dataset.type;
        updateInlineCategories(btn.dataset.type);
      });
    });
    // Initial inline categories
    const activeToggle = document.querySelector('#typeToggle button.active');
    updateInlineCategories(activeToggle?.dataset.type || 'expense');
  }

  // Set default txDate
  const txDateInput = document.getElementById('txDate');
  if (txDateInput) {
    txDateInput.valueAsDate = new Date();
  }
}

export function openAllowanceModal() {
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  const cfg = getAllowanceConfig() || {
    monthlyOnlineAllowance: 0,
    monthlyCashAllowance: 0,
    effectiveDate: new Date().toISOString().slice(0, 10)
  };

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const daysInCurMonth = getDaysInMonth(curYear, curMonth);

  content.innerHTML = `
    <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3 mb-4">
      <div>
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-serif-editorial">Configure Monthly Virtual Allowance</h3>
        <p class="text-[11px] text-[var(--text-muted)] mt-0.5">Progressively allocated into your virtual wallets each day.</p>
      </div>
      <button id="closeAllowanceModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="space-y-4">
      <div>
        <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Monthly Online Allowance (₹)</label>
        <input id="allowanceOnlineInput" type="number" step="any" min="0" value="${cfg.monthlyOnlineAllowance || ''}" placeholder="E.g. 800" class="neu-input w-full p-2.5 text-xs font-bold text-[var(--text-primary)]"/>
        <p id="allowanceOnlineRateText" class="text-[10px] text-[var(--accent)] font-semibold mt-1">Daily virtual allocation: ₹0.00/day</p>
      </div>
      <div>
        <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Monthly Cash Allowance (₹)</label>
        <input id="allowanceCashInput" type="number" step="any" min="0" value="${cfg.monthlyCashAllowance || ''}" placeholder="E.g. 400" class="neu-input w-full p-2.5 text-xs font-bold text-[var(--text-primary)]"/>
        <p id="allowanceCashRateText" class="text-[10px] text-[var(--accent-secondary)] font-semibold mt-1">Daily virtual allocation: ₹0.00/day</p>
      </div>
      <div>
        <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Effective Date</label>
        <input id="allowanceEffectiveDate" type="date" value="${cfg.effectiveDate || new Date().toISOString().slice(0, 10)}" class="neu-input w-full p-2.5 text-xs text-[var(--text-primary)]"/>
        <p class="text-[10px] text-[var(--text-muted)] mt-1">Daily virtual allocations apply from this date forward (no retroactive drift).</p>
      </div>
      <div class="p-3 neu-inset rounded-xl bg-[var(--surface-inset)] flex justify-between items-center">
        <span class="text-xs font-bold text-[var(--text-secondary)]">Total Monthly Allowance</span>
        <span id="allowanceTotalPreview" class="text-sm font-extrabold font-mono text-[var(--text-primary)]">₹0.00</span>
      </div>
      <div class="flex gap-2 pt-2">
        <button id="saveAllowanceBtn" class="flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5">Save Virtual Allowance</button>
        <button id="cancelAllowanceBtn" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all">Cancel</button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  modal.style.display = 'flex';

  const onIn = document.getElementById('allowanceOnlineInput');
  const cashIn = document.getElementById('allowanceCashInput');
  const onText = document.getElementById('allowanceOnlineRateText');
  const cashText = document.getElementById('allowanceCashRateText');
  const totalPrev = document.getElementById('allowanceTotalPreview');

  const updatePreview = () => {
    const onlineVal = Number(onIn.value) || 0;
    const cashVal = Number(cashIn.value) || 0;
    const totalVal = onlineVal + cashVal;

    onText.textContent = `Daily virtual allocation: ₹${(onlineVal / daysInCurMonth).toFixed(2)}/day (${daysInCurMonth} days in current month)`;
    cashText.textContent = `Daily virtual allocation: ₹${(cashVal / daysInCurMonth).toFixed(2)}/day`;
    totalPrev.textContent = `₹${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  };

  onIn.addEventListener('input', updatePreview);
  cashIn.addEventListener('input', updatePreview);
  updatePreview();

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  document.getElementById('closeAllowanceModal').addEventListener('click', hide);
  document.getElementById('cancelAllowanceBtn').addEventListener('click', hide);

  document.getElementById('saveAllowanceBtn').addEventListener('click', () => {
    const monthlyOnline = Math.max(0, Number(onIn.value) || 0);
    const monthlyCash = Math.max(0, Number(cashIn.value) || 0);
    const effDate = document.getElementById('allowanceEffectiveDate').value || new Date().toISOString().slice(0, 10);

    const newConfig = createAllowanceConfig({
      monthlyOnlineAllowance: monthlyOnline,
      monthlyCashAllowance: monthlyCash,
      effectiveDate: effDate,
      version: (cfg.version || 0) + 1
    });

    saveAllowanceConfig(newConfig);
    refreshAllViews();
    if (typeof showToast === 'function') {
      showToast('Monthly virtual allowance updated', 'success');
    }
    hide();
  });
}

export function openStartingBalanceModal() {
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  const start = getStartingBalances();

  content.innerHTML = `
    <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3 mb-4">
      <div>
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-serif-editorial">Starting Virtual Balances</h3>
        <p class="text-[11px] text-[var(--text-muted)] mt-0.5">Initial virtual baseline before allocations and transactions.</p>
      </div>
      <button id="closeStartingModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="space-y-4">
      <div>
        <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Cash Wallet Starting Balance (₹)</label>
        <input id="startingCashInput" type="number" step="0.01" value="${start.cash || 0}" class="neu-input w-full p-2.5 text-xs font-bold text-[var(--text-primary)]"/>
      </div>
      <div>
        <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1">Online Wallet Starting Balance (₹)</label>
        <input id="startingOnlineInput" type="number" step="0.01" value="${start.online || 0}" class="neu-input w-full p-2.5 text-xs font-bold text-[var(--text-primary)]"/>
      </div>
      <div class="flex gap-2 pt-2">
        <button id="saveStartingBtn" class="flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5">Save Starting Balances</button>
        <button id="cancelStartingBtn" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all">Cancel</button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  modal.style.display = 'flex';

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  document.getElementById('closeStartingModal').addEventListener('click', hide);
  document.getElementById('cancelStartingBtn').addEventListener('click', hide);

  document.getElementById('saveStartingBtn').addEventListener('click', () => {
    const cashVal = Number(document.getElementById('startingCashInput').value) || 0;
    const onlineVal = Number(document.getElementById('startingOnlineInput').value) || 0;
    saveStartingBalances({ cash: cashVal, online: onlineVal });
    refreshAllViews();
    if (typeof showToast === 'function') {
      showToast('Starting wallet baseline updated', 'success');
    }
    hide();
  });
}
