// Secret Savings Vault Cryptography & Allocation Nodes Controller
import { state, setVaultUnlocked, setVaultDarkTheme, setVaultCryptoKey, setDecryptedVaultRecords, safeStorage } from '../core/state.js';
export { setDecryptedVaultRecords } from '../core/state.js';
import { AppDB } from '../storage/database.js';
import { downloadBlob, escapeHtml } from '../utils/utils.js';
import { getIcon } from '../ui/icons.js';
import { getStoredHash, hashPassword, openCreatePasswordModal, triggerForgotPasswordFlow } from '../auth/auth.js';
import { showToast } from '../ui/toast.js';
import { openModal, closeModal } from '../ui/modal.js';
import { events } from '../core/events.js';
import { enqueueMutation, VAULT_MUTATION_TYPES } from '../sync/queue.js';
import {
  VAULT_TYPES,
  VAULT_CATEGORIES,
  generateVaultRecordId,
  validateVaultTransaction,
  calculateVaultBalance,
  reconstructVaultHistory,
  calculateVaultAnalytics,
  calculateHoldingsSummary
} from '../financial/vault-ledger.js';

export {
  VAULT_TYPES,
  VAULT_CATEGORIES,
  generateVaultRecordId,
  validateVaultTransaction,
  calculateVaultBalance,
  reconstructVaultHistory,
  calculateVaultAnalytics,
  calculateHoldingsSummary
};

let vaultDoughnutChart = null;
let vaultLineChart = null;
let currentVaultTypeFilter = 'all';

// --- Cryptographic Services (Web Crypto API) ---

export async function getOrCreateSalt() {
  if (!AppDB.db) {
    return new Uint8Array([101, 120, 112, 101, 110, 115, 101, 95, 116, 114, 97, 99, 107, 101, 114, 95]);
  }
  let saltRecord = await AppDB.get('app_settings', 'vault_salt');
  if (!saltRecord) {
    const randomSalt = crypto.getRandomValues(new Uint8Array(16));
    saltRecord = { key: 'vault_salt', value: Array.from(randomSalt) };
    await AppDB.put('app_settings', saltRecord);
  }
  return new Uint8Array(saltRecord.value);
}

export async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptRecord(record, key) {
  const encoder = new TextEncoder();
  const sensitiveData = {
    // Legacy snapshot fields (preserved for backwards compatibility)
    cashSavings: record.cashSavings !== undefined ? record.cashSavings : 0,
    onlineSavings: record.onlineSavings !== undefined ? record.onlineSavings : 0,
    extraSavings: record.extraSavings !== undefined ? record.extraSavings : 0,
    emergencySavings: record.emergencySavings !== undefined ? record.emergencySavings : 0,
    investments: record.investments !== undefined ? record.investments : 0,
    goldSavings: record.goldSavings !== undefined ? record.goldSavings : 0,
    otherSavings: record.otherSavings !== undefined ? record.otherSavings : 0,
    notes: record.notes !== undefined ? record.notes : '',
    // Vault ledger fields
    type: record.type || null,
    amount: record.amount !== undefined ? record.amount : null,
    date: record.date || null,
    sourceWallet: record.sourceWallet || null,
    destinationWallet: record.destinationWallet || null,
    category: record.category || null,
    description: record.description || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    deviceId: record.deviceId || null,
    revision: record.revision || null,
    deleted: record.deleted || false
  };

  const plaintext = JSON.stringify(sensitiveData);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const ctHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    id: record.id,
    month: record.month || (record.date ? record.date.slice(0, 7) : '2026-10'),
    iv: ivHex,
    data: ctHex
  };
}

