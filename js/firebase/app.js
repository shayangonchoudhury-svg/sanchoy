// Sanchoy Firebase App & Services Initializer
// Initializes:
// - Firebase App
// - Firebase Auth (Google Provider)
// - Cloud Firestore with custom error handling
// Follows official Firebase skill guidelines

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFirebaseConfig, isFirebaseConfigured } from './config.js';

let app = null;
let auth = null;
let db = null;
let googleProvider = null;
let isInitialized = false;

export async function initFirebaseServices() {
  if (isInitialized) {
    return { app, auth, db, googleProvider, ready: true };
  }

  const config = await getFirebaseConfig();
  if (!config || !config.apiKey || !config.projectId) {
    console.warn('[Sanchoy Firebase] No active Firebase configuration found. Running in sovereign local/offline mode.');
    return { app: null, auth: null, db: null, googleProvider: null, ready: false };
  }

  try {
    if (!getApps().length) {
      app = initializeApp(config);
    } else {
      app = getApp();
    }

    auth = getAuth(app);
    // Explicitly set browserLocalPersistence
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      console.warn('[Sanchoy Firebase] setPersistence warning:', e);
    }

    // Initialize Firestore with configured databaseId per skill guidance
    const dbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)'
      ? config.firestoreDatabaseId
      : undefined;
    db = getFirestore(app, dbId);

    // Google Auth Provider setup
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({
      prompt: 'select_account'
    });

    isInitialized = true;
    console.log('[Sanchoy Firebase] Firebase services successfully initialized for project:', config.projectId);
    return { app, auth, db, googleProvider, ready: true };
  } catch (err) {
    console.error('[Sanchoy Firebase] Initialization failed:', err);
    return { app: null, auth: null, db: null, googleProvider: null, ready: false, error: err };
  }
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirestoreDB() {
  return db;
}

export function getGoogleProvider() {
  return googleProvider;
}
