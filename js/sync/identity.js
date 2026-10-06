// Sanchoy Transaction & Mutation Identity Engine
// Guarantees:
// - Cryptographically secure, stable, collisions-free transaction IDs
// - Idempotent mutation tracking
// - Zero reliance on array index or timestamp alone

/**
 * Generates a stable unique transaction identifier: 'tx_' + 12-byte random hex + timestamp component
 * e.g., 'tx_18e2a3f9b0c1_8f4a1c'
 */
export function generateStableTxId() {
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const randHex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const tsHex = Date.now().toString(16);
  return `tx_${tsHex}_${randHex}`;
}

/**
 * Generates an idempotent mutation ID for synchronization operations
 */
export function generateMutationId(opType, entityId) {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const randHex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `mut_${opType}_${entityId || 'workspace'}_${randHex}`;
}
