import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VAULT_TYPES,
  VAULT_CATEGORIES,
  generateVaultRecordId,
  validateVaultTransaction,
  calculateVaultBalance,
  reconstructVaultHistory,
  calculateVaultAnalytics,
  calculateHoldingsSummary
} from '../js/financial/vault-ledger.js';

import {
  reconcileVirtualLedger,
  calculateWalletBalance,
  EVENT_TYPES
} from '../js/financial/ledger.js';

import { WALLET_TYPES } from '../js/financial/wallets.js';

// ==================================================
// PHASE 9A — SANCHOY VAULT CORE FINANCIAL ENGINE TESTS
// ==================================================

test('TEST 1: Initial Vault balance defaults to zero with an empty ledger', () => {
  const balance = calculateVaultBalance([]);
  assert.equal(balance, 0, 'Empty vault ledger must calculate to ₹0.00');

  const historyResult = reconstructVaultHistory([]);
  assert.equal(historyResult.finalBalance, 0);
  assert.equal(historyResult.history.length, 0);
});

test('TEST 2: Deposit from Online decreases Online Wallet and increases Vault without creating an expense', () => {
  const initialWallets = { online: 1000, cash: 500 };
  const depositTx = {
    id: generateVaultRecordId(),
    type: VAULT_TYPES.DEPOSIT,
    amount: 300,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-08',
    description: 'Transfer savings to Vault'
  };

  // 1. Validation check
  const validation = validateVaultTransaction(depositTx, { online: 1000, cash: 500, vault: 0 });
  assert.equal(validation.valid, true);

  // 2. Deterministic ledger reconciliation
  const ledger = reconcileVirtualLedger({
    transactions: [],
    initialBalances: initialWallets,
    vaultTransactions: [depositTx]
  });

  assert.equal(ledger.wallets.online, 700, 'Online Wallet must decrease by ₹300 (₹1,000 -> ₹700)');
  assert.equal(ledger.wallets.cash, 500, 'Cash Wallet must remain unchanged at ₹500');
  assert.equal(ledger.wallets.total, 1200, 'Total Liquid Virtual Balance must be ₹1,200');

  // Verify event classification is VAULT_TRANSFER, NOT EXPENSE
  const transferEvent = ledger.events.find(e => e.id === `vt_${depositTx.id}`);
  assert.ok(transferEvent, 'Transfer event must exist in virtual ledger');
  assert.equal(transferEvent.type, EVENT_TYPES.VAULT_TRANSFER);
  assert.notEqual(transferEvent.type, EVENT_TYPES.EXPENSE, 'Vault transfer must NEVER be classified as EXPENSE');

  // 3. Vault balance calculation
  const vaultBalance = calculateVaultBalance([depositTx]);
  assert.equal(vaultBalance, 300, 'Vault balance must increase by ₹300');

  // 4. Holdings check
  const holdings = calculateHoldingsSummary(ledger.wallets.online, ledger.wallets.cash, vaultBalance);
  assert.equal(holdings.liquidBalance, 1200);
  assert.equal(holdings.totalHoldings, 1500, 'Total Sanchoy Holdings must remain preserved at ₹1,500');
});

test('TEST 3: Deposit from Cash decreases Cash Wallet and increases Vault', () => {
  const initialWallets = { online: 800, cash: 600 };
  const depositTx = {
    id: generateVaultRecordId(),
    type: VAULT_TYPES.DEPOSIT,
    amount: 250,
    sourceWallet: 'cash',
    destinationWallet: 'vault',
    date: '2026-10-08',
    description: 'Cash deposit into savings vault'
  };

  const validation = validateVaultTransaction(depositTx, { online: 800, cash: 600, vault: 100 });
  assert.equal(validation.valid, true);

  const ledger = reconcileVirtualLedger({
    transactions: [],
    initialBalances: initialWallets,
    vaultTransactions: [depositTx]
  });

  assert.equal(ledger.wallets.online, 800, 'Online Wallet must remain ₹800');
  assert.equal(ledger.wallets.cash, 350, 'Cash Wallet must decrease by ₹250 (₹600 -> ₹350)');

  const vaultBalance = calculateVaultBalance([depositTx], 100);
  assert.equal(vaultBalance, 350, 'Vault balance must be Starting (₹100) + Deposit (₹250) = ₹350');
});

