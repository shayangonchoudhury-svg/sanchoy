# Sanchoy Deployment & Firebase Auth Domain Audit

## 1. Current Deployment Status

Sanchoy has multiple active deployment targets:

1. **Google Cloud Run (AI Studio Build / Preview Environment):**
   - **Development App URL:** `https://ais-dev-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app`
   - **Shared/Preview App URL:** `https://ais-pre-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app`
   - **Platform:** Google Cloud Run (Containerized Node.js / Express on port 3000)

2. **Vercel Production Deployment:**
   - **Production URL:** `https://expense-tracker-pro-theta-silk.vercel.app/`
   - **Platform:** Vercel

3. **Local Development Origin:**
   - **URL:** `http://localhost:3000` (and `http://localhost:5173` / standard loopback interfaces)

---

## 2. Development URL

- **Local Development:** `http://localhost:3000`
- **Cloud Dev Runtime:** `https://ais-dev-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app`

---

## 3. Production URL

- **Production Live URL:** `https://expense-tracker-pro-theta-silk.vercel.app`
- **Cloud Run Shared Preview URL:** `https://ais-pre-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app`

---

## 4. Deployment Platform

- **Target A:** Vercel (`expense-tracker-pro-theta-silk.vercel.app`)
- **Target B:** Google Cloud Run (`asia-southeast1.run.app`)
- **Server:** Node.js Express server (`server.js`) serving static assets and routing all paths to `index.html` on `0.0.0.0:3000`.

---

## 5. Firebase Authentication Configuration

From `firebase-applet-config.json`:
- **Firebase Project ID:** `sanchoy-408dd`
- **Firebase Auth Domain:** `sanchoy-408dd.firebaseapp.com`
- **Firestore Database ID:** `(default)`
- **App ID:** `1:795575191016:web:1874cfbe7a8b5120bc505d`

---

## 6. Google Sign-In Configuration

- **API Used:** `signInWithPopup(auth, googleProvider)` in `js/firebase/auth.js`.
- **Provider Parameters:** `prompt: 'select_account'` configured via `GoogleAuthProvider`.
- **Persistence:** `setPersistence(auth, browserLocalPersistence)` in `js/firebase/app.js`.
- **Origin Dependency:**
  - Firebase Authentication evaluates `window.location.origin` against the project's **Authorized domains** list when `signInWithPopup` is called.
  - If the hosting domain is not on the Authorized Domains whitelist, Firebase immediately rejects authentication with:
    `auth/unauthorized-domain: This domain is not authorized for OAuth operations for your Firebase project.`
  - No redirect URLs or OAuth endpoints are hardcoded in application logic.

---

## 7. Authorized Domain(s) Required

| Environment | URL | Hostname to Add | Required? |
|---|---|---|---|
| Production (Vercel) | `https://expense-tracker-pro-theta-silk.vercel.app/` | `expense-tracker-pro-theta-silk.vercel.app` | **Yes** |
| Shared Preview (Cloud Run) | `https://ais-pre-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app/` | `ais-pre-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app` | **Yes** |
| Dev Preview (Cloud Run) | `https://ais-dev-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app/` | `ais-dev-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app` | **Yes** |
| Local Development | `http://localhost:3000` | `localhost` | **Already Included by Default** (Verify in Console) |
| Firebase Default Domains | `sanchoy-408dd.firebaseapp.com`, `sanchoy-408dd.web.app` | (Managed automatically by Firebase) | **Already Included by Default** |

---

## 8. Exact Firebase Console Steps

Follow these exact steps in your browser:

1. Open the **Firebase Console**:
   `https://console.firebase.google.com/project/sanchoy-408dd/authentication/settings`
2. Select your project: **sanchoy-408dd**
3. In the left navigation, click **Authentication**
4. Click the **Settings** tab in the top navigation bar of Authentication
5. In the settings panel, select **Authorized domains**
6. Click **Add domain**
7. Enter the exact production hostname:
   ```text
   expense-tracker-pro-theta-silk.vercel.app
   ```
8. Click **Save**
9. (Optional for Cloud Run preview testing) Click **Add domain** again and enter:
   ```text
   ais-pre-vab4zd42zzdo3vhmibliq2-401056371756.asia-southeast1.run.app
   ```
10. Click **Save**

---

## 9. Security Notes

- **Zero Secret Exposure:** No Firebase service account keys, private API secrets, or master encryption keys are exposed.
- **Client Web Configuration:** The `apiKey` in `firebase-applet-config.json` is a public Firebase Web identifier designed for client-side routing; security is strictly enforced by `firestore.rules` and authorized domain whitelisting.
- **Dual-Layer Protection:** Even after a successful Google OAuth sign-in, zero financial data or vault records are decrypted until the user unlocks their workspace using their **Sanchoy Private Passcode**.

---

## 10. Final Verification Checklist

- [ ] Sanchoy opens at the production URL (`https://expense-tracker-pro-theta-silk.vercel.app/`)
- [ ] Correct hostname (`expense-tracker-pro-theta-silk.vercel.app`) added to Firebase Authorized Domains
- [ ] Google provider enabled in Firebase Authentication sign-in methods
- [ ] Google Sign-In popup opens without `auth/unauthorized-domain` error
- [ ] User returns to Sanchoy after authentication
- [ ] Sanchoy Private Passcode screen appears after Google authentication
- [ ] Financial data remains locked and masked until passcode unlock
- [ ] No secrets exposed in browser logs or network requests
