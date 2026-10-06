# PHASE 4 — SANCHOY SECURITY & CLOUD ARCHITECTURE SPECIFICATION

## 1. Executive Overview

Sanchoy Financial OS implements a privacy-first **Dual-Layer Security Architecture**. Financial records, balances, daily allowance allocations, transactions, and private notes are client-side encrypted before any remote synchronization occurs.

```
                    ┌──────────────────────────────────────────────┐
                    │                   Layer 1                    │
                    │           GOOGLE AUTHENTICATION              │
                    │        (Identity & Account Access)           │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │                   Layer 2                    │
                    │          SANCHOY PRIVATE PASSCODE            │
                    │  (Client-Side Workspace DEK Decryption Key)  │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │          LOCAL FINANCIAL WORKSPACE           │
                    │   (IndexedDB Ledger & Deterministic Calc)    │
                    └──────────────────────────────────────────────┘
```

---

## 2. Dual-Key Encryption Envelope (DEK / KEK)

To prevent re-encrypting large ledgers when a user changes their passcode, Sanchoy uses a two-key envelope model:

```
                            ┌────────────────────────┐
                            │     Workspace DEK      │
                            │  (AES-GCM 256-bit Key) │
                            └───────────┬────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
                    ▼                                       ▼
        ┌───────────────────────┐               ┌───────────────────────┐
        │     Passcode KEK      │               │     Recovery KEK      │
        │  (PBKDF2 SHA-256 KEK) │               │  (PBKDF2 SHA-256 KEK) │
        │   100,000 Iterations  │               │   100,000 Iterations  │
        └───────────┬───────────┘               └───────────┬───────────┘
                    │                                       │
                    ▼                                       ▼
             Private Passcode                     20-char Recovery Code
```

1. **Data Encryption Key (DEK):** A cryptographically random 256-bit AES-GCM key generated in the browser. It encrypts and decrypts the entire financial workspace payload.
2. **Key Encryption Key (KEK):** Derived using PBKDF2 with SHA-256 (100,000 iterations) and a unique 16-byte random salt.
3. **Passcode Wrapping:** The DEK is wrapped using the Passcode KEK with a unique 96-bit AES-GCM IV.
4. **Recovery Wrapping:** The exact same DEK is independently wrapped using a KEK derived from a 20-character emergency Recovery Code (`XXXX-XXXX-XXXX-XXXX-XXXX`).

---

## 3. Recovery Architecture (Option A)

- **Format:** 20 Base32 Crockford characters partitioned into five groups (`XXXX-XXXX-XXXX-XXXX-XXXX`).
- **Zero-Knowledge Storage:** Plaintext recovery codes are **never** uploaded to Firestore, stored in `localStorage`, or logged.
- **Rotation:** Upon successful recovery, the user creates a new Private Passcode and Sanchoy generates a fresh Recovery Code, immediately invalidating the old recovery wrapping material.

---

## 4. Application Security States

- **State A: `SIGNED_OUT`**
  No active Google session. Workspace is locked; no encryption keys exist in volatile memory.
- **State B: `AUTHENTICATED_LOCKED`**
  User is authenticated with Google. Cloud envelope metadata is fetched, but financial amounts are masked with `₹ XXXX` until the Private Passcode is entered.
- **State C: `AUTHENTICATED_UNLOCKED`**
  The user enters the correct Private Passcode. The DEK is unwrapped into volatile memory. Full financial command center and charts become accessible.
- **State D: `LOCKED` (Auto-Lock / Explicit Lock)**
  Inactivity timeout or user lock action immediately zeros and wipes the active DEK from volatile memory. The Google identity session remains active.

---

## 5. Cloud Firestore Schema & Security Rules

### Document Paths

- **Public Account Document:** `/users/{userId}`
  - Non-sensitive metadata: `uid`, `email`, `displayName`, `photoURL`, `updatedAt`.
- **Private Encrypted Workspace:** `/users/{userId}/private/workspace`
  - Encrypted payload: `cryptoVersion`, `passcodeWrappedKey`, `passcodeSalt`, `passcodeWrapIv`, `recoveryWrappedKey`, `recoverySalt`, `recoveryWrapIv`, `encryptedData`, `encryptedDataIv`, `clientRevision`, `updatedAt`.

### Security Rules (Zero-Trust Owner Isolation)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Default deny
    }

    match /users/{userId} {
      allow get, create, update, delete: if request.auth != null && request.auth.uid == userId;
      allow list: if false;

      match /private/workspace {
        allow get, create, update, delete: if request.auth != null && request.auth.uid == userId;
        allow list: if false;
      }
    }
  }
}
```

---

## 6. Local IndexedDB Integration & Offline Sovereignty

- Sanchoy is local-first. The deterministic financial engine reconciles daily allocations from local IndexedDB records.
- When online, the sync engine checks revisions (`localRevision` vs `clientRevision`).
- If offline, mutations queue locally in IndexedDB and synchronize automatically upon network reconnection.

---

## 7. Vault Compatibility

- The Secret Savings Vault maintains its own specialized salt and derivation mechanism (`vault_salt`).
- In Phase 4, Vault records are backed up within the encrypted workspace bundle while retaining their separate vault unlocking lifecycle.

---

## 8. Quantum Insight Compatibility

- Future Quantum Insight AI will process only user-approved, locally aggregated statistical metrics (e.g., category totals, spending velocity), never raw unencrypted financial records.

---

## 9. Firebase Console Setup Checklist

To enable live Google Sign-In and cloud synchronization:

1. **Create Firebase Project:** In the [Firebase Console](https://console.firebase.google.com/), create a project for Sanchoy.
2. **Enable Authentication:**
   - Go to **Build > Authentication > Sign-in method**.
   - Enable the **Google** provider.
   - Add authorized domains: `localhost`, `127.0.0.1`, and your deployment URL.
3. **Enable Cloud Firestore:**
   - Go to **Build > Firestore Database**.
   - Create database in production mode.
   - Deploy `firestore.rules` using the Firebase CLI or console.
4. **Register Web App:**
   - Add a Web app in project settings and place the configuration into `firebase-applet-config.json`.
