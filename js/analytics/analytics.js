// Financial Analytics & Metrics Calculation Engine
import { state, money, safeStorage, LS } from '../core/state.js';
import { round, escapeHtml } from '../utils/utils.js';
import { getIcon } from '../ui/icons.js';

export function getAdaptiveBudgetSuggestion(txs = []) {
  const now = new Date();
  const monthlyTotals = [];

  for (let i = 1; i <= 3; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    let total = 0;

    txs.forEach(t => {
      const d = new Date(t.date);
      if (t.type === 'expense' && d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear()) {
        total += Number(t.amount);
      }
    });

    if (total > 0) monthlyTotals.push(total);
  }

  if (!monthlyTotals.length) return null;

  const avg = monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length;
  return Math.round((avg * 0.9) / 500) * 500;
}

export function getExpensePersonality(txs = []) {
  let food = 0, shopping = 0, bills = 0;

  txs.forEach(t => {
    if (t.type !== 'expense') return;
    if (t.category.includes('Food')) food += Number(t.amount);
    if (t.category.includes('Shopping')) shopping += Number(t.amount);
    if (t.category.includes('Bills')) bills += Number(t.amount);
  });

  if (food > shopping && food > bills) return 'Food Lover 🍔';
  if (shopping > food) return 'Shopaholic 🛍';
  if (bills > food && bills > shopping) return 'Responsible Planner 📊';
  return 'Balanced ⚖️';
}

export function renderBudget(monthExpenses, budget = 0) {
  const bar = document.getElementById('budgetBar');
  const text = document.getElementById('budgetText');
  const input = document.getElementById('budgetInput');
  if (!bar || !text || !input) return;

  if (!budget || budget <= 0) {
    bar.style.width = '0%';
    bar.style.background = 'var(--surface-inset)';
    text.textContent = 'No budget set';
    input.value = '';
    input.placeholder = !state.sessionUnlocked ? '₹ XXXX' : 'Set budget ₹';
    return;
  }

  const usedPct = Math.min((monthExpenses / budget) * 100, 100);
  bar.style.width = usedPct + '%';

  const expensesStr = state.sessionUnlocked ? `₹${monthExpenses.toFixed(2)}` : '₹ XXXX';
  const budgetStr = state.sessionUnlocked ? `₹${budget}` : '₹ XXXX';

  if (usedPct < 80) {
    bar.style.background = 'var(--income)';
    text.className = 'text-[11px] text-[var(--income)] font-bold';
    text.textContent = `${expensesStr} of ${budgetStr} used`;
  } else if (usedPct < 100) {
    bar.style.background = 'var(--warning)';
    text.className = 'text-[11px] text-[var(--warning)] font-bold';
    text.textContent = `⚠ Near budget: ${expensesStr} / ${budgetStr}`;
  } else {
    bar.style.background = 'var(--expense)';
    text.className = 'text-[11px] text-[var(--expense)] font-bold';
    text.textContent = `❌ Budget exceeded: ${expensesStr} / ${budgetStr}`;
  }

  input.value = state.sessionUnlocked ? budget : '';
  input.placeholder = !state.sessionUnlocked ? '₹ XXXX' : 'Set budget ₹';
}

export function renderAdaptiveBudgetSuggestion(txs = [], budget = 0, onApply = null) {
  const box = document.getElementById('budgetSuggestionBox');
  if (!box) return;

  try {
    const dismissed = safeStorage.getItem(LS.budgetSuggestionDismissed);

    if (dismissed || budget > 0) {
      box.style.display = 'none';
      return;
    }

    const suggestion = getAdaptiveBudgetSuggestion(txs);
    if (!suggestion) {
      box.style.display = 'none';
      return;
    }

    document.getElementById('suggestedBudgetText').textContent = money(suggestion);
    box.style.display = 'block';

    const applyBtn = document.getElementById('applySuggestedBudget');
    if (applyBtn) {
      applyBtn.onclick = () => {
        if (typeof onApply === 'function') {
          onApply(suggestion);
        }
        box.style.display = 'none';
      };
    }

    const dismissBtn = document.getElementById('dismissSuggestedBudget');
    if (dismissBtn) {
      dismissBtn.onclick = () => {
        try {
          safeStorage.setItem(LS.budgetSuggestionDismissed, '1');
        } catch (err) {}
        box.style.display = 'none';
      };
    }
  } catch (err) {
    box.style.display = 'none';
  }
}

