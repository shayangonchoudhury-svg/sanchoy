// Sanchoy Three-Way Financial Ledger Merge Engine
// Reconciles independent changes made across different devices based on a common ancestor base.
// Rules:
// 1. Transaction-level merging:
//    - Transactions added by Device A that are absent in Device B are safely added.
//    - Transactions added by Device B that are absent in Device A are safely added.
//    - Stable unique transaction IDs are respected.
// 2. Same-transaction conflict detection:
//    - If both Device A and Device B modified the same transaction with differing values,
//      a field conflict is flagged.
// 3. Deletion handling with tombstones:
//    - Explicitly deleted transactions are honored without reviving if deleted after base.
// 4. Zero duplicate transactions.
// 5. Preserves allowance and vault records deterministically.

import { round } from '../utils/utils.js';

/**
 * Merges a local financial workspace bundle with a remote cloud workspace bundle.
 * Base represents the common ancestor snapshot (or remote if no base exists).
 * 
 * Returns: {
 *   success: boolean,
 *   mergedBundle: object,
 *   hasConflict: boolean,
 *   conflicts: Array<{ type, entityId, local, remote, message }>
 * }
 */
export function mergeFinancialWorkspaces(localBundle, remoteBundle, baseBundle = null) {
  if (!localBundle && remoteBundle) {
    return { success: true, mergedBundle: remoteBundle, hasConflict: false, conflicts: [] };
  }
  if (localBundle && !remoteBundle) {
    return { success: true, mergedBundle: localBundle, hasConflict: false, conflicts: [] };
  }
  if (!localBundle && !remoteBundle) {
    return { success: true, mergedBundle: null, hasConflict: false, conflicts: [] };
  }

  const conflicts = [];
  const baseTxs = (baseBundle && Array.isArray(baseBundle.transactions)) ? baseBundle.transactions : [];
  const localTxs = Array.isArray(localBundle.transactions) ? localBundle.transactions : [];
  const remoteTxs = Array.isArray(remoteBundle.transactions) ? remoteBundle.transactions : [];

  const baseMap = new Map(baseTxs.map(t => [t.id, t]));
  const localMap = new Map(localTxs.map(t => [t.id, t]));
  const remoteMap = new Map(remoteTxs.map(t => [t.id, t]));

  // All unique transaction IDs seen across all sets
  const allTxIds = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);

  const mergedTxs = [];

  for (const id of allTxIds) {
    const inLocal = localMap.has(id);
    const inRemote = remoteMap.has(id);
    const inBase = baseMap.has(id);

    const localTx = localMap.get(id);
    const remoteTx = remoteMap.get(id);
    const baseTx = baseMap.get(id);

    if (inLocal && inRemote) {
      // Present in both local and remote
      if (areTransactionsEqual(localTx, remoteTx)) {
        mergedTxs.push(localTx);
      } else {
        // Both modified or diverged
        if (inBase) {
          const localChanged = !areTransactionsEqual(localTx, baseTx);
          const remoteChanged = !areTransactionsEqual(remoteTx, baseTx);

          if (localChanged && !remoteChanged) {
            // Only local changed: take local
            mergedTxs.push(localTx);
          } else if (!localChanged && remoteChanged) {
            // Only remote changed: take remote
            mergedTxs.push(remoteTx);
          } else {
            // Both changed differently: CONFLICT
            conflicts.push({
              type: 'TRANSACTION_EDIT_CONFLICT',
              entityId: id,
              local: localTx,
              remote: remoteTx,
              message: `Transaction "${localTx.desc || id}" was edited differently on another device.`
            });
            // Keep local version tentatively pending user resolution
            mergedTxs.push(localTx);
          }
        } else {
          // Both created same ID but with different data: CONFLICT
          conflicts.push({
            type: 'TRANSACTION_COLLISION',
            entityId: id,
            local: localTx,
            remote: remoteTx,
            message: `Transaction "${id}" exists on both devices with differing amounts or details.`
          });
          mergedTxs.push(localTx);
        }
      }
    } else if (inLocal && !inRemote) {
      // In local, missing in remote
      if (inBase) {
        // Was present in base, missing in remote -> remote deleted it
        // Check if local modified it after base
        if (!areTransactionsEqual(localTx, baseTx)) {
          conflicts.push({
            type: 'DELETION_EDIT_CONFLICT',
            entityId: id,
            local: localTx,
            remote: null,
            message: `Transaction "${localTx.desc || id}" was deleted on another device but edited locally.`
          });
          mergedTxs.push(localTx);
        } else {
          // Clean deletion from remote: drop from merged
        }
      } else {
        // Not in base: newly added locally
        mergedTxs.push(localTx);
      }
    } else if (!inLocal && inRemote) {
      // In remote, missing in local
      if (inBase) {
        // Was present in base, missing in local -> local deleted it
        if (!areTransactionsEqual(remoteTx, baseTx)) {
          conflicts.push({
            type: 'DELETION_EDIT_CONFLICT',
            entityId: id,
            local: null,
            remote: remoteTx,
            message: `Transaction "${remoteTx.desc || id}" was edited on another device but deleted locally.`
          });
          mergedTxs.push(remoteTx);
        } else {
          // Clean deletion locally: drop from merged
        }
      } else {
        // Newly added on remote
        mergedTxs.push(remoteTx);
      }
    }
  }

  // Deduplicate merged transactions by stable ID
  const dedupedTxs = [];
  const seenIds = new Set();
  for (const tx of mergedTxs) {
    if (tx && tx.id && !seenIds.has(tx.id)) {
      seenIds.add(tx.id);
      dedupedTxs.push(tx);
    }
  }

  // Allowance configuration merge: prefer higher version if tracked, else remote if configured
  let mergedAllowance = localBundle.allowanceConfig || remoteBundle.allowanceConfig;
  if (localBundle.allowanceConfig && remoteBundle.allowanceConfig) {
    const localVer = Number(localBundle.allowanceConfig.version) || 0;
    const remoteVer = Number(remoteBundle.allowanceConfig.version) || 0;
    mergedAllowance = remoteVer > localVer ? remoteBundle.allowanceConfig : localBundle.allowanceConfig;
  }

  // Starting balances merge
  let mergedStarting = localBundle.startingBalances || remoteBundle.startingBalances;
  if (!mergedStarting || !mergedStarting.configured) {
    mergedStarting = remoteBundle.startingBalances || localBundle.startingBalances;
  }

  // Vault records 3-way merge & conflict detection
  const vaultMergeResult = mergeVaultRecords(localBundle.vaultRecords, remoteBundle.vaultRecords, baseBundle ? baseBundle.vaultRecords : null);
  if (vaultMergeResult.conflicts && vaultMergeResult.conflicts.length > 0) {
    conflicts.push(...vaultMergeResult.conflicts);
  }
  const mergedVault = vaultMergeResult.mergedRecords;

  // Categories merge (union by name)
  const mergedCategories = mergeCategories(localBundle.categories, remoteBundle.categories);

  // Budgets merge (union by month)
  const mergedBudgets = mergeBudgets(localBundle.budgets, remoteBundle.budgets);

  const mergedBundle = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    balances: localBundle.balances || remoteBundle.balances || { online: 0, cash: 0 },
    startingBalances: mergedStarting,
    allowanceConfig: mergedAllowance,
    transactions: dedupedTxs,
    categories: mergedCategories,
    budgets: mergedBudgets,
    vaultRecords: mergedVault
  };

  return {
    success: true,
    mergedBundle,
    hasConflict: conflicts.length > 0,
    conflicts
  };
}

