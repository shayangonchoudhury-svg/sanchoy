// IndexedDB Storage & Synchronization Engine
import { LS, safeStorage, registerDBSyncHandler, setVaultDarkTheme } from '../core/state.js';

export const DB_VERSION = 1;
export const DB_NAME_PROD = 'et_production_db';

export const AppDB = {
  db: null,

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME_PROD, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        const stores = [
          { name: 'transactions', keyPath: 'id' },
          { name: 'categories', keyPath: 'name' },
          { name: 'budgets', keyPath: 'month' },
          { name: 'analytics_cache', keyPath: 'key' },
          { name: 'monthly_reports', keyPath: 'month' },
          { name: 'savings_vault', keyPath: 'id' },
          { name: 'master_password_hash', keyPath: 'id' },
          { name: 'user_preferences', keyPath: 'key' },
          { name: 'theme_settings', keyPath: 'key' },
          { name: 'privacy_settings', keyPath: 'key' },
          { name: 'achievements', keyPath: 'id' },
          { name: 'app_settings', keyPath: 'key' }
        ];

        stores.forEach(s => {
          if (!db.objectStoreNames.contains(s.name)) {
            db.createObjectStore(s.name, { keyPath: s.keyPath });
          }
        });
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('IndexedDB initialization failed:', e.target.error);
        reject(e.target.error);
      };
    });
  },

  get(storeName, key) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(null);
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  },

  getAll(storeName) {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  },

  put(storeName, item) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  delete(storeName, key) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  clearStore(storeName) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  putAll(storeName, items) {
    return new Promise((resolve) => {
      if (!this.db || !items.length) return resolve(true);
      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        items.forEach(item => store.put(item));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
};

export const AppDBSync = {
  async syncKeyToDB(key, value) {
    if (!AppDB.db) return;
    try {
      if (key === 'et_master_password_hash') {
        await AppDB.put('master_password_hash', { id: 'master_hash', hash: value });
      } else if (key === LS.transactions) {
        const txs = JSON.parse(value) || [];
        const existing = await AppDB.getAll('transactions');
        const newIds = new Set(txs.map(t => t.id));
        for (const oldTx of existing) {
          if (!newIds.has(oldTx.id)) {
            await AppDB.delete('transactions', oldTx.id);
          }
        }
        await AppDB.putAll('transactions', txs);
        await this.updateAchievements(txs);
      } else if (key === LS.balances) {
        const balances = JSON.parse(value);
        await AppDB.put('app_settings', { key: 'balances', value: balances });
      } else if (key === LS.budget) {
        const amt = Number(value) || 0;
        const currentMonth = new Date().toISOString().slice(0, 7);
        await AppDB.put('budgets', { month: currentMonth, amount: amt });
        if (amt > 0) {
          const ach = await AppDB.get('achievements', 'budget_master');
          if (ach && !ach.unlocked) {
            ach.unlocked = true;
            ach.progress = 100;
            await AppDB.put('achievements', ach);
          }
        }
      } else if (key === LS.budgetSuggestionDismissed) {
        await AppDB.put('user_preferences', { key: 'budgetSuggestionDismissed', value: value });
      } else if (key === LS.allowanceConfig) {
        const cfg = JSON.parse(value);
        await AppDB.put('app_settings', { key: 'allowance_config', value: cfg });
      } else if (key === LS.startingBalances) {
        const sb = JSON.parse(value);
        await AppDB.put('app_settings', { key: 'starting_balances', value: sb });
      }
    } catch (e) {
      console.error('Error in AppDBSync.syncKeyToDB:', e);
    }
  },

  async deleteKeyFromDB(key) {
    if (!AppDB.db) return;
    try {
      if (key === 'et_master_password_hash') {
        await AppDB.delete('master_password_hash', 'master_hash');
      } else if (key === LS.transactions) {
        await AppDB.clearStore('transactions');
      } else if (key === LS.balances) {
        await AppDB.delete('app_settings', 'balances');
      } else if (key === LS.budget) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        await AppDB.delete('budgets', currentMonth);
      } else if (key === LS.budgetSuggestionDismissed) {
        await AppDB.delete('user_preferences', 'budgetSuggestionDismissed');
      } else if (key === LS.allowanceConfig) {
        await AppDB.delete('app_settings', 'allowance_config');
      } else if (key === LS.startingBalances) {
        await AppDB.delete('app_settings', 'starting_balances');
      } else if (key === 'et_vault_savings_v1') {
        await AppDB.clearStore('savings_vault');
      }
    } catch (e) {
      console.error('Error in AppDBSync.deleteKeyFromDB:', e);
    }
  },

  async clearAllStores() {
    if (!AppDB.db) return;
    const stores = [
      'transactions',
      'budgets',
      'analytics_cache',
      'monthly_reports',
      'savings_vault',
      'user_preferences',
      'theme_settings',
      'privacy_settings',
      'app_settings'
    ];
    for (const store of stores) {
      await AppDB.clearStore(store);
    }
  },

  async updateAchievements(txs) {
    try {
      if (txs.length > 0) {
        const ach = await AppDB.get('achievements', 'first_tx');
        if (ach && !ach.unlocked) {
          ach.unlocked = true;
          ach.progress = 100;
          await AppDB.put('achievements', ach);
        }
      }
      const bRaw = safeStorage.getItem(LS.balances);
      if (bRaw) {
        const b = JSON.parse(bRaw);
        const total = (Number(b.cash) || 0) + (Number(b.online) || 0);
        if (total >= 10000) {
          const ach = await AppDB.get('achievements', 'saver_gold');
          if (ach && !ach.unlocked) {
            ach.unlocked = true;
            ach.progress = 100;
            await AppDB.put('achievements', ach);
          }
        }
      }
    } catch (e) {
      console.error('Error in updateAchievements:', e);
    }
  }
};

registerDBSyncHandler(AppDBSync);

let dbInitPromise = null;
export function ensureDataLoaded() {
  if (!dbInitPromise) {
    dbInitPromise = loadDataFromDB();
  }
  return dbInitPromise;
}

export async function loadDataFromDB() {
  await AppDB.init();

  // 1. Master Password Hash
  let hashRecord = await AppDB.get('master_password_hash', 'master_hash');
  if (!hashRecord) {
    const oldHash = localStorage.getItem('et_master_password_hash');
    if (oldHash) {
      hashRecord = { id: 'master_hash', hash: oldHash };
      await AppDB.put('master_password_hash', hashRecord);
    }
  }
  if (hashRecord) {
    safeStorage._data['et_master_password_hash'] = hashRecord.hash;
  }

  // 2. Transactions
  let txs = await AppDB.getAll('transactions');
  if (txs.length === 0) {
    const oldTxsRaw = localStorage.getItem(LS.transactions);
    if (oldTxsRaw) {
      try {
        txs = JSON.parse(oldTxsRaw) || [];
        if (txs.length > 0) {
          await AppDB.putAll('transactions', txs);
        }
      } catch (e) {}
    }
  }
  safeStorage._data[LS.transactions] = JSON.stringify(txs);

  // 3. Budgets
  const budgets = await AppDB.getAll('budgets');
  let currentBudgetVal = 0;
  const oldBudget = localStorage.getItem(LS.budget);
  if (budgets.length === 0 && oldBudget) {
    currentBudgetVal = Number(oldBudget) || 0;
    const currentMonth = new Date().toISOString().slice(0, 7);
    await AppDB.put('budgets', { month: currentMonth, amount: currentBudgetVal });
  } else if (budgets.length > 0) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const match = budgets.find(b => b.month === currentMonth);
    if (match) {
      currentBudgetVal = match.amount;
    } else {
      currentBudgetVal = budgets[0].amount;
    }
  }
  safeStorage._data[LS.budget] = String(currentBudgetVal);

  // 4. Balances
  let balancesRecord = await AppDB.get('app_settings', 'balances');
  if (!balancesRecord) {
    const oldBalancesRaw = localStorage.getItem(LS.balances);
    if (oldBalancesRaw) {
      try {
        const parsed = JSON.parse(oldBalancesRaw);
        balancesRecord = { key: 'balances', value: parsed };
        await AppDB.put('app_settings', balancesRecord);
      } catch (e) {}
    }
  }
  if (balancesRecord) {
    safeStorage._data[LS.balances] = JSON.stringify(balancesRecord.value);
  }

  // 4b. Sanchoy Allowance Config & Starting Balances
  let allowanceRecord = await AppDB.get('app_settings', 'allowance_config');
  if (!allowanceRecord) {
    const oldAllowanceRaw = localStorage.getItem(LS.allowanceConfig);
    if (oldAllowanceRaw) {
      try {
        allowanceRecord = { key: 'allowance_config', value: JSON.parse(oldAllowanceRaw) };
        await AppDB.put('app_settings', allowanceRecord);
      } catch (e) {}
    }
  }
  if (allowanceRecord) {
    safeStorage._data[LS.allowanceConfig] = JSON.stringify(allowanceRecord.value);
  }

  let startingBalancesRecord = await AppDB.get('app_settings', 'starting_balances');
  if (!startingBalancesRecord) {
    const oldStartingRaw = localStorage.getItem(LS.startingBalances);
    if (oldStartingRaw) {
      try {
        startingBalancesRecord = { key: 'starting_balances', value: JSON.parse(oldStartingRaw) };
        await AppDB.put('app_settings', startingBalancesRecord);
      } catch (e) {}
    }
  }
  if (startingBalancesRecord) {
    safeStorage._data[LS.startingBalances] = JSON.stringify(startingBalancesRecord.value);
  }

  // 5. Savings Vault
  let vaultSavings = await AppDB.getAll('savings_vault');
  if (vaultSavings.length === 0) {
    const oldVaultRaw = localStorage.getItem('et_vault_savings_v1');
    if (oldVaultRaw) {
      try {
        vaultSavings = JSON.parse(oldVaultRaw) || [];
        if (vaultSavings.length > 0) {
          await AppDB.putAll('savings_vault', vaultSavings);
        }
      } catch (e) {}
    }
  }

  // 6. User Preferences
  let dismissPref = await AppDB.get('user_preferences', 'budgetSuggestionDismissed');
  if (!dismissPref) {
    const oldDismiss = localStorage.getItem(LS.budgetSuggestionDismissed);
    if (oldDismiss) {
      dismissPref = { key: 'budgetSuggestionDismissed', value: oldDismiss };
      await AppDB.put('user_preferences', dismissPref);
    }
  }
  if (dismissPref) {
    safeStorage._data[LS.budgetSuggestionDismissed] = dismissPref.value;
  }

  // 7. Theme Settings
  let themeSetting = await AppDB.get('theme_settings', 'vaultDarkTheme');
  if (themeSetting) {
    setVaultDarkTheme(themeSetting.value === 'true');
  }

  // 8. Categories
  let categoriesList = await AppDB.getAll('categories');
  if (categoriesList.length === 0) {
    const defaultCats = [
      { name: 'Food & Dining' },
      { name: 'Shopping' },
      { name: 'Transport' },
      { name: 'Entertainment' },
      { name: 'Bills' },
      { name: 'Health' },
      { name: 'Other' }
    ];
    await AppDB.putAll('categories', defaultCats);
  }

  // 9. Achievements
  let achievementsList = await AppDB.getAll('achievements');
  if (achievementsList.length === 0) {
    const defaultAchievements = [
      { id: 'first_tx', title: 'First Entry', desc: 'Add your first transaction', unlocked: false, progress: 0 },
      { id: 'vault_keeper', title: 'Vault Sanctuary', desc: 'Secure an entry inside the Hidden Vault', unlocked: false, progress: 0 },
      { id: 'budget_master', title: 'Budget Captain', desc: 'Set up a monthly budget cap', unlocked: false, progress: 0 },
      { id: 'saver_gold', title: 'Power Accumulator', desc: 'Save over ₹10,000 in the system', unlocked: false, progress: 0 }
    ];
    await AppDB.putAll('achievements', defaultAchievements);
  }
}
