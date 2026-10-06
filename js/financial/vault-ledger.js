// Sanchoy Deterministic Vault Ledger & Financial Holdings Engine
// Manages the Secret Savings Vault as a third distinct financial balance.
// Accounting rules:
// - Total Liquid Virtual Balance = Online Wallet + Cash Wallet
// - Total Sanchoy Holdings = Online Wallet + Cash Wallet + Vault
// - Vault does NOT participate in monthly automatic allowance.
// - Vault balance is derived deterministically from its transaction ledger.

export const VAULT_TYPES = {
  DEPOSIT: 'VAULT_DEPOSIT',
  WITHDRAWAL: 'VAULT_WITHDRAWAL',
  SPEND: 'VAULT_SPEND'
};

export const VAULT_CATEGORIES = [
  'Food & Dining',
  'Shopping',
  'Transport',
  'Entertainment',
  'Bills',
  'Health',
  'Study Material',
  'Other'
];

/**
 * Generates a stable unique Vault transaction ID
 */
export function generateVaultRecordId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `vault_${hex}`;
  }
  return `vault_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Validates a proposed Vault transaction against current wallet balances.
 * Enforces strict financial limits:
 * - Amount must be positive (> 0)
 * - Deposits cannot exceed source wallet balance
 * - Withdrawals and Spending cannot exceed current Vault balance
 * - Vault balance can NEVER become negative
 */
export function validateVaultTransaction(tx, currentBalances = { online: 0, cash: 0, vault: 0 }) {
  if (!tx || typeof tx !== 'object') {
    return { valid: false, error: 'Transaction data is missing or malformed.' };
  }

  const amount = Number(tx.amount);
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: 'Amount must be greater than zero.' };
  }

  const type = tx.type;
  if (![VAULT_TYPES.DEPOSIT, VAULT_TYPES.WITHDRAWAL, VAULT_TYPES.SPEND].includes(type)) {
    return { valid: false, error: 'Invalid Vault transaction type.' };
  }

  if (!tx.date) {
    return { valid: false, error: 'Transaction date is required.' };
  }

  const availableOnline = Number(currentBalances.online) || 0;
  const availableCash = Number(currentBalances.cash) || 0;
  const availableVault = Math.max(0, Number(currentBalances.vault) || 0);

  if (type === VAULT_TYPES.DEPOSIT) {
    const src = String(tx.sourceWallet || '').toLowerCase();
    if (src !== 'online' && src !== 'cash') {
      return { valid: false, error: 'Deposit source must be Online Wallet or Cash Wallet.' };
    }
    const sourceAvailable = src === 'online' ? availableOnline : availableCash;
    if (amount > sourceAvailable) {
      const walletName = src === 'online' ? 'Online Wallet' : 'Cash Wallet';
      return {
        valid: false,
        error: `Cannot transfer more than current ${walletName} balance (Available: ₹${sourceAvailable.toFixed(2)}).`
      };
    }
  } else if (type === VAULT_TYPES.WITHDRAWAL) {
    const dst = String(tx.destinationWallet || '').toLowerCase();
    if (dst !== 'online' && dst !== 'cash') {
      return { valid: false, error: 'Withdrawal destination must be Online Wallet or Cash Wallet.' };
    }
    if (amount > availableVault) {
      return {
        valid: false,
        error: `Cannot withdraw more than current Vault balance (Available: ₹${availableVault.toFixed(2)}).`
      };
    }
  } else if (type === VAULT_TYPES.SPEND) {
    if (amount > availableVault) {
      return {
        valid: false,
        error: `Cannot spend more than current Vault balance (Available: ₹${availableVault.toFixed(2)}).`
      };
    }
    if (!tx.category || String(tx.category).trim() === '') {
      return { valid: false, error: 'Spending category is required.' };
    }
  }

  return { valid: true };
}

/**
 * Deterministically calculates the authoritative Vault balance from its ledger records.
 * Formula: Starting Vault Balance + Deposits - Withdrawals - Spending
 * Guarantees Vault balance never drops below zero.
 */
export function calculateVaultBalance(records = [], startingBalance = 0) {
  let balance = Number(startingBalance) || 0;
  const activeRecords = (records || []).filter(r => r && !r.deleted);

  activeRecords.forEach(r => {
    const amt = Number(r.amount) || 0;
    if (r.type === VAULT_TYPES.DEPOSIT) {
      balance += amt;
    } else if (r.type === VAULT_TYPES.WITHDRAWAL) {
      balance -= amt;
    } else if (r.type === VAULT_TYPES.SPEND) {
      balance -= amt;
    } else if (!r.type) {
      // Legacy monthly snapshot record support
      const legacySum = Number(r.cashSavings || 0) + Number(r.onlineSavings || 0) + Number(r.extraSavings || 0) +
        Number(r.emergencySavings || 0) + Number(r.investments || 0) + Number(r.goldSavings || 0) + Number(r.otherSavings || 0);
      balance += legacySum;
    }
  });

  return Math.max(0, balance);
}

/**
 * Chronologically replays the Vault ledger to compute:
 * 1. Running balance after each transaction
 * 2. Formatted display metadata for history view
 * 3. Final reconstructed Vault balance
 */
export function reconstructVaultHistory(records = [], startingBalance = 0) {
  const activeRecords = (records || []).filter(r => r && !r.deleted);

  // Normalize legacy and modern records
  const normalized = activeRecords.map(r => {
    if (!r.type) {
      const sum = Number(r.cashSavings || 0) + Number(r.onlineSavings || 0) + Number(r.extraSavings || 0) +
        Number(r.emergencySavings || 0) + Number(r.investments || 0) + Number(r.goldSavings || 0) + Number(r.otherSavings || 0);
      return {
        id: r.id,
        type: VAULT_TYPES.DEPOSIT,
        amount: sum,
        date: r.month ? `${r.month}-01` : (r.date || new Date().toISOString().slice(0, 10)),
        sourceWallet: 'online',
        destinationWallet: 'vault',
        category: 'Savings Snapshot',
        description: r.notes || `Legacy savings for ${r.month || 'node'}`,
        createdAt: r.createdAt || r.date || '2026-01-01',
        isLegacy: true
      };
    }
    return { ...r };
  });

  // Sort chronologically (oldest to newest for forward replay)
  normalized.sort((a, b) => {
    const timeA = new Date(a.date).getTime() || 0;
    const timeB = new Date(b.date).getTime() || 0;
    if (timeA !== timeB) return timeA - timeB;
    const createA = new Date(a.createdAt || a.date).getTime() || 0;
    const createB = new Date(b.createdAt || b.date).getTime() || 0;
    return createA - createB;
  });

  let runningBalance = Number(startingBalance) || 0;
  const history = normalized.map(tx => {
    const amt = Number(tx.amount) || 0;
    if (tx.type === VAULT_TYPES.DEPOSIT) {
      runningBalance += amt;
    } else if (tx.type === VAULT_TYPES.WITHDRAWAL || tx.type === VAULT_TYPES.SPEND) {
      runningBalance -= amt;
    }

    return {
      ...tx,
      amount: amt,
      balanceAfter: Math.max(0, runningBalance)
    };
  });

  return {
    history, // chronological (oldest to newest)
    historyDescending: [...history].reverse(), // for UI (newest to oldest)
    finalBalance: Math.max(0, runningBalance)
  };
}

/**
 * Calculates analytics aggregations across Vault history
 */
export function calculateVaultAnalytics(records = [], startingBalance = 0) {
  const activeRecords = (records || []).filter(r => r && !r.deleted);
  let totalDeposited = 0;
  let totalWithdrawn = 0;
  let totalSpent = 0;
  const categoryBreakdown = {};

  activeRecords.forEach(r => {
    const amt = Number(r.amount) || 0;
    if (r.type === VAULT_TYPES.DEPOSIT) {
      totalDeposited += amt;
    } else if (r.type === VAULT_TYPES.WITHDRAWAL) {
      totalWithdrawn += amt;
    } else if (r.type === VAULT_TYPES.SPEND) {
      totalSpent += amt;
      const cat = r.category || 'Other';
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + amt;
    } else if (!r.type) {
      const sum = Number(r.cashSavings || 0) + Number(r.onlineSavings || 0) + Number(r.extraSavings || 0) +
        Number(r.emergencySavings || 0) + Number(r.investments || 0) + Number(r.goldSavings || 0) + Number(r.otherSavings || 0);
      totalDeposited += sum;
    }
  });

  const netSavings = totalDeposited - totalWithdrawn - totalSpent;
  const currentBalance = Math.max(0, startingBalance + netSavings);

  return {
    startingBalance,
    totalDeposited,
    totalWithdrawn,
    totalSpent,
    netSavings,
    currentBalance,
    transactionCount: activeRecords.length,
    categoryBreakdown
  };
}

/**
 * Computes Total Liquid Virtual Balance and Total Sanchoy Holdings
 * Liquid = Online + Cash
 * Total Holdings = Online + Cash + Vault
 */
export function calculateHoldingsSummary(onlineBalance = 0, cashBalance = 0, vaultBalance = 0) {
  const online = Number(onlineBalance) || 0;
  const cash = Number(cashBalance) || 0;
  const vault = Math.max(0, Number(vaultBalance) || 0);
  const liquid = online + cash;
  const total = liquid + vault;

  return {
    online,
    cash,
    vault,
    liquidBalance: liquid,
    totalHoldings: total
  };
}
