// Settings, Data Portability & Backup/Restore Controller
import { state, LS, safeStorage, setDecryptedVaultRecords } from '../core/state.js';
import { AppDB, AppDBSync } from '../storage/database.js';
import { downloadBlob, csvSafe, splitLines, parseCSVLine, round } from '../utils/utils.js';
import { getIcon } from '../ui/icons.js';
import { getTxs, getBalances, applyTxToBalances, saveTxs, saveMonthlyBudget, refreshAllViews } from '../transactions/transactions.js';
import { getStoredHash, openCreatePasswordModal, openUnlockModal, openChangePasswordModal } from '../auth/auth.js';
import { decryptRecord, updateVaultStyles } from '../vault/vault.js';
import { showToast } from '../ui/toast.js';

export function showExportMenu() {
  const menu = document.createElement('div');
  menu.className = "space-y-4";
  menu.innerHTML = `
    <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
      <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-serif-editorial">Export Data Backup</h3>
      <button id="closeExport" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <p class="text-xs text-[var(--text-muted)] leading-relaxed">Choose a backup file format to save your local bookkeeping history safely on your machine.</p>
    <div class="grid grid-cols-1 gap-3 pt-2">
      <button id="expTxCSV" class="flex items-center justify-center gap-2 w-full py-3 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all cursor-pointer">
        ${getIcon('exportCsv', { size: 'w-4 h-4', className: 'text-[var(--accent)]' })}
        <span>Save Transactions as CSV</span>
      </button>
      <button id="expJSON" class="flex items-center justify-center gap-2 w-full py-3 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer">
        ${getIcon('backup', { size: 'w-4 h-4', className: 'text-white' })}
        <span>Save Full Backup as JSON</span>
      </button>
    </div>
  `;
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  content.innerHTML = '';
  content.appendChild(menu);
  modal.classList.add('show');
  modal.style.display = 'flex';

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  document.getElementById('closeExport').addEventListener('click', hide);
  document.getElementById('expTxCSV').addEventListener('click', () => {
    exportTransactionsCSV();
    hide();
  });
  document.getElementById('expJSON').addEventListener('click', async () => {
    await exportAllApplicationDataJSON();
    hide();
  });
}

export function exportTransactionsCSV() {
  const txs = getTxs();
  if (!txs.length) {
    showToast('No transaction records to export.', 'info');
    return;
  }
  const header = ['id', 'type', 'amount', 'category', 'method', 'desc', 'date'];
  const rows = txs.map(t => header.map(h => csvSafe(t[h])).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  downloadBlob(csv, 'transactions_export.csv', 'text/csv;charset=utf-8;');
}

export async function exportAllApplicationDataJSON() {
  const data = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    transactions: await AppDB.getAll('transactions'),
    categories: await AppDB.getAll('categories'),
    budgets: await AppDB.getAll('budgets'),
    analytics_cache: await AppDB.getAll('analytics_cache'),
    monthly_reports: await AppDB.getAll('monthly_reports'),
    savings_vault: await AppDB.getAll('savings_vault'),
    master_password_hash: await AppDB.getAll('master_password_hash'),
    user_preferences: await AppDB.getAll('user_preferences'),
    theme_settings: await AppDB.getAll('theme_settings'),
    privacy_settings: await AppDB.getAll('privacy_settings'),
    achievements: await AppDB.getAll('achievements'),
    app_settings: await AppDB.getAll('app_settings'),
    balances: getBalances()
  };
  downloadBlob(JSON.stringify(data, null, 2), 'expense_tracker_full_backup.json', 'application/json');
}

export function validateBackupJSON(parsed) {
  if (!parsed || typeof parsed !== 'object') return 'Invalid file structure.';
  const hasCore = ('transactions' in parsed) || ('balances' in parsed);
  if (!hasCore) return 'Backup file is missing core Expense Tracker data.';
  if (parsed.transactions && !Array.isArray(parsed.transactions)) {
    return 'Transactions field must be an array.';
  }
  if (parsed.savings_vault && !Array.isArray(parsed.savings_vault)) {
    return 'Savings Vault field must be an array.';
  }
  if (parsed.categories && !Array.isArray(parsed.categories)) {
    return 'Categories field must be an array.';
  }
  if (parsed.budgets && !Array.isArray(parsed.budgets)) {
    return 'Budgets field must be an array.';
  }
  return null;
}

