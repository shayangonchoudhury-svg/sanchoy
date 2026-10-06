// Sanchoy Local <-> Cloud Migration Engine
// Handles:
// - Migrating existing local IndexedDB records to the new two-key encrypted cloud envelope
// - Bundling local wallets, transactions, starting balances, allowance config, categories, vault records
// - Ensuring ZERO data loss for existing users
// - Preserves deterministic ledger states

import { AppDB } from '../storage/database.js';
import { safeStorage, LS } from '../core/state.js';
import { encryptPayload, decryptPayload } from '../security/crypto.js';
import { createWorkspaceEnvelope } from '../security/workspace-keys.js';
import { saveEncryptedWorkspace, saveUserProfile } from '../firebase/firestore.js';
import { setActiveWorkspaceDEK } from '../security/secure-session.js';
import { showToast } from '../ui/toast.js';

/**
 * Gathers all local financial records from IndexedDB and safeStorage
 * into a single unified private financial workspace bundle
 */
export async function gatherLocalFinancialWorkspace() {
  const txs = await AppDB.getAll('transactions');
  const categories = await AppDB.getAll('categories');
  const budgets = await AppDB.getAll('budgets');
  let vaultRecords = await AppDB.getAll('savings_vault');

  if (!vaultRecords || vaultRecords.length === 0) {
    try {
      const cached = safeStorage.getItem('sanchoy_vault_records_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          vaultRecords = parsed;
        }
      }
    } catch (e) {}
  }

  const balancesRaw = safeStorage.getItem(LS.balances);
  const startingBalancesRaw = safeStorage.getItem(LS.startingBalances);
  const allowanceConfigRaw = safeStorage.getItem(LS.allowanceConfig);

  let balances = { online: 0, cash: 0 };
  let startingBalances = { online: 0, cash: 0, configured: false };
  let allowanceConfig = { monthlyOnline: 0, monthlyCash: 0, configured: false, startDate: null };

  try { if (balancesRaw) balances = JSON.parse(balancesRaw); } catch (e) {}
  try { if (startingBalancesRaw) startingBalances = JSON.parse(startingBalancesRaw); } catch (e) {}
  try { if (allowanceConfigRaw) allowanceConfig = JSON.parse(allowanceConfigRaw); } catch (e) {}

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    balances,
    startingBalances,
    allowanceConfig,
    transactions: txs || [],
    categories: categories || [],
    budgets: budgets || [],
    vaultRecords: vaultRecords || []
  };
}

/**
 * Restores a decrypted financial workspace bundle into local IndexedDB and safeStorage
 */
export async function restoreFinancialWorkspaceLocally(bundle) {
  if (!bundle) throw new Error('Cannot restore empty workspace bundle');

  // 1. Restore safeStorage balances & config
  if (bundle.balances) {
    safeStorage.setItem(LS.balances, JSON.stringify(bundle.balances));
  }
  if (bundle.startingBalances) {
    safeStorage.setItem(LS.startingBalances, JSON.stringify(bundle.startingBalances));
  }
  if (bundle.allowanceConfig) {
    safeStorage.setItem(LS.allowanceConfig, JSON.stringify(bundle.allowanceConfig));
  }

  // 2. Restore transactions
  if (Array.isArray(bundle.transactions)) {
    for (const tx of bundle.transactions) {
      if (tx && tx.id) {
        await AppDB.put('transactions', tx);
      }
    }
    safeStorage.setItem(LS.transactions, JSON.stringify(bundle.transactions));
  }

  // 3. Restore categories
  if (Array.isArray(bundle.categories)) {
    for (const cat of bundle.categories) {
      if (cat && cat.name) {
        await AppDB.put('categories', cat);
      }
    }
  }

  // 4. Restore budgets
  if (Array.isArray(bundle.budgets)) {
    for (const b of bundle.budgets) {
      if (b && b.month) {
        await AppDB.put('budgets', b);
      }
    }
  }

  // 5. Restore vault records
  if (Array.isArray(bundle.vaultRecords)) {
    for (const vr of bundle.vaultRecords) {
      if (vr && vr.id) {
        await AppDB.put('savings_vault', vr);
      }
    }
    safeStorage.setItem('sanchoy_vault_records_cache', JSON.stringify(bundle.vaultRecords));
    try {
      const { setDecryptedVaultRecords } = await import('../core/state.js');
      setDecryptedVaultRecords(bundle.vaultRecords);
    } catch (e) {}
  }
}

/**
 * Migrates an existing local workspace to Firebase Cloud under Google user's account
 * Creates workspace envelope, encrypts existing local ledger, uploads to Firestore
 */
export async function migrateLocalWorkspaceToCloud(user, passcode, recoveryCode) {
  if (!user || !user.uid) throw new Error('Authenticated user required for migration');

  // 1. Gather all existing local financial records
  const localBundle = await gatherLocalFinancialWorkspace();

  // 2. Create the two-key envelope (DEK wrapped with Passcode KEK + Recovery KEK)
  const { dek, envelope } = await createWorkspaceEnvelope(passcode, recoveryCode);

  // 3. Encrypt the entire financial bundle with the DEK
  const encryptedPayload = await encryptPayload(localBundle, dek);

  // 4. Prepare cloud workspace document
  const cloudRecord = {
    cryptoVersion: envelope.cryptoVersion,
    schemaVersion: 1,
    passcodeWrappedKey: envelope.passcodeWrappedKey,
    passcodeSalt: envelope.passcodeSalt,
    passcodeWrapIv: envelope.passcodeWrapIv,
    recoveryWrappedKey: envelope.recoveryWrappedKey,
    recoverySalt: envelope.recoverySalt,
    recoveryWrapIv: envelope.recoveryWrapIv,
    encryptedData: encryptedPayload.ciphertext,
    encryptedDataIv: encryptedPayload.iv,
    clientRevision: 1,
    createdAt: envelope.createdAt,
    updatedAt: new Date().toISOString()
  };

  // 5. Save minimal user profile & encrypted workspace in Firestore
  await saveUserProfile(user.uid, {
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL
  });

  await saveEncryptedWorkspace(user.uid, cloudRecord);

  // 6. Set active DEK in volatile memory
  setActiveWorkspaceDEK(dek);

  console.log('[Sanchoy Migration] Local financial workspace successfully encrypted and migrated to cloud.');
  return { dek, envelope, cloudRecord };
}