export async function decryptRecord(encryptedRecord, key) {
  try {
    if (!encryptedRecord.iv || !encryptedRecord.data) {
      return encryptedRecord;
    }
    const iv = new Uint8Array(encryptedRecord.iv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const ciphertext = new Uint8Array(encryptedRecord.data.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const decoder = new TextDecoder();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const sensitiveFields = JSON.parse(decoder.decode(decrypted));
    return {
      id: encryptedRecord.id,
      month: encryptedRecord.month,
      ...sensitiveFields
    };
  } catch (e) {
    console.error('Decryption failed for record:', encryptedRecord.id, e);
    return null;
  }
}

// --- Data Operations & Persistence ---

export function getVaultSavings() {
  if (state.decryptedVaultRecords && state.decryptedVaultRecords.length > 0) {
    return state.decryptedVaultRecords;
  }
  try {
    const cached = safeStorage.getItem('sanchoy_vault_records_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setDecryptedVaultRecords(parsed);
        return parsed;
      }
    }
  } catch (e) {}
  return state.decryptedVaultRecords || [];
}

export async function saveVaultSavingsAsync(records) {
  setDecryptedVaultRecords(records);
  try {
    safeStorage.setItem('sanchoy_vault_records_cache', JSON.stringify(records));
  } catch (e) {}

  if (AppDB.db) {
    try {
      const existing = await AppDB.getAll('savings_vault');
      const newIds = new Set(records.map(r => r.id));
      for (const oldRec of existing) {
        if (!newIds.has(oldRec.id)) {
          await AppDB.delete('savings_vault', oldRec.id);
        }
      }
      if (state.vaultCryptoKey) {
        const encryptedRecords = [];
        for (const r of records) {
          const enc = await encryptRecord(r, state.vaultCryptoKey);
          encryptedRecords.push(enc);
        }
        await AppDB.putAll('savings_vault', encryptedRecords);
      } else {
        await AppDB.putAll('savings_vault', records);
      }

      if (records.length > 0) {
        const ach = await AppDB.get('achievements', 'vault_keeper');
        if (ach && !ach.unlocked) {
          ach.unlocked = true;
          ach.progress = 100;
          await AppDB.put('achievements', ach);
        }
      }
    } catch (e) {
      console.error('Error encrypting/saving vault records:', e);
    }
  }
  return records;
}

export function saveVaultSavings(records) {
  setDecryptedVaultRecords(records);
  try {
    safeStorage.setItem('sanchoy_vault_records_cache', JSON.stringify(records));
  } catch (e) {}
  saveVaultSavingsAsync(records).catch(() => {});
}

/**
 * Deposits money into Vault from Online Wallet or Cash Wallet
 * Internal transfer: Wallet decreases, Vault increases. Not an expense.
 */
export async function depositToVault({ amount, sourceWallet, date, description, currentBalances = null }) {
  const numAmt = Number(amount);
  const src = String(sourceWallet || '').toLowerCase();
  const txDate = date || new Date().toISOString().slice(0, 10);
  const txDesc = description || `Added to Vault from ${src === 'online' ? 'Online' : 'Cash'} Wallet`;

  let balances = currentBalances;
  if (!balances) {
    try {
      const { getBalances } = await import('../transactions/transactions.js');
      const walletBalances = getBalances();
      const vaultBal = calculateVaultBalance(getVaultSavings());
      balances = { online: walletBalances.online, cash: walletBalances.cash, vault: vaultBal };
    } catch (e) {
      balances = { online: 0, cash: 0, vault: calculateVaultBalance(getVaultSavings()) };
    }
  }

  const txProposal = {
    type: VAULT_TYPES.DEPOSIT,
    amount: numAmt,
    date: txDate,
    sourceWallet: src,
    destinationWallet: 'vault'
  };

  const validation = validateVaultTransaction(txProposal, balances);
  if (!validation.valid) {
    showToast(validation.error, 'danger');
    return { success: false, error: validation.error };
  }

  const record = {
    id: generateVaultRecordId(),
    type: VAULT_TYPES.DEPOSIT,
    amount: numAmt,
    date: txDate,
    sourceWallet: src,
    destinationWallet: 'vault',
    category: 'Vault Deposit',
    description: txDesc,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const records = [...getVaultSavings(), record];
  await saveVaultSavingsAsync(records);

  try {
    enqueueMutation(VAULT_MUTATION_TYPES.CREATE, record, record.id);
    import('../firebase/sync.js').then(m => m.syncWorkspaceToCloud('vault_deposit')).catch(() => {});
  } catch (e) {}

  try {
    const { refreshAllViews } = await import('../transactions/transactions.js');
    refreshAllViews();
  } catch (e) {}
  renderVault();

  events.emit('vault:change', records);
  events.emit('balances:change');

  showToast(`₹${numAmt.toFixed(2)} added to Vault from ${src === 'online' ? 'Online' : 'Cash'} Wallet`, 'success');
  return { success: true, record };
}

/**
 * Withdraws money from Vault to Online Wallet or Cash Wallet
 * Internal transfer: Vault decreases, Wallet increases. Not income.
 */
export async function withdrawFromVault({ amount, destinationWallet, date, description, currentBalances = null }) {
  const numAmt = Number(amount);
  const dst = String(destinationWallet || '').toLowerCase();
  const txDate = date || new Date().toISOString().slice(0, 10);
  const txDesc = description || `Withdrawn to ${dst === 'online' ? 'Online' : 'Cash'} Wallet`;

  let balances = currentBalances;
  if (!balances) {
    try {
      const { getBalances } = await import('../transactions/transactions.js');
      const walletBalances = getBalances();
      const vaultBal = calculateVaultBalance(getVaultSavings());
      balances = { online: walletBalances.online, cash: walletBalances.cash, vault: vaultBal };
    } catch (e) {
      balances = { online: 0, cash: 0, vault: calculateVaultBalance(getVaultSavings()) };
    }
  }

  const txProposal = {
    type: VAULT_TYPES.WITHDRAWAL,
    amount: numAmt,
    date: txDate,
    sourceWallet: 'vault',
    destinationWallet: dst
  };

  const validation = validateVaultTransaction(txProposal, balances);
  if (!validation.valid) {
    showToast(validation.error, 'danger');
    return { success: false, error: validation.error };
  }

  const record = {
    id: generateVaultRecordId(),
    type: VAULT_TYPES.WITHDRAWAL,
    amount: numAmt,
    date: txDate,
    sourceWallet: 'vault',
    destinationWallet: dst,
    category: 'Vault Withdrawal',
    description: txDesc,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const records = [...getVaultSavings(), record];
  await saveVaultSavingsAsync(records);

  try {
    enqueueMutation(VAULT_MUTATION_TYPES.CREATE, record, record.id);
    import('../firebase/sync.js').then(m => m.syncWorkspaceToCloud('vault_withdrawal')).catch(() => {});
  } catch (e) {}

  try {
    const { refreshAllViews } = await import('../transactions/transactions.js');
    refreshAllViews();
  } catch (e) {}
  renderVault();

  events.emit('vault:change', records);
  events.emit('balances:change');

  showToast(`₹${numAmt.toFixed(2)} withdrawn from Vault to ${dst === 'online' ? 'Online' : 'Cash'} Wallet`, 'success');
  return { success: true, record };
}

/**
 * Records external spending directly from Vault savings
 * Vault decreases, Online & Cash are UNTOUCHED, Liquid balance is UNTOUCHED.
 * Total Sanchoy Holdings decreases.
 */
export async function spendFromVault({ amount, category, description, date, currentBalances = null }) {
  const numAmt = Number(amount);
  const cat = category || 'Other';
  const txDate = date || new Date().toISOString().slice(0, 10);
  const txDesc = description || 'Spent from Vault';

  let balances = currentBalances;
  if (!balances) {
    try {
      const { getBalances } = await import('../transactions/transactions.js');
      const walletBalances = getBalances();
      const vaultBal = calculateVaultBalance(getVaultSavings());
      balances = { online: walletBalances.online, cash: walletBalances.cash, vault: vaultBal };
    } catch (e) {
      balances = { online: 0, cash: 0, vault: calculateVaultBalance(getVaultSavings()) };
    }
  }

  const txProposal = {
    type: VAULT_TYPES.SPEND,
    amount: numAmt,
    date: txDate,
    sourceWallet: 'vault',
    destinationWallet: 'external',
    category: cat
  };

  const validation = validateVaultTransaction(txProposal, balances);
  if (!validation.valid) {
    showToast(validation.error, 'danger');
    return { success: false, error: validation.error };
  }

  const record = {
    id: generateVaultRecordId(),
    type: VAULT_TYPES.SPEND,
    amount: numAmt,
    date: txDate,
    sourceWallet: 'vault',
    destinationWallet: 'external',
    category: cat,
    description: txDesc,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const records = [...getVaultSavings(), record];
  await saveVaultSavingsAsync(records);

  try {
    enqueueMutation(VAULT_MUTATION_TYPES.CREATE, record, record.id);
    import('../firebase/sync.js').then(m => m.syncWorkspaceToCloud('vault_spend')).catch(() => {});
  } catch (e) {}

  try {
    const { refreshAllViews } = await import('../transactions/transactions.js');
    refreshAllViews();
  } catch (e) {}
  renderVault();

  events.emit('vault:change', records);
  events.emit('balances:change');

  showToast(`₹${numAmt.toFixed(2)} spent from Vault for ${cat}`, 'success');
  return { success: true, record };
}

export function getRecordSum(r) {
  return Number(r.cashSavings || 0) + Number(r.onlineSavings || 0) + Number(r.extraSavings || 0) +
         Number(r.emergencySavings || 0) + Number(r.investments || 0) + Number(r.goldSavings || 0) + Number(r.otherSavings || 0);
}

/**
 * Applies a resolved Vault record (or deletion if null), updates storage,
 * and triggers deterministic recalculation of Vault & Holdings.
 */
export async function applyVaultConflictResolution(recordId, resolvedRecord) {
  const records = getVaultSavings();
  const existingIdx = records.findIndex(r => r.id === recordId);

  let updated;
  if (resolvedRecord) {
    if (existingIdx >= 0) {
      updated = [...records];
      updated[existingIdx] = resolvedRecord;
    } else {
      updated = [...records, resolvedRecord];
    }
  } else {
    // Resolved by deletion
    updated = records.filter(r => r.id !== recordId);
  }

  // Deduplicate records by stable ID
  const deduped = [];
  const seenIds = new Set();
  for (const r of updated) {
    if (r && r.id && !seenIds.has(r.id)) {
      seenIds.add(r.id);
      deduped.push(r);
    }
  }

  await saveVaultSavingsAsync(deduped);
  renderVault();

  try {
    const { refreshAllViews } = await import('../transactions/transactions.js');
    refreshAllViews();
  } catch (e) {}

  events.emit('vault:change', updated);
  events.emit('balances:change');

  return updated;
}


// --- UI Controllers ---

export async function openVaultUnlockModal(onNavigate = null) {
  const stored = await getStoredHash();
  if (!stored) {
    openCreatePasswordModal();
    return;
  }

  const unlockContent = document.createElement('div');
  unlockContent.className = "space-y-6 text-center py-4";
  unlockContent.innerHTML = `
    <div class="mx-auto w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-3xl flex items-center justify-center shadow-lg shadow-amber-500/20 mb-4 animate-bounce text-white">
      ${getIcon('vault', { size: 'w-8 h-8', className: 'text-white' })}
    </div>
    <h3 class="text-xl font-extrabold tracking-tight font-serif-editorial bg-gradient-to-r from-amber-500 to-yellow-500 bg-clip-text text-transparent">Authenticate Vault Access</h3>
    <p class="text-xs text-[var(--text-muted)] max-w-xs mx-auto">This sector contains classified savings and allocation ledger states. Enter the Master Password to decrypt.</p>
    
    <div class="space-y-3 pt-3">
      <div class="relative">
        <input type="password" id="vaultAuthPass" placeholder="Enter Master Password" class="w-full px-4 py-3 text-xs font-bold rounded-xl text-center focus:outline-none focus:ring-2 focus:ring-amber-500/50 sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)]" />
        <button id="toggleVaultAuthPass" class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
      </div>
      <div id="vaultAuthError" class="text-[10px] text-rose-500 font-bold hidden">Incorrect Master Password</div>
    </div>

    <div class="flex gap-3 pt-4 pb-2">
      <button id="confirmVaultUnlock" class="flex-1 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 flex items-center justify-center gap-1.5 cursor-pointer">
        ${getIcon('key', { size: 'w-4 h-4' })}
        <span>Unlock Sanctuary</span>
      </button>
      <button id="cancelVaultUnlock" class="py-3 px-5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl transition-all">
        Cancel
      </button>
    </div>

    <div class="text-center pt-3 border-t border-slate-100 dark:border-slate-800/50">
      <button id="vaultForgotPasswordBtn" class="text-[11px] text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 font-semibold underline bg-transparent border-0 cursor-pointer">
        Forgot Master Password?
      </button>
    </div>
  `;

  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  content.innerHTML = '';
  content.appendChild(unlockContent);
  modal.classList.add('show');
  modal.style.display = 'flex';

  const authInput = document.getElementById('vaultAuthPass');
  if (authInput) authInput.focus();

  document.getElementById('toggleVaultAuthPass').addEventListener('click', () => {
    authInput.type = authInput.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('vaultForgotPasswordBtn').addEventListener('click', () => {
    triggerForgotPasswordFlow();
  });

  const confirmUnlock = async () => {
    const entered = authInput.value;
    const error = document.getElementById('vaultAuthError');

    if (!entered) {
      error.textContent = "Please enter your password.";
      error.classList.remove('hidden');
      return;
    }

    const enteredHash = await hashPassword(entered);
    if (enteredHash === stored) {
      try {
        const salt = await getOrCreateSalt();
        const derived = await deriveKey(entered, salt);
        setVaultCryptoKey(derived);

        const rawRecords = await AppDB.getAll('savings_vault');
        const decrypted = [];
        let needsReEncryption = false;

        for (const r of rawRecords) {
          const decryptedRec = await decryptRecord(r, derived);
          if (decryptedRec) {
            decrypted.push(decryptedRec);
            if (!r.data || !r.iv) {
              needsReEncryption = true;
            }
          }
        }

        setDecryptedVaultRecords(decrypted);

        if (needsReEncryption) {
          const encryptedRecords = [];
          for (const r of decrypted) {
            const enc = await encryptRecord(r, derived);
            encryptedRecords.push(enc);
          }
          await AppDB.putAll('savings_vault', encryptedRecords);
        }

        setVaultUnlocked(true);
        modal.classList.remove('show');
        modal.style.display = 'none';

        if (typeof onNavigate === 'function') {
          onNavigate('/vault');
        }
      } catch (e) {
        console.error('Error during vault decryption:', e);
        error.textContent = "Error decrypting vault data: " + e.message;
        error.classList.remove('hidden');
      }
    } else {
      error.textContent = "Incorrect Master Password";
      error.classList.remove('hidden');

      authInput.classList.add('animate-shake', 'border-rose-500');
      setTimeout(() => {
        authInput.classList.remove('animate-shake', 'border-rose-500');
      }, 500);
    }
  };

  document.getElementById('confirmVaultUnlock').addEventListener('click', confirmUnlock);
  authInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmUnlock();
  });

  document.getElementById('cancelVaultUnlock').addEventListener('click', () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  });
}

export function setVaultTypeFilter(filter) {
  currentVaultTypeFilter = filter;
  ['vaultFilterAll', 'vaultFilterDeposits', 'vaultFilterWithdrawals', 'vaultFilterSpends'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const isActive = (filter === 'all' && id === 'vaultFilterAll') ||
      (filter === 'deposit' && id === 'vaultFilterDeposits') ||
      (filter === 'withdrawal' && id === 'vaultFilterWithdrawals') ||
      (filter === 'spend' && id === 'vaultFilterSpends');
    if (isActive) {
      btn.className = "px-2.5 py-1 text-xs font-bold rounded-md transition-all bg-[var(--accent)] text-white";
    } else {
      btn.className = "px-2.5 py-1 text-xs font-bold rounded-md transition-all text-[var(--text-muted)] hover:text-[var(--text-primary)]";
    }
  });
  renderVaultList(getVaultSavings());
}

export function renderVault() {
  if (typeof document === 'undefined') return;

  const records = getVaultSavings();
  const grandTotal = calculateVaultBalance(records);

  const totalSavingsEl = document.getElementById('vault-total-savings');
  const totalHoldingsEl = document.getElementById('vault-total-holdings');

  if (totalSavingsEl) {
    totalSavingsEl.textContent = '₹' + grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Asynchronously query liquid wallet balances to show Total Sanchoy Holdings
  try {
    import('../transactions/transactions.js').then(({ getBalances }) => {
      const wb = getBalances();
      const h = calculateHoldingsSummary(wb.online, wb.cash, grandTotal);
      if (totalHoldingsEl) {
        totalHoldingsEl.textContent = '₹' + h.totalHoldings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }).catch(() => {});
  } catch (e) {}

  // Flow analytics
  const analytics = calculateVaultAnalytics(records);
  const depEl = document.getElementById('vault-flow-deposits');
  const withEl = document.getElementById('vault-flow-withdrawals');
  const spEl = document.getElementById('vault-flow-spends');
  const countEl = document.getElementById('vault-active-categories');

  if (depEl) depEl.textContent = `+₹${analytics.totalDeposited.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (withEl) withEl.textContent = `−₹${analytics.totalWithdrawn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (spEl) spEl.textContent = `−₹${analytics.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const activeCount = records.filter(r => !r.deleted).length;
  if (countEl) countEl.textContent = `${activeCount} Record${activeCount === 1 ? '' : 's'}`;

  renderVaultList(records);
  renderVaultCharts(records);
}

export function renderVaultList(records = []) {
  const container = document.getElementById('vault-timeline-list');
  const searchInput = document.getElementById('vaultSearch');
  const sortSelect = document.getElementById('vaultSort');
  if (!container) return;

  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const sortVal = sortSelect ? sortSelect.value : 'newest';

  let filtered = (records || []).filter(r => {
    if (!r || r.deleted) return false;

    // Type filter
    if (currentVaultTypeFilter === 'deposit') {
      if (r.type && r.type !== VAULT_TYPES.DEPOSIT) return false;
    } else if (currentVaultTypeFilter === 'withdrawal') {
      if (r.type !== VAULT_TYPES.WITHDRAWAL) return false;
    } else if (currentVaultTypeFilter === 'spend') {
      if (r.type !== VAULT_TYPES.SPEND) return false;
    }

    // Search filter
    if (searchVal) {
      const desc = (r.description || r.notes || '').toLowerCase();
      const cat = (r.category || '').toLowerCase();
      const dateStr = (r.date || r.month || '').toLowerCase();
      const amtStr = String(r.amount !== undefined ? r.amount : getRecordSum(r));
      return desc.includes(searchVal) || cat.includes(searchVal) || dateStr.includes(searchVal) || amtStr.includes(searchVal);
    }
    return true;
  });

  const getRecordDate = (r) => {
    if (r.date) return new Date(r.date).getTime() || 0;
    if (r.month) return new Date(`${r.month}-01`).getTime() || 0;
    return new Date(r.createdAt || 0).getTime() || 0;
  };

  const getRecordAmt = (r) => {
    if (r.amount !== undefined && r.amount !== null) return Number(r.amount) || 0;
    return getRecordSum(r);
  };

  if (sortVal === 'newest') {
    filtered.sort((a, b) => getRecordDate(b) - getRecordDate(a));
  } else if (sortVal === 'oldest') {
    filtered.sort((a, b) => getRecordDate(a) - getRecordDate(b));
  } else if (sortVal === 'high-savings') {
    filtered.sort((a, b) => getRecordAmt(b) - getRecordAmt(a));
  } else if (sortVal === 'low-savings') {
    filtered.sort((a, b) => getRecordAmt(a) - getRecordAmt(b));
  }

  const countBadge = document.getElementById('vault-count-badge');
  if (countBadge) {
    countBadge.textContent = `${filtered.length} Record${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 rounded-2xl border border-dashed border-[var(--border-subtle)] p-6">
        <div class="inline-flex p-3 rounded-2xl sanchoy-surface-inset text-[var(--accent)] mb-2">
          ${getIcon('vault', { size: 'w-8 h-8' })}
        </div>
        <h4 class="font-bold text-sm text-[var(--text-primary)] mt-2 font-serif-editorial">No Vault Activity Recorded</h4>
        <p class="text-xs text-[var(--text-muted)] mt-1 max-w-sm mx-auto">Transfer funds from Online or Cash wallet to establish your sovereign reserve.</p>
        <button onclick="window.openDepositModal()" class="mt-4 px-4 py-2 sanchoy-btn sanchoy-btn-primary text-xs font-bold shadow-sm transition-all cursor-pointer inline-flex items-center gap-1.5">
          ${getIcon('plus', { size: 'w-3.5 h-3.5' })}
          <span>Add to Vault</span>
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  filtered.forEach(r => {
    const isDeposit = r.type === VAULT_TYPES.DEPOSIT;
    const isWithdrawal = r.type === VAULT_TYPES.WITHDRAWAL;
    const isSpend = r.type === VAULT_TYPES.SPEND;

    const recordCard = document.createElement('div');
    recordCard.className = "sanchoy-card p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--border)] transition-all space-y-3";

    let cardContent = '';

    if (isDeposit) {
      const srcName = String(r.sourceWallet).toLowerCase() === 'cash' ? 'Cash Wallet' : 'Online Wallet';
      const numAmt = Number(r.amount) || 0;
      cardContent = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
          <div class="flex items-center gap-2 text-xs font-mono text-[var(--income)]">
            ${getIcon('deposit', { size: 'w-3.5 h-3.5', className: 'text-[var(--income)] shrink-0' })}
            <span class="font-bold tracking-wider uppercase">Deposit</span>
            <span aria-hidden="true" class="text-[var(--text-muted)]">·</span>
            <span class="text-[var(--text-secondary)] font-sans font-medium">${srcName} → Vault</span>
            <span aria-hidden="true" class="text-[var(--text-muted)]">·</span>
            <span class="text-[var(--text-muted)]">${r.date || 'Today'}</span>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <button onclick="window.openVaultDeleteModal('${r.id}')" class="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors cursor-pointer" title="Delete Entry">
              Delete
            </button>
          </div>
        </div>
        <div class="flex justify-between items-center gap-4">
          <p class="text-xs text-[var(--text-secondary)] font-medium leading-relaxed">${escapeHtml(r.description || 'Added to Vault')}</p>
          <span class="text-base sm:text-lg font-bold font-mono text-[var(--income)] whitespace-nowrap">
            +₹${numAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      `;
    } else if (isWithdrawal) {
      const dstName = String(r.destinationWallet).toLowerCase() === 'cash' ? 'Cash Wallet' : 'Online Wallet';
      const numAmt = Number(r.amount) || 0;
      cardContent = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
          <div class="flex items-center gap-2 text-xs font-mono text-[var(--accent)]">
            ${getIcon('withdraw', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)] shrink-0' })}
            <span class="font-bold tracking-wider uppercase">Withdrawal</span>
            <span aria-hidden="true" class="text-[var(--text-muted)]">·</span>
            <span class="text-[var(--text-secondary)] font-sans font-medium">Vault → ${dstName}</span>
            <span aria-hidden="true" class="text-[var(--text-muted)]">·</span>
            <span class="text-[var(--text-muted)]">${r.date || 'Today'}</span>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <button onclick="window.openVaultDeleteModal('${r.id}')" class="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors cursor-pointer" title="Delete Entry">
              Delete
            </button>
          </div>
        </div>
        <div class="flex justify-between items-center gap-4">
          <p class="text-xs text-[var(--text-secondary)] font-medium leading-relaxed">${escapeHtml(r.description || 'Withdrawn to Wallet')}</p>
          <span class="text-base sm:text-lg font-bold font-mono text-[var(--accent)] whitespace-nowrap">
            −₹${numAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      `;
    } else if (isSpend) {
      const numAmt = Number(r.amount) || 0;
      cardContent = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
          <div class="flex items-center gap-2 text-xs font-mono text-[var(--expense)]">
            ${getIcon('tag', { size: 'w-3.5 h-3.5', className: 'text-[var(--expense)] shrink-0' })}
            <span class="font-bold tracking-wider uppercase">Direct Spend</span>
            <span aria-hidden="true" class="text-[var(--text-muted)]">·</span>
            <span class="text-[var(--text-secondary)] font-sans font-medium">External: ${escapeHtml(r.category || 'Other')}</span>
            <span aria-hidden="true" class="text-[var(--text-muted)]">·</span>
            <span class="text-[var(--text-muted)]">${r.date || 'Today'}</span>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <button onclick="window.openVaultDeleteModal('${r.id}')" class="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors cursor-pointer" title="Delete Entry">
              Delete
            </button>
          </div>
        </div>
        <div class="flex justify-between items-center gap-4">
          <div>
            <p class="text-xs text-[var(--text-secondary)] font-medium leading-relaxed">${escapeHtml(r.description || 'Spent from Vault')}</p>
            <p class="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">Direct reserve deduction · Virtual allowances unaffected</p>
          </div>
          <span class="text-base sm:text-lg font-bold font-mono text-[var(--expense)] whitespace-nowrap">
            −₹${numAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      `;
    } else {
      // Legacy snapshot node
      const [y, m] = (r.month || '2026-01').split('-');
      const dObj = new Date(Number(y), Number(m) - 1, 1);
      const monthTitle = dObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const totalSavings = getRecordSum(r);
      cardContent = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
          <div class="flex items-center gap-2 text-xs font-mono text-[var(--accent-secondary)]">
            ${getIcon('vault', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent-secondary)] shrink-0' })}
            <span class="font-bold tracking-wider uppercase">${monthTitle}</span>
            <span aria-hidden="true" class="text-[var(--text-muted)]">·</span>
            <span class="text-[var(--text-muted)] font-sans font-medium">Monthly Snapshot</span>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <button onclick="window.editVaultRecord('${r.id}')" class="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" title="Edit Record">
              Edit
            </button>
            <span class="text-[var(--border)]">·</span>
            <button onclick="window.openVaultDeleteModal('${r.id}')" class="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors cursor-pointer" title="Delete Record">
              Delete
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div class="p-2 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)]">
            <p class="text-[9px] font-bold text-[var(--text-muted)] uppercase font-mono">Cash</p>
            <p class="font-bold font-mono text-[var(--text-primary)] mt-0.5">₹${Number(r.cashSavings || 0).toLocaleString()}</p>
          </div>
          <div class="p-2 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)]">
            <p class="text-[9px] font-bold text-[var(--text-muted)] uppercase font-mono">Online</p>
            <p class="font-bold font-mono text-[var(--text-primary)] mt-0.5">₹${Number(r.onlineSavings || 0).toLocaleString()}</p>
          </div>
          <div class="p-2 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)]">
            <p class="text-[9px] font-bold text-[var(--text-muted)] uppercase font-mono">Invest</p>
            <p class="font-bold font-mono text-[var(--text-primary)] mt-0.5">₹${Number(r.investments || 0).toLocaleString()}</p>
          </div>
          <div class="p-2 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)]">
            <p class="text-[9px] font-bold text-[var(--accent-secondary)] uppercase font-mono">Sum</p>
            <p class="font-bold font-mono text-[var(--text-primary)] mt-0.5">₹${Number(totalSavings || 0).toLocaleString()}</p>
          </div>
        </div>
        ${r.notes ? `
          <div class="p-2.5 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] italic flex items-start gap-1.5">
            ${getIcon('note', { size: 'w-3.5 h-3.5', className: 'text-[var(--text-muted)] mt-0.5 shrink-0' })}
            <span>${escapeHtml(r.notes)}</span>
          </div>
        ` : ''}
      `;
    }

    recordCard.innerHTML = cardContent;
    container.appendChild(recordCard);
  });
}

export function renderVaultCharts(records = []) {
  const ctxDoughnut = document.getElementById('vaultDoughnutChart');
  const ctxLine = document.getElementById('vaultLineChart');
  if (!ctxDoughnut || !ctxLine) return;

  if (typeof Chart === 'undefined') return;

  if (vaultDoughnutChart) vaultDoughnutChart.destroy();
  if (vaultLineChart) vaultLineChart.destroy();

  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(243, 241, 236, 0.08)' : 'rgba(21, 30, 27, 0.08)';
  const textColor = isDark ? '#b1bdb9' : '#485450';

  const activeRecords = (records || []).filter(r => r && !r.deleted);

  // Category & flow breakdown for Doughnut:
  let onlineDeposits = 0;
  let cashDeposits = 0;
  let categorySpends = {};
  let legacyTotals = 0;

  activeRecords.forEach(r => {
    if (r.type === VAULT_TYPES.DEPOSIT) {
      if (String(r.sourceWallet).toLowerCase() === 'cash') {
        cashDeposits += Number(r.amount) || 0;
      } else {
        onlineDeposits += Number(r.amount) || 0;
      }
    } else if (r.type === VAULT_TYPES.SPEND) {
      const cat = r.category || 'Other';
      categorySpends[cat] = (categorySpends[cat] || 0) + (Number(r.amount) || 0);
    } else if (!r.type) {
      legacyTotals += getRecordSum(r);
    }
  });

  const doughnutLabels = [];
  const doughnutData = [];
  const doughnutColors = [
    '#fbbf24', '#34d399', '#38bdf8', '#f87171', '#818cf8', '#facc15', '#a78bfa', '#fb923c'
  ];

  if (onlineDeposits > 0) {
    doughnutLabels.push('Online Deposits');
    doughnutData.push(onlineDeposits);
  }
  if (cashDeposits > 0) {
    doughnutLabels.push('Cash Deposits');
    doughnutData.push(cashDeposits);
  }
  Object.entries(categorySpends).forEach(([cat, val]) => {
    doughnutLabels.push(`Spend: ${cat}`);
    doughnutData.push(val);
  });
  if (legacyTotals > 0) {
    doughnutLabels.push('Legacy Snapshots');
    doughnutData.push(legacyTotals);
  }

  if (doughnutData.length === 0) {
    doughnutLabels.push('Protected Vault Reserve');
    doughnutData.push(1);
  }

  vaultDoughnutChart = new Chart(ctxDoughnut, {
    type: 'doughnut',
    data: {
      labels: doughnutLabels,
      datasets: [{
        data: doughnutData,
        backgroundColor: doughnutColors.slice(0, doughnutLabels.length),
        borderWidth: isDark ? 2 : 1,
        borderColor: isDark ? '#020617' : '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: textColor,
            font: { size: 9, family: 'Plus Jakarta Sans', weight: 'bold' },
            boxWidth: 10
          }
        }
      }
    }
  });

  // Cumulative line chart using reconstructVaultHistory
  const { history } = reconstructVaultHistory(records);
  let lineLabels = [];
  let lineData = [];

  if (history.length === 0) {
    lineLabels = ['Start'];
    lineData = [0];
  } else {
    lineLabels = history.map(h => {
      if (h.date) {
        const d = new Date(h.date);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
      }
      return h.month || 'Entry';
    });
    lineData = history.map(h => h.balanceAfter);
  }

  vaultLineChart = new Chart(ctxLine, {
    type: 'line',
    data: {
      labels: lineLabels,
      datasets: [{
        label: 'Protected Savings Balance',
        data: lineData,
        borderColor: '#fbbf24',
        backgroundColor: isDark ? 'rgba(251, 191, 36, 0.12)' : 'rgba(251, 191, 36, 0.06)',
        fill: true,
        tension: 0.3,
        borderWidth: 2.5,
        pointBackgroundColor: '#fbbf24',
        pointRadius: 4.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: 9, family: 'Plus Jakarta Sans', weight: 'bold' } }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: 9, family: 'Plus Jakarta Sans', weight: 'bold' } }
        }
      }
    }
  });
}

export function updateVaultStyles() {
  const isDark = document.documentElement.classList.contains('dark');
  const wrapper = document.getElementById('vault-theme-wrapper');
  const subtitle = document.getElementById('vault-subtitle');

  const cLifetime = document.getElementById('card-lifetime');
  const cGrowth = document.getElementById('card-growth');
  const cAllocation = document.getElementById('card-allocation');
  const opsBar = document.getElementById('operations-bar');
  const cBreakdown = document.getElementById('chart-breakdown-card');
  const cRoadmap = document.getElementById('chart-roadmap-card');

  if (!wrapper) return;

  if (isDark) {
    wrapper.className = "rounded-3xl p-6 sm:p-8 space-y-8 duration-300 bg-[var(--surface)] backdrop-blur-2xl border border-[var(--border-subtle)] shadow-2xl text-[var(--text-primary)]";
    if (subtitle) subtitle.className = "text-xs sm:text-sm text-[var(--text-muted)] font-medium mt-0.5";

    if (cLifetime) cLifetime.className = "rounded-2xl p-6 border border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40 transition-all duration-300 shadow-lg relative overflow-hidden";
    if (cGrowth) cGrowth.className = "rounded-2xl p-6 border border-[var(--border-subtle)] sanchoy-surface-inset transition-all duration-300 shadow-md";
    if (cAllocation) cAllocation.className = "rounded-2xl p-6 border border-[var(--border-subtle)] sanchoy-surface-inset transition-all duration-300 shadow-md";
    if (opsBar) opsBar.className = "flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 p-4 rounded-2xl border border-[var(--border-subtle)] sanchoy-surface-inset transition-all duration-300";
    if (cBreakdown) cBreakdown.className = "rounded-2xl p-6 border border-[var(--border-subtle)] sanchoy-surface-inset transition-all duration-300 shadow-md";
    if (cRoadmap) cRoadmap.className = "rounded-2xl p-6 border border-[var(--border-subtle)] sanchoy-surface-inset transition-all duration-300 shadow-md";
  } else {
    wrapper.className = "rounded-3xl p-6 sm:p-8 space-y-8 duration-300 bg-[var(--surface)] backdrop-blur-2xl border border-[var(--border)] shadow-sm text-[var(--text-primary)]";
    if (subtitle) subtitle.className = "text-xs sm:text-sm text-[var(--text-muted)] font-medium mt-0.5";

    if (cLifetime) cLifetime.className = "rounded-2xl p-6 border border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50 transition-all duration-300 shadow-lg relative overflow-hidden";
    if (cGrowth) cGrowth.className = "rounded-2xl p-6 border border-[var(--border)] sanchoy-surface-inset transition-all duration-300 shadow-sm";
    if (cAllocation) cAllocation.className = "rounded-2xl p-6 border border-[var(--border)] sanchoy-surface-inset transition-all duration-300 shadow-sm";
    if (opsBar) opsBar.className = "flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 p-4 rounded-2xl border border-[var(--border)] sanchoy-surface-inset transition-all duration-300";
    if (cBreakdown) cBreakdown.className = "rounded-2xl p-6 border border-[var(--border)] sanchoy-surface-inset transition-all duration-300 shadow-sm";
    if (cRoadmap) cRoadmap.className = "rounded-2xl p-6 border border-[var(--border)] sanchoy-surface-inset transition-all duration-300 shadow-sm";
  }

  const records = getVaultSavings();
  renderVaultList(records);
  renderVaultCharts(records);
}

export function seedSampleVaultData() {
  const sample = [
    {
      id: 'v_sample_1',
      month: '2026-04',
      cashSavings: 4500,
      onlineSavings: 12000,
      extraSavings: 2000,
      emergencySavings: 5000,
      investments: 15000,
      goldSavings: 3000,
      otherSavings: 1500,
      notes: 'Successful month. Added extra to online bank savings and standard mutual fund node investments.'
    },
    {
      id: 'v_sample_2',
      month: '2026-05',
      cashSavings: 5000,
      onlineSavings: 14500,
      extraSavings: 1500,
      emergencySavings: 3000,
      investments: 18000,
      goldSavings: 2000,
      otherSavings: 1000,
      notes: 'Allocated additional resources to Investments and Gold savings. Perfect visual timeline node.'
    }
  ];
  saveVaultSavings(sample);
  renderVault();
}

export function editVaultRecord(id) {
  const records = getVaultSavings();
  const r = records.find(item => item.id === id);
  if (!r) return;

  document.getElementById('edit-record-id').value = r.id;
  document.getElementById('vaultMonthInput').value = r.month;
  document.getElementById('vaultCashInput').value = r.cashSavings || '';
  document.getElementById('vaultOnlineInput').value = r.onlineSavings || '';
  document.getElementById('vaultExtraInput').value = r.extraSavings || '';
  document.getElementById('vaultEmergencyInput').value = r.emergencySavings || '';
  document.getElementById('vaultInvestmentsInput').value = r.investments || '';
  document.getElementById('vaultGoldInput').value = r.goldSavings || '';
  document.getElementById('vaultOtherInput').value = r.otherSavings || '';
  document.getElementById('vaultNotesInput').value = r.notes || '';

  document.getElementById('vaultModalTitle').textContent = 'Edit Savings Node';

  const modal = document.getElementById('vaultRecordModal');
  if (modal) {
    modal.classList.add('show');
    modal.style.display = 'flex';
  }
}

// --- Primary Vault Modals (Phase 9B) ---

export async function openDepositModal() {
  let balances = { online: 0, cash: 0, vault: 0 };
  try {
    const { getBalances } = await import('../transactions/transactions.js');
    const b = getBalances();
    balances.online = b.online;
    balances.cash = b.cash;
  } catch (e) {}
  balances.vault = calculateVaultBalance(getVaultSavings());

  const today = new Date().toISOString().slice(0, 10);

  const html = `
    <div class="space-y-5">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center text-base shrink-0">
            ${getIcon('vault', { size: 'w-4 h-4', className: 'text-amber-500' })}
          </div>
          <div>
            <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">Add to Protected Vault</h3>
            <p class="text-[11px] text-[var(--text-muted)]">Move liquid funds into Protected Savings • Not an expense</p>
          </div>
        </div>
        <button id="closeDepositModalBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close modal">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="space-y-4 text-xs">
        <!-- Source Wallet -->
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Source Wallet</label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="depSourceOnline" class="p-3 rounded-xl border text-left transition-all cursor-pointer border-amber-500 bg-amber-500/10 text-[var(--text-primary)] font-bold">
              <div class="flex items-center justify-between">
                <span class="inline-flex items-center gap-1.5">${getIcon('walletOnline', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)]' })} Online Wallet</span>
                <span class="text-amber-500">●</span>
              </div>
              <div class="text-[11px] font-mono mt-1 text-[var(--text-muted)]">Available: ₹${balances.online.toFixed(2)}</div>
            </button>
            <button type="button" id="depSourceCash" class="p-3 rounded-xl border text-left transition-all cursor-pointer border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-muted)] font-medium">
              <div class="flex items-center justify-between">
                <span class="inline-flex items-center gap-1.5">${getIcon('walletCash', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent-secondary)]' })} Cash Wallet</span>
                <span class="opacity-0">●</span>
              </div>
              <div class="text-[11px] font-mono mt-1 text-[var(--text-muted)]">Available: ₹${balances.cash.toFixed(2)}</div>
            </button>
          </div>
        </div>

        <!-- Amount -->
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Transfer Amount (₹)</label>
          <div class="relative">
            <span class="absolute left-3.5 top-2.5 text-sm font-bold text-[var(--text-muted)]">₹</span>
            <input type="number" id="depAmountInput" step="any" min="0.01" placeholder="0.00" class="w-full pl-8 pr-4 py-2 text-xs font-bold rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
          </div>
        </div>

        <!-- Date & Note Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Date</label>
            <input type="date" id="depDateInput" value="${today}" class="w-full px-3 py-2 text-xs font-medium rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Optional Note</label>
            <input type="text" id="depNoteInput" placeholder="e.g. Monthly savings contribution" class="w-full px-3 py-2 text-xs font-medium rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
          </div>
        </div>

        <!-- Live Preview Card (Phase 9B Requirement 3) -->
        <div class="p-3.5 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] space-y-2">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">Source Wallet Balance:</span>
            <span id="depPreviewSourceCurrent" class="font-mono font-bold text-[var(--text-primary)]">₹${balances.online.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">Transfer Amount:</span>
            <span id="depPreviewAmount" class="font-mono font-bold text-amber-500">₹0.00</span>
          </div>
          <div class="flex items-center justify-between text-[11px] pt-1.5 border-t border-[var(--border-subtle)]">
            <span class="text-[var(--text-muted)]">New Source Balance:</span>
            <span id="depPreviewSourceNew" class="font-mono font-bold text-[var(--text-primary)]">₹${balances.online.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">New Vault Balance:</span>
            <span id="depPreviewVaultNew" class="font-mono font-bold text-emerald-500">₹${balances.vault.toFixed(2)}</span>
          </div>
          <div id="depValidationNotice" class="text-[10px] font-bold text-rose-500 hidden pt-1"></div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2.5 pt-2">
          <button id="confirmDepositBtn" type="button" class="flex-1 py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            Confirm Add to Vault
          </button>
          <button id="cancelDepositBtn" type="button" class="py-2.5 px-4 sanchoy-btn sanchoy-btn-secondary text-xs cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-md',
    onOpen: (content) => {
      let selectedSource = 'online';
      const btnOnline = content.querySelector('#depSourceOnline');
      const btnCash = content.querySelector('#depSourceCash');
      const amountInput = content.querySelector('#depAmountInput');
      const dateInput = content.querySelector('#depDateInput');
      const noteInput = content.querySelector('#depNoteInput');
      const previewSourceCurrent = content.querySelector('#depPreviewSourceCurrent');
      const previewAmount = content.querySelector('#depPreviewAmount');
      const previewSourceNew = content.querySelector('#depPreviewSourceNew');
      const previewVaultNew = content.querySelector('#depPreviewVaultNew');
      const validationNotice = content.querySelector('#depValidationNotice');
      const confirmBtn = content.querySelector('#confirmDepositBtn');
      const cancelBtn = content.querySelector('#cancelDepositBtn');
      const closeBtn = content.querySelector('#closeDepositModalBtn');

      const selectSource = (src) => {
        selectedSource = src;
        if (src === 'online') {
          btnOnline.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-amber-500 bg-amber-500/10 text-[var(--text-primary)] font-bold";
          btnOnline.querySelector('span:last-child').className = "text-amber-500";
          btnCash.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-muted)] font-medium";
          btnCash.querySelector('span:last-child').className = "opacity-0";
        } else {
          btnCash.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-amber-500 bg-amber-500/10 text-[var(--text-primary)] font-bold";
          btnCash.querySelector('span:last-child').className = "text-amber-500";
          btnOnline.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-muted)] font-medium";
          btnOnline.querySelector('span:last-child').className = "opacity-0";
        }
        updatePreview();
      };

      btnOnline.addEventListener('click', () => selectSource('online'));
      btnCash.addEventListener('click', () => selectSource('cash'));

      const updatePreview = () => {
        const sourceBal = selectedSource === 'online' ? balances.online : balances.cash;
        const amt = parseFloat(amountInput.value) || 0;
        const newSourceBal = sourceBal - amt;
        const newVaultBal = balances.vault + amt;

        previewSourceCurrent.textContent = `₹${sourceBal.toFixed(2)}`;
        previewAmount.textContent = `₹${amt.toFixed(2)}`;
        previewSourceNew.textContent = `₹${newSourceBal.toFixed(2)}`;
        previewVaultNew.textContent = `₹${newVaultBal.toFixed(2)}`;

        if (amt <= 0) {
          validationNotice.textContent = amountInput.value ? "Please enter an amount greater than ₹0." : "";
          validationNotice.classList.toggle('hidden', !amountInput.value);
          confirmBtn.disabled = true;
        } else if (amt > sourceBal) {
          const walletName = selectedSource === 'online' ? 'Online Wallet' : 'Cash Wallet';
          validationNotice.textContent = `Cannot transfer more than available ${walletName} balance (₹${sourceBal.toFixed(2)}).`;
          validationNotice.classList.remove('hidden');
          previewSourceNew.className = "font-mono font-bold text-rose-500";
          confirmBtn.disabled = true;
        } else {
          validationNotice.classList.add('hidden');
          previewSourceNew.className = "font-mono font-bold text-[var(--text-primary)]";
          confirmBtn.disabled = false;
        }
      };

      amountInput.addEventListener('input', updatePreview);
      closeBtn.addEventListener('click', closeModal);
      cancelBtn.addEventListener('click', closeModal);

      confirmBtn.addEventListener('click', async () => {
        const amt = parseFloat(amountInput.value);
        const date = dateInput.value;
        const note = noteInput.value.trim();

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Depositing...';

        const result = await depositToVault({
          amount: amt,
          sourceWallet: selectedSource,
          date,
          description: note,
          currentBalances: balances
        });

        if (result && result.success) {
          closeModal();
        } else {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm Add to Vault';
        }
      });

      amountInput.focus();
    }
  });
}

export async function openWithdrawModal() {
  let balances = { online: 0, cash: 0, vault: 0 };
  try {
    const { getBalances } = await import('../transactions/transactions.js');
    const b = getBalances();
    balances.online = b.online;
    balances.cash = b.cash;
  } catch (e) {}
  balances.vault = calculateVaultBalance(getVaultSavings());

  const today = new Date().toISOString().slice(0, 10);

  const html = `
    <div class="space-y-5">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-500 flex items-center justify-center text-base shrink-0">
            ${getIcon('withdraw', { size: 'w-4 h-4', className: 'text-sky-500' })}
          </div>
          <div>
            <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">Withdraw from Vault</h3>
            <p class="text-[11px] text-[var(--text-muted)]">Return protected savings to liquid wallet • Not an income</p>
          </div>
        </div>
        <button id="closeWithdrawModalBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close modal">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="space-y-4 text-xs">
        <!-- Destination Wallet -->
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Destination Wallet</label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="witDestOnline" class="p-3 rounded-xl border text-left transition-all cursor-pointer border-sky-500 bg-sky-500/10 text-[var(--text-primary)] font-bold">
              <div class="flex items-center justify-between">
                <span class="inline-flex items-center gap-1.5">${getIcon('walletOnline', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)]' })} Online Wallet</span>
                <span class="text-sky-500">●</span>
              </div>
              <div class="text-[11px] font-mono mt-1 text-[var(--text-muted)]">Current: ₹${balances.online.toFixed(2)}</div>
            </button>
            <button type="button" id="witDestCash" class="p-3 rounded-xl border text-left transition-all cursor-pointer border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-muted)] font-medium">
              <div class="flex items-center justify-between">
                <span class="inline-flex items-center gap-1.5">${getIcon('walletCash', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent-secondary)]' })} Cash Wallet</span>
                <span class="opacity-0">●</span>
              </div>
              <div class="text-[11px] font-mono mt-1 text-[var(--text-muted)]">Current: ₹${balances.cash.toFixed(2)}</div>
            </button>
          </div>
        </div>

        <!-- Amount -->
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Withdrawal Amount (₹)</label>
          <div class="relative">
            <span class="absolute left-3.5 top-2.5 text-sm font-bold text-[var(--text-muted)]">₹</span>
            <input type="number" id="witAmountInput" step="any" min="0.01" placeholder="0.00" class="w-full pl-8 pr-4 py-2 text-xs font-bold rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
          </div>
        </div>

        <!-- Date & Note Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Date</label>
            <input type="date" id="witDateInput" value="${today}" class="w-full px-3 py-2 text-xs font-medium rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Optional Note</label>
            <input type="text" id="witNoteInput" placeholder="e.g. Bill payment withdrawal" class="w-full px-3 py-2 text-xs font-medium rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
          </div>
        </div>

        <!-- Live Preview Card (Phase 9B Requirement 4) -->
        <div class="p-3.5 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] space-y-2">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">Current Vault:</span>
            <span id="witPreviewVaultCurrent" class="font-mono font-bold text-[var(--text-primary)]">₹${balances.vault.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">Withdrawal:</span>
            <span id="witPreviewAmount" class="font-mono font-bold text-sky-500">₹0.00</span>
          </div>
          <div class="flex items-center justify-between text-[11px] pt-1.5 border-t border-[var(--border-subtle)]">
            <span class="text-[var(--text-muted)]">New Vault:</span>
            <span id="witPreviewVaultNew" class="font-mono font-bold text-[var(--text-primary)]">₹${balances.vault.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">Destination Wallet After:</span>
            <span id="witPreviewDestNew" class="font-mono font-bold text-emerald-500">₹${balances.online.toFixed(2)}</span>
          </div>
          <div id="witValidationNotice" class="text-[10px] font-bold text-rose-500 hidden pt-1"></div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2.5 pt-2">
          <button id="confirmWithdrawBtn" type="button" class="flex-1 py-2.5 px-4 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            Confirm Withdrawal
          </button>
          <button id="cancelWithdrawBtn" type="button" class="py-2.5 px-4 sanchoy-btn sanchoy-btn-secondary text-xs cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-md',
    onOpen: (content) => {
      let selectedDest = 'online';
      const btnOnline = content.querySelector('#witDestOnline');
      const btnCash = content.querySelector('#witDestCash');
      const amountInput = content.querySelector('#witAmountInput');
      const dateInput = content.querySelector('#witDateInput');
      const noteInput = content.querySelector('#witNoteInput');
      const previewVaultCurrent = content.querySelector('#witPreviewVaultCurrent');
      const previewAmount = content.querySelector('#witPreviewAmount');
      const previewVaultNew = content.querySelector('#witPreviewVaultNew');
      const previewDestNew = content.querySelector('#witPreviewDestNew');
      const validationNotice = content.querySelector('#witValidationNotice');
      const confirmBtn = content.querySelector('#confirmWithdrawBtn');
      const cancelBtn = content.querySelector('#cancelWithdrawBtn');
      const closeBtn = content.querySelector('#closeWithdrawModalBtn');

      const selectDest = (dst) => {
        selectedDest = dst;
        if (dst === 'online') {
          btnOnline.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-sky-500 bg-sky-500/10 text-[var(--text-primary)] font-bold";
          btnOnline.querySelector('span:last-child').className = "text-sky-500";
          btnCash.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-muted)] font-medium";
          btnCash.querySelector('span:last-child').className = "opacity-0";
        } else {
          btnCash.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-sky-500 bg-sky-500/10 text-[var(--text-primary)] font-bold";
          btnCash.querySelector('span:last-child').className = "text-sky-500";
          btnOnline.className = "p-3 rounded-xl border text-left transition-all cursor-pointer border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-muted)] font-medium";
          btnOnline.querySelector('span:last-child').className = "opacity-0";
        }
        updatePreview();
      };

      btnOnline.addEventListener('click', () => selectDest('online'));
      btnCash.addEventListener('click', () => selectDest('cash'));

      const updatePreview = () => {
        const destBal = selectedDest === 'online' ? balances.online : balances.cash;
        const amt = parseFloat(amountInput.value) || 0;
        const newVaultBal = balances.vault - amt;
        const newDestBal = destBal + amt;

        previewVaultCurrent.textContent = `₹${balances.vault.toFixed(2)}`;
        previewAmount.textContent = `₹${amt.toFixed(2)}`;
        previewVaultNew.textContent = `₹${newVaultBal.toFixed(2)}`;
        previewDestNew.textContent = `₹${newDestBal.toFixed(2)}`;

        if (amt <= 0) {
          validationNotice.textContent = amountInput.value ? "Please enter an amount greater than ₹0." : "";
          validationNotice.classList.toggle('hidden', !amountInput.value);
          confirmBtn.disabled = true;
        } else if (amt > balances.vault) {
          validationNotice.textContent = `Cannot withdraw more than available Vault balance (₹${balances.vault.toFixed(2)}).`;
          validationNotice.classList.remove('hidden');
          previewVaultNew.className = "font-mono font-bold text-rose-500";
          confirmBtn.disabled = true;
        } else {
          validationNotice.classList.add('hidden');
          previewVaultNew.className = "font-mono font-bold text-[var(--text-primary)]";
          confirmBtn.disabled = false;
        }
      };

      amountInput.addEventListener('input', updatePreview);
      closeBtn.addEventListener('click', closeModal);
      cancelBtn.addEventListener('click', closeModal);

      confirmBtn.addEventListener('click', async () => {
        const amt = parseFloat(amountInput.value);
        const date = dateInput.value;
        const note = noteInput.value.trim();

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';

        const result = await withdrawFromVault({
          amount: amt,
          destinationWallet: selectedDest,
          date,
          description: note,
          currentBalances: balances
        });

        if (result && result.success) {
          closeModal();
        } else {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm Withdrawal';
        }
      });

      amountInput.focus();
    }
  });
}

export async function openSpendModal() {
  let balances = { online: 0, cash: 0, vault: 0 };
  try {
    const { getBalances } = await import('../transactions/transactions.js');
    const b = getBalances();
    balances.online = b.online;
    balances.cash = b.cash;
  } catch (e) {}
  balances.vault = calculateVaultBalance(getVaultSavings());

  const today = new Date().toISOString().slice(0, 10);
  const categoriesHtml = VAULT_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  const html = `
    <div class="space-y-5">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center text-base shrink-0">
            ${getIcon('spend', { size: 'w-4 h-4', className: 'text-rose-500' })}
          </div>
          <div>
            <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">Spend from Vault</h3>
            <p class="text-[11px] text-[var(--text-muted)]">External purchase directly from Protected Savings</p>
          </div>
        </div>
        <button id="closeSpendModalBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close modal">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="space-y-4 text-xs">
        <!-- Amount & Category Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Amount (₹)</label>
            <div class="relative">
              <span class="absolute left-3.5 top-2.5 text-sm font-bold text-[var(--text-muted)]">₹</span>
              <input type="number" id="spdAmountInput" step="any" min="0.01" placeholder="0.00" class="w-full pl-8 pr-4 py-2 text-xs font-bold rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-rose-500/50" />
            </div>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Category</label>
            <select id="spdCategorySelect" class="w-full px-3 py-2 text-xs font-medium rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-rose-500/50">
              ${categoriesHtml}
            </select>
          </div>
        </div>

        <!-- Date & Description -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Date</label>
            <input type="date" id="spdDateInput" value="${today}" class="w-full px-3 py-2 text-xs font-medium rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-rose-500/50" />
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Description / Purpose</label>
            <input type="text" id="spdDescInput" placeholder="e.g. Headphones, Emergency purchase" class="w-full px-3 py-2 text-xs font-medium rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-rose-500/50" />
          </div>
        </div>

        <!-- Live Preview Card (Phase 9B Requirement 5) -->
        <div class="p-3.5 rounded-xl sanchoy-surface-inset border border-[var(--border-subtle)] space-y-2">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">Current Vault Balance:</span>
            <span id="spdPreviewVaultCurrent" class="font-mono font-bold text-[var(--text-primary)]">₹${balances.vault.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--text-muted)]">Spending Amount:</span>
            <span id="spdPreviewAmount" class="font-mono font-bold text-rose-500">₹0.00</span>
          </div>
          <div class="flex items-center justify-between text-[11px] pt-1.5 border-t border-[var(--border-subtle)]">
            <span class="text-[var(--text-muted)]">New Vault Balance:</span>
            <span id="spdPreviewVaultNew" class="font-mono font-bold text-[var(--text-primary)]">₹${balances.vault.toFixed(2)}</span>
          </div>
          <p class="text-[10px] text-[var(--text-muted)] italic pt-1 border-t border-[var(--border-subtle)]">
            ℹ️ Money leaves Sanchoy holdings directly from Vault. Online & Cash liquid wallets are NOT touched.
          </p>
          <div id="spdValidationNotice" class="text-[10px] font-bold text-rose-500 hidden pt-1"></div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2.5 pt-2">
          <button id="confirmSpendBtn" type="button" class="flex-1 py-2.5 px-4 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            Record Vault Spend
          </button>
          <button id="cancelSpendBtn" type="button" class="py-2.5 px-4 sanchoy-btn sanchoy-btn-secondary text-xs cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-md',
    onOpen: (content) => {
      const amountInput = content.querySelector('#spdAmountInput');
      const catSelect = content.querySelector('#spdCategorySelect');
      const dateInput = content.querySelector('#spdDateInput');
      const descInput = content.querySelector('#spdDescInput');
      const previewVaultCurrent = content.querySelector('#spdPreviewVaultCurrent');
      const previewAmount = content.querySelector('#spdPreviewAmount');
      const previewVaultNew = content.querySelector('#spdPreviewVaultNew');
      const validationNotice = content.querySelector('#spdValidationNotice');
      const confirmBtn = content.querySelector('#confirmSpendBtn');
      const cancelBtn = content.querySelector('#cancelSpendBtn');
      const closeBtn = content.querySelector('#closeSpendModalBtn');

      const updatePreview = () => {
        const amt = parseFloat(amountInput.value) || 0;
        const newVaultBal = balances.vault - amt;

        previewVaultCurrent.textContent = `₹${balances.vault.toFixed(2)}`;
        previewAmount.textContent = `₹${amt.toFixed(2)}`;
        previewVaultNew.textContent = `₹${newVaultBal.toFixed(2)}`;

        if (amt <= 0) {
          validationNotice.textContent = amountInput.value ? "Please enter an amount greater than ₹0." : "";
          validationNotice.classList.toggle('hidden', !amountInput.value);
          confirmBtn.disabled = true;
        } else if (amt > balances.vault) {
          validationNotice.textContent = `Cannot spend more than available Vault balance (₹${balances.vault.toFixed(2)}).`;
          validationNotice.classList.remove('hidden');
          previewVaultNew.className = "font-mono font-bold text-rose-500";
          confirmBtn.disabled = true;
        } else {
          validationNotice.classList.add('hidden');
          previewVaultNew.className = "font-mono font-bold text-[var(--text-primary)]";
          confirmBtn.disabled = false;
        }
      };

      amountInput.addEventListener('input', updatePreview);
      closeBtn.addEventListener('click', closeModal);
      cancelBtn.addEventListener('click', closeModal);

      confirmBtn.addEventListener('click', async () => {
        const amt = parseFloat(amountInput.value);
        const cat = catSelect.value;
        const date = dateInput.value;
        const desc = descInput.value.trim() || `Spent for ${cat}`;

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Recording...';

        const result = await spendFromVault({
          amount: amt,
          category: cat,
          description: desc,
          date,
          currentBalances: balances
        });

        if (result && result.success) {
          closeModal();
        } else {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Record Vault Spend';
        }
      });

      amountInput.focus();
    }
  });
}

export function openVaultDeleteModal(id) {
  const records = getVaultSavings();
  const record = records.find(r => r.id === id);
  if (!record) return;

  const isDeposit = record.type === VAULT_TYPES.DEPOSIT;
  const isWithdrawal = record.type === VAULT_TYPES.WITHDRAWAL;
  const isSpend = record.type === VAULT_TYPES.SPEND;
  const isLegacy = !record.type;

  let typeTitle = 'Vault Record';
  let badgeClass = 'text-amber-500 bg-amber-500/10 border-amber-500/20';
  let amt = Number(record.amount !== undefined ? record.amount : getRecordSum(record));

  if (isDeposit) {
    typeTitle = 'Vault Deposit';
    badgeClass = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
  } else if (isWithdrawal) {
    typeTitle = 'Vault Withdrawal';
    badgeClass = 'text-sky-500 bg-sky-500/10 border-sky-500/20';
  } else if (isSpend) {
    typeTitle = 'Vault Spend';
    badgeClass = 'text-rose-500 bg-rose-500/10 border-rose-500/20';
  } else if (isLegacy) {
    typeTitle = 'Monthly Savings Node';
  }

  const html = `
    <div class="space-y-4">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">Delete Vault Entry</h3>
        <button id="closeDelVaultModalBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close modal">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="p-4 rounded-xl sanchoy-surface-inset border border-rose-500/30 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-extrabold px-2 py-0.5 rounded border uppercase ${badgeClass}">${typeTitle}</span>
          <span class="font-extrabold font-mono text-sm text-[var(--text-primary)]">₹${amt.toFixed(2)}</span>
        </div>
        <p class="text-xs text-[var(--text-primary)] font-medium">
          ${escapeHtml(record.description || record.notes || record.category || typeTitle)}
        </p>
        <div class="text-[10px] text-[var(--text-muted)]">
          Date: ${record.date || record.month || 'N/A'}${record.category ? ` • Category: ${escapeHtml(record.category)}` : ''}
        </div>
      </div>

      <p class="text-xs text-[var(--text-muted)] leading-relaxed">
        Are you sure you want to permanently delete this entry? The Vault balance will be deterministically recalculated from the remaining ledger.
      </p>

      <div class="flex gap-2.5 pt-2">
        <button id="confirmDelVaultBtn" type="button" class="flex-1 py-2.5 px-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer">
          Yes, Delete Entry
        </button>
        <button id="cancelDelVaultBtn" type="button" class="py-2.5 px-4 sanchoy-btn sanchoy-btn-secondary text-xs cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-md',
    onOpen: (content) => {
      content.querySelector('#closeDelVaultModalBtn').addEventListener('click', closeModal);
      content.querySelector('#cancelDelVaultBtn').addEventListener('click', closeModal);
      content.querySelector('#confirmDelVaultBtn').addEventListener('click', () => {
        let updated = getVaultSavings().filter(item => item.id !== id);
        saveVaultSavings(updated);
        try {
          enqueueMutation(VAULT_MUTATION_TYPES.DELETE, { id }, id);
          import('../firebase/sync.js').then(m => m.syncWorkspaceToCloud('vault_delete')).catch(() => {});
        } catch (e) {}
        closeModal();
        renderVault();
        showToast('Vault entry permanently deleted.', 'info');
      });
    }
  });
}

