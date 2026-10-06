// Sanchoy Unified Multi-Device Synchronization Controller (Phase 5)
// Architecture:
// - Local IndexedDB remains primary working database
// - Cloud Firestore stores encrypted workspace payload
// - Deterministic revision incrementation & optimistic concurrency
// - Offline mutation queue with auto-retry
// - 3-Way financial merge engine (zero duplicate transactions)
// - Preserves conflicts safely without silent data loss
// - Subtle status indicator updates

import { getActiveUser, getActiveWorkspaceDEK } from '../security/secure-session.js';
import { getEncryptedWorkspace, saveEncryptedWorkspace } from '../firebase/firestore.js';
import { encryptPayload, decryptPayload } from '../security/crypto.js';
import { gatherLocalFinancialWorkspace, restoreFinancialWorkspaceLocally } from '../migration/local-to-cloud.js';
import { events } from '../core/events.js';
import { refreshAllViews } from '../transactions/transactions.js';
import { getOrCreateDeviceId } from '../sync/device.js';
import {
  getSyncMetadata,
  saveSyncMetadata,
  recordSyncSuccess,
  recordConflictState,
  SyncState
} from '../sync/revision.js';
import { getOfflineQueue, removeMutations, clearOfflineQueue } from '../sync/queue.js';
import { mergeFinancialWorkspaces } from '../sync/merge.js';
import { preserveConflict, clearConflicts, getActiveConflicts } from '../sync/conflict.js';

let syncInProgress = false;
let syncQueued = false;
let retryTimer = null;
let retryBackoffMs = 2000;
const MAX_BACKOFF_MS = 30000;

// Session-based recent sync activity list (UI-safe, maximum 20 entries)
const syncActivityLog = [];

export function recordSyncActivity(type, message) {
  syncActivityLog.unshift({
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type, // 'SYNCED', 'SYNCING', 'OFFLINE', 'ONLINE', 'CONFLICT', 'ERROR', 'MUTATION'
    message,
    timestamp: new Date().toISOString()
  });
  if (syncActivityLog.length > 20) {
    syncActivityLog.pop();
  }
}

export function getSyncActivityLog() {
  return [...syncActivityLog];
}

export const SyncStatus = SyncState;

/**
 * Returns current synchronization status for UI indicators
 */
export function getSyncStatus() {
  const meta = getSyncMetadata();
  const queue = getOfflineQueue();
  const conflicts = getActiveConflicts();

  let effectiveStatus = meta.syncState || SyncStatus.SYNCED;
  const isBrowserOffline = (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false);
  if (isBrowserOffline) {
    effectiveStatus = SyncStatus.OFFLINE;
  } else if (conflicts.length > 0) {
    effectiveStatus = SyncStatus.CONFLICT;
  } else if (syncInProgress) {
    effectiveStatus = SyncStatus.SYNCING;
  } else if (queue.length > 0 && effectiveStatus !== SyncStatus.ERROR) {
    effectiveStatus = SyncStatus.PENDING;
  }

  return {
    status: effectiveStatus,
    deviceId: meta.deviceId,
    clientRevision: meta.clientRevision,
    cloudRevision: meta.cloudRevision,
    lastSyncedAt: meta.lastSyncedAt,
    lastLocalChangeAt: meta.lastLocalChangeAt,
    pendingMutationCount: queue.length,
    hasConflict: conflicts.length > 0,
    conflicts
  };
}

/**
 * Primary sync orchestrator: Synchronizes local working state with cloud
 */
