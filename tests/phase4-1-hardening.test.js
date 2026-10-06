// Phase 4.1 Comprehensive Security Hardening & Firebase Consistency Test Suite
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
  setActiveUser,
  getActiveUser
} from '../js/security/secure-session.js';

import {
  gatherLocalFinancialWorkspace,
  restoreFinancialWorkspaceLocally
} from '../js/migration/local-to-cloud.js';

import { getOrCreateSalt, deriveKey, encryptRecord, decryptRecord } from '../js/vault/vault.js';

// ==========================================
// 1. CONFIGURATION & SDK CONSISTENCY TESTS
// ==========================================

test('CONFIG: /firebase-applet-config.json exists and has valid production values without placeholders', () => {
  assert.ok(fs.existsSync('./firebase-applet-config.json'), 'File must exist');
  const raw = fs.readFileSync('./firebase-applet-config.json', 'utf8');
  const config = JSON.parse(raw);

  const forbiddenPlaceholders = [
    'PASTE_MY_API_KEY_HERE',
    'PASTE_MY_MESSAGING_SENDER_ID_HERE',
    'PASTE_MY_APP_ID_HERE',
    'PASTE_MY_STORAGE_BUCKET_HERE'
  ];

  for (const placeholder of forbiddenPlaceholders) {
    assert.equal(raw.includes(placeholder), false, `Must not contain ${placeholder}`);
  }

  assert.equal(config.projectId, 'sanchoy-408dd', 'Must point to sanchoy-408dd');
  assert.equal(config.firestoreDatabaseId, '(default)', 'Must use (default) database');
  assert.ok(config.apiKey && config.apiKey.length > 20, 'API key must be populated');
  assert.ok(config.appId && config.appId.length > 10, 'App ID must be populated');
  assert.ok(config.authDomain.includes('sanchoy-408dd'), 'Auth domain must match');
});

test('SDK CONSISTENCY: Package.json and index.html import map use consistent Firebase 10.13.0', () => {
  const indexHtml = fs.readFileSync('./index.html', 'utf8');
  const pkgJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

  assert.ok(indexHtml.includes('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'));
  assert.ok(indexHtml.includes('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js'));
  assert.ok(indexHtml.includes('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js'));

  assert.equal(pkgJson.dependencies.firebase, '10.13.0', 'package.json must match 10.13.0');
});

// ==========================================
// 2. CRYPTOGRAPHIC INTEGRITY TESTS
// ==========================================

test('AES-GCM: IV uniqueness verified across 10,000 generations', () => {
  const seen = new Set();
  const iterations = 10000;
  for (let i = 0; i < iterations; i++) {
    const iv = generateIV(12);
    const b64 = bufferToBase64(iv);
    assert.equal(seen.has(b64), false, 'IV collision detected!');
    seen.add(b64);
  }
  assert.equal(seen.size, iterations);
});

test('AES-GCM: 256-bit key length and 96-bit (12-byte) IV constraints strictly enforced', async () => {
  const iv = generateIV(12);
  assert.equal(iv.byteLength, 12, 'IV must be exactly 12 bytes (96 bits)');

  const salt = generateSalt(16);
  assert.equal(salt.byteLength, 16, 'Salt must be at least 16 bytes');

  const dek = await generateWorkspaceDEK();
  assert.equal(dek.algorithm.name, 'AES-GCM');
  assert.equal(dek.algorithm.length, 256, 'DEK must be 256 bits');
});

test('FAIL-CLOSED: Corrupted ciphertext throws authentication error during decryptPayload', async () => {
  const dek = await generateWorkspaceDEK();
  const encrypted = await encryptPayload({ sensitive: 'financial data' }, dek);

  // Corrupt the ciphertext bytes
  const bytes = base64ToBuffer(encrypted.ciphertext);
  bytes[bytes.length - 1] ^= 0xff; // Flip bits in authentication tag / ciphertext
  const corruptedB64 = bufferToBase64(bytes);

  const corruptedPayload = { ...encrypted, ciphertext: corruptedB64 };

  await assert.rejects(
    async () => {
      await decryptPayload(corruptedPayload, dek);
    },
    /Decryption failed: invalid key or corrupted payload/
  );
});

