import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VAULT_TYPES,
  VAULT_CATEGORIES,
  generateVaultRecordId,
  calculateVaultBalance,
  reconstructVaultHistory,
  calculateVaultAnalytics,
  calculateHoldingsSummary
} from '../js/financial/vault-ledger.js';

import {
  openDepositModal,
  openWithdrawModal,
  openSpendModal,
  openVaultDeleteModal,
  openVaultRestoreConfirmModal
} from '../js/vault/vault.js';

// ==================================================
// PHASE 9B — SANCHOY VAULT USER INTERFACE & INTEGRATION TESTS
// ==================================================

test('PHASE 9B - 1: Vault categories and types are defined for UI consumption', () => {
  assert.ok(Array.isArray(VAULT_CATEGORIES), 'VAULT_CATEGORIES must be an array');
  assert.ok(VAULT_CATEGORIES.includes('Food & Dining'));
  assert.ok(VAULT_CATEGORIES.includes('Shopping'));
  assert.ok(VAULT_CATEGORIES.includes('Entertainment'));
  assert.ok(VAULT_CATEGORIES.includes('Bills'));

  assert.equal(VAULT_TYPES.DEPOSIT, 'VAULT_DEPOSIT');
  assert.equal(VAULT_TYPES.WITHDRAWAL, 'VAULT_WITHDRAWAL');
  assert.equal(VAULT_TYPES.SPEND, 'VAULT_SPEND');
});

test('PHASE 9B - 2: Modal entrypoints are functions and export correctly', () => {
  assert.equal(typeof openDepositModal, 'function');
  assert.equal(typeof openWithdrawModal, 'function');
  assert.equal(typeof openSpendModal, 'function');
  assert.equal(typeof openVaultDeleteModal, 'function');
  assert.equal(typeof openVaultRestoreConfirmModal, 'function');
});

test('PHASE 9B - 3: Live preview calculations conform to financial accounting rules', () => {
  const currentWallets = { online: 1500, cash: 800 };
  const currentVault = 3200;

  // Deposit Preview: Online -> Vault ₹500
  const depositAmt = 500;
  const newOnlineAfterDeposit = currentWallets.online - depositAmt;
  const newVaultAfterDeposit = currentVault + depositAmt;
  assert.equal(newOnlineAfterDeposit, 1000);
  assert.equal(newVaultAfterDeposit, 3700);

  // Withdraw Preview: Vault -> Cash ₹400
  const withdrawAmt = 400;
  const newVaultAfterWithdraw = currentVault - withdrawAmt;
  const newCashAfterWithdraw = currentWallets.cash + withdrawAmt;
  assert.equal(newVaultAfterWithdraw, 2800);
  assert.equal(newCashAfterWithdraw, 1200);

  // Spend Preview: Vault -> External ₹600
  const spendAmt = 600;
  const newVaultAfterSpend = currentVault - spendAmt;
  assert.equal(newVaultAfterSpend, 2600);

  // Verify Holdings impact of each operation
  const initialHoldings = calculateHoldingsSummary(currentWallets.online, currentWallets.cash, currentVault);
  assert.equal(initialHoldings.liquidBalance, 2300);
  assert.equal(initialHoldings.totalHoldings, 5500);

  // After deposit: Liquid drops by 500, Total holdings unchanged
  const postDepositHoldings = calculateHoldingsSummary(newOnlineAfterDeposit, currentWallets.cash, newVaultAfterDeposit);
  assert.equal(postDepositHoldings.liquidBalance, 1800);
  assert.equal(postDepositHoldings.totalHoldings, 5500);

  // After withdrawal: Liquid increases by 400, Total holdings unchanged
  const postWithdrawHoldings = calculateHoldingsSummary(currentWallets.online, newCashAfterWithdraw, newVaultAfterWithdraw);
  assert.equal(postWithdrawHoldings.liquidBalance, 2700);
  assert.equal(postWithdrawHoldings.totalHoldings, 5500);

  // After spend: Liquid unchanged (2300), Total holdings drops by 600 (4900)
  const postSpendHoldings = calculateHoldingsSummary(currentWallets.online, currentWallets.cash, newVaultAfterSpend);
  assert.equal(postSpendHoldings.liquidBalance, 2300);
  assert.equal(postSpendHoldings.totalHoldings, 4900);
});

test('PHASE 9B - 4: Vault history and analytics compute deposits, withdrawals, spends and legacy totals', () => {
  const records = [
    {
      id: generateVaultRecordId(),
      type: VAULT_TYPES.DEPOSIT,
      amount: 1000,
      sourceWallet: 'online',
      date: '2026-10-01'
    },
    {
      id: generateVaultRecordId(),
      type: VAULT_TYPES.DEPOSIT,
      amount: 500,
      sourceWallet: 'cash',
      date: '2026-10-02'
    },
    {
      id: generateVaultRecordId(),
      type: VAULT_TYPES.WITHDRAWAL,
      amount: 300,
      destinationWallet: 'online',
      date: '2026-10-03'
    },
    {
      id: generateVaultRecordId(),
      type: VAULT_TYPES.SPEND,
      amount: 450,
      category: 'Shopping',
      description: 'Noise Cancelling Earbuds',
      date: '2026-10-04'
    },
    {
      id: 'legacy_node_1',
      month: '2026-09',
      onlineSavings: 200,
      cashSavings: 150
    }
  ];

  const analytics = calculateVaultAnalytics(records);
  assert.equal(analytics.totalDeposited, 1850); // 1000 + 500 + 350 legacy
  assert.equal(analytics.totalWithdrawn, 300);
  assert.equal(analytics.totalSpent, 450);
  assert.equal(analytics.currentBalance, 1100);

  const history = reconstructVaultHistory(records);
  assert.equal(history.finalBalance, 1100);
  assert.equal(history.history.length, 5);
});
