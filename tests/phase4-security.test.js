// Automated Tests for Phase 4: Sanchoy Security, Dual-Layer Crypto & Recovery
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateWorkspaceDEK,
  generateIV,
  generateSalt,
  encryptPayload,
  decryptPayload,
  bufferToBase64,
  base64ToBuffer
} from '../js/security/crypto.js';

import {
  derivePasscodeKEK,
  wrapKeyWithPasscode,
  unwrapKeyWithPasscode
} from '../js/security/key-derivation.js';

import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  wrapKeyWithRecoveryCode,
  unwrapKeyWithRecoveryCode
} from '../js/security/recovery.js';

import {
  createWorkspaceEnvelope,
  unlockDEKWithPasscode,
  unlockDEKWithRecoveryCode,
  changePasscodeInEnvelope,
  rotateRecoveryCodeInEnvelope
} from '../js/security/workspace-keys.js';

import {
  SecurityState,
  getSecurityState,
  getActiveWorkspaceDEK,
  setActiveWorkspaceDEK,
  lockWorkspaceMemory,
  signOutSecuritySession,
  setActiveUser
} from '../js/security/secure-session.js';

test('CRYPTO: AES-GCM 256-bit DEK generation and encryption/decryption roundtrip', async () => {
  const dek = await generateWorkspaceDEK();
  assert.ok(dek, 'DEK must be generated');

  const testData = {
    wallets: { online: 500, cash: 250 },
    transactions: [
      { id: 'tx-1', amount: 45, category: 'Food', desc: 'Private dinner' }
    ],
    notes: 'Confidential ledger data'
  };

  const encrypted = await encryptPayload(testData, dek);
  assert.equal(encrypted.version, 1);
  assert.equal(encrypted.algorithm, 'AES-GCM');
  assert.ok(encrypted.ciphertext && encrypted.ciphertext.length > 20);
  assert.ok(encrypted.iv && encrypted.iv.length > 5);

  const decrypted = await decryptPayload(encrypted, dek);
  assert.deepEqual(decrypted, testData, 'Decrypted data must match original plaintext');
});

test('CRYPTO: Unique IV generation prevents IV reuse', () => {
  const iv1 = generateIV();
  const iv2 = generateIV();
  assert.notDeepEqual(iv1, iv2, 'Successive IVs must be cryptographically distinct');
  assert.equal(iv1.byteLength, 12, 'IV must be 96-bit (12 bytes) for AES-GCM');
});

test('CRYPTO: Decryption fails with wrong key or corrupted ciphertext', async () => {
  const dek1 = await generateWorkspaceDEK();
  const dek2 = await generateWorkspaceDEK();

  const encrypted = await encryptPayload({ secret: 12345 }, dek1);

  await assert.rejects(
    async () => {
      await decryptPayload(encrypted, dek2);
    },
    /Decryption failed/,
    'Decryption with wrong key must throw an error'
  );

  const corrupted = {
    ...encrypted,
    ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA'
  };

  await assert.rejects(
    async () => {
      await decryptPayload(corrupted, dek1);
    },
    /Decryption failed/,
    'Decryption with corrupted ciphertext must fail'
  );
});

test('PASSCODE KEK: Wrap and unwrap DEK under passcode-derived key', async () => {
  const dek = await generateWorkspaceDEK();
  const passcode = 'MySecurePasscode!2026';

  const wrapped = await wrapKeyWithPasscode(dek, passcode);
  assert.ok(wrapped.wrappedKey);
  assert.ok(wrapped.salt);
  assert.ok(wrapped.iv);

  // Unwrap with correct passcode
  const unwrappedDek = await unwrapKeyWithPasscode(
    wrapped.wrappedKey,
    wrapped.salt,
    wrapped.iv,
    passcode
  );
  assert.ok(unwrappedDek);

  // Test data encrypted with original DEK decrypts with unwrapped DEK
  const encrypted = await encryptPayload('ledger-content', dek);
  const decrypted = await decryptPayload(encrypted, unwrappedDek);
  assert.equal(decrypted, 'ledger-content');

  // Unwrap with wrong passcode fails
  await assert.rejects(
    async () => {
      await unwrapKeyWithPasscode(
        wrapped.wrappedKey,
        wrapped.salt,
        wrapped.iv,
        'WrongPasscode123'
      );
    },
    /Failed to unwrap encryption key/
  );
});