export function renderZeroSpendQuality(txs = []) {
  const now = new Date();
  const today = now.getDate();

  const bar = document.getElementById('zeroSpendQualityBar');
  const pct = document.getElementById('zeroSpendQualityPct');
  const text = document.getElementById('zeroSpendQualityText');
  if (!bar || !pct || !text) return;

  if (today <= 1) {
    pct.textContent = '0%';
    bar.style.width = '0%';
    text.textContent = 'Not enough data yet';
    return;
  }

  const spentDays = new Set();
  txs.forEach(t => {
    if (t.type !== 'expense') return;
    const d = new Date(t.date);
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && d.getDate() <= today) {
      spentDays.add(d.getDate());
    }
  });

  const zeroSpendDays = today - spentDays.size;
  const quality = Math.max(0, Math.round((zeroSpendDays / today) * 100));

  bar.style.width = quality + '%';
  pct.textContent = quality + '%';

  if (quality >= 60) {
    bar.style.background = 'var(--income)';
    text.textContent = 'Excellent spending discipline 🎯';
  } else if (quality >= 40) {
    bar.style.background = 'var(--accent)';
    text.textContent = 'Good control so far 👍';
  } else if (quality >= 20) {
    bar.style.background = 'var(--warning)';
    text.textContent = 'Average discipline ⚠';
  } else {
    bar.style.background = 'var(--expense)';
    text.textContent = 'Needs improvement 🚨';
  }
}

export function renderSmartInsights(txs = [], budget = 0) {
  const list = document.getElementById('smartInsights');
  if (!list) return;

  const now = new Date();

  if (!txs.length) {
    list.innerHTML = '<li class="text-[11px] text-slate-400 list-none">Log transactions to reveal smart advice.</li>';
    return;
  }

  function monthTotals(offset) {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    let exp = 0, inc = 0;
    txs.forEach(t => {
      const d = new Date(t.date);
      if (d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear()) {
        if (t.type === 'expense') exp += Number(t.amount);
        else inc += Number(t.amount);
      }
    });
    return { exp, inc };
  }

  const cur = monthTotals(0);
  const prev = monthTotals(-1);
  const insights = [];

  if (prev.exp > 0) {
    const diffPct = ((cur.exp - prev.exp) / prev.exp) * 100;
    if (Math.abs(diffPct) >= 5) {
      insights.push(diffPct > 0 ? `You spent ${diffPct.toFixed(1)}% more than last month.` : `Awesome! Spent ${Math.abs(diffPct).toFixed(1)}% less than last month.`);
    }
  }

  if (budget > 0) {
    insights.push(cur.exp <= budget ? 'Great! Within your monthly budget.' : 'Careful! Budget exceeded.');
  }

  if (cur.inc > 0) {
    const rate = ((cur.inc - cur.exp) / cur.inc) * 100;
    if (rate >= 20) insights.push('Excellent 20%+ savings rate this month! 💪');
    else if (rate < 5) insights.push('Savings rate is low, review discretionary spending.');
  }

  if (!insights.length) insights.push('Daily spending is stable and aligned.');
  list.innerHTML = insights.map(i => `<li>${i}</li>`).join('');
}