export function openVaultRestoreConfirmModal(parsed) {
  const html = `
    <div class="space-y-4">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">Restore Vault Backup</h3>
        <button id="closeRestoreModalBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close modal">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="p-4 rounded-xl sanchoy-surface-inset border border-amber-500/30 space-y-1.5">
        <span class="text-xs font-bold text-[var(--text-primary)] block">Backup File Verified ✓</span>
        <p class="text-xs text-[var(--text-muted)]">
          Contains <strong>${parsed.data.length}</strong> record${parsed.data.length === 1 ? '' : 's'}. Do you want to merge them into your secure local database?
        </p>
      </div>

      <div class="flex gap-2.5 pt-2">
        <button id="confirmRestoreBtn" type="button" class="flex-1 py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer">
          Merge Backup Records
        </button>
        <button id="cancelRestoreBtn" type="button" class="py-2.5 px-4 sanchoy-btn sanchoy-btn-secondary text-xs cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-md',
    onOpen: (content) => {
      content.querySelector('#closeRestoreModalBtn').addEventListener('click', closeModal);
      content.querySelector('#cancelRestoreBtn').addEventListener('click', closeModal);
      content.querySelector('#confirmRestoreBtn').addEventListener('click', () => {
        let current = getVaultSavings();
        parsed.data.forEach(imported => {
          const existingIndex = current.findIndex(r => r.id === imported.id || (r.month && r.month === imported.month));
          if (existingIndex !== -1) {
            current[existingIndex] = imported;
          } else {
            current.push(imported);
          }
        });
        saveVaultSavings(current);
        closeModal();
        renderVault();
        showToast('Vault restore completed successfully!', 'success');
      });
    }
  });
}

export function deleteVaultRecord(id) {
  openVaultDeleteModal(id);
}

export function exportVaultCSV() {
  const records = getVaultSavings();
  if (records.length === 0) {
    showToast('No savings records available to export.', 'info');
    return;
  }

  let csv = 'Type,Amount,Date,Source/Dest,Category,Description,ID\n';

  records.forEach(r => {
    const t = r.type || 'LEGACY_NODE';
    const a = r.amount !== undefined ? r.amount : getRecordSum(r);
    const d = r.date || r.month || '';
    const sd = r.sourceWallet || r.destinationWallet || 'Vault';
    const c = r.category || 'Savings';
    const desc = (r.description || r.notes || '').replace(/"/g, '""');
    csv += `"${t}",${a},"${d}","${sd}","${c}","${desc}","${r.id}"\n`;
  });

  downloadBlob(csv, `Secret_Vault_Backup_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
}