function areTransactionsEqual(a, b) {
  if (!a || !b) return false;
  return (
    Number(a.amount) === Number(b.amount) &&
    String(a.type).toLowerCase() === String(b.type).toLowerCase() &&
    String(a.category || '') === String(b.category || '') &&
    String(a.method || '').toLowerCase() === String(b.method || '').toLowerCase() &&
    String(a.desc || '').trim() === String(b.desc || '').trim() &&
    String(a.date || '').slice(0, 10) === String(b.date || '').slice(0, 10)
  );
}

export function areVaultRecordsEqual(a, b) {
  if (!a || !b) return false;
  const isALegacy = !a.type;
  const isBLegacy = !b.type;

  if (isALegacy || isBLegacy) {
    if (isALegacy !== isBLegacy) return false;
    return (
      String(a.month || '') === String(b.month || '') &&
      Number(a.cashSavings || 0) === Number(b.cashSavings || 0) &&
      Number(a.onlineSavings || 0) === Number(b.onlineSavings || 0) &&
      Number(a.extraSavings || 0) === Number(b.extraSavings || 0) &&
      Number(a.emergencySavings || 0) === Number(b.emergencySavings || 0) &&
      Number(a.investments || 0) === Number(b.investments || 0) &&
      Number(a.goldSavings || 0) === Number(b.goldSavings || 0) &&
      Number(a.otherSavings || 0) === Number(b.otherSavings || 0) &&
      String(a.notes || '').trim() === String(b.notes || '').trim()
    );
  }

  return (
    Number(a.amount) === Number(b.amount) &&
    String(a.type || '') === String(b.type || '') &&
    String(a.sourceWallet || '').toLowerCase() === String(b.sourceWallet || '').toLowerCase() &&
    String(a.destinationWallet || '').toLowerCase() === String(b.destinationWallet || '').toLowerCase() &&
    String(a.category || '') === String(b.category || '') &&
    String(a.description || a.notes || '').trim() === String(b.description || b.notes || '').trim() &&
    String(a.date || '').slice(0, 10) === String(b.date || '').slice(0, 10)
  );
}