export async function syncWorkspaceToCloud(reason = 'update') {
  const user = getActiveUser();
  const dek = getActiveWorkspaceDEK();

  if (!user || !user.uid || !dek) {
    // Offline, locked, or unauthenticated; changes safely stored in local IndexedDB
    updateSyncStatus();
    return;
  }

  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  syncInProgress = true;
  updateSyncStatus();
  recordSyncActivity('SYNCING', 'Synchronization started');

  try {
    // 1. Fetch remote cloud workspace record
    const remoteRecord = await getEncryptedWorkspace(user.uid);
    const meta = getSyncMetadata();
    const localBaseRev = Number(meta.cloudRevision) || 1;

    let remoteBundle = null;
    let remoteRevision = 1;

    if (remoteRecord) {
      remoteRevision = Number(remoteRecord.clientRevision) || 1;
      // Decrypt remote bundle using active DEK
      try {
        remoteBundle = await decryptPayload({
          version: remoteRecord.cryptoVersion || 1,
          ciphertext: remoteRecord.encryptedData,
          iv: remoteRecord.encryptedDataIv
        }, dek);
      } catch (decErr) {
        console.error('[Sanchoy Sync] Failed to decrypt remote cloud record:', decErr);
        recordConflictState({ error: 'Remote payload decryption failed: key mismatch or corrupted payload' });
        updateSyncStatus();
        syncInProgress = false;
        return;
      }
    }

    // 2. Gather current local financial workspace
    const localBundle = await gatherLocalFinancialWorkspace();

    // 3. Concurrency & Divergence Check
    if (remoteBundle && remoteRevision > localBaseRev) {
      // Remote cloud is ahead of our last synchronized base!
      // Run 3-Way Merge Engine to reconcile independent changes
      console.log(`[Sanchoy Sync] Remote revision (${remoteRevision}) > local base (${localBaseRev}). Running 3-way merge.`);

      const mergeResult = mergeFinancialWorkspaces(localBundle, remoteBundle, null);

      if (mergeResult.hasConflict) {
        // True conflict detected: Preserve both local and remote states safely
        console.warn('[Sanchoy Sync] Financial conflict detected during merge:', mergeResult.conflicts);
        preserveConflict(mergeResult.conflicts, localBundle, remoteBundle);
        updateSyncStatus();
        syncInProgress = false;
        return;
      }

      // Clean merge with no conflicts! Apply merged bundle to local working store
      await restoreFinancialWorkspaceLocally(mergeResult.mergedBundle);
      refreshAllViews();
    }

    // 4. Gather final unified bundle to upload
    const bundleToUpload = await gatherLocalFinancialWorkspace();
    const encrypted = await encryptPayload(bundleToUpload, dek);

    // Compute next cloud revision
    const nextRevision = Math.max(remoteRevision, Number(meta.clientRevision) || 1) + 1;

    const updatedCloudRecord = {
      ...(remoteRecord || {}),
      cryptoVersion: (remoteRecord && remoteRecord.cryptoVersion) || 1,
      schemaVersion: 1,
      encryptedData: encrypted.ciphertext,
      encryptedDataIv: encrypted.iv,
      clientRevision: nextRevision,
      updatedAt: new Date().toISOString()
    };

    // 5. Save encrypted workspace to Firestore
    await saveEncryptedWorkspace(user.uid, updatedCloudRecord);

    // 6. Record sync success and clear offline queue
    clearOfflineQueue();
    recordSyncSuccess(nextRevision);
    retryBackoffMs = 2000; // Reset retry backoff on success
    recordSyncActivity('SYNCED', `Workspace synchronized (Rev ${nextRevision})`);

    console.log('[Sanchoy Sync] Successfully synchronized to cloud. Revision:', nextRevision);
  } catch (err) {
    console.warn('[Sanchoy Sync] Synchronization error or offline:', err.message);
    if (!navigator.onLine) {
      saveSyncMetadata({ syncState: SyncStatus.OFFLINE });
      recordSyncActivity('OFFLINE', 'Device is offline; mutations queued locally');
    } else {
      saveSyncMetadata({ syncState: SyncStatus.ERROR });
      recordSyncActivity('ERROR', `Synchronization retry scheduled: ${err.message || 'Network error'}`);
      scheduleRetry();
    }
  } finally {
    syncInProgress = false;
    updateSyncStatus();

    if (syncQueued) {
      syncQueued = false;
      setTimeout(() => syncWorkspaceToCloud('queued_pass'), 300);
    }
  }
}

/**
 * Updates UI and emits sync:statusChange event
 */
export function updateSyncStatus() {
  const current = getSyncStatus();
  events.emit('sync:statusChange', current);
  renderSyncUIBadge(current);
}

