// Sanchoy Cryptographic Core Engine (Web Crypto API)
// Provides:
// - AES-GCM 256-bit encryption/decryption
// - Cryptographically random 256-bit DEK generation
// - Unique 96-bit (12-byte) IV generation for every encryption operation
// - Safe ArrayBuffer <-> Base64 / Hex conversions
// - Structured encrypted payload validation

/**
 * Converts Uint8Array or ArrayBuffer to standard Base64 string
 */
export function bufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts Base64 string to Uint8Array
 */
export function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a cryptographically random salt
 */
export function generateSalt(byteLength = 16) {
  const salt = new Uint8Array(byteLength);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Generates a unique 96-bit (12-byte) IV for AES-GCM
 * CRITICAL: Never reuse an IV with the same key
 */
export function generateIV(byteLength = 12) {
  const iv = new Uint8Array(byteLength);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Generates a cryptographically random 256-bit AES-GCM Data Encryption Key (DEK)
 */
export async function generateWorkspaceDEK() {
  return await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true, // extractable for wrapping
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts an arbitrary serializable payload (object, array, string) using AES-GCM 256-bit
 * Returns typed structured encrypted payload
 */
export async function encryptPayload(data, aesKey) {
  if (!aesKey) throw new Error('Encryption key is required');
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(typeof data === 'string' ? data : JSON.stringify(data));
  const iv = generateIV(12);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    aesKey,
    plaintextBytes
  );

  return {
    version: 1,
    algorithm: 'AES-GCM',
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
    encryptedAt: new Date().toISOString(),
    schemaVersion: 1
  };
}

/**
 * Decrypts a structured encrypted payload using AES-GCM 256-bit
 * Returns the parsed JSON or string payload
 */
export async function decryptPayload(payload, aesKey) {
  if (!payload || !payload.ciphertext || !payload.iv) {
    throw new Error('Invalid encrypted payload format');
  }
  if (!aesKey) {
    throw new Error('Decryption key is required');
  }

  const ciphertextBytes = base64ToBuffer(payload.ciphertext);
  const ivBytes = base64ToBuffer(payload.iv);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes
      },
      aesKey,
      ciphertextBytes
    );

    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decryptedBuffer);

    try {
      return JSON.parse(plaintext);
    } catch {
      return plaintext;
    }
  } catch (err) {
    throw new Error('Decryption failed: invalid key or corrupted payload');
  }
}