/**
 * Checks if two divergent vault records can be safely merged at field-level:
 * Safe merge condition: All financial properties (amount, type, sourceWallet, destinationWallet, date)
 * match identically, and only non-financial text (description or category) diverges.
 */
export function checkVaultSafeMerge(localRecord, remoteRecord, baseRecord = null) {
  if (!localRecord || !remoteRecord) return false;
  if (!localRecord.type || !remoteRecord.type) return false; // Legacy nodes require explicit resolution if diverged

  const financialMatch = (
    Number(localRecord.amount) === Number(remoteRecord.amount) &&
    String(localRecord.type || '') === String(remoteRecord.type || '') &&
    String(localRecord.sourceWallet || '').toLowerCase() === String(remoteRecord.sourceWallet || '').toLowerCase() &&
    String(localRecord.destinationWallet || '').toLowerCase() === String(remoteRecord.destinationWallet || '').toLowerCase() &&
    String(localRecord.date || '').slice(0, 10) === String(remoteRecord.date || '').slice(0, 10)
  );

  if (!financialMatch) return false;

  // If baseRecord is provided, check for conflicting field modifications
  if (baseRecord) {
    const localCat = String(localRecord.category || '');
    const remoteCat = String(remoteRecord.category || '');
    const baseCat = String(baseRecord.category || '');
    const localCatChanged = localCat !== baseCat;
    const remoteCatChanged = remoteCat !== baseCat;

    // Both changed category to different values -> conflict
    if (localCatChanged && remoteCatChanged && localCat !== remoteCat) {
      return false;
    }
  }

  return true;
}

export function constructVaultSafeMerge(localRecord, remoteRecord, baseRecord = null) {
  const localDesc = (localRecord.description || localRecord.notes || '').trim();
  const remoteDesc = (remoteRecord.description || remoteRecord.notes || '').trim();
  let mergedDesc = localDesc;

  if (baseRecord) {
    const baseDesc = (baseRecord.description || baseRecord.notes || '').trim();
    const localDescChanged = localDesc !== baseDesc;
    const remoteDescChanged = remoteDesc !== baseDesc;
    if (localDescChanged && !remoteDescChanged) {
      mergedDesc = localDesc;
    } else if (!localDescChanged && remoteDescChanged) {
      mergedDesc = remoteDesc;
    } else if (localDescChanged && remoteDescChanged) {
      mergedDesc = localDesc === remoteDesc ? localDesc : `${localDesc} (${remoteDesc})`;
    }
  } else {
    if (!localDesc && remoteDesc) {
      mergedDesc = remoteDesc;
    } else if (localDesc && remoteDesc && localDesc !== remoteDesc) {
      mergedDesc = `${localDesc} (${remoteDesc})`;
    }
  }

  const localCat = localRecord.category || '';
  const remoteCat = remoteRecord.category || '';
  let mergedCat = localCat;

  if (baseRecord) {
    const baseCat = baseRecord.category || '';
    const localCatChanged = localCat !== baseCat;
    const remoteCatChanged = remoteCat !== baseCat;
    if (localCatChanged && !remoteCatChanged) {
      mergedCat = localCat;
    } else if (!localCatChanged && remoteCatChanged) {
      mergedCat = remoteCat;
    } else {
      mergedCat = localCat || remoteCat || 'General Savings';
    }
  } else {
    mergedCat = localCat || remoteCat || 'General Savings';
  }

  return {
    ...localRecord,
    category: mergedCat,
    description: mergedDesc
  };
}