export async function restoreFullApplicationData(parsed) {
  await AppDBSync.clearAllStores();

  if (parsed.transactions) {
    const txs = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    await AppDB.putAll('transactions', txs);
    safeStorage._data[LS.transactions] = JSON.stringify(txs);
  }

  if (parsed.balances) {
    await AppDB.put('app_settings', { key: 'balances', value: parsed.balances });
    safeStorage._data[LS.balances] = JSON.stringify(parsed.balances);
  }

  if (parsed.budgets && Array.isArray(parsed.budgets)) {
    await AppDB.putAll('budgets', parsed.budgets);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const match = parsed.budgets.find(b => b.month === currentMonth);
    if (match) {
      safeStorage._data[LS.budget] = String(match.amount);
    } else if (parsed.budgets.length > 0) {
      safeStorage._data[LS.budget] = String(parsed.budgets[0].amount);
    }
  } else if (parsed.budget) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    await AppDB.put('budgets', { month: currentMonth, amount: Number(parsed.budget) });
    safeStorage._data[LS.budget] = String(parsed.budget);
  }

  if (parsed.categories && Array.isArray(parsed.categories)) {
    await AppDB.putAll('categories', parsed.categories);
  }
  if (parsed.analytics_cache && Array.isArray(parsed.analytics_cache)) {
    await AppDB.putAll('analytics_cache', parsed.analytics_cache);
  }
  if (parsed.monthly_reports && Array.isArray(parsed.monthly_reports)) {
    await AppDB.putAll('monthly_reports', parsed.monthly_reports);
  }
  if (parsed.savings_vault && Array.isArray(parsed.savings_vault)) {
    await AppDB.putAll('savings_vault', parsed.savings_vault);
    if (state.vaultCryptoKey) {
      const decrypted = [];
      for (const r of parsed.savings_vault) {
        const dec = await decryptRecord(r, state.vaultCryptoKey);
        if (dec) decrypted.push(dec);
      }
      setDecryptedVaultRecords(decrypted);
    } else {
      setDecryptedVaultRecords([]);
    }
  }
  if (parsed.master_password_hash && Array.isArray(parsed.master_password_hash)) {
    await AppDB.putAll('master_password_hash', parsed.master_password_hash);
    const match = parsed.master_password_hash.find(h => h.id === 'master_hash');
    if (match) {
      safeStorage._data['et_master_password_hash'] = match.hash;
    }
  }
  if (parsed.user_preferences && Array.isArray(parsed.user_preferences)) {
    await AppDB.putAll('user_preferences', parsed.user_preferences);
    const match = parsed.user_preferences.find(p => p.key === 'budgetSuggestionDismissed');
    if (match) {
      safeStorage._data[LS.budgetSuggestionDismissed] = match.value;
    }
  }
  if (parsed.theme_settings && Array.isArray(parsed.theme_settings)) {
    await AppDB.putAll('theme_settings', parsed.theme_settings);
    const match = parsed.theme_settings.find(t => t.key === 'vaultDarkTheme');
    if (match) {
      state.vaultDarkTheme = match.value === 'true';
      updateVaultStyles();
    }
  }
  if (parsed.privacy_settings && Array.isArray(parsed.privacy_settings)) {
    await AppDB.putAll('privacy_settings', parsed.privacy_settings);
  }
  if (parsed.achievements && Array.isArray(parsed.achievements)) {
    await AppDB.putAll('achievements', parsed.achievements);
  }
  if (parsed.app_settings && Array.isArray(parsed.app_settings)) {
    await AppDB.putAll('app_settings', parsed.app_settings);
  }
}

