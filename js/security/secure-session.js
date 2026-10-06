// Sanchoy Active Secure Session & Memory Management
// Handles:
// - Holding active decrypted CryptoKey (DEK) in volatile application memory only
// - Removing active crypto key references from the application security context on auto-lock, explicit lock, or sign-out
// - Emitting security state transition events
// - Security states:
//   State A: SIGNED_OUT
//   State B: AUTHENTICATED_LOCKED
//   State C: AUTHENTICATED_UNLOCKED
//   State D: LOCKED
//   State E: SIGNED_OUT

import { events } from '../core/events.js';
import { state, setSessionUnlocked, setVaultUnlocked, setVaultCryptoKey, setDecryptedVaultRecords } from '../core/state.js';

export const SecurityState = {
  SIGNED_OUT: 'SIGNED_OUT',
  AUTHENTICATED_LOCKED: 'AUTHENTICATED_LOCKED',
  AUTHENTICATED_UNLOCKED: 'AUTHENTICATED_UNLOCKED',
  LOCKED: 'LOCKED'
};

let currentSecurityState = SecurityState.SIGNED_OUT;
let activeWorkspaceDEK = null;
let activeUser = null; // Google/Firebase user object { uid, email, displayName, photoURL }

/**
 * Returns the currently active workspace Data Encryption Key (DEK)
 * Returns null if locked or signed out
 */
export function getActiveWorkspaceDEK() {
  return activeWorkspaceDEK;
}

/**
 * Returns the current security state
 */
export function getSecurityState() {
  return currentSecurityState;
}

/**
 * Returns the currently authenticated user
 */
export function getActiveUser() {
  return activeUser;
}

/**
 * Sets authenticated user on Google sign-in
 */
export function setActiveUser(user) {
  activeUser = user ? {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || 'Sanchoy User',
    photoURL: user.photoURL || null
  } : null;

  if (!activeUser) {
    transitionSecurityState(SecurityState.SIGNED_OUT);
  } else if (currentSecurityState === SecurityState.SIGNED_OUT) {
    transitionSecurityState(SecurityState.AUTHENTICATED_LOCKED);
  }
}

/**
 * Sets the active workspace DEK in volatile memory upon successful passcode or recovery unlock
 */
export function setActiveWorkspaceDEK(dek) {
  activeWorkspaceDEK = dek;
  if (dek) {
    transitionSecurityState(SecurityState.AUTHENTICATED_UNLOCKED);
    setSessionUnlocked(true);
  } else {
    lockWorkspaceMemory();
  }
}

/**
 * Transitions application security state and emits event
 */
function transitionSecurityState(newState) {
  const oldState = currentSecurityState;
  currentSecurityState = newState;
  events.emit('security:stateChange', { oldState, newState, user: activeUser });
}

/**
 * Removes active DEK reference from application security context, resets decrypted states, and enters LOCKED state
 * Note: Keeps Google account authenticated if user is signed in
 */
export function lockWorkspaceMemory() {
  activeWorkspaceDEK = null;
  setSessionUnlocked(false);
  setVaultUnlocked(false);
  setVaultCryptoKey(null);
  setDecryptedVaultRecords([]);

  if (activeUser) {
    transitionSecurityState(SecurityState.AUTHENTICATED_LOCKED);
  } else {
    transitionSecurityState(SecurityState.SIGNED_OUT);
  }

  events.emit('auth:lock');
}

/**
 * Complete sign-out: Removes active encryption key references, clears user session, resets security state to SIGNED_OUT
 */
export function signOutSecuritySession() {
  activeWorkspaceDEK = null;
  activeUser = null;
  setSessionUnlocked(false);
  setVaultUnlocked(false);
  setVaultCryptoKey(null);
  setDecryptedVaultRecords([]);
  transitionSecurityState(SecurityState.SIGNED_OUT);
  events.emit('auth:lock');
  events.emit('auth:signOut');
}
