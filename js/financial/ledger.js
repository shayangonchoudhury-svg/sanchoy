// Sanchoy Deterministic Virtual Ledger
// The authoritative calculation layer for virtual wallet balances and financial history.

import { WALLET_TYPES, normalizeWalletType, createWalletState } from './wallets.js';
import { generateDailyAllocationEvents, getDailyAllocation, toLocalDateString } from './allowance.js';
import { calculateRecoveryEstimate } from './recovery.js';

export const EVENT_TYPES = {
  ALLOCATION: 'ALLOCATION',
  MANUAL_INCOME: 'MANUAL_INCOME',
  EXPENSE: 'EXPENSE',
  STARTING_BALANCE: 'STARTING_BALANCE',
  VAULT_TRANSFER: 'VAULT_TRANSFER'
};

/**
 * Adapts an existing/historical user transaction into a standard ledger event.
 * Preserves the original record without modification.
 * @param {object} tx - Existing transaction
 * @returns {object} LedgerEvent
 */
export function adaptTransactionToLedgerEvent(tx) {
  const isIncome = String(tx.type || '').toLowerCase() === 'income';
  const wallet = normalizeWalletType(tx.method);

  return {
    id: String(tx.id),
    type: isIncome ? EVENT_TYPES.MANUAL_INCOME : EVENT_TYPES.EXPENSE,
    wallet,
    amount: Math.abs(Number(tx.amount)) || 0,
    date: tx.date || new Date().toISOString(),
    source: 'manual_transaction',
    category: String(tx.category || 'Other'),
    desc: String(tx.desc || ''),
    referenceId: String(tx.id),
    metadata: {
      originalMethod: tx.method,
      originalType: tx.type
    }
  };
}

/**
 * Deterministically calculates a single wallet balance from an array of ledger events.
 * Unused balance carries forward indefinitely.
 * Negative balances are fully supported.
 * @param {Array<object>} events - Ledger events
 * @param {'online' | 'cash'} walletType
 * @param {number} initialBalance
 * @returns {number} Unrounded floating-point balance
 */
export function calculateWalletBalance(events = [], walletType, initialBalance = 0) {
  let balance = Number(initialBalance) || 0;

  events.forEach(event => {
    if (event.wallet !== walletType) return;

    const amount = Number(event.amount) || 0;

    switch (event.type) {
      case EVENT_TYPES.ALLOCATION:
      case EVENT_TYPES.MANUAL_INCOME:
      case EVENT_TYPES.STARTING_BALANCE:
        balance += amount;
        break;
      case EVENT_TYPES.EXPENSE:
        balance -= amount;
        break;
      case EVENT_TYPES.VAULT_TRANSFER:
        if (event.direction === 'in') {
          balance += amount;
        } else if (event.direction === 'out') {
          balance -= amount;
        }
        break;
      default:
        break;
    }
  });

  return balance;
}

/**
 * Reconciles the entire virtual ledger deterministically.
 * Merges:
 * - Starting balances
 * - Automated daily virtual allocations (idempotently generated per date & wallet)
 * - User manual transactions (income & expense)
 * - Explicit internal transfers to/from the Secret Savings Vault
 *
 * @param {object} params
 * @param {Array<object>} params.transactions - Array of transactions
 * @param {object | Array<object>} params.allowanceConfig - Current or historical allowance configs
 * @param {object} [params.initialBalances] - { online: number, cash: number }
 * @param {string} [params.targetDateStr] - Target date for calculations ("YYYY-MM-DD")
 * @param {Array<object>} [params.vaultTransactions] - Array of Vault ledger records
 * @returns {object}
 */