export function handleFileInput(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const text = reader.result;
    if (file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        const validationError = validateBackupJSON(parsed);
        if (validationError) {
          showToast('Validation Error: ' + validationError, 'error');
          e.target.value = '';
          return;
        }
        if (!confirm('JSON import will OVERWRITE all your active data. Continue?')) {
          e.target.value = '';
          return;
        }
        await restoreFullApplicationData(parsed);
        refreshAllViews();
        showToast('JSON data backup successfully restored.', 'success');
      } catch (err) {
        showToast('Failed to parse invalid backup JSON file: ' + err.message, 'error');
      }
    } else {
      // CSV import
      const lines = splitLines(text).filter(Boolean);
      if (lines.length < 2) {
        showToast('CSV data is empty.', 'warning');
        e.target.value = '';
        return;
      }
      const header = parseCSVLine(lines[0]);
      const toAdd = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (!cols.length) continue;
        const obj = {};
        for (let j = 0; j < header.length; j++) {
          obj[header[j]] = cols[j] || '';
        }
        let importDate = new Date().toISOString();
        if (obj.date) {
          try {
            const testD = new Date(obj.date);
            if (!isNaN(testD.getTime())) {
              importDate = testD.toISOString();
            }
          } catch (err) {}
        }
        const tx = {
          id: obj.id && obj.id.trim() ? obj.id.trim() : 't_import_' + Date.now() + '_' + i,
          type: (obj.type || 'expense').trim().toLowerCase() === 'income' ? 'income' : 'expense',
          amount: round(parseFloat(obj.amount) || 0),
          category: obj.category || 'Other',
          method: (obj.method && (obj.method.trim() === 'Cash' || obj.method.trim() === 'Online')) ? obj.method.trim() : 'Cash',
          desc: obj.desc || '',
          date: importDate
        };
        if (tx.amount > 0) toAdd.push(tx);
      }
      if (!toAdd.length) {
        showToast('No valid records recognized to import.', 'warning');
        e.target.value = '';
        return;
      }

      const existingTxs = getTxs();
      toAdd.forEach(tx => {
        existingTxs.push(tx);
        applyTxToBalances(tx, false);
      });
      saveTxs(existingTxs);

      refreshAllViews();
      showToast(`Successfully imported ${toAdd.length} transaction entries.`, 'success');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

export function initSettingsControls() {
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      const stored = await getStoredHash();
      if (!stored) {
        openCreatePasswordModal();
        return;
      }
      if (!state.sessionUnlocked) {
        openUnlockModal(() => {
          showExportMenu();
        });
      } else {
        showExportMenu();
      }
    });
  }

  const importBtn = document.getElementById('importBtn');
  const fileInput = document.getElementById('fileInput');
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileInput);
  }

  const exportCSVtx = document.getElementById('exportCSVtx');
  if (exportCSVtx) {
    exportCSVtx.addEventListener('click', async () => {
      const stored = await getStoredHash();
      if (!stored) {
        openCreatePasswordModal();
        return;
      }
      if (!state.sessionUnlocked) {
        openUnlockModal(() => {
          exportTransactionsCSV();
        });
      } else {
        exportTransactionsCSV();
      }
    });
  }

  const clearAllBtn = document.getElementById('clearAll');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (confirm('Clear ALL active bookkeeping storage? This operation cannot be reversed.')) {
        try {
          safeStorage.removeItem(LS.balances);
          safeStorage.removeItem(LS.transactions);
          safeStorage.removeItem(LS.budget);
          safeStorage.removeItem(LS.budgetSuggestionDismissed);
        } catch (e) {}

        refreshAllViews();
        showToast('Local storage cleared successfully.', 'info');
      }
    });
  }

  const securitySettingsBtn = document.getElementById('securitySettingsBtn');
  if (securitySettingsBtn) {
    securitySettingsBtn.addEventListener('click', async () => {
      const stored = await getStoredHash();
      if (!stored) {
        openCreatePasswordModal();
      } else if (!state.sessionUnlocked) {
        openUnlockModal(() => {
          openChangePasswordModal();
        });
      } else {
        openChangePasswordModal();
      }
    });
  }

  const saveBudgetBtn = document.getElementById('saveBudget');
  if (saveBudgetBtn) {
    saveBudgetBtn.addEventListener('click', () => {
      const val = Number(document.getElementById('budgetInput').value || 0);
      if (val <= 0) {
        showToast('Please specify a positive budget cap.', 'warning');
        return;
      }
      saveMonthlyBudget(val);
      showToast('Budget cap updated.', 'success');
    });
  }

  const copySummaryBtn = document.getElementById('copySummary');
  if (copySummaryBtn) {
    copySummaryBtn.addEventListener('click', () => {
      const text = document.getElementById('monthlySummary').textContent;
      navigator.clipboard.writeText(text).then(() => {
        showToast('Summary report copied to clipboard!', 'success');
      });
    });
  }
}
