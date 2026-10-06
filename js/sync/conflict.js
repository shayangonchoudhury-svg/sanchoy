// Sanchoy Conflict Preservation & Resolution Engine
// Stores active conflicts in safeStorage / IndexedDB so no data is silently destroyed.
// Allows manual or automatic resolution when user reviews.

import { safeStorage } from '../core/state.js';
import { recordConflictState, saveSyncMetadata, SyncState } from './revision.js';
import { events } from '../core/events.js';

const CONFLICT_KEY = 'sanchoy_active_conflicts';

/**
 * Returns currently recorded conflicts
 */
export function getActiveConflicts() {
  try {
    const raw = safeStorage.getItem(CONFLICT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

/**
 * Preserves a conflict set with full copies of local and remote snapshots
 */
export function preserveConflict(conflictList, localBundle, remoteBundle) {
  const conflictRecord = {
    id: `conf_${Date.now()}`,
    detectedAt: new Date().toISOString(),
    conflicts: conflictList,
    localSnapshot: localBundle,
    remoteSnapshot: remoteBundle
  };

  try {
    safeStorage.setItem(CONFLICT_KEY, JSON.stringify([conflictRecord]));
  } catch (e) {}

  recordConflictState({
    conflictId: conflictRecord.id,
    conflictCount: conflictList.length,
    detectedAt: conflictRecord.detectedAt
  });

  events.emit('sync:conflict', conflictRecord);
  return conflictRecord;
}

/**
 * Clears active conflicts after resolution
 */
export function clearConflicts() {
  try {
    safeStorage.removeItem(CONFLICT_KEY);
  } catch (e) {}

  saveSyncMetadata({
    syncState: SyncState.SYNCED,
    conflictData: null
  });

  events.emit('sync:conflictResolved');
}

/**
 * Removes a single resolved conflict item by entityId and updates storage & sync state
 */
export function removeConflictItem(entityId) {
  const records = getActiveConflicts();
  if (!records || records.length === 0) return;

  const currentRecord = records[0];
  const remainingConflicts = (currentRecord.conflicts || []).filter(c => c.entityId !== entityId);

  if (remainingConflicts.length === 0) {
    clearConflicts();
  } else {
    currentRecord.conflicts = remainingConflicts;
    try {
      safeStorage.setItem(CONFLICT_KEY, JSON.stringify([currentRecord]));
    } catch (e) {}

    recordConflictState({
      conflictId: currentRecord.id,
      conflictCount: remainingConflicts.length,
      detectedAt: currentRecord.detectedAt
    });

    events.emit('sync:conflictItemResolved', { entityId, remaining: remainingConflicts.length });
  }
}
