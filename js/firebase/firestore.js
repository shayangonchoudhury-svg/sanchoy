// Sanchoy Cloud Firestore Operations & Standard Error Handling
// Adheres strictly to the Firebase Integration Skill guidelines:
// - Structured FirestoreErrorInfo JSON on permission or mutation failures
// - Uses user-owned paths: users/{uid} and users/{uid}/private/workspace
// - NEVER writes raw plaintext balances, transactions, allowances or notes
// - Handles online/offline reachability testing (testConnection with getDocFromServer)

import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getFirestoreDB, getFirebaseAuth } from './app.js';

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

/**
 * Standard Firestore error handler conforming to skill requirements
 */
export function handleFirestoreError(error, operationType, path) {
  const auth = getFirebaseAuth();
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Tests live connection to Firestore server per skill guidelines
 */
export async function testFirestoreConnection() {
  const db = getFirestoreDB();
  if (!db) return false;
  const auth = getFirebaseAuth();
  // If no user is signed in yet, database instance is configured and ready;
  // avoid sending unauthenticated RPC streams to unpermitted paths.
  if (!auth || !auth.currentUser) {
    return true;
  }
  try {
    await getDocFromServer(doc(db, 'users', auth.currentUser.uid));
    return true;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('offline') || error.message.includes('unavailable'))) {
      console.warn('[Sanchoy Firestore] Client is offline or Firestore is unreachable.');
    }
    return false;
  }
}

/**
 * Fetches user profile metadata document at users/{uid}
 */
export async function getUserProfile(uid) {
  const db = getFirestoreDB();
  if (!db || !uid) return null;
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Saves minimal public user profile metadata at users/{uid}
 * Contains only non-sensitive account identity metadata (name, email, timestamps)
 */
export async function saveUserProfile(uid, profileData) {
  const db = getFirestoreDB();
  if (!db || !uid) return;
  const path = `users/${uid}`;
  try {
    await setDoc(doc(db, 'users', uid), {
      uid: uid,
      email: profileData.email || '',
      displayName: profileData.displayName || '',
      photoURL: profileData.photoURL || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Fetches the user's private encrypted workspace document at users/{uid}/private/workspace
 */
export async function getEncryptedWorkspace(uid) {
  const db = getFirestoreDB();
  if (!db || !uid) return null;
  const path = `users/${uid}/private/workspace`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'workspace'));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Saves the user's private encrypted workspace document at users/{uid}/private/workspace
 * CRITICAL: The data payload is 100% AES-GCM encrypted ciphertext before reaching this method
 */
export async function saveEncryptedWorkspace(uid, workspaceRecord) {
  const db = getFirestoreDB();
  if (!db || !uid) return;
  const path = `users/${uid}/private/workspace`;
  try {
    await setDoc(doc(db, 'users', uid, 'private', 'workspace'), {
      ...workspaceRecord,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