test('FAIL-CLOSED: Incorrect key throws authentication error during decryptPayload', async () => {
  const dek1 = await generateWorkspaceDEK();
  const dek2 = await generateWorkspaceDEK();

  const encrypted = await encryptPayload({ secret: 'savings' }, dek1);

  await assert.rejects(
    async () => {
      await decryptPayload(encrypted, dek2);
    },
    /Decryption failed: invalid key or corrupted payload/
  );
});

// ==========================================
// 3. RECOVERY CODE ENTROPY & ROTATION TESTS
// ==========================================

test('RECOVERY: Generation format, alphabet entropy, and randomness properties', () => {
  const codes = new Set();
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // 30 symbols: log2(30^20) = ~98.1 bits
  assert.equal(alphabet.length, 30);

  for (let i = 0; i < 1000; i++) {
    const code = generateRecoveryCode();
    assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    const normalized = normalizeRecoveryCode(code);
    assert.equal(normalized.length, 20);
    assert.equal(codes.has(normalized), false, 'Recovery code collision!');
    codes.add(normalized);
  }
});

test('RECOVERY ROTATION: Recovery Code A recovers workspace -> Passcode changed -> Recovery Code B generated -> Code A fails, Code B succeeds', async () => {
  const initialPasscode = 'InitialPasscode2026!';
  const recoveryCodeA = generateRecoveryCode();

  // 1. Create envelope with Passcode + Recovery Code A
  const { dek, envelope: envelopeA } = await createWorkspaceEnvelope(initialPasscode, recoveryCodeA);

  // Encrypt sensitive financial ledger with original DEK
  const financialLedger = {
    wallets: { online: 3500, cash: 1200 },
    transactions: [{ id: 'tx-sec-1', amount: 50, note: 'Vault allocation' }]
  };
  const encryptedWorkspace = await encryptPayload(financialLedger, dek);

  // 2. Emergency Recovery Simulation: User lost passcode, uses Recovery Code A
  const recoveredDEK = await unlockDEKWithRecoveryCode(envelopeA, recoveryCodeA);
  const decryptedDuringRecovery = await decryptPayload(encryptedWorkspace, recoveredDEK);
  assert.deepEqual(decryptedDuringRecovery, financialLedger, 'Recovery Code A must recover DEK and decrypt ledger');

  // 3. Post-recovery: User sets New Passcode and rotates to Recovery Code B
  const newPasscode = 'BrandNewPasscode2026!';
  const recoveryCodeB = generateRecoveryCode();

  // Change passcode on recovered DEK
  const { envelope: envelopeNewPasscode } = await changePasscodeInEnvelope(envelopeA, initialPasscode, newPasscode);

  // Rotate recovery code to Recovery Code B
  const finalEnvelope = await rotateRecoveryCodeInEnvelope(envelopeNewPasscode, recoveredDEK, recoveryCodeB);

  // 4. Verification: Recovery Code A must FAIL
  await assert.rejects(
    async () => {
      await unlockDEKWithRecoveryCode(finalEnvelope, recoveryCodeA);
    },
    /Failed to unwrap encryption key/
  );

  // 5. Verification: Recovery Code B must SUCCEED
  const unlockedWithB = await unlockDEKWithRecoveryCode(finalEnvelope, recoveryCodeB);
  const decryptedWithB = await decryptPayload(encryptedWorkspace, unlockedWithB);
  assert.deepEqual(decryptedWithB, financialLedger, 'Recovery Code B must unlock exact same DEK without re-encrypting ledger');

  // 6. Verification: New passcode must SUCCEED
  const unlockedWithPasscode = await unlockDEKWithPasscode(finalEnvelope, newPasscode);
  const decryptedWithPasscode = await decryptPayload(encryptedWorkspace, unlockedWithPasscode);
  assert.deepEqual(decryptedWithPasscode, financialLedger);

  // 7. Verification: Old passcode must FAIL
  await assert.rejects(
    async () => {
      await unlockDEKWithPasscode(finalEnvelope, initialPasscode);
    },
    /Failed to unwrap encryption key/
  );
});

