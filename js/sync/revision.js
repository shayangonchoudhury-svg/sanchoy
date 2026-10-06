// Sanchoy Synchronization Revision & Metadata Engine
// Manages:
// - Local client revision tracking
// - Cloud revision base detection
// - Optimistic concurrency precondition validation
// - Sync state machine (SYNCED, PENDING, SYNCING, OFFLINE, CONFLICT, ERROR)

import { safeStorage } from '../core/state.js';
import { getOrCreateDeviceId } from './device.js';

const SYNC_META_KEY = 'sanchoy_sync_meta';

export const SyncState = {
  SYNCED: 'SYNCED',
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  OFFLINE: 'OFFLINE',
  CONFLICT: 'CONFLICT',
  ERROR: 'ERROR'
};

const defaultMetadata = {
  deviceId: null,
  clientRevision: 1,
  cloudRevision: 1,
  lastSyncedAt: null,
  lastLocalChangeAt: null,
  lastCloudChangeAt: null,
  syncState: SyncState.SYNCED,
  pendingMutationCount: 0,
  conflictData: null
};

/**
 * Loads current sync metadata from safeStorage
 */
export function getSyncMetadata() {
  try {
    const raw = safeStorage.getItem(SYNC_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          ...defaultMetadata,
          ...parsed,
          deviceId: getOrCreateDeviceId()
        };
      }
    }
  } catch (e) {}

  return {
    ...defaultMetadata,
    deviceId: getOrCreateDeviceId()
  };
}

/**
 * Persists updated sync metadata
 */
export function saveSyncMetadata(metaUpdates) {
  const current = getSyncMetadata();
  const updated = {
    ...current,
    ...metaUpdates,
    deviceId: getOrCreateDeviceId()
  };

  try {
    safeStorage.setItem(SYNC_META_KEY, JSON.stringify(updated));
  } catch (e) {}

  return updated;
}

/**
 * Increments local client revision upon an authorized local financial mutation
 */
export function advanceLocalRevision() {
  const meta = getSyncMetadata();
  const nextRev = (Number(meta.clientRevision) || 0) + 1;
  return saveSyncMetadata({
    clientRevision: nextRev,
    lastLocalChangeAt: new Date().toISOString(),
    syncState: SyncState.PENDING
  });
}

/**
 * Records a successful synchronization round-trip with the cloud
 */
export function recordSyncSuccess(cloudRev) {
  const confirmedRev = Number(cloudRev) || 1;
  return saveSyncMetadata({
    clientRevision: confirmedRev,
    cloudRevision: confirmedRev,
    lastSyncedAt: new Date().toISOString(),
    lastCloudChangeAt: new Date().toISOString(),
    syncState: SyncState.SYNCED,
    pendingMutationCount: 0,
    conflictData: null
  });
}

/**
 * Sets the sync state to CONFLICT and stores the conflict descriptor
 */
export function recordConflictState(conflictDescriptor) {
  return saveSyncMetadata({
    syncState: SyncState.CONFLICT,
    conflictData: conflictDescriptor
  });
}