export function renderStreaks(txs = []) {
  const now = new Date();
  const expenseDays = new Set();
  const logDays = new Set();

  txs.forEach(t => {
    const d = new Date(t.date);
    const key = d.toISOString().slice(0, 10);
    logDays.add(key);
    if (t.type === 'expense') expenseDays.add(key);
  });

  let zeroStreak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (expenseDays.has(key)) break;
    zeroStreak++;
  }

  let logStreak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (!logDays.has(key)) break;
    logStreak++;
  }

  const zeroEl = document.getElementById('zeroSpendStreak');
  const logEl = document.getElementById('logStreak');
  const badgeEl = document.getElementById('streakBadges');

  if (zeroEl) zeroEl.textContent = `${zeroStreak} days`;
  if (logEl) logEl.textContent = `${logStreak} days`;

  const badges = [];
  const best = Math.max(zeroStreak, logStreak);
  if (best >= 3) badges.push('🥉 Apprentice');
  if (best >= 6) badges.push('🥈 Veteran');
  if (best >= 9) badges.push('🥇 Champion');
  if (best >= 15) badges.push('💎 Legend');

  if (badgeEl) {
    badgeEl.textContent = badges.length ? `Unlocked: ${badges.join(' | ')}` : '🏆 No streak badges unlocked yet';
  }
}

export function renderMonthlySummary(txs = [], budget = 0) {
  const summaryEl = document.getElementById('monthlySummary');
  if (!summaryEl) return;

  const now = new Date();
  const mm = now.getMonth();
  const yy = now.getFullYear();

  let income = 0, expense = 0;
  const catTotals = {};
  const dailyExpense = {};

  txs.forEach(t => {
    const d = new Date(t.date);
    if (d.getMonth() === mm && d.getFullYear() === yy) {
      const day = d.getDate();
      if (t.type === 'income') {
        income += Number(t.amount);
      } else {
        expense += Number(t.amount);
        catTotals[t.category] = (catTotals[t.category] || 0) + Number(t.amount);
        dailyExpense[day] = (dailyExpense[day] || 0) + Number(t.amount);
      }
    }
  });

  if (income === 0 && expense === 0) {
    summaryEl.textContent = 'No transactions recorded this month.';
    return;
  }

  const savings = income - expense;
  const savingsRate = income > 0 ? ((savings / income) * 100).toFixed(1) : 0;
  const topCategory = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  const highestDay = Object.entries(dailyExpense).sort((a, b) => b[1] - a[1])[0];

  let budgetStatus = 'No budget set';
  if (budget > 0) {
    budgetStatus = expense > budget ? '❌ Over Budget' : '✅ On Track';
  }

  const personality = getExpensePersonality(txs);

  const summary = `📅 Report: ${now.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
💰 Total Income: ${money(income)}
💸 Total Expenses: ${money(expense)}
💾 Projected Savings: ${money(savings)} (${savingsRate}%)
🔥 Peak Spent Day: Day ${highestDay?.[0] || '-'} (${money(highestDay?.[1] || 0)})
🏷 Primary Outflow: ${topCategory?.[0] || '-'} (${money(topCategory?.[1] || 0)})
🎯 Budget Guideline: ${budgetStatus}
🧠 Profile Archetype: ${personality}`;

  summaryEl.textContent = summary;
}