export function backupVaultJSON() {
  const records = getVaultSavings();
  const backup = {
    app: 'expense-tracker-vault',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    data: records
  };
  downloadBlob(JSON.stringify(backup, null, 2), `Secret_Vault_Encrypted_Backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
}

export function triggerVaultRestore() {
  const input = document.getElementById('vaultFileInput');
  if (input) input.click();
}

export function handleVaultFileInput(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (parsed.app !== 'expense-tracker-vault' || !Array.isArray(parsed.data)) {
        showToast('Invalid backup file. Make sure this is a JSON export from the Secret Savings Vault.', 'error');
        return;
      }
      openVaultRestoreConfirmModal(parsed);
    } catch (err) {
      showToast('Failed to parse backup JSON file: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

export function lockVault(onNavigate = null) {
  setVaultUnlocked(false);
  setVaultCryptoKey(null);
  setDecryptedVaultRecords([]);
  if (typeof onNavigate === 'function') {
    onNavigate('/tracker');
  }
}

export function initVaultControls(navigateHandler) {
  const toAnalyticsBtn = document.getElementById('toAnalytics');
  if (toAnalyticsBtn) {
    let clickTimeout = null;
    let lastClickTime = 0;
    let longPressTimeout = null;
    let longPressTriggered = false;

    function triggerSecretGesture() {
      if (navigator.vibrate) {
        try { navigator.vibrate([100, 50, 100]); } catch (e) {}
      }
      toAnalyticsBtn.classList.add('scale-110', 'rotate-1', 'bg-amber-500', 'border-amber-400');
      setTimeout(() => {
        toAnalyticsBtn.classList.remove('scale-110', 'rotate-1', 'bg-amber-500', 'border-amber-400');
      }, 600);

      openVaultUnlockModal(navigateHandler);
    }

    function startPress(e) {
      longPressTriggered = false;
      clearTimeout(longPressTimeout);
      longPressTimeout = setTimeout(() => {
        longPressTriggered = true;
        triggerSecretGesture();
      }, 5000);
    }

    function endPress(e) {
      clearTimeout(longPressTimeout);
    }

    toAnalyticsBtn.addEventListener('mousedown', startPress);
    toAnalyticsBtn.addEventListener('touchstart', startPress);
    toAnalyticsBtn.addEventListener('mouseup', endPress);
    toAnalyticsBtn.addEventListener('mouseleave', endPress);
    toAnalyticsBtn.addEventListener('touchend', endPress);
    toAnalyticsBtn.addEventListener('touchcancel', endPress);

    toAnalyticsBtn.addEventListener('click', (e) => {
      if (longPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
        longPressTriggered = false;
        return;
      }

      const currentTime = new Date().getTime();
      const clickDelay = currentTime - lastClickTime;
      lastClickTime = currentTime;

      if (clickDelay < 350) {
        e.preventDefault();
        e.stopPropagation();
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        }
        triggerSecretGesture();
      } else {
        if (clickTimeout) clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => {
          if (typeof navigateHandler === 'function') navigateHandler('/analytics');
          clickTimeout = null;
        }, 350);
      }
    });
  }

  // Primary Vault Actions (Phase 9B Requirement 2)
  const primaryDepositBtn = document.getElementById('primaryDepositVaultBtn');
  if (primaryDepositBtn) primaryDepositBtn.addEventListener('click', openDepositModal);

  const primaryWithdrawBtn = document.getElementById('primaryWithdrawVaultBtn');
  if (primaryWithdrawBtn) primaryWithdrawBtn.addEventListener('click', openWithdrawModal);

  const primarySpendBtn = document.getElementById('primarySpendVaultBtn');
  if (primarySpendBtn) primarySpendBtn.addEventListener('click', openSpendModal);

  // Type Filters
  const filterAllBtn = document.getElementById('vaultFilterAll');
  if (filterAllBtn) filterAllBtn.addEventListener('click', () => setVaultTypeFilter('all'));

  const filterDepBtn = document.getElementById('vaultFilterDeposits');
  if (filterDepBtn) filterDepBtn.addEventListener('click', () => setVaultTypeFilter('deposit'));

  const filterWitBtn = document.getElementById('vaultFilterWithdrawals');
  if (filterWitBtn) filterWitBtn.addEventListener('click', () => setVaultTypeFilter('withdrawal'));

  const filterSpdBtn = document.getElementById('vaultFilterSpends');
  if (filterSpdBtn) filterSpdBtn.addEventListener('click', () => setVaultTypeFilter('spend'));

  // Legacy Monthly Snapshot Add Button
  const addVaultRecordBtn = document.getElementById('addVaultRecordBtn');
  if (addVaultRecordBtn) {
    addVaultRecordBtn.addEventListener('click', () => {
      document.getElementById('edit-record-id').value = '';
      document.getElementById('vaultMonthInput').value = new Date().toISOString().slice(0, 7);
      document.getElementById('vaultCashInput').value = '';
      document.getElementById('vaultOnlineInput').value = '';
      document.getElementById('vaultExtraInput').value = '';
      document.getElementById('vaultEmergencyInput').value = '';
      document.getElementById('vaultInvestmentsInput').value = '';
      document.getElementById('vaultGoldInput').value = '';
      document.getElementById('vaultOtherInput').value = '';
      document.getElementById('vaultNotesInput').value = '';

      document.getElementById('vaultModalTitle').textContent = 'Add Savings Node';

      const modal = document.getElementById('vaultRecordModal');
      if (modal) {
        modal.classList.add('show');
        modal.style.display = 'flex';
      }
    });
  }

  const closeRecordModal = () => {
    const modal = document.getElementById('vaultRecordModal');
    if (modal) {
      modal.classList.remove('show');
      modal.style.display = 'none';
    }
  };

  const closeVaultRecordModalBtn = document.getElementById('closeVaultRecordModal');
  if (closeVaultRecordModalBtn) closeVaultRecordModalBtn.addEventListener('click', closeRecordModal);

  const cancelVaultRecordBtn = document.getElementById('cancelVaultRecordBtn');
  if (cancelVaultRecordBtn) cancelVaultRecordBtn.addEventListener('click', closeRecordModal);

  const saveVaultRecordBtn = document.getElementById('saveVaultRecordBtn');
  if (saveVaultRecordBtn) {
    saveVaultRecordBtn.addEventListener('click', () => {
      const id = document.getElementById('edit-record-id').value;
      const month = document.getElementById('vaultMonthInput').value;

      if (!month) {
        showToast('Please specify a month.', 'warning');
        return;
      }

      const recordData = {
        id: id || 'vault_' + Date.now().toString(),
        month: month,
        cashSavings: parseFloat(document.getElementById('vaultCashInput').value) || 0,
        onlineSavings: parseFloat(document.getElementById('vaultOnlineInput').value) || 0,
        extraSavings: parseFloat(document.getElementById('vaultExtraInput').value) || 0,
        emergencySavings: parseFloat(document.getElementById('vaultEmergencyInput').value) || 0,
        investments: parseFloat(document.getElementById('vaultInvestmentsInput').value) || 0,
        goldSavings: parseFloat(document.getElementById('vaultGoldInput').value) || 0,
        otherSavings: parseFloat(document.getElementById('vaultOtherInput').value) || 0,
        notes: document.getElementById('vaultNotesInput').value || ''
      };

      let records = getVaultSavings();

      if (id) {
        records = records.map(r => r.id === id ? recordData : r);
      } else {
        const duplicate = records.find(r => r.month === month);
        if (duplicate) {
          records = records.map(r => r.month === month ? { ...recordData, id: r.id } : r);
          showToast(`Updated existing savings node for ${month}`, 'info');
        } else {
          records.push(recordData);
        }
      }

      saveVaultSavings(records);
      try {
        enqueueMutation(id ? VAULT_MUTATION_TYPES.UPDATE : VAULT_MUTATION_TYPES.CREATE, recordData, recordData.id);
        import('../firebase/sync.js').then(m => m.syncWorkspaceToCloud('vault_save')).catch(() => {});
      } catch (e) {}
      closeRecordModal();
      renderVault();
    });
  }

  const vaultCsvBtn = document.getElementById('vaultCsvBtn');
  if (vaultCsvBtn) vaultCsvBtn.addEventListener('click', exportVaultCSV);

  const vaultBackupBtn = document.getElementById('vaultBackupBtn');
  if (vaultBackupBtn) vaultBackupBtn.addEventListener('click', backupVaultJSON);

  const vaultRestoreBtn = document.getElementById('vaultRestoreBtn');
  if (vaultRestoreBtn) vaultRestoreBtn.addEventListener('click', triggerVaultRestore);

  const vaultFileInput = document.getElementById('vaultFileInput');
  if (vaultFileInput) vaultFileInput.addEventListener('change', handleVaultFileInput);

  const vaultSearch = document.getElementById('vaultSearch');
  if (vaultSearch) {
    vaultSearch.addEventListener('input', () => {
      renderVaultList(getVaultSavings());
    });
  }

  const vaultSort = document.getElementById('vaultSort');
  if (vaultSort) {
    vaultSort.addEventListener('change', () => {
      renderVaultList(getVaultSavings());
    });
  }

  // Synchronize Vault with global theme changes
  events.on('theme:change', () => {
    updateVaultStyles();
  });

  const lockVaultBtn = document.getElementById('lockVaultBtn');
  if (lockVaultBtn) {
    lockVaultBtn.addEventListener('click', () => {
      lockVault(navigateHandler);
    });
  }

  // Bind globals for inline onclicks
  window.openDepositModal = openDepositModal;
  window.openWithdrawModal = openWithdrawModal;
  window.openSpendModal = openSpendModal;
  window.openVaultDeleteModal = openVaultDeleteModal;
  window.deleteVaultRecord = deleteVaultRecord;
  window.editVaultRecord = editVaultRecord;
  window.seedSampleVaultData = seedSampleVaultData;
}
