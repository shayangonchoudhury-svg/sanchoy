// Application Centralized State & Cache Engine
import { events } from './events.js';

export const LS = {
  balances: 'et_balances_v1',
  startingBalances: 'sanchoy_starting_balances_v1',
  transactions: 'et_txs_v1',
  budget: 'et_budget_v1',
  budgetSuggestionDismissed: 'et_budget_suggestion_dismissed',
  allowanceConfig: 'sanchoy_allowance_config_v1'
};

export const state = {
  sessionUnlocked: false,
  currentRange: 'daily',
  vaultUnlocked: false,
  vaultDarkTheme: true,
  decryptedVaultRecords: [],
  vaultCryptoKey: null
};

// Safe in-memory store with asynchronous IndexedDB persistence
let dbSyncHandler = null;

export function registerDBSyncHandler(handler) {
  dbSyncHandler = handler;
}

export const safeStorage = {
  _data: {},
  getItem(key) {
    return this._data[key] || null;
  },
  setItem(key, value) {
    this._data[key] = String(value);
    if (dbSyncHandler && typeof dbSyncHandler.syncKeyToDB === 'function') {
      dbSyncHandler.syncKeyToDB(key, value);
    }
  },
  removeItem(key) {
    delete this._data[key];
    if (dbSyncHandler && typeof dbSyncHandler.deleteKeyFromDB === 'function') {
      dbSyncHandler.deleteKeyFromDB(key);
    }
  },
  clear() {
    this._data = {};
    if (dbSyncHandler && typeof dbSyncHandler.clearAllStores === 'function') {
      dbSyncHandler.clearAllStores();
    }
  }
};

export function money(n) {
  if (!state.sessionUnlocked) {
    return '₹ XXXX';
  }
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  return sign + '₹' + Math.abs(num).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function setSessionUnlocked(status) {
  state.sessionUnlocked = status;
  events.emit('session:change', status);
}

export function setCurrentRange(range) {
  state.currentRange = range;
  events.emit('range:change', range);
}

export function setVaultUnlocked(status) {
  state.vaultUnlocked = status;
  events.emit('vault:unlockChange', status);
}

export function setVaultDarkTheme(status) {
  state.vaultDarkTheme = status;
  events.emit('vault:themeChange', status);
}

export function setDecryptedVaultRecords(records) {
  state.decryptedVaultRecords = records;
}

export function setVaultCryptoKey(key) {
  state.vaultCryptoKey = key;
}