export function renderFinancialHealthScore(txs = [], budget = 0) {
  const now = new Date();
  let income = 0, expense = 0;
  let dailyExpense = {};
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  txs.forEach(t => {
    const d = new Date(t.date);
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
      const day = d.getDate();
      if (t.type === 'income') income += Number(t.amount);
      else {
        expense += Number(t.amount);
        dailyExpense[day] = (dailyExpense[day] || 0) + Number(t.amount);
      }
    }
  });

  const zeroSpendDays = daysInMonth - Object.keys(dailyExpense).length;

  let savingsScore = 0;
  if (income > 0) {
    const rate = (income - expense) / income;
    savingsScore = Math.min(Math.max(rate * 100, 0), 100);
  }

  let budgetScore = 50;
  if (budget > 0) {
    const usage = expense / budget;
    if (usage <= 1) budgetScore = 100 - (usage * 30);
    else budgetScore = Math.max(0, 100 - (usage * 60));
  }

  const spends = Object.values(dailyExpense);
  let consistencyScore = 80;
  if (spends.length > 1) {
    const avg = spends.reduce((a, b) => a + b, 0) / spends.length;
    const variance = spends.reduce((a, b) => a + Math.abs(b - avg), 0) / spends.length;
    consistencyScore = Math.max(20, 100 - (variance / avg) * 100);
  }

  const zeroScore = Math.min((zeroSpendDays / daysInMonth) * 100, 100);
  const score = Math.round(savingsScore * 0.4 + budgetScore * 0.25 + consistencyScore * 0.2 + zeroScore * 0.15);

  const scoreEl = document.getElementById('healthScore');
  const labelEl = document.getElementById('healthLabel');
  const barEl = document.getElementById('healthBar');
  const breakdownEl = document.getElementById('healthBreakdown');

  if (!scoreEl || !labelEl || !barEl || !breakdownEl) return;

  scoreEl.textContent = score;
  barEl.style.width = score + '%';

  let label = 'Under Review';
  let color = 'var(--expense)';

  if (score >= 80) { label = 'Optimal'; color = 'var(--income)'; }
  else if (score >= 60) { label = 'Good'; color = 'var(--accent)'; }
  else if (score >= 40) { label = 'Moderate'; color = 'var(--warning)'; }

  scoreEl.style.color = color;
  barEl.style.background = color;
  labelEl.textContent = label;
  labelEl.style.color = color;

  breakdownEl.innerHTML = `Savings: ${Math.round(savingsScore)} | Budget: ${Math.round(budgetScore)} | Zero-Spend: ${Math.round(zeroScore)}`;
}

export function renderPhase1Insights(txs = []) {
  const now = new Date();

  function monthTotals(offset) {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    let exp = 0, inc = 0;
    txs.forEach(t => {
      const d = new Date(t.date);
      if (d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear()) {
        if (t.type === 'expense') exp += Number(t.amount);
        else inc += Number(t.amount);
      }
    });
    return { exp, inc };
  }

  const cur = monthTotals(0);
  const prev = monthTotals(-1);

  function trend(c, p) {
    if (c > p * 1.05) return '↑ Upward';
    if (c < p * 0.95) return '↓ Downward';
    return '→ Stable';
  }

  const trendEl = document.getElementById('trendIndicators');
  if (trendEl) {
    trendEl.innerHTML = `
      Expenses: ${trend(cur.exp, prev.exp)}<br>
      Income: ${trend(cur.inc, prev.inc)}<br>
      Savings: ${trend(cur.inc - cur.exp, prev.inc - prev.exp)}
    `;
  }

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const spentDays = new Set();

  txs.forEach(t => {
    const d = new Date(t.date);
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.type === 'expense') {
      spentDays.add(d.getDate());
    }
  });

  let streak = 0;
  for (let i = now.getDate(); i >= 1; i--) {
    if (spentDays.has(i)) break;
    streak++;
  }

  const zeroInfoEl = document.getElementById('zeroSpendInfo');
  if (zeroInfoEl) {
    zeroInfoEl.innerHTML = `
      Count: ${daysInMonth - spentDays.size} days<br>
      Streak: ${streak} days continuous
    `;
  }
}

export function renderMonthlyComparisons(txs = []) {
  const now = new Date();

  function monthExpense(offset) {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    let total = 0;
    txs.forEach(t => {
      const d = new Date(t.date);
      if (t.type === 'expense' && d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear()) {
        total += Number(t.amount);
      }
    });
    return total;
  }

  const current = monthExpense(0);
  const last = monthExpense(-1);

  const lastEl = document.getElementById('compareLastMonth');
  const lastText = document.getElementById('compareLastMonthText');

  if (lastEl && lastText) {
    if (last > 0) {
      const diff = current - last;
      const pct = Math.round((diff / last) * 100);
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      const color = diff > 0 ? 'var(--expense)' : 'var(--income)';

      lastEl.textContent = `${arrow} ${Math.abs(pct)}%`;
      lastEl.style.color = color;
      lastText.textContent = diff > 0 ? 'Higher spending than last month' : diff < 0 ? 'Lower spending than last month' : 'Same as last month';
    } else {
      lastEl.textContent = '—';
      lastEl.style.color = 'var(--text-muted)';
      lastText.textContent = 'Not enough data';
    }
  }

  const totals = [];
  for (let i = 1; i <= 3; i++) {
    const v = monthExpense(-i);
    if (v > 0) totals.push(v);
  }

  const avgEl = document.getElementById('compareAvg');
  const avgText = document.getElementById('compareAvgText');

  if (avgEl && avgText) {
    if (totals.length) {
      const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
      const diff = current - avg;
      const pct = Math.round((diff / avg) * 100);
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      const color = diff > 0 ? 'var(--expense)' : 'var(--income)';

      avgEl.textContent = `${arrow} ${Math.abs(pct)}%`;
      avgEl.style.color = color;
      avgText.textContent = diff > 0 ? 'Above recent average' : diff < 0 ? 'Below recent average' : 'On average';
    } else {
      avgEl.textContent = '—';
      avgEl.style.color = 'var(--text-muted)';
      avgText.textContent = 'Not enough history';
    }
  }
}

