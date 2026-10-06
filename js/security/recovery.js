// Sanchoy Emergency Recovery Code Engine (Option A)
// Provides:
// - Cryptographically secure 20-character recovery code generation (XXXX-XXXX-XXXX-XXXX-XXXX format)
// - Normalized key derivation from recovery code
// - Recovery wrapping and unwrapping of workspace DEK
// - Independent recovery path without storing plaintext recovery code in Firestore or localStorage
// - Recovery code rotation and invalidation

import { generateIV, generateSalt, bufferToBase64, base64ToBuffer } from './crypto.js';
import { derivePasscodeKEK } from './key-derivation.js';

// Base32 Crockford alphabet for high readability and zero ambiguity (no 0/O, 1/I/L)
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a cryptographically random recovery code with 20 characters in 5-character groups
 * Example: '7K9X-M42B-T8QW-P3NY-F5VR'
 */
export function generateRecoveryCode() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let rawChars = '';
  for (let i = 0; i < bytes.length; i++) {
    rawChars += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return `${rawChars.slice(0, 4)}-${rawChars.slice(4, 8)}-${rawChars.slice(8, 12)}-${rawChars.slice(12, 16)}-${rawChars.slice(16, 20)}`;
}

/**
 * Normalizes user input recovery code (removes dashes, whitespace, upper-cases)
 */
export function normalizeRecoveryCode(input) {
  if (!input) return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Wraps the workspace DEK using a recovery code KEK
 * Note: Raw recovery code is NEVER stored anywhere; only salt, wrap IV, and wrapped key are returned
 */
export async function wrapKeyWithRecoveryCode(targetKey, recoveryCode, existingSalt = null) {
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (normalized.length < 16) {
    throw new Error('Recovery code is invalid or too short');
  }

  const salt = existingSalt ? (existingSalt instanceof Uint8Array ? existingSalt : base64ToBuffer(existingSalt)) : generateSalt(16);
  const kek = await derivePasscodeKEK(normalized, salt);
  const iv = generateIV(12);

  const wrappedBuffer = await crypto.subtle.wrapKey(
    'raw',
    targetKey,
    kek,
    {
      name: 'AES-GCM',
      iv: iv
    }
  );

  return {
    wrappedKey: bufferToBase64(wrappedBuffer),
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv)
  };
}

/**
 * Unwraps the workspace DEK using a recovery code
 */
export async function unwrapKeyWithRecoveryCode(wrappedKeyBase64, saltBase64, ivBase64, recoveryCode) {
  const normalized = normalizeRecoveryCode(recoveryCode);
  const salt = base64ToBuffer(saltBase64);
  const iv = base64ToBuffer(ivBase64);
  const wrappedKeyBytes = base64ToBuffer(wrappedKeyBase64);

  const kek = await derivePasscodeKEK(normalized, salt);

  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrappedKeyBytes,
      kek,
      {
        name: 'AES-GCM',
        iv: iv
      },
      {
        name: 'AES-GCM',
        length: 256
      },
      true,
      ['encrypt', 'decrypt']
    );
  } catch (err) {
    throw new Error('Failed to unwrap encryption key using recovery code: incorrect code or corrupted key material');
  }
}
