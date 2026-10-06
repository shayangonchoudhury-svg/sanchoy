// Sanchoy Firebase Google Authentication Controller
// Provides:
// - signInWithGoogle (with fallback handling for popup blocks)
// - signOutFromFirebase
// - onAuthStateChanged tracking
// - Integration with Sanchoy's dual-layer security model

import { signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from 'firebase/auth';
import { initFirebaseServices, getFirebaseAuth, getGoogleProvider } from './app.js';
import { setActiveUser, signOutSecuritySession } from '../security/secure-session.js';
import { events } from '../core/events.js';

let authStateUnsubscribe = null;
let currentFirebaseUser = null;

/**
 * Initializes Firebase Auth state listener
 */
export async function initFirebaseAuthListener(onUserChanged) {
  const { auth, ready } = await initFirebaseServices();
  if (!ready || !auth) {
    return () => {};
  }

  if (authStateUnsubscribe) {
    authStateUnsubscribe();
  }

  authStateUnsubscribe = onAuthStateChanged(auth, (user) => {
    currentFirebaseUser = user;
    if (user) {
      setActiveUser(user);
    } else {
      setActiveUser(null);
    }

    if (typeof onUserChanged === 'function') {
      onUserChanged(user);
    }
    events.emit('firebase:authChanged', user);
  });

  return authStateUnsubscribe;
}

/**
 * Initiates Google Sign-In using Firebase Authentication popup
 */
export async function signInWithGoogle() {
  const { auth, googleProvider, ready } = await initFirebaseServices();
  if (!ready || !auth || !googleProvider) {
    throw new Error('Firebase Authentication is not configured yet. Please configure Firebase project.');
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    currentFirebaseUser = result.user;
    setActiveUser(result.user);
    return result.user;
  } catch (err) {
    // If popup was blocked by browser sandbox or user popup blocker
    if (err.code === 'auth/popup-blocked') {
      console.warn('[Sanchoy Auth] Google popup blocked by browser. Consider allowing popups.');
      throw new Error('Popup blocked by browser. Please enable popups for this site and try again.');
    } else if (err.code === 'auth/popup-closed-by-user') {
      throw new Error('Google sign-in was cancelled.');
    } else {
      console.error('[Sanchoy Auth] Google Sign-In failed:', err);
      throw err;
    }
  }
}

/**
 * Signs out the current Firebase user and wipes volatile encryption keys
 */
export async function signOutUser() {
  const auth = getFirebaseAuth();
  if (auth && auth.currentUser) {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('[Sanchoy Auth] Firebase signOut error:', e);
    }
  }
  currentFirebaseUser = null;
  signOutSecuritySession();
}

/**
 * Returns current Firebase user if signed in
 */
export function getCurrentFirebaseUser() {
  const auth = getFirebaseAuth();
  return auth ? auth.currentUser : currentFirebaseUser;
}