/**
 * Renders subtle status badge in navbar header
 */
function renderSyncUIBadge(syncInfo) {
  if (typeof document === 'undefined') return;

  let badge = document.getElementById('sanchoySyncBadge');
  if (!badge) {
    const headerActions = document.querySelector('header .flex.items-center.gap-2');
    if (headerActions) {
      badge = document.createElement('button');
      badge.id = 'sanchoySyncBadge';
      badge.type = 'button';
      badge.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg sanchoy-surface-inset text-[10px] font-mono select-none cursor-pointer transition-all hover:brightness-110 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';
      badge.title = 'Open Sync Center';
      badge.setAttribute('aria-label', 'Synchronization Status');
      badge.addEventListener('click', async () => {
        try {
          const { navigate } = await import('../ui/ui.js');
          navigate('/sync');
        } catch (e) {}
      });
      headerActions.prepend(badge);
    }
  }

  if (!badge) return;

  const { status, pendingMutationCount } = syncInfo;

  if (status === SyncStatus.SYNCING) {
    badge.setAttribute('aria-label', `Synchronization status: Syncing, ${pendingMutationCount} pending`);
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping" aria-hidden="true"></span><span class="text-[var(--accent)] font-semibold">↻ Syncing…</span>`;
  } else if (status === SyncStatus.OFFLINE) {
    badge.setAttribute('aria-label', `Synchronization status: Offline, ${pendingMutationCount} changes saved locally`);
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" aria-hidden="true"></span><span class="text-[var(--text-muted)]">○ Offline${pendingMutationCount > 0 ? ` · ${pendingMutationCount}` : ''}</span>`;
  } else if (status === SyncStatus.CONFLICT) {
    badge.setAttribute('aria-label', 'Synchronization status: Conflict detected, action required');
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" aria-hidden="true"></span><span class="text-[var(--danger)] font-bold">! Conflict</span>`;
  } else if (status === SyncStatus.ERROR) {
    badge.setAttribute('aria-label', 'Synchronization status: Error, retrying automatically');
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" aria-hidden="true"></span><span class="text-[var(--danger)]">× Sync Error</span>`;
  } else if (status === SyncStatus.PENDING) {
    badge.setAttribute('aria-label', `Synchronization status: ${pendingMutationCount} pending changes`);
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" aria-hidden="true"></span><span class="text-[var(--text-secondary)]">○ Pending${pendingMutationCount > 0 ? ` · ${pendingMutationCount}` : ''}</span>`;
  } else {
    badge.setAttribute('aria-label', 'Synchronization status: All changes synchronized');
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-[var(--income)]" aria-hidden="true"></span><span class="text-[var(--income)] font-medium">✓ Synced</span>`;
  }
}

/**
 * Exponential backoff retry handler for transient network drops
 */
function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryBackoffMs = Math.min(retryBackoffMs * 1.5, MAX_BACKOFF_MS);
    syncWorkspaceToCloud('exponential_retry');
  }, retryBackoffMs);
}

// Multi-Tab & Network Event Listeners
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Sanchoy Sync] Network restored. Replaying queue.');
    recordSyncActivity('ONLINE', 'Network connection restored');
    syncWorkspaceToCloud('online_restored');
  });

  window.addEventListener('offline', () => {
    recordSyncActivity('OFFLINE', 'Network connection dropped');
    updateSyncStatus();
  });

  // Cross-tab synchronization via BroadcastChannel if supported
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('sanchoy_sync_channel');
    channel.onmessage = (msg) => {
      if (msg.data && msg.data.type === 'WORKSPACE_UPDATED') {
        const currentDev = getOrCreateDeviceId();
        if (msg.data.sourceDeviceId !== currentDev) {
          // Another tab on the same device updated local storage; refresh views
          refreshAllViews();
        }
      }
    };

    events.on('transactions:change', () => {
      try {
        channel.postMessage({
          type: 'WORKSPACE_UPDATED',
          sourceDeviceId: getOrCreateDeviceId(),
          timestamp: Date.now()
        });
      } catch (e) {}
    });
  }
}
