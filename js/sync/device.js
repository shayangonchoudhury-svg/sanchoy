// Sanchoy Device Identity Engine
// Generates and persists a cryptographically secure anonymous device identifier.
// The device ID contains NO personal data (no UID, no email, no timestamp-derived pattern).
// It is used solely to identify the originating synchronization source in multi-device setups.

import { safeStorage } from '../core/state.js';

const DEVICE_ID_KEY = 'sanchoy_device_id';

/**
 * Returns the stable persistent device ID, generating a cryptographically secure
 * random UUID if one does not already exist.
 */
export function getOrCreateDeviceId() {
  let deviceId = null;
  try {
    deviceId = safeStorage.getItem(DEVICE_ID_KEY);
  } catch (e) {}

  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length < 16) {
    deviceId = generateSecureDeviceId();
    try {
      safeStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch (e) {}
  }

  return deviceId;
}

/**
 * Generates a cryptographically random device ID using Web Crypto API
 * Produces a format: "dev_" + 32 hexadecimal random characters (128 bits of entropy)
 */
export function generateSecureDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `dev_${hex}`;
  }
  // Fallback for non-browser/test environments without Web Crypto
  const arr = new Array(32).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  return `dev_${arr}`;
}