// ==========================================
// 4. DETERMINISTIC SECURITY STATES AUDIT
// ==========================================

test('SECURITY STATES: Deterministic transitions and key removal on lock and sign-out', async () => {
  // Start SIGNED_OUT
  signOutSecuritySession();
  assert.equal(getSecurityState(), SecurityState.SIGNED_OUT);
  assert.equal(getActiveWorkspaceDEK(), null);
  assert.equal(getActiveUser(), null);

  // Step 1: User signs in with Google (Firebase user populated)
  setActiveUser({ uid: 'user_sanchoy_prod', email: 'owner@sanchoy.io' });
  // CRITICAL: Financial workspace MUST remain locked until Private Passcode unlock!
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_LOCKED, 'Google sign-in alone must NOT unlock workspace');
  assert.equal(getActiveWorkspaceDEK(), null, 'No DEK allowed in AUTHENTICATED_LOCKED state');

  // Step 2: User provides Private Passcode -> DEK loaded
  const dek = await generateWorkspaceDEK();
  setActiveWorkspaceDEK(dek);
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_UNLOCKED);
  assert.equal(getActiveWorkspaceDEK(), dek);

  // Step 3: Workspace locked (auto-lock or manual lock)
  lockWorkspaceMemory();
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_LOCKED, 'User remains authenticated but workspace locked');
  assert.equal(getActiveWorkspaceDEK(), null, 'Active DEK must be cleared from security context on lock');

  // Step 4: Unlock again
  setActiveWorkspaceDEK(dek);
  assert.equal(getSecurityState(), SecurityState.AUTHENTICATED_UNLOCKED);
  assert.equal(getActiveWorkspaceDEK(), dek);

  // Step 5: Sign out
  signOutSecuritySession();
  assert.equal(getSecurityState(), SecurityState.SIGNED_OUT);
  assert.equal(getActiveWorkspaceDEK(), null, 'DEK cleared on sign-out');
  assert.equal(getActiveUser(), null, 'User cleared on sign-out');
});

// ==========================================
// 5. MIGRATION & LOCAL-TO-CLOUD DATA INTEGRITY
// ==========================================

test('MIGRATION: Encrypted workspace bundle contains zero plaintext financial keys in Firestore document envelope', async () => {
  const passcode = 'SecurePasscode2026!';
  const recoveryCode = generateRecoveryCode();

  const localLedger = {
    balances: { online: 2400, cash: 650 },
    startingBalances: { online: 2000, cash: 500, configured: true },
    allowanceConfig: { monthlyOnline: 3000, monthlyCash: 1000, configured: true, startDate: '2026-09-01' },
    transactions: [
      { id: 'tx-1', amount: 150, type: 'expense', wallet: 'online', desc: 'Groceries' },
      { id: 'tx-2', amount: 200, type: 'income', wallet: 'cash', desc: 'Bonus' }
    ],
    categories: [{ name: 'Food' }, { name: 'Transport' }],
    budgets: [{ month: '2026-09', limit: 4000 }],
    vaultRecords: [{ id: 'vault-1', month: '2026-09', onlineSavings: 500 }]
  };

  const { dek, envelope } = await createWorkspaceEnvelope(passcode, recoveryCode);
  const encryptedPayload = await encryptPayload(localLedger, dek);

  const cloudDocumentPayload = {
    cryptoVersion: envelope.cryptoVersion,
    schemaVersion: 1,
    passcodeWrappedKey: envelope.passcodeWrappedKey,
    passcodeSalt: envelope.passcodeSalt,
    passcodeWrapIv: envelope.passcodeWrapIv,
    recoveryWrappedKey: envelope.recoveryWrappedKey,
    recoverySalt: envelope.recoverySalt,
    recoveryWrapIv: envelope.recoveryWrapIv,
    encryptedData: encryptedPayload.ciphertext,
    encryptedDataIv: encryptedPayload.iv,
    clientRevision: 1,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt
  };

  // Verify that the cloud document payload DOES NOT contain any plaintext financial fields
  const serialized = JSON.stringify(cloudDocumentPayload);
  assert.equal(serialized.includes('balances'), false);
  assert.equal(serialized.includes('online'), false);
  assert.equal(serialized.includes('cash'), false);
  assert.equal(serialized.includes('Groceries'), false);
  assert.equal(serialized.includes('Bonus'), false);
  assert.equal(serialized.includes('2400'), false);
  assert.equal(serialized.includes('650'), false);
  assert.equal(serialized.includes('allowanceConfig'), false);

  // Verify full round-trip decryption of migrated payload
  const decryptedBundle = await decryptPayload({
    ciphertext: cloudDocumentPayload.encryptedData,
    iv: cloudDocumentPayload.encryptedDataIv
  }, dek);

  assert.deepEqual(decryptedBundle, localLedger, 'Decrypted workspace must match exact local ledger');
});