export function renderExpenseHeatmap(txs = []) {
  const container = document.getElementById('expenseHeatmap');
  if (!container) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dailySpend = Array(daysInMonth).fill(0);

  txs.forEach(t => {
    if (t.type !== 'expense') return;
    const d = new Date(t.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      dailySpend[d.getDate() - 1] += Number(t.amount);
    }
  });

  container.innerHTML = '';

  for (let i = 0; i < daysInMonth; i++) {
    const amt = dailySpend[i];
    const today = new Date().getDate();

    let color = '#f1f5f9';
    if (i + 1 <= today) {
      if (amt === 0) color = '#ecfdf5';
      else if (amt >= 400) color = '#f43f5e';
      else if (amt >= 200) color = '#fb923c';
      else if (amt >= 100) color = '#fbbf24';
      else color = '#93c5fd';
    }

    const cell = document.createElement('div');
    cell.className = "aspect-square w-full rounded-lg transition-all duration-200 hover:scale-110 shadow-sm border border-white/50 cursor-pointer";
    cell.style.background = color;
    cell.title = `Day ${i + 1}: ₹${amt.toFixed(2)}`;

    const clickedDay = i + 1;
    cell.addEventListener('click', () => showDayTransactions(clickedDay, txs));
    container.appendChild(cell);
  }
}

export function showDayTransactions(day, txs = []) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const dayTxs = txs.filter(t => {
    const d = new Date(t.date);
    return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year;
  });

  const total = dayTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  let html = `
    <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3 mb-4">
      <div>
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-serif-editorial">Daily Activity</h3>
        <span class="text-[10px] text-[var(--text-muted)] font-medium block mt-0.5">${day} ${now.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</span>
      </div>
      <button id="closeDayModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg sanchoy-btn sanchoy-btn-icon transition-colors">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    
    <div class="p-3.5 rounded-xl sanchoy-surface-inset flex justify-between items-center mb-4">
      <span class="text-xs font-bold text-[var(--text-secondary)]">Total Spent</span>
      <span class="text-sm font-extrabold font-mono text-[var(--expense)]">${money(total)}</span>
    </div>
    
    <div class="space-y-2 max-h-[260px] overflow-y-auto pr-1">
  `;

  if (!dayTxs.length) {
    html += `
      <div class="text-center py-6 flex flex-col items-center justify-center">
        <span class="text-[var(--income)]/80 inline-flex items-center justify-center">${getIcon('leaf', { size: 'w-7 h-7' })}</span>
        <p class="text-[11px] text-[var(--text-muted)] font-medium mt-2">Zero spend day! Nice work.</p>
      </div>
    `;
  } else {
    dayTxs.forEach(t => {
      html += `
        <div class="flex justify-between items-center p-3 rounded-xl sanchoy-card gap-4 text-xs">
          <div class="min-w-0">
            <h4 class="font-bold text-[var(--text-primary)] truncate">${escapeHtml(t.desc || t.category)}</h4>
            <span class="text-[9px] text-[var(--text-muted)] block mt-0.5">${escapeHtml(t.category)} • ${t.method}</span>
          </div>
          <span class="font-extrabold font-mono shrink-0 ${t.type === 'expense' ? 'text-[var(--expense)]' : 'text-[var(--income)]'}">
            ${t.type === 'expense' ? '-' : '+'}${money(t.amount)}
          </span>
        </div>
      `;
    });
  }

  html += `</div>`;

  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (modal && content) {
    content.innerHTML = html;
    modal.classList.add('show');
    modal.style.display = 'flex';

    document.getElementById('closeDayModal').addEventListener('click', () => {
      modal.classList.remove('show');
      modal.style.display = 'none';
    });
  }
}