test('RECOVERY: Generation format, normalization, and DEK wrap/unwrap', async () => {
  const code = generateRecoveryCode();
  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

  const normalized = normalizeRecoveryCode('  7k9x-m42b-t8qw-p3ny-f5vr  ');
  assert.equal(normalized, '7K9XM42BT8QWP3NYF5VR');

  const dek = await generateWorkspaceDEK();
  const wrapped = await wrapKeyWithRecoveryCode(dek, code);

  const unwrapped = await unwrapKeyWithRecoveryCode(
    wrapped.wrappedKey,
    wrapped.salt,
    wrapped.iv,
    code
  );
  assert.ok(unwrapped);

  // Wrong recovery code fails
  await assert.rejects(
    async () => {
      await unwrapKeyWithRecoveryCode(
        wrapped.wrappedKey,
        wrapped.salt,
        wrapped.iv,
        'WRONG-CODE-1111-2222-3333'
      );
    },
    /Failed to unwrap encryption key/
  );
});

test('WORKSPACE ENVELOPE: Create envelope, change passcode without re-encrypting data', async () => {
  const passcode = 'OldPasscode999!';
  const recoveryCode = generateRecoveryCode();

  const { dek, envelope } = await createWorkspaceEnvelope(passcode, recoveryCode);
  assert.ok(envelope.passcodeWrappedKey);
  assert.ok(envelope.recoveryWrappedKey);

  // Encrypt sensitive financial payload
  const financialData = { online: 1200, transactionsCount: 42 };
  const encryptedPayload = await encryptPayload(financialData, dek);

  // Change passcode
  const newPasscode = 'NewPasscode2026!';
  const { dek: sameDek, envelope: updatedEnvelope } = await changePasscodeInEnvelope(
    envelope,
    passcode,
    newPasscode
  );

  // Verify that old passcode no longer works
  await assert.rejects(
    async () => {
      await unlockDEKWithPasscode(updatedEnvelope, passcode);
    },
    /Failed to unwrap encryption key/
  );

  // Verify new passcode successfully unwraps the exact same DEK
  const unlockedWithNew = await unlockDEKWithPasscode(updatedEnvelope, newPasscode);
  const decrypted = await decryptPayload(encryptedPayload, unlockedWithNew);
  assert.deepEqual(decrypted, financialData, 'Financial payload decrypts without re-encryption');

  // Verify recovery code still works with updated envelope
  const unlockedWithRecovery = await unlockDEKWithRecoveryCode(updatedEnvelope, recoveryCode);
  const decryptedRec = await decryptPayload(encryptedPayload, unlockedWithRecovery);
  assert.deepEqual(decryptedRec, financialData);
});

test('SECURITY STATES & MEMORY: Lock clears active key from memory', async () => {
  const dek = await generateWorkspaceDEK();
  setActiveUser({ uid: 'test-user-123', email: 'test@example.com' });
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_LOCKED);

  setActiveWorkspaceDEK(dek);
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_UNLOCKED);
  assert.equal(getActiveWorkspaceDEK(), dek);

  // Lock workspace
  lockWorkspaceMemory();
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_LOCKED);
  assert.equal(getActiveWorkspaceDEK(), null, 'Active DEK must be cleared from memory on lock');

  // Sign out
  signOutSecuritySession();
  assert.equal(getSecurityState(), SecurityState.SIGNED_OUT);
  assert.equal(getActiveWorkspaceDEK(), null);
});
