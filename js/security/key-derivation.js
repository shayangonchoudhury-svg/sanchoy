// Sanchoy Key Derivation Engine (Web Crypto API)
// Provides:
// - PBKDF2 with SHA-256 for Passcode-derived Key Encryption Key (KEK)
// - Strong iteration configuration (100,000 iterations standard)
// - Key Wrapping & Unwrapping for AES-GCM 256-bit DEK under KEK
// - Secure salt and wrap IV generation

import { generateIV, generateSalt, bufferToBase64, base64ToBuffer } from './crypto.js';

export const PBKDF2_ITERATIONS = 100000;
export const HASH_ALGORITHM = 'SHA-256';

/**
 * Derives an AES-GCM 256-bit Key Encryption Key (KEK) from a passcode or secret string and salt
 */
export async function derivePasscodeKEK(passcode, salt) {
  if (!passcode) throw new Error('Passcode is required for key derivation');
  if (!salt) throw new Error('Salt is required for key derivation');

  const encoder = new TextEncoder();
  const rawKeyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passcode),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltBytes = salt instanceof Uint8Array ? salt : base64ToBuffer(salt);

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM
    },
    rawKeyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  );
}

/**
 * Wraps a target DEK (AES-GCM key) using a KEK (AES-GCM key)
 * Returns object containing wrappedKey (base64), salt (base64), and iv (base64)
 */
export async function wrapKeyWithPasscode(targetKey, passcode, existingSalt = null) {
  const salt = existingSalt ? (existingSalt instanceof Uint8Array ? existingSalt : base64ToBuffer(existingSalt)) : generateSalt(16);
  const kek = await derivePasscodeKEK(passcode, salt);
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
    iv: bufferToBase64(iv),
    iterations: PBKDF2_ITERATIONS,
    algorithm: 'AES-GCM'
  };
}

/**
 * Unwraps a target DEK from its wrapped representation using passcode
 */
export async function unwrapKeyWithPasscode(wrappedKeyBase64, saltBase64, ivBase64, passcode) {
  const salt = base64ToBuffer(saltBase64);
  const iv = base64ToBuffer(ivBase64);
  const wrappedKeyBytes = base64ToBuffer(wrappedKeyBase64);

  const kek = await derivePasscodeKEK(passcode, salt);

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
      true, // extractable so it can be re-wrapped or backed up
      ['encrypt', 'decrypt']
    );
  } catch (err) {
    throw new Error('Failed to unwrap encryption key: incorrect passcode or corrupted key material');
  }
}