test('TEST 4: Withdrawal to Online decreases Vault and increases Online Wallet without creating income', () => {
  const initialWallets = { online: 700, cash: 500 };
  const depositTx = {
    id: 'tx_dep_1',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1000,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-01'
  };
  const withdrawTx = {
    id: 'tx_wd_1',
    type: VAULT_TYPES.WITHDRAWAL,
    amount: 400,
    sourceWallet: 'vault',
    destinationWallet: 'online',
    date: '2026-10-05',
    description: 'Withdrawal to Online wallet'
  };

  const vaultBalanceBefore = calculateVaultBalance([depositTx]);
  assert.equal(vaultBalanceBefore, 1000);

  const validation = validateVaultTransaction(withdrawTx, { online: 700, cash: 500, vault: vaultBalanceBefore });
  assert.equal(validation.valid, true);

  const ledger = reconcileVirtualLedger({
    transactions: [],
    initialBalances: initialWallets,
    vaultTransactions: [depositTx, withdrawTx]
  });

  // Online started at 700, deposit took 1000 (net -300), withdrawal added 400 (net 100)
  assert.equal(ledger.wallets.online, 100, 'Online wallet reflects net transfer');

  const transferInEvent = ledger.events.find(e => e.id === `vt_${withdrawTx.id}`);
  assert.ok(transferInEvent);
  assert.equal(transferInEvent.type, EVENT_TYPES.VAULT_TRANSFER);
  assert.equal(transferInEvent.direction, 'in');
  assert.notEqual(transferInEvent.type, EVENT_TYPES.MANUAL_INCOME, 'Vault withdrawal must NEVER be classified as MANUAL_INCOME');

  const vaultBalanceAfter = calculateVaultBalance([depositTx, withdrawTx]);
  assert.equal(vaultBalanceAfter, 600, 'Vault balance must decrease from ₹1,000 to ₹600');
});

test('TEST 5: Withdrawal to Cash decreases Vault and increases Cash Wallet', () => {
  const initialWallets = { online: 500, cash: 200 };
  const depositTx = {
    id: 'dep_1',
    type: VAULT_TYPES.DEPOSIT,
    amount: 1500,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-01'
  };
  const withdrawTx = {
    id: 'wd_cash_1',
    type: VAULT_TYPES.WITHDRAWAL,
    amount: 500,
    sourceWallet: 'vault',
    destinationWallet: 'cash',
    date: '2026-10-06'
  };

  const ledger = reconcileVirtualLedger({
    transactions: [],
    initialBalances: initialWallets,
    vaultTransactions: [depositTx, withdrawTx]
  });

  assert.equal(ledger.wallets.cash, 700, 'Cash Wallet must increase from ₹200 to ₹700 (200 + 500)');

  const vaultBalance = calculateVaultBalance([depositTx, withdrawTx]);
  assert.equal(vaultBalance, 1000, 'Vault balance must decrease from ₹1,500 to ₹1,000');
});

test('TEST 6: Spend from Vault directly reduces Vault and Total Holdings without altering liquid wallet balances', () => {
  const initialWallets = { online: 1200, cash: 800 };
  const depositTx = {
    id: 'dep_main',
    type: VAULT_TYPES.DEPOSIT,
    amount: 2000,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-01'
  };

  // Balance before spending: Online: 1200 - 2000 = -800, Cash: 800, Vault: 2000
  // Total Liquid = 0, Total Holdings = 2000
  // Now user spends ₹600 from Vault for headphones
  const spendTx = {
    id: 'spend_headphones',
    type: VAULT_TYPES.SPEND,
    amount: 600,
    sourceWallet: 'vault',
    destinationWallet: 'external',
    category: 'Shopping',
    description: 'Bought headphones',
    date: '2026-10-08'
  };

  const validation = validateVaultTransaction(spendTx, { online: -800, cash: 800, vault: 2000 });
  assert.equal(validation.valid, true);

  const ledger = reconcileVirtualLedger({
    transactions: [],
    initialBalances: initialWallets,
    vaultTransactions: [depositTx, spendTx]
  });

  // Verify Online and Cash are COMPLETELY UNCHANGED by the spend event
  assert.equal(ledger.wallets.online, -800, 'Online Wallet MUST NOT change when spending from Vault');
  assert.equal(ledger.wallets.cash, 800, 'Cash Wallet MUST NOT change when spending from Vault');
  assert.equal(ledger.wallets.total, 0, 'Liquid balance MUST NOT change when spending from Vault');

  // Verify no spend event was injected into Online/Cash ledger
  const spendEventInLedger = ledger.events.find(e => e.id === `vt_${spendTx.id}`);
  assert.equal(spendEventInLedger, undefined, 'Vault external spend must not inject into liquid wallet ledger');

  // Verify Vault balance decreased by ₹600
  const vaultBalance = calculateVaultBalance([depositTx, spendTx]);
  assert.equal(vaultBalance, 1400, 'Vault balance must decrease from ₹2,000 to ₹1,400');

  // Holdings check: Holdings was ₹2,000, now ₹1,400
  const holdings = calculateHoldingsSummary(ledger.wallets.online, ledger.wallets.cash, vaultBalance);
  assert.equal(holdings.liquidBalance, 0);
  assert.equal(holdings.vault, 1400);
  assert.equal(holdings.totalHoldings, 1400, 'Total Sanchoy Holdings must decrease by exactly the spend amount (₹600)');
});