// ==========================================
// 6. VAULT CRYPTOGRAPHIC ISOLATION TESTS
// ==========================================

test('VAULT: Secret Savings Vault independent PBKDF2/AES-GCM encryption survives within workspace bundle', async () => {
  const vaultPassword = 'VaultMasterPassword2026!';
  const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  const vaultKey = await deriveKey(vaultPassword, salt);
  assert.ok(vaultKey);

  const sensitiveRecord = {
    id: 'vault-sep-2026',
    month: '2026-09',
    cashSavings: 1500,
    onlineSavings: 4500,
    emergencySavings: 10000,
    notes: 'Confidential emergency fund reserve'
  };

  const encryptedVaultRec = await encryptRecord(sensitiveRecord, vaultKey);
  assert.ok(encryptedVaultRec.iv);
  assert.ok(encryptedVaultRec.data);

  // Verify plaintext fields are omitted in encrypted record
  assert.equal(encryptedVaultRec.notes, undefined);
  assert.equal(encryptedVaultRec.cashSavings, undefined);
  assert.equal(encryptedVaultRec.onlineSavings, undefined);

  // Decrypt with correct key
  const decryptedVault = await decryptRecord(encryptedVaultRec, vaultKey);
  assert.equal(decryptedVault.id, 'vault-sep-2026');
  assert.equal(decryptedVault.cashSavings, 1500);
  assert.equal(decryptedVault.notes, 'Confidential emergency fund reserve');

  // Verify wrong vault key fails
  const wrongVaultKey = await deriveKey('WrongPassword123!', salt);
  const failedVault = await decryptRecord(encryptedVaultRec, wrongVaultKey);
  assert.equal(failedVault, null, 'Decryption with wrong password returns null (fails closed)');
});

// ==========================================
// 7. SENSITIVE LOGGING AUDIT TEST
// ==========================================

test('SENSITIVE LOGGING: Verify codebase does not log passcodes, recovery codes, or raw DEK buffers', () => {
  const jsFiles = [
    'js/security/crypto.js',
    'js/security/key-derivation.js',
    'js/security/recovery.js',
    'js/security/secure-session.js',
    'js/security/workspace-keys.js',
    'js/firebase/config.js',
    'js/firebase/app.js',
    'js/firebase/auth.js',
    'js/firebase/firestore.js',
    'js/firebase/sync.js',
    'js/migration/local-to-cloud.js'
  ];

  const forbiddenPatterns = [
    /console\.(log|info|warn|error)\(.*passcode/i,
    /console\.(log|info|warn|error)\(.*recoveryCode/i,
    /console\.(log|info|warn|error)\(.*wrappedKey/i,
    /console\.(log|info|warn|error)\(.*encryptedData/i,
    /console\.(log|info|warn|error)\(.*plaintext/i,
    /console\.(log|info|warn|error)\(.*secret/i
  ];

  for (const file of jsFiles) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        assert.equal(pattern.test(content), false, `Sensitive log found in ${file} matching ${pattern}`);
      }
    }
  }
});
