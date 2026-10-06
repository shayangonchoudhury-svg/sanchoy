// Sanchoy Offline Mutation Queue Engine
// Persists all local mutations (create, edit, delete, allowance changes) to IndexedDB / safeStorage.
// Survives browser closures, reloads, and network drops.
// Guarantees mutation idempotency via stable mutation IDs.

import { safeStorage } from '../core/state.js';
import { getOrCreateDeviceId } from './device.js';
import { advanceLocalRevision, saveSyncMetadata } from './revision.js';

const QUEUE_KEY = 'sanchoy_mutation_queue';

export const VAULT_MUTATION_TYPES = {
  CREATE: 'vault:create',
  UPDATE: 'vault:update',
  DELETE: 'vault:delete'
};

/**
 * Returns all pending mutations currently in the offline queue
 */
export function getOfflineQueue() {
  try {
    const raw = safeStorage.getItem(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

/**
 * Persists the offline mutation queue to storage
 */
export function saveOfflineQueue(queue) {
  try {
    safeStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    saveSyncMetadata({ pendingMutationCount: queue.length });
  } catch (e) {}
}

/**
 * Generates a stable unique mutation ID
 */
export function generateMutationId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `mut_${hex}`;
  }
  return `mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Enqueues a new financial mutation
 * Operation types: 'ADD_TX', 'EDIT_TX', 'DELETE_TX', 'UPDATE_ALLOWANCE', 'UPDATE_STARTING_BALANCES'
 */
export function enqueueMutation(operationType, payload, entityId = null) {
  const queue = getOfflineQueue();
  const mutationId = generateMutationId();
  const deviceId = getOrCreateDeviceId();

  const mutation = {
    mutationId,
    deviceId,
    type: operationType,
    entityId: entityId || (payload && payload.id) || null,
    payload,
    timestamp: new Date().toISOString(),
    retryCount: 0
  };

  queue.push(mutation);
  saveOfflineQueue(queue);
  advanceLocalRevision();

  return mutation;
}

/**
 * Removes successfully processed mutations from the queue
 */
export function removeMutations(mutationIds) {
  const idSet = new Set(mutationIds);
  const queue = getOfflineQueue().filter(m => !idSet.has(m.mutationId));
  saveOfflineQueue(queue);
  return queue;
}

/**
 * Clears the entire offline queue (e.g. after full workspace snapshot reconciliation)
 */
export function clearOfflineQueue() {
  saveOfflineQueue([]);
}