export function renderAnalysis(txs = [], budget = 0, onApplyBudget = null) {
  const now = new Date();
  const mm = now.getMonth();
  const yy = now.getFullYear();

  let monthExpenses = 0, monthIncome = 0, pmCash = 0, pmOnline = 0;
  const catTotals = {};

  txs.forEach(t => {
    const d = new Date(t.date);
    if (d.getMonth() === mm && d.getFullYear() === yy) {
      if (t.type === 'expense') monthExpenses += Number(t.amount);
      else monthIncome += Number(t.amount);
    }
    if (t.method === 'Cash') pmCash += Number(t.amount) * (t.type === 'expense' ? -1 : 1);
    if (t.method === 'Online') pmOnline += Number(t.amount) * (t.type === 'expense' ? -1 : 1);

    if (t.type === 'expense') {
      catTotals[t.category] = (catTotals[t.category] || 0) + Number(t.amount);
    }
  });

  const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const topCatsEl = document.getElementById('topCats');
  
  if (topCatsEl) {
    topCatsEl.innerHTML = sortedCats.length ? sortedCats.map(c => `
      <div class="space-y-1">
        <div class="flex justify-between text-[var(--text-secondary)] font-medium text-xs">
          <span>${escapeHtml(c[0])}</span>
          <span class="font-extrabold font-mono text-[var(--text-primary)]">${money(c[1])}</span>
        </div>
        <div class="w-full h-1.5 rounded-full overflow-hidden sanchoy-surface-inset border-none">
          <div class="bg-[var(--accent)] h-full rounded-full transition-all duration-300" style="width: ${Math.min((c[1] / (monthExpenses || 1)) * 100, 100)}%"></div>
        </div>
      </div>
    `).join('') : '<div class="text-[11px] text-[var(--text-muted)]">No category history.</div>';
  }

  const monthExpensesEl = document.getElementById('monthExpenses');
  if (monthExpensesEl) monthExpensesEl.textContent = money(monthExpenses);

  renderBudget(monthExpenses, budget);

  const monthIncomeEl = document.getElementById('monthIncome');
  if (monthIncomeEl) monthIncomeEl.textContent = money(monthIncome);

  const savingsRate = monthIncome > 0 ? round(((monthIncome - monthExpenses) / monthIncome) * 100) : 0;
  const savingsBar = document.getElementById('savingsBar');
  const savingsPct = document.getElementById('savingsPct');
  if (savingsBar) savingsBar.style.width = Math.min(Math.max(savingsRate, 0), 100) + '%';
  if (savingsPct) savingsPct.textContent = savingsRate.toFixed(1) + '%';

  const pmCashEl = document.getElementById('pmCash');
  const pmOnlineEl = document.getElementById('pmOnline');
  const netIncomeEl = document.getElementById('netIncome');
  if (pmCashEl) pmCashEl.textContent = money(Math.abs(pmCash));
  if (pmOnlineEl) pmOnlineEl.textContent = money(Math.abs(pmOnline));
  if (netIncomeEl) netIncomeEl.textContent = money(monthIncome - monthExpenses);

  renderPhase1Insights(txs);
  renderExpenseHeatmap(txs);
  renderSmartInsights(txs, budget);
  renderStreaks(txs);
  renderMonthlySummary(txs, budget);
  renderAdaptiveBudgetSuggestion(txs, budget, onApplyBudget);
  renderZeroSpendQuality(txs);
  renderMonthlyComparisons(txs);
  renderFinancialHealthScore(txs, budget);
}
