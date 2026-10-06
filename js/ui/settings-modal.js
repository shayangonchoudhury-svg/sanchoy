// Sanchoy Unified Settings Dialog
// Appearance, Master Security, Data Portability, Storage Management
import { openModal, closeModal } from './modal.js';
import { getPreferredTheme, applyTheme } from './theme.js';
import { showToast } from './toast.js';
import { getIcon } from './icons.js';
import { getStoredHash, openCreatePasswordModal, openChangePasswordModal, openUnlockModal } from '../auth/auth.js';
import { exportAllApplicationDataJSON, exportTransactionsCSV } from '../settings/settings.js';
import { openAllowanceModal, openStartingBalanceModal, refreshAllViews } from '../transactions/transactions.js';
import { state, LS, safeStorage } from '../core/state.js';

export function openSettingsModal() {
  const currentTheme = getPreferredTheme();

  const html = `
    <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3 mb-5">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
          ${getIcon('settings', { size: 'w-4 h-4' })}
        </div>
        <div>
          <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">System Settings</h3>
          <p class="text-[11px] text-[var(--text-muted)]">Preferences, security, and data portability</p>
        </div>
      </div>
      <button id="closeSettingsModalBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close settings">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="space-y-5 text-xs max-h-[70vh] overflow-y-auto pr-1">
      
      <!-- 1. THEME SELECTION -->
      <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-2.5">
        <div class="flex justify-between items-center">
          <div>
            <span class="font-bold text-[var(--text-primary)] block">Visual Atmosphere</span>
            <span class="text-[10px] text-[var(--text-muted)]">Choose your Sanchoy operational aesthetic</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-1">
          <button id="setThemeDarkBtn" type="button" class="sanchoy-btn ${currentTheme === 'dark' ? 'sanchoy-btn-primary' : 'sanchoy-btn-secondary'} w-full text-xs flex items-center justify-center gap-1.5">
            ${getIcon('moon', { size: 'w-3.5 h-3.5' })}
            <span>Futuristic OS (Dark)</span>
          </button>
          <button id="setThemeLightBtn" type="button" class="sanchoy-btn ${currentTheme === 'light' ? 'sanchoy-btn-primary' : 'sanchoy-btn-secondary'} w-full text-xs flex items-center justify-center gap-1.5">
            ${getIcon('sun', { size: 'w-3.5 h-3.5' })}
            <span>Premium FinTech (Light)</span>
          </button>
        </div>
      </div>

      <!-- 2. SECURITY & PASSCODE -->
      <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-2.5">
        <div class="flex justify-between items-center">
          <div>
            <span class="font-bold text-[var(--text-primary)] block">Master Passcode Security</span>
            <span class="text-[10px] text-[var(--text-muted)]">Local SHA-256 vault encryption and session lock</span>
          </div>
        </div>
        <div class="flex gap-2 pt-1">
          <button id="manageSecurityPasscodeBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary w-full text-xs flex items-center justify-center gap-1.5">
            ${getIcon('key', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)]' })}
            <span>Configure Passcode</span>
          </button>
        </div>
      </div>

      <!-- 2b. CLOUD SYNCHRONIZATION -->
      <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-2.5">
        <div class="flex justify-between items-center">
          <div>
            <span class="font-bold text-[var(--text-primary)] block">Cloud Synchronization</span>
            <span class="text-[10px] text-[var(--text-muted)]">Inspect multi-device sync, offline queues & device ID</span>
          </div>
        </div>
        <div class="flex gap-2 pt-1">
          <button id="settingsOpenSyncCenterBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary w-full text-xs flex items-center justify-center gap-2">
            ${getIcon('sync', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)]' })}
            <span>Open Sync Center</span>
          </button>
        </div>
      </div>

      <!-- 3. FINANCIAL ENGINE CONFIG -->
      <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-2.5">
        <div>
          <span class="font-bold text-[var(--text-primary)] block">Virtual Financial Engine</span>
          <span class="text-[10px] text-[var(--text-muted)]">Configure monthly allowances & wallet baselines</span>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-1">
          <button id="settingsAllowanceBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary w-full text-xs flex items-center justify-center gap-1.5">
            ${getIcon('allowance', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)]' })}
            <span>Monthly Allowance</span>
          </button>
          <button id="settingsBaselineBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary w-full text-xs flex items-center justify-center gap-1.5">
            ${getIcon('startingBalance', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent-secondary)]' })}
            <span>Starting Baseline</span>
          </button>
        </div>
      </div>

      <!-- 4. DATA PORTABILITY & BACKUP -->
      <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-2.5">
        <div>
          <span class="font-bold text-[var(--text-primary)] block">Data Portability</span>
          <span class="text-[10px] text-[var(--text-muted)]">Export and restore full offline JSON records</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <button id="settingsBackupJsonBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary text-xs flex items-center justify-center gap-1.5">
            ${getIcon('backup', { size: 'w-3.5 h-3.5', className: 'text-[var(--text-secondary)]' })}
            <span>Download JSON</span>
          </button>
          <button id="settingsExportCsvBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary text-xs flex items-center justify-center gap-1.5">
            ${getIcon('exportCsv', { size: 'w-3.5 h-3.5', className: 'text-[var(--text-secondary)]' })}
            <span>Export CSV</span>
          </button>
          <button id="settingsImportBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary text-xs sm:col-span-2 flex items-center justify-center gap-1.5">
            ${getIcon('restore', { size: 'w-3.5 h-3.5', className: 'text-[var(--text-secondary)]' })}
            <span>Import Backup File</span>
          </button>
        </div>
      </div>

      <!-- 5. STORAGE RESET -->
      <div class="p-3.5 rounded-xl sanchoy-surface-inset border border-rose-500/20 space-y-2">
        <div>
          <span class="font-bold text-rose-500 block">Reset Bookkeeping Storage</span>
          <span class="text-[10px] text-[var(--text-muted)]">Clears local transactions and wallet balances</span>
        </div>
        <button id="settingsResetStorageBtn" type="button" class="sanchoy-btn sanchoy-btn-danger w-full text-xs flex items-center justify-center gap-1.5">
          ${getIcon('warning', { size: 'w-3.5 h-3.5' })}
          <span>Clear Bookkeeping Data</span>
        </button>
      </div>

    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-md',
    onOpen: (modalEl) => {
      // Close button
      modalEl.querySelector('#closeSettingsModalBtn').addEventListener('click', closeModal);

      // Theme buttons
      modalEl.querySelector('#setThemeDarkBtn').addEventListener('click', () => {
        applyTheme('dark');
        showToast('Switched to Futuristic Financial OS (Dark)', 'info');
        openSettingsModal(); // re-render state
      });
      modalEl.querySelector('#setThemeLightBtn').addEventListener('click', () => {
        applyTheme('light');
        showToast('Switched to Premium FinTech (Light)', 'info');
        openSettingsModal(); // re-render state
      });

      // Passcode
      modalEl.querySelector('#manageSecurityPasscodeBtn').addEventListener('click', async () => {
        closeModal();
        const stored = await getStoredHash();
        if (!stored) {
          openCreatePasswordModal();
        } else if (!state.sessionUnlocked) {
          openUnlockModal(() => openChangePasswordModal());
        } else {
          openChangePasswordModal();
        }
      });

      // Open Sync Center
      modalEl.querySelector('#settingsOpenSyncCenterBtn')?.addEventListener('click', async () => {
        closeModal();
        const { navigate } = await import('./ui.js');
        navigate('/sync');
      });

      // Allowance
      modalEl.querySelector('#settingsAllowanceBtn').addEventListener('click', () => {
        closeModal();
        openAllowanceModal();
      });

      // Baseline
      modalEl.querySelector('#settingsBaselineBtn').addEventListener('click', () => {
        closeModal();
        openStartingBalanceModal();
      });

      // Export JSON
      modalEl.querySelector('#settingsBackupJsonBtn').addEventListener('click', async () => {
        closeModal();
        await exportAllApplicationDataJSON();
        showToast('Full JSON backup generated', 'success');
      });

      // Export CSV
      modalEl.querySelector('#settingsExportCsvBtn').addEventListener('click', () => {
        closeModal();
        exportTransactionsCSV();
        showToast('Transactions exported as CSV', 'success');
      });

      // Import Backup
      modalEl.querySelector('#settingsImportBtn').addEventListener('click', () => {
        closeModal();
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.click();
      });

      // Reset
      modalEl.querySelector('#settingsResetStorageBtn').addEventListener('click', () => {
        closeModal();
        openConfirmClearModal();
      });
    }
  });
}

function openConfirmClearModal() {
  const html = `
    <div class="space-y-4">
      <div class="flex items-center gap-2 text-rose-500 font-bold">
        ${getIcon('warning', { size: 'w-5 h-5', className: 'text-rose-500' })}
        <h3 class="text-sm font-extrabold font-display">Confirm Storage Reset</h3>
      </div>
      <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
        Are you certain you want to clear your local bookkeeping data (transactions, balances, allowance)? Encrypted vault data will be preserved.
      </p>
      <div class="flex gap-2 pt-2">
        <button id="confirmClearBtn" class="flex-1 sanchoy-btn sanchoy-btn-danger text-xs">Yes, Clear Data</button>
        <button id="cancelClearBtn" class="sanchoy-btn sanchoy-btn-secondary text-xs">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-sm',
    onOpen: (el) => {
      el.querySelector('#cancelClearBtn').addEventListener('click', closeModal);
      el.querySelector('#confirmClearBtn').addEventListener('click', () => {
        try {
          safeStorage.removeItem(LS.balances);
          safeStorage.removeItem(LS.transactions);
          safeStorage.removeItem(LS.budget);
          safeStorage.removeItem(LS.startingBalances);
          safeStorage.removeItem(LS.allowanceConfig);
        } catch (e) {}
        refreshAllViews();
        closeModal();
        showToast('Bookkeeping storage reset successfully.', 'info');
      });
    }
  });
}