test('TEST 7: Vault balance can NEVER become negative', () => {
  const startingVault = 500;
  const overdraftSpend = {
    id: 'overdraft_tx',
    type: VAULT_TYPES.SPEND,
    amount: 700,
    sourceWallet: 'vault',
    destinationWallet: 'external',
    category: 'Bills',
    date: '2026-10-08'
  };

  const validation = validateVaultTransaction(overdraftSpend, { online: 1000, cash: 1000, vault: startingVault });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /cannot spend more than current vault balance/i);

  // Even if a malformed ledger with excess spending is evaluated, calculateVaultBalance clamps to 0
  const forcedNegativeBalance = calculateVaultBalance([overdraftSpend], startingVault);
  assert.equal(forcedNegativeBalance, 0, 'calculateVaultBalance must never return negative values');
});

test('TEST 8: Cannot deposit more than source wallet balance', () => {
  const currentOnline = 400;
  const excessiveDeposit = {
    id: 'excess_dep',
    type: VAULT_TYPES.DEPOSIT,
    amount: 500,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-08'
  };

  const validation = validateVaultTransaction(excessiveDeposit, { online: currentOnline, cash: 1000, vault: 0 });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /cannot transfer more than current online wallet balance/i);
});

test('TEST 9: Cannot withdraw more than Vault balance', () => {
  const currentVault = 300;
  const excessiveWithdrawal = {
    id: 'excess_wd',
    type: VAULT_TYPES.WITHDRAWAL,
    amount: 350,
    sourceWallet: 'vault',
    destinationWallet: 'online',
    date: '2026-10-08'
  };

  const validation = validateVaultTransaction(excessiveWithdrawal, { online: 500, cash: 500, vault: currentVault });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /cannot withdraw more than current vault balance/i);
});

test('TEST 10: Cannot spend more than Vault balance', () => {
  const currentVault = 450;
  const excessiveSpend = {
    id: 'excess_spend',
    type: VAULT_TYPES.SPEND,
    amount: 600,
    sourceWallet: 'vault',
    destinationWallet: 'external',
    category: 'Shopping',
    date: '2026-10-08'
  };

  const validation = validateVaultTransaction(excessiveSpend, { online: 1000, cash: 1000, vault: currentVault });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /cannot spend more than current vault balance/i);
});

test('TEST 11: Zero amount is rejected', () => {
  const zeroTx = {
    id: 'zero_tx',
    type: VAULT_TYPES.DEPOSIT,
    amount: 0,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-08'
  };

  const validation = validateVaultTransaction(zeroTx, { online: 1000, cash: 1000, vault: 1000 });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /amount must be greater than zero/i);
});

test('TEST 12: Negative amount is rejected', () => {
  const negTx = {
    id: 'neg_tx',
    type: VAULT_TYPES.SPEND,
    amount: -50,
    sourceWallet: 'vault',
    destinationWallet: 'external',
    category: 'Food & Dining',
    date: '2026-10-08'
  };

  const validation = validateVaultTransaction(negTx, { online: 1000, cash: 1000, vault: 1000 });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /amount must be greater than zero/i);
});

test('TEST 13: Deterministic Vault balance and running history reconstruction', () => {
  // Reconstruct history chronologically:
  // Day 1: Deposit ₹1,000 from Online -> Balance ₹1,000
  // Day 2: Deposit ₹500 from Cash -> Balance ₹1,500
  // Day 3: Withdraw ₹300 to Online -> Balance ₹1,200
  // Day 4: Spend ₹450 for Shopping -> Balance ₹750
  const records = [
    { id: 'tx_3', type: VAULT_TYPES.WITHDRAWAL, amount: 300, date: '2026-10-03', sourceWallet: 'vault', destinationWallet: 'online' },
    { id: 'tx_1', type: VAULT_TYPES.DEPOSIT, amount: 1000, date: '2026-10-01', sourceWallet: 'online', destinationWallet: 'vault' },
    { id: 'tx_4', type: VAULT_TYPES.SPEND, amount: 450, date: '2026-10-04', sourceWallet: 'vault', destinationWallet: 'external', category: 'Shopping' },
    { id: 'tx_2', type: VAULT_TYPES.DEPOSIT, amount: 500, date: '2026-10-02', sourceWallet: 'cash', destinationWallet: 'vault' }
  ];

  const { history, finalBalance } = reconstructVaultHistory(records, 0);

  assert.equal(finalBalance, 750, 'Final deterministic balance must be ₹750');
  assert.equal(history.length, 4);

  // Check running balance after each event in chronological order
  assert.equal(history[0].id, 'tx_1');
  assert.equal(history[0].balanceAfter, 1000);

  assert.equal(history[1].id, 'tx_2');
  assert.equal(history[1].balanceAfter, 1500);

  assert.equal(history[2].id, 'tx_3');
  assert.equal(history[2].balanceAfter, 1200);

  assert.equal(history[3].id, 'tx_4');
  assert.equal(history[3].balanceAfter, 750);
});

