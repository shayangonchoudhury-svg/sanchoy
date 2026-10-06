// Sanchoy Workspace Keys & Two-Key Envelope Management
// Manages:
// - Creating initial workspace envelope (DEK + Passcode Wrapped Key + Recovery Wrapped Key)
// - Re-wrapping DEK under a new passcode without re-encrypting the workspace
// - Re-wrapping DEK under a new recovery code (rotation)
// - Storing and loading key envelope metadata locally in IndexedDB and in Firestore

import { generateWorkspaceDEK } from './crypto.js';
import { wrapKeyWithPasscode, unwrapKeyWithPasscode } from './key-derivation.js';
import { wrapKeyWithRecoveryCode, unwrapKeyWithRecoveryCode } from './recovery.js';
import { AppDB } from '../storage/database.js';

export const WORKSPACE_CRYPTO_VERSION = 1;

/**
 * Initializes a new workspace envelope from scratch
 * Takes: passcode, recoveryCode
 * Returns: { dek, envelope: { cryptoVersion, passcodeWrappedKey, passcodeSalt, passcodeWrapIv, recoveryWrappedKey, recoverySalt, recoveryWrapIv, createdAt } }
 */
export async function createWorkspaceEnvelope(passcode, recoveryCode) {
  if (!passcode) throw new Error('Passcode is required to create workspace envelope');
  if (!recoveryCode) throw new Error('Recovery code is required to create workspace envelope');

  // 1. Generate random 256-bit AES-GCM DEK
  const dek = await generateWorkspaceDEK();

  // 2. Wrap DEK with Passcode KEK
  const pwWrapped = await wrapKeyWithPasscode(dek, passcode);

  // 3. Wrap DEK with Recovery Code KEK
  const recWrapped = await wrapKeyWithRecoveryCode(dek, recoveryCode);

  const envelope = {
    cryptoVersion: WORKSPACE_CRYPTO_VERSION,
    schemaVersion: 1,
    passcodeWrappedKey: pwWrapped.wrappedKey,
    passcodeSalt: pwWrapped.salt,
    passcodeWrapIv: pwWrapped.iv,
    recoveryWrappedKey: recWrapped.wrappedKey,
    recoverySalt: recWrapped.salt,
    recoveryWrapIv: recWrapped.iv,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Cache envelope in local IndexedDB
  await saveLocalEnvelope(envelope);

  return { dek, envelope };
}

/**
 * Unwraps the DEK using passcode from an envelope
 */
export async function unlockDEKWithPasscode(envelope, passcode) {
  if (!envelope || !envelope.passcodeWrappedKey) {
    throw new Error('No workspace envelope available');
  }
  return await unwrapKeyWithPasscode(
    envelope.passcodeWrappedKey,
    envelope.passcodeSalt,
    envelope.passcodeWrapIv,
    passcode
  );
}

/**
 * Unwraps the DEK using recovery code from an envelope
 */
export async function unlockDEKWithRecoveryCode(envelope, recoveryCode) {
  if (!envelope || !envelope.recoveryWrappedKey) {
    throw new Error('No recovery key available in workspace envelope');
  }
  return await unwrapKeyWithRecoveryCode(
    envelope.recoveryWrappedKey,
    envelope.recoverySalt,
    envelope.recoveryWrapIv,
    recoveryCode
  );
}

/**
 * Changes workspace passcode WITHOUT re-encrypting the financial workspace data
 * Only updates the passcode wrapping of the existing DEK
 */
export async function changePasscodeInEnvelope(existingEnvelope, currentPasscode, newPasscode) {
  // 1. Unwrap current DEK
  const dek = await unlockDEKWithPasscode(existingEnvelope, currentPasscode);

  // 2. Wrap DEK with new passcode
  const newPwWrapped = await wrapKeyWithPasscode(dek, newPasscode);

  const updatedEnvelope = {
    ...existingEnvelope,
    passcodeWrappedKey: newPwWrapped.wrappedKey,
    passcodeSalt: newPwWrapped.salt,
    passcodeWrapIv: newPwWrapped.iv,
    updatedAt: new Date().toISOString()
  };

  await saveLocalEnvelope(updatedEnvelope);
  return { dek, envelope: updatedEnvelope };
}

/**
 * Rotates the recovery code and updates the envelope
 */
export async function rotateRecoveryCodeInEnvelope(existingEnvelope, dek, newRecoveryCode) {
  const newRecWrapped = await wrapKeyWithRecoveryCode(dek, newRecoveryCode);

  const updatedEnvelope = {
    ...existingEnvelope,
    recoveryWrappedKey: newRecWrapped.wrappedKey,
    recoverySalt: newRecWrapped.salt,
    recoveryWrapIv: newRecWrapped.iv,
    updatedAt: new Date().toISOString()
  };

  await saveLocalEnvelope(updatedEnvelope);
  return updatedEnvelope;
}

/**
 * Saves envelope to local IndexedDB store
 */
export async function saveLocalEnvelope(envelope) {
  if (AppDB.db) {
    await AppDB.put('app_settings', { key: 'workspace_key_envelope', value: envelope });
  }
}

/**
 * Loads envelope from local IndexedDB store
 */
export async function loadLocalEnvelope() {
  if (AppDB.db) {
    const rec = await AppDB.get('app_settings', 'workspace_key_envelope');
    if (rec && rec.value) return rec.value;
  }
  return null;
}