export function mergeVaultRecords(localRecords = [], remoteRecords = [], baseRecords = null) {
  const baseList = Array.isArray(baseRecords) ? baseRecords : [];
  const localList = Array.isArray(localRecords) ? localRecords : [];
  const remoteList = Array.isArray(remoteRecords) ? remoteRecords : [];

  const baseMap = new Map(baseList.map(r => [r.id, r]));
  const localMap = new Map(localList.map(r => [r.id, r]));
  const remoteMap = new Map(remoteList.map(r => [r.id, r]));

  const allIds = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
  const mergedList = [];
  const conflicts = [];

  for (const id of allIds) {
    const inLocal = localMap.has(id);
    const inRemote = remoteMap.has(id);
    const inBase = baseMap.has(id);

    const localRec = localMap.get(id);
    const remoteRec = remoteMap.get(id);
    const baseRec = baseMap.get(id);

    if (inLocal && inRemote) {
      if (areVaultRecordsEqual(localRec, remoteRec)) {
        mergedList.push(localRec);
      } else {
        // Both exist but diverged
        if (inBase) {
          const localChanged = !areVaultRecordsEqual(localRec, baseRec);
          const remoteChanged = !areVaultRecordsEqual(remoteRec, baseRec);

          if (localChanged && !remoteChanged) {
            mergedList.push(localRec);
          } else if (!localChanged && remoteChanged) {
            mergedList.push(remoteRec);
          } else {
            // Both changed differently
            if (checkVaultSafeMerge(localRec, remoteRec, baseRec)) {
              mergedList.push(constructVaultSafeMerge(localRec, remoteRec, baseRec));
            } else {
              conflicts.push({
                type: 'VAULT_EDIT_CONFLICT',
                entityType: 'vault',
                entityId: id,
                local: localRec,
                remote: remoteRec,
                message: `Vault record "${localRec.description || id}" was edited differently on another device.`
              });
              mergedList.push(localRec);
            }
          }
        } else {
          // Both created same ID but with differing data
          if (checkVaultSafeMerge(localRec, remoteRec)) {
            mergedList.push(constructVaultSafeMerge(localRec, remoteRec));
          } else {
            conflicts.push({
              type: 'VAULT_EDIT_CONFLICT',
              entityType: 'vault',
              entityId: id,
              local: localRec,
              remote: remoteRec,
              message: `Vault record "${id}" was created differently on another device.`
            });
            mergedList.push(localRec);
          }
        }
      }
    } else if (inLocal && !inRemote) {
      if (inBase) {
        // Existed in base, missing in remote -> remote deleted it
        if (!areVaultRecordsEqual(localRec, baseRec)) {
          // Local edited it after base -> delete vs edit conflict!
          conflicts.push({
            type: 'VAULT_DELETION_CONFLICT',
            entityType: 'vault',
            entityId: id,
            local: localRec,
            remote: null,
            message: `Vault record "${localRec.description || id}" was deleted on another device but edited locally.`
          });
          mergedList.push(localRec);
        } else {
          // Clean remote deletion: do not add to merged
        }
      } else {
        // Newly added locally
        mergedList.push(localRec);
      }
    } else if (!inLocal && inRemote) {
      if (inBase) {
        // Existed in base, missing in local -> local deleted it
        if (!areVaultRecordsEqual(remoteRec, baseRec)) {
          // Remote edited it after base -> edit vs delete conflict!
          conflicts.push({
            type: 'VAULT_DELETION_CONFLICT',
            entityType: 'vault',
            entityId: id,
            local: null,
            remote: remoteRec,
            message: `Vault record "${remoteRec.description || id}" was edited on another device but deleted locally.`
          });
          mergedList.push(remoteRec);
        } else {
          // Clean local deletion: do not add to merged
        }
      } else {
        // Newly added on remote
        mergedList.push(remoteRec);
      }
    }
  }

  // Deduplicate by ID
  const deduped = [];
  const seenIds = new Set();
  for (const r of mergedList) {
    if (r && r.id && !seenIds.has(r.id)) {
      seenIds.add(r.id);
      deduped.push(r);
    }
  }

  return {
    mergedRecords: deduped,
    conflicts
  };
}

function mergeCategories(localCats = [], remoteCats = []) {
  const map = new Map();
  for (const c of (remoteCats || [])) {
    if (c && c.name) map.set(c.name, c);
  }
  for (const c of (localCats || [])) {
    if (c && c.name) map.set(c.name, c);
  }
  return Array.from(map.values());
}

function mergeBudgets(localBudgets = [], remoteBudgets = []) {
  const map = new Map();
  for (const b of (remoteBudgets || [])) {
    if (b && b.month) map.set(b.month, b);
  }
  for (const b of (localBudgets || [])) {
    if (b && b.month) map.set(b.month, b);
  }
  return Array.from(map.values());
}