test('TEST 14: Total Liquid Virtual Balance strictly excludes Vault balance', () => {
  const online = 500;
  const cash = 300;
  const vault = 2000;

  const holdings = calculateHoldingsSummary(online, cash, vault);

  assert.equal(holdings.liquidBalance, 800, 'Liquid balance must be Online (500) + Cash (300) = 800');
  assert.notEqual(holdings.liquidBalance, 2800, 'Liquid balance must NEVER include Vault balance');
});

test('TEST 15: Total Sanchoy Holdings strictly includes Vault balance', () => {
  const online = 500;
  const cash = 300;
  const vault = 2000;

  const holdings = calculateHoldingsSummary(online, cash, vault);

  assert.equal(holdings.totalHoldings, 2800, 'Total holdings must be Online (500) + Cash (300) + Vault (2000) = 2800');

  // Now spend ₹600 from Vault
  const updatedVault = vault - 600;
  const updatedHoldings = calculateHoldingsSummary(online, cash, updatedVault);

  assert.equal(updatedHoldings.liquidBalance, 800, 'Liquid balance remains ₹800');
  assert.equal(updatedHoldings.vault, 1400, 'Vault becomes ₹1,400');
  assert.equal(updatedHoldings.totalHoldings, 2200, 'Total holdings decreases to ₹2,200');
});

test('TEST 16: Existing financial tests still pass and allowance engine is not affected by Vault', () => {
  // Config: Monthly allowance 3100 Online, 3100 Cash in Oct (31 days) -> 100/day
  const allowanceConfig = {
    monthlyOnlineAllowance: 3100,
    monthlyCashAllowance: 3100,
    effectiveDate: '2026-10-01'
  };

  const initialBalances = { online: 500, cash: 500 };

  // Ledger with regular transaction AND vault transfer
  const regularExpense = {
    id: 'reg_exp_1',
    type: 'expense',
    amount: 100,
    method: 'online',
    date: '2026-10-02'
  };

  const vaultDeposit = {
    id: 'vault_dep_1',
    type: VAULT_TYPES.DEPOSIT,
    amount: 200,
    sourceWallet: 'online',
    destinationWallet: 'vault',
    date: '2026-10-03'
  };

  const ledger = reconcileVirtualLedger({
    transactions: [regularExpense],
    allowanceConfig,
    initialBalances,
    targetDateStr: '2026-10-03', // 3 days allocation: 3 * 100 = 300 per wallet
    vaultTransactions: [vaultDeposit]
  });

  // Daily allocation rate check: rate must remain strictly 3100 / 31 = 100 per day
  assert.equal(ledger.dailyRates.online, 100, 'Daily rate must not be altered by Vault');
  assert.equal(ledger.dailyRates.cash, 100, 'Daily rate must not be altered by Vault');

  // Online wallet calculation:
  // Initial: 500
  // Allocations: 300 (Oct 1, 2, 3)
  // Expense: -100
  // Vault Transfer out: -200
  // Expected = 500 + 300 - 100 - 200 = 500
  assert.equal(ledger.wallets.online, 500);

  // Cash wallet calculation:
  // Initial: 500
  // Allocations: 300
  // Expected = 800
  assert.equal(ledger.wallets.cash, 800);

  // Total Liquid = 500 + 800 = 1300
  assert.equal(ledger.wallets.total, 1300);

  // Vault = 200
  const vaultBal = calculateVaultBalance([vaultDeposit]);
  assert.equal(vaultBal, 200);

  // Holdings = 1300 + 200 = 1500
  const holdings = calculateHoldingsSummary(ledger.wallets.online, ledger.wallets.cash, vaultBal);
  assert.equal(holdings.totalHoldings, 1500);
});