export function reconcileVirtualLedger({
  transactions = [],
  allowanceConfig = null,
  initialBalances = { online: 0, cash: 0 },
  targetDateStr = null,
  vaultTransactions = []
} = {}) {
  const targetDate = targetDateStr || toLocalDateString(new Date());
  const allEvents = [];
  const eventIdSet = new Set();

  // 1. Initial starting balance events (if any non-zero initial balance exists)
  if (initialBalances.online) {
    allEvents.push({
      id: 'init_balance_online',
      type: EVENT_TYPES.STARTING_BALANCE,
      wallet: WALLET_TYPES.ONLINE,
      amount: Number(initialBalances.online),
      date: '1970-01-01',
      source: 'initial_balance'
    });
    eventIdSet.add('init_balance_online');
  }

  if (initialBalances.cash) {
    allEvents.push({
      id: 'init_balance_cash',
      type: EVENT_TYPES.STARTING_BALANCE,
      wallet: WALLET_TYPES.CASH,
      amount: Number(initialBalances.cash),
      date: '1970-01-01',
      source: 'initial_balance'
    });
    eventIdSet.add('init_balance_cash');
  }

  // 2. Generate daily virtual allocations from active allowance configuration
  const configs = Array.isArray(allowanceConfig) ? allowanceConfig : (allowanceConfig ? [allowanceConfig] : []);
  configs.forEach(cfg => {
    const allocations = generateDailyAllocationEvents(cfg, targetDate);
    allocations.forEach(alloc => {
      if (!eventIdSet.has(alloc.id)) {
        allEvents.push(alloc);
        eventIdSet.add(alloc.id);
      }
    });
  });

  // 3. Adapt and include all manual transactions
  transactions.forEach(tx => {
    if (!tx || typeof tx !== 'object') return;
    const event = adaptTransactionToLedgerEvent(tx);
    allEvents.push(event);
  });

  // 3b. Adapt vault transfers into ledger events for Online/Cash wallets
  (vaultTransactions || []).forEach(vtx => {
    if (!vtx || vtx.deleted) return;
    const amt = Number(vtx.amount) || 0;
    if (amt <= 0) return;

    if (vtx.type === 'VAULT_DEPOSIT') {
      // Transfer out of online/cash into vault
      const wallet = normalizeWalletType(vtx.sourceWallet);
      allEvents.push({
        id: `vt_${vtx.id}`,
        type: EVENT_TYPES.VAULT_TRANSFER,
        wallet,
        direction: 'out',
        amount: amt,
        date: vtx.date || new Date().toISOString(),
        source: 'vault_transfer',
        category: 'Vault Transfer',
        desc: vtx.description || `Added to Vault from ${wallet}`,
        referenceId: String(vtx.id)
      });
    } else if (vtx.type === 'VAULT_WITHDRAWAL') {
      // Transfer into online/cash from vault
      const wallet = normalizeWalletType(vtx.destinationWallet);
      allEvents.push({
        id: `vt_${vtx.id}`,
        type: EVENT_TYPES.VAULT_TRANSFER,
        wallet,
        direction: 'in',
        amount: amt,
        date: vtx.date || new Date().toISOString(),
        source: 'vault_transfer',
        category: 'Vault Transfer',
        desc: vtx.description || `Withdrawn from Vault to ${wallet}`,
        referenceId: String(vtx.id)
      });
    }
    // VAULT_SPEND has source 'vault' and destination 'external', so it does NOT affect online or cash wallet!
  });

  // Sort events chronologically
  allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // 4. Calculate deterministic balances
  const onlineBalance = calculateWalletBalance(allEvents, WALLET_TYPES.ONLINE, 0);
  const cashBalance = calculateWalletBalance(allEvents, WALLET_TYPES.CASH, 0);
  const walletState = createWalletState(onlineBalance, cashBalance);

  // 5. Calculate current daily allocation rates based on target date
  const targetDateObj = new Date(targetDate);
  const currentYear = !isNaN(targetDateObj.getFullYear()) ? targetDateObj.getFullYear() : new Date().getFullYear();
  const currentMonth = !isNaN(targetDateObj.getMonth()) ? (targetDateObj.getMonth() + 1) : (new Date().getMonth() + 1);
  const activeConfig = configs.length ? configs[configs.length - 1] : null;

  const dailyRates = {
    online: activeConfig ? getDailyAllocation(activeConfig.monthlyOnlineAllowance, currentYear, currentMonth) : 0,
    cash: activeConfig ? getDailyAllocation(activeConfig.monthlyCashAllowance, currentYear, currentMonth) : 0
  };

  // 6. Calculate recovery estimates for negative balances
  const recovery = {
    online: calculateRecoveryEstimate(onlineBalance, dailyRates.online),
    cash: calculateRecoveryEstimate(cashBalance, dailyRates.cash)
  };

  return {
    wallets: walletState,
    dailyRates,
    recovery,
    activeConfig,
    events: allEvents,
    eventCount: allEvents.length
  };
}

/**
 * Provides an explainable audit breakdown for a specific virtual wallet.
 * Answers: "What events caused this wallet to have its current balance?"
 * @param {Array<object>} events - Reconciled ledger events
 * @param {'online' | 'cash'} walletType
 * @returns {object}
 */
export function explainWalletBalance(events = [], walletType) {
  const walletEvents = events.filter(e => e.wallet === walletType);

  let totalAllocations = 0;
  let totalManualIncome = 0;
  let totalExpenses = 0;
  let totalTransfersIn = 0;
  let totalTransfersOut = 0;
  let startingBalance = 0;

  walletEvents.forEach(e => {
    const amt = Number(e.amount) || 0;
    if (e.type === EVENT_TYPES.ALLOCATION) totalAllocations += amt;
    else if (e.type === EVENT_TYPES.MANUAL_INCOME) totalManualIncome += amt;
    else if (e.type === EVENT_TYPES.EXPENSE) totalExpenses += amt;
    else if (e.type === EVENT_TYPES.STARTING_BALANCE) startingBalance += amt;
    else if (e.type === EVENT_TYPES.VAULT_TRANSFER) {
      if (e.direction === 'in') totalTransfersIn += amt;
      else if (e.direction === 'out') totalTransfersOut += amt;
    }
  });

  const finalBalance = startingBalance + totalAllocations + totalManualIncome - totalExpenses + totalTransfersIn - totalTransfersOut;

  return {
    wallet: walletType,
    startingBalance,
    totalAllocations,
    totalManualIncome,
    totalExpenses,
    totalTransfersIn,
    totalTransfersOut,
    finalBalance,
    eventCount: walletEvents.length,
    events: walletEvents
  };
}
