// Sanchoy Screen 2 — Dual-Layer Authentication & Workspace Initialization View
// Implements Phase 4 specifications:
// - Layer 1: Google Authentication (Account Identity & Cloud Access)
// - Layer 2: Sanchoy Private Passcode (Financial Workspace Decryption Key)
// - Emergency Recovery: 20-character Recovery Code (Option A)
// - States:
//   State A: SIGNED_OUT -> Continue with Google
//   State B: AUTHENTICATED_LOCKED -> Enter Sanchoy Private Passcode
//   State C: FIRST-TIME USER -> Create Passcode + Display & Confirm Recovery Code
//   State D: RECOVERY UNLOCK -> Enter Recovery Code, Decrypt DEK, Set New Passcode
//   Local Fallback: Sovereign Offline Mode if Firebase is unconfigured or user operates offline
// - Seamless theme integration (Dark: "Futuristic Financial OS", Light: "Premium FinTech")

import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { AppDB } from '../storage/database.js';
import { getStoredHash, storeHash, hashPassword, verifyPassword, unlockSession } from '../auth/auth.js';
import { navigate } from './ui.js';
import { showToast } from './toast.js';
import { toggleTheme, applyTheme } from './theme.js';
import { getIcon } from './icons.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { signInWithGoogle, signOutUser, getCurrentFirebaseUser } from '../firebase/auth.js';
import { getEncryptedWorkspace } from '../firebase/firestore.js';
import {
  SecurityState,
  getSecurityState,
  getActiveUser,
  setActiveWorkspaceDEK
} from '../security/secure-session.js';
import {
  createWorkspaceEnvelope,
  unlockDEKWithPasscode,
  unlockDEKWithRecoveryCode,
  loadLocalEnvelope,
  saveLocalEnvelope,
  rotateRecoveryCodeInEnvelope
} from '../security/workspace-keys.js';
import { generateRecoveryCode } from '../security/recovery.js';
import { migrateLocalWorkspaceToCloud, restoreFinancialWorkspaceLocally } from '../migration/local-to-cloud.js';
import { decryptPayload } from '../security/crypto.js';
import { syncWorkspaceToCloud } from '../firebase/sync.js';

let pendingAuthSuccessCallback = null;
let currentViewMode = 'standard'; // 'standard' | 'recovery' | 'show_recovery_code'
let tempGeneratedRecoveryCode = null;
let tempCreatedPasscode = null;

export function setPendingAuthCallback(cb) {
  pendingAuthSuccessCallback = cb;
}

/**
 * Initializes and mounts the dedicated Screen 2 Auth / Dual-Layer view
 */
export async function renderAuthPage() {
  const container = document.getElementById('authScreenContainer');
  if (!container) return;

  const firebaseReady = await isFirebaseConfigured();
  const currentUser = getCurrentFirebaseUser();
  const localEnvelope = await loadLocalEnvelope();
  const storedHash = await getStoredHash();

  let cloudWorkspace = null;
  let firestorePermissionError = false;
  if (currentUser) {
    try {
      cloudWorkspace = await getEncryptedWorkspace(currentUser.uid);
    } catch (e) {
      console.warn('[Sanchoy Auth Page] Error loading cloud workspace:', e);
      if (e?.message?.includes('Missing or insufficient permissions') || e?.message?.includes('permission-denied')) {
        firestorePermissionError = true;
      }
    }
  }

  mountAuthLayout(container, {
    firebaseReady,
    currentUser,
    localEnvelope,
    cloudWorkspace,
    storedHash,
    firestorePermissionError
  });
}

function mountAuthLayout(container, ctx) {
  const isDark = document.documentElement.classList.contains('dark') || document.documentElement.getAttribute('data-theme') === 'dark';
  const { currentUser, cloudWorkspace, localEnvelope, storedHash, firebaseReady } = ctx;

  const hasWorkspace = !!(cloudWorkspace || localEnvelope || storedHash);

  container.innerHTML = `
    <div class="sanchoy-auth-viewport">
      <!-- Atmospheric Background Layer (Zero external images required) -->
      <div class="sanchoy-auth-backdrop" aria-hidden="true">
        <div class="sanchoy-auth-overlay"></div>
      </div>

      <!-- Main Content Container -->
      <div class="sanchoy-auth-content">
        <!-- TOP BRAND & THEME SWITCH -->
        <header class="sanchoy-auth-topbar">
          <button id="authBrandHomeBtn" class="sanchoy-auth-brand" aria-label="Sanchoy Brand">
            <div class="sanchoy-auth-brand-logo">S</div>
            <div>
              <div class="sanchoy-auth-brand-name">SANCHOY</div>
              <div class="sanchoy-auth-brand-sub">Financial Intelligence</div>
            </div>
          </button>

          <!-- Theme Capsule & Account pill if signed in -->
          <div class="flex items-center gap-3">
            ${currentUser ? `
              <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full sanchoy-surface-inset border border-[var(--border)] text-xs">
                <span class="w-2 h-2 rounded-full bg-[var(--income)]"></span>
                <span class="font-medium text-[var(--text-secondary)] truncate max-w-[120px]">${currentUser.displayName || currentUser.email}</span>
                <button id="authHeaderSignOutBtn" class="text-[var(--text-muted)] hover:text-[var(--danger)] text-[10px] uppercase font-bold ml-1 cursor-pointer">Sign Out</button>
              </div>
            ` : ''}

            <div class="sanchoy-auth-theme-capsule" role="radiogroup" aria-label="Theme mode">
              <button id="authThemeLightBtn" class="sanchoy-auth-theme-btn ${!isDark ? 'active' : ''}" title="Light Mode (Premium FinTech)" aria-label="Switch to Light Theme">
                ${getIcon('sun', { size: 'w-3.5 h-3.5' })}
              </button>
              <button id="authThemeDarkBtn" class="sanchoy-auth-theme-btn ${isDark ? 'active' : ''}" title="Dark Mode (Futuristic Financial OS)" aria-label="Switch to Dark Theme">
                ${getIcon('moon', { size: 'w-3.5 h-3.5' })}
              </button>
            </div>
          </div>
        </header>

        <!-- CENTER MAIN SECTION: Editorial Headline + Auth Card -->
        <main class="sanchoy-auth-main-layout">
          <!-- LEFT / UPPER: Editorial Statement -->
          <div class="sanchoy-auth-editorial animate-fade-in">
            <h1 class="sanchoy-auth-headline">
              Your financial world,<br/>
              made <span class="sanchoy-auth-headline-accent">intelligible.</span>
            </h1>
            <p id="authHeroSubtitle" class="sanchoy-auth-desc">
              ${currentUser
                ? 'Your Google account identifies your workspace. Enter your Sanchoy Private Passcode to decrypt your local ledger.'
                : 'Take control of your virtual liquidity with dual-layer security: Google account identity and zero-knowledge client encryption.'}
            </p>

            <!-- Dual-Layer Explainer Box -->
            <div class="mt-6 p-4 rounded-2xl sanchoy-surface-inset border border-[var(--border-subtle)] space-y-2.5 max-w-md hidden sm:block">
              <div class="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                ${getIcon('vault', { size: 'w-4 h-4', className: 'text-[var(--accent)] shrink-0' })}
                <span>Dual-Layer Security Architecture</span>
              </div>
              <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
                <strong>Layer 1 (Google):</strong> Identifies you and secures cloud synchronization.<br/>
                <strong>Layer 2 (Sanchoy Passcode):</strong> Client-side AES-GCM 256-bit key that keeps financial records completely private.
              </p>
            </div>
          </div>

          <!-- RIGHT / LOWER: Auth Panel Card -->
          <div class="sanchoy-auth-card animate-fade-in" role="region" aria-label="Authentication Panel">
            <div id="authDynamicContainer"></div>
          </div>
        </main>

        <!-- LOWER FEATURE STRIP TRIPTYCH -->
        <footer class="sanchoy-auth-footer" aria-label="Core Architecture">
          <div class="sanchoy-auth-pillar">
            <div class="sanchoy-auth-pillar-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <div class="sanchoy-auth-pillar-title">Client-Side Encrypted</div>
              <div class="sanchoy-auth-pillar-desc">Financial amounts are encrypted before sync</div>
            </div>
          </div>

          <div class="sanchoy-auth-pillar">
            <div class="sanchoy-auth-pillar-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 20V10M12 20V4M6 20v-6"/>
              </svg>
            </div>
            <div>
              <div class="sanchoy-auth-pillar-title">Deterministic Engine</div>
              <div class="sanchoy-auth-pillar-desc">Continuous calendar-day reconciliation</div>
            </div>
          </div>

          <div class="sanchoy-auth-pillar">
            <div class="sanchoy-auth-pillar-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1z"/>
              </svg>
            </div>
            <div>
              <div class="sanchoy-auth-pillar-title">Local Sovereignty</div>
              <div class="sanchoy-auth-pillar-desc">IndexedDB offline fallback & recovery codes</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  `;

  // Bind Header Controls
  document.getElementById('authBrandHomeBtn')?.addEventListener('click', () => {
    navigate('/');
  });

  document.getElementById('authHeaderSignOutBtn')?.addEventListener('click', async () => {
    await signOutUser();
    showToast('Signed out of Google account', 'info');
    renderAuthPage();
  });

  const lightBtn = document.getElementById('authThemeLightBtn');
  const darkBtn = document.getElementById('authThemeDarkBtn');

  lightBtn?.addEventListener('click', () => {
    applyTheme('light');
    lightBtn.classList.add('active');
    darkBtn.classList.remove('active');
  });

  darkBtn?.addEventListener('click', () => {
    applyTheme('dark');
    darkBtn.classList.add('active');
    lightBtn.classList.remove('active');
  });

  // Render the appropriate stage
  renderDynamicAuthStage(ctx);
}

function renderDynamicAuthStage(ctx) {
  const container = document.getElementById('authDynamicContainer');
  if (!container) return;

  const { currentUser, cloudWorkspace, localEnvelope, storedHash, firebaseReady } = ctx;

  // Case 1: Recovery Code flow active
  if (currentViewMode === 'recovery') {
    renderRecoveryInputView(container, ctx);
    return;
  }

  // Case 2: Display newly generated Recovery Code (User must explicitly confirm saving it)
  if (currentViewMode === 'show_recovery_code') {
    renderRecoveryCodeDisplayView(container, ctx);
    return;
  }

  // Case 3: User is signed in with Google
  if (currentUser) {
    const envelope = cloudWorkspace || localEnvelope;

    if (!envelope && !storedHash) {
      // First-time Google user: Create Sanchoy Private Passcode
      renderCreatePasscodeView(container, ctx);
    } else {
      // Returning user: Enter Sanchoy Private Passcode
      renderUnlockPasscodeView(container, ctx, envelope);
    }
    return;
  }

  // Case 4: User is NOT signed in with Google yet
  // If Firebase is configured, provide Google Sign-In as Layer 1, plus sovereign local passcode option
  renderSignInEntryView(container, ctx);
}

/**
 * ENTRY VIEW: Continue with Google + Local Sovereign Passcode Option
 */
function renderSignInEntryView(container, ctx) {
  const { storedHash, localEnvelope } = ctx;
  const hasLocal = !!(storedHash || localEnvelope);

  container.innerHTML = `
    <div class="space-y-5 animate-fade-in">
      <div>
        <h2 class="sanchoy-auth-card-title">Welcome to Sanchoy</h2>
        <p class="sanchoy-auth-card-sub">Access your private financial intelligence workspace.</p>
      </div>

      <div id="authEntryAlert" class="sanchoy-auth-alert hidden" role="alert"></div>

      <!-- Google Sign-In Button (Layer 1) -->
      <div class="space-y-3 pt-1">
        <button id="signInWithGoogleBtn" type="button" class="w-full py-3 px-4 rounded-xl bg-[var(--surface-raised)] hover:bg-[var(--surface-inset)] border border-[var(--border)] text-[var(--text-primary)] font-bold text-xs flex items-center justify-center gap-3 transition-all shadow-sm hover:-translate-y-0.5 cursor-pointer">
          <svg class="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.67v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.16z"/>
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
            <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
          </svg>
          <span>Continue with Google</span>
        </button>
      </div>

      <div class="relative flex py-1 items-center">
        <div class="flex-grow border-t border-[var(--border-subtle)]"></div>
        <span class="flex-shrink mx-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono">or local mode</span>
        <div class="flex-grow border-t border-[var(--border-subtle)]"></div>
      </div>

      <!-- Local Workspace Passcode Option -->
      <div>
        <button id="continueLocalModeBtn" type="button" class="sanchoy-auth-submit w-full">
          <span>${hasLocal ? 'Unlock Local Workspace' : 'Initialize Local Workspace'}</span>
          <span>→</span>
        </button>
      </div>

      <p class="text-[10px] text-[var(--text-muted)] text-center leading-relaxed flex items-center justify-center gap-1.5">
        ${getIcon('lock', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)] shrink-0' })}
        <span>All financial ledgers remain encrypted in your local browser sandbox.</span>
      </p>
    </div>
  `;

  const googleBtn = document.getElementById('signInWithGoogleBtn');
  const localBtn = document.getElementById('continueLocalModeBtn');
  const alertBox = document.getElementById('authEntryAlert');

  googleBtn?.addEventListener('click', async () => {
    alertBox?.classList.add('hidden');
    googleBtn.disabled = true;
    googleBtn.innerHTML = `<span>Connecting to Google...</span>`;

    try {
      await signInWithGoogle();
      showToast('Authenticated with Google successfully', 'success');
      renderAuthPage();
    } catch (err) {
      console.error('Google sign-in error:', err);
      googleBtn.disabled = false;
      googleBtn.innerHTML = `
        <svg class="w-4 h-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.67v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.16z"/>
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
        </svg>
        <span>Continue with Google</span>
      `;
      if (alertBox) {
        if (err.code === 'auth/unauthorized-domain' || (err.message && err.message.includes('auth/unauthorized-domain'))) {
          const currentHost = window.location.hostname || 'this domain';
          alertBox.innerHTML = `
            <div class="space-y-1 text-left">
              <div class="font-bold flex items-center gap-1.5">
                ${getIcon('warning', { size: 'w-4 h-4', className: 'text-[var(--warning)] shrink-0' })}
                <span>Unauthorized Domain</span>
              </div>
              <div>This domain (<code>${currentHost}</code>) must be whitelisted in Firebase.</div>
              <div class="text-[11px] opacity-90">Go to <strong>Firebase Console &rarr; Authentication &rarr; Settings &rarr; Authorized domains</strong> and add <code>${currentHost}</code>.</div>
            </div>
          `;
        } else {
          alertBox.textContent = err.message || 'Google authentication was not completed.';
        }
        alertBox.classList.remove('hidden');
      }
    }
  });

  localBtn?.addEventListener('click', () => {
    // Treat as sovereign local mode
    if (hasLocal) {
      renderUnlockPasscodeView(container, ctx, localEnvelope);
    } else {
      renderCreatePasscodeView(container, ctx);
    }
  });
}

/**
 * UNLOCK WORKSPACE VIEW (Layer 2: Sanchoy Private Passcode)
 */
function renderUnlockPasscodeView(container, ctx, envelope) {
  const { currentUser, storedHash, firestorePermissionError } = ctx;

  container.innerHTML = `
    <div class="space-y-4 animate-fade-in">
      <div>
        <h2 class="sanchoy-auth-card-title">Welcome Back</h2>
        <p class="sanchoy-auth-card-sub">
          ${currentUser ? 'Sanchoy is ready. Enter your Private Passcode to unlock your financial workspace.' : 'Enter your master passcode to unlock your financial workspace.'}
        </p>
      </div>

      ${firestorePermissionError ? `
        <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs space-y-1">
          <div class="font-bold flex items-center gap-1.5">
            ${getIcon('warning', { size: 'w-4 h-4', className: 'text-amber-500 shrink-0' })}
            <span>Cloud Database Permissions Notice</span>
          </div>
          <p class="leading-relaxed">
            Firestore returned "Missing or insufficient permissions". Your cloud workspace cannot be fetched until security rules are published in Firebase Console (Firestore Database → Rules).
          </p>
        </div>
      ` : ''}

      <div id="authUnlockAlert" class="sanchoy-auth-alert hidden" role="alert"></div>

      <form id="authUnlockForm" onsubmit="return false;" class="space-y-4">
        <div class="sanchoy-auth-field">
          <label class="sanchoy-auth-label" for="unlockPasscodeInput">Sanchoy Private Passcode</label>
          <div class="sanchoy-auth-input-wrapper">
            <span class="sanchoy-auth-input-icon">
              ${getIcon('lock', { size: 'w-4 h-4' })}
            </span>
            <input
              id="unlockPasscodeInput"
              type="password"
              placeholder="Enter your passcode"
              class="sanchoy-auth-input"
              autocomplete="current-password"
              required
              autofocus
            />
            <button type="button" id="toggleUnlockPass" class="sanchoy-auth-toggle-vis" aria-label="Toggle password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
        </div>

        <div class="sanchoy-auth-row">
          <label class="sanchoy-auth-checkbox-label">
            <input type="checkbox" id="keepUnlockedCheck" class="sanchoy-auth-checkbox" checked />
            <span>Keep session active</span>
          </label>
          <button type="button" id="useRecoveryCodeBtn" class="sanchoy-auth-link">
            Use Recovery Code
          </button>
        </div>

        <div class="pt-1">
          <button id="unlockWorkspaceSubmitBtn" type="submit" class="sanchoy-auth-submit">
            <span>Enter Financial Command</span>
            <span>→</span>
          </button>
        </div>
      </form>
    </div>
  `;

  const input = document.getElementById('unlockPasscodeInput');
  const toggleBtn = document.getElementById('toggleUnlockPass');
  const submitBtn = document.getElementById('unlockWorkspaceSubmitBtn');
  const alertBox = document.getElementById('authUnlockAlert');
  const recoveryBtn = document.getElementById('useRecoveryCodeBtn');

  if (toggleBtn && input) {
    toggleBtn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  recoveryBtn?.addEventListener('click', () => {
    currentViewMode = 'recovery';
    renderDynamicAuthStage(ctx);
  });

  async function handleUnlock() {
    const entered = input.value.trim();
    if (!entered) {
      if (alertBox) {
        alertBox.textContent = 'Please enter your passcode.';
        alertBox.classList.remove('hidden');
      }
      input.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Decrypting workspace...</span>`;

    try {
      let dek = null;

      // 1. If envelope exists, unwrap DEK
      if (envelope && envelope.passcodeWrappedKey) {
        dek = await unlockDEKWithPasscode(envelope, entered);
        setActiveWorkspaceDEK(dek);

        // If cloud workspace contains encrypted financial data, decrypt and restore locally
        if (envelope.encryptedData && envelope.encryptedDataIv) {
          try {
            const bundle = await decryptPayload({
              version: envelope.cryptoVersion || 1,
              ciphertext: envelope.encryptedData,
              iv: envelope.encryptedDataIv
            }, dek);
            await restoreFinancialWorkspaceLocally(bundle);
            const { refreshAllViews } = await import('../transactions/transactions.js');
            refreshAllViews();
            const { recordSyncSuccess } = await import('../sync/revision.js');
            recordSyncSuccess(envelope.clientRevision || 1);
          } catch (decErr) {
            console.warn('[Sanchoy Unlock] Local workspace restore notice:', decErr);
          }
        }
      } else if (storedHash) {
        // Fallback for legacy passcode hash
        const isValid = await verifyPassword(entered);
        if (!isValid) throw new Error('Incorrect passcode');
        unlockSession();
      }

      showToast('Workspace decrypted. Welcome to Financial Command.', 'success');

      // Trigger cloud sync in background
      syncWorkspaceToCloud('unlock');

      if (typeof pendingAuthSuccessCallback === 'function') {
        const cb = pendingAuthSuccessCallback;
        pendingAuthSuccessCallback = null;
        cb();
      } else {
        navigate('/tracker');
      }
    } catch (err) {
      console.warn('Unlock error:', err);
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Enter Financial Command</span> <span>→</span>`;
      if (alertBox) {
        alertBox.textContent = 'Unable to unlock your workspace. Check your passcode and try again.';
        alertBox.classList.remove('hidden');
      }
      input.value = '';
      input.focus();
    }
  }

  document.getElementById('authUnlockForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleUnlock();
  });
}

/**
 * CREATE PRIVATE PASSCODE VIEW
 */
function renderCreatePasscodeView(container, ctx) {
  const { currentUser, firestorePermissionError } = ctx;

  container.innerHTML = `
    <div class="space-y-4 animate-fade-in">
      <div>
        <h2 class="sanchoy-auth-card-title">Create Your Private Workspace</h2>
        <p class="sanchoy-auth-card-sub">
          ${currentUser ? 'Your Google account identifies your Sanchoy account. Your Sanchoy Private Passcode protects your financial workspace.' : 'Initialize your offline private Sanchoy workspace.'}
        </p>
      </div>

      ${firestorePermissionError ? `
        <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs space-y-1">
          <div class="font-bold flex items-center gap-1.5">
            ${getIcon('warning', { size: 'w-4 h-4', className: 'text-amber-500 shrink-0' })}
            <span>Cloud Database Permissions Notice</span>
          </div>
          <p class="leading-relaxed">
            Firestore returned "Missing or insufficient permissions". Cloud initialization will be blocked until security rules are published in Firebase Console (Firestore Database → Rules).
          </p>
        </div>
      ` : ''}

      <div id="authCreateAlert" class="sanchoy-auth-alert hidden" role="alert"></div>

      <form id="authCreateForm" onsubmit="return false;" class="space-y-3.5">
        <div class="sanchoy-auth-field">
          <label class="sanchoy-auth-label" for="createPassInput">Create Sanchoy Private Passcode</label>
          <div class="sanchoy-auth-input-wrapper">
            <span class="sanchoy-auth-input-icon">
              ${getIcon('lock', { size: 'w-4 h-4' })}
            </span>
            <input
              id="createPassInput"
              type="password"
              placeholder="Enter a strong passcode (min 6 chars)"
              class="sanchoy-auth-input"
              autocomplete="new-password"
              required
            />
            <button type="button" id="toggleCreatePassBtn" class="sanchoy-auth-toggle-vis" aria-label="Toggle password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
        </div>

        <div class="sanchoy-auth-field">
          <label class="sanchoy-auth-label" for="confirmPassInput">Confirm Passcode</label>
          <div class="sanchoy-auth-input-wrapper">
            <span class="sanchoy-auth-input-icon">
              ${getIcon('lock', { size: 'w-4 h-4' })}
            </span>
            <input
              id="confirmPassInput"
              type="password"
              placeholder="Re-enter your passcode"
              class="sanchoy-auth-input"
              autocomplete="new-password"
              required
            />
            <button type="button" id="toggleConfirmPassBtn" class="sanchoy-auth-toggle-vis" aria-label="Toggle password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
          <div id="createMatchStatus" class="sanchoy-auth-input-hint hidden"></div>
        </div>

        <div class="pt-1 pb-1">
          <label class="sanchoy-auth-checkbox-label">
            <input type="checkbox" id="createPrivacyNoticeCheck" class="sanchoy-auth-checkbox" checked />
            <span class="text-[0.725rem]">I understand that my financial data is client-side encrypted and protected by this passcode.</span>
          </label>
        </div>

        <div class="pt-1">
          <button id="createWorkspaceContinueBtn" type="submit" class="sanchoy-auth-submit">
            <span>Continue to Recovery Code</span>
            <span>→</span>
          </button>
        </div>
      </form>
    </div>
  `;

  const p1 = document.getElementById('createPassInput');
  const p2 = document.getElementById('confirmPassInput');
  const t1 = document.getElementById('toggleCreatePassBtn');
  const t2 = document.getElementById('toggleConfirmPassBtn');
  const matchStatus = document.getElementById('createMatchStatus');
  const submitBtn = document.getElementById('createWorkspaceContinueBtn');
  const alertBox = document.getElementById('authCreateAlert');

  if (t1 && p1) t1.addEventListener('click', () => p1.type = p1.type === 'password' ? 'text' : 'password');
  if (t2 && p2) t2.addEventListener('click', () => p2.type = p2.type === 'password' ? 'text' : 'password');

  function validate() {
    if (p2.value.length > 0) {
      matchStatus.classList.remove('hidden');
      if (p1.value === p2.value) {
        matchStatus.innerHTML = `<span style="color:var(--income)">✓ Passcodes match</span>`;
      } else {
        matchStatus.innerHTML = `<span style="color:var(--expense)">✗ Passcodes do not match</span>`;
      }
    } else {
      matchStatus.classList.add('hidden');
    }
  }

  p1.addEventListener('input', validate);
  p2.addEventListener('input', validate);

  submitBtn?.addEventListener('click', () => {
    const val = p1.value;
    const conf = p2.value;

    if (!val || val.length < 6) {
      if (alertBox) {
        alertBox.textContent = 'Passcode must be at least 6 characters.';
        alertBox.classList.remove('hidden');
      }
      p1.focus();
      return;
    }

    if (val !== conf) {
      if (alertBox) {
        alertBox.textContent = 'Passcodes do not match.';
        alertBox.classList.remove('hidden');
      }
      p2.focus();
      return;
    }

    tempCreatedPasscode = val;
    tempGeneratedRecoveryCode = generateRecoveryCode();
    currentViewMode = 'show_recovery_code';
    renderDynamicAuthStage(ctx);
  });
}

/**
 * RECOVERY CODE DISPLAY & CONFIRMATION VIEW
 */
function renderRecoveryCodeDisplayView(container, ctx) {
  const { currentUser } = ctx;

  container.innerHTML = `
    <div class="space-y-4 animate-fade-in text-left">
      <div>
        <h2 class="sanchoy-auth-card-title">Save Your Recovery Code</h2>
        <p class="sanchoy-auth-card-sub">
          If you ever forget your Sanchoy Private Passcode, this emergency code is the ONLY way to recover your encrypted financial workspace.
        </p>
      </div>

      <!-- Recovery Code Visual Capsule -->
      <div class="p-4 rounded-2xl sanchoy-surface-inset border-2 border-[var(--accent)] text-center space-y-2">
        <div class="text-[10px] uppercase font-mono font-bold text-[var(--accent)] tracking-widest">
          Emergency Recovery Key
        </div>
        <div id="recoveryCodeDisplayBox" class="font-mono text-base sm:text-lg font-extrabold text-[var(--text-primary)] tracking-widest select-all py-1">
          ${tempGeneratedRecoveryCode}
        </div>
        <div class="flex justify-center gap-2 pt-1">
          <button id="copyRecoveryCodeBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary text-[11px] py-1 px-3 flex items-center gap-1.5 cursor-pointer">
            ${getIcon('copy', { size: 'w-3.5 h-3.5' })}
            <span>Copy Code</span>
          </button>
        </div>
      </div>

      <div class="p-3 rounded-xl bg-[var(--warning-bg)] border border-[var(--warning)] text-[11px] text-[var(--text-secondary)] space-y-1">
        <div class="font-bold text-[var(--warning)] flex items-center gap-1.5">
          ${getIcon('warning', { size: 'w-4 h-4', className: 'text-[var(--warning)] shrink-0' })}
          <span>Important Security Notice</span>
        </div>
        <p>This code is never stored in plaintext on our servers or in the cloud. Store it in a safe place.</p>
      </div>

      <!-- Confirmation Checkbox -->
      <div class="pt-1">
        <label class="sanchoy-auth-checkbox-label">
          <input type="checkbox" id="savedRecoveryCodeCheck" class="sanchoy-auth-checkbox" />
          <span class="text-xs font-semibold text-[var(--text-primary)]">I have securely saved my Recovery Code.</span>
        </label>
      </div>

      <div class="pt-2 flex gap-3">
        <button id="backToCreatePassBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary flex-1 py-3 text-xs">
          ← Back
        </button>
        <button id="finalizeWorkspaceInitBtn" type="button" disabled class="sanchoy-auth-submit flex-[2] opacity-50 cursor-not-allowed">
          <span>Initialize Workspace</span>
          <span>→</span>
        </button>
      </div>
    </div>
  `;

  const copyBtn = document.getElementById('copyRecoveryCodeBtn');
  const check = document.getElementById('savedRecoveryCodeCheck');
  const finishBtn = document.getElementById('finalizeWorkspaceInitBtn');
  const backBtn = document.getElementById('backToCreatePassBtn');

  copyBtn?.addEventListener('click', () => {
    navigator.clipboard?.writeText(tempGeneratedRecoveryCode).then(() => {
      showToast('Recovery code copied to clipboard', 'info');
      copyBtn.innerHTML = `<span>✓ Copied</span>`;
      setTimeout(() => {
        if (copyBtn) copyBtn.innerHTML = `${getIcon('copy', { size: 'w-3.5 h-3.5' })} <span>Copy Code</span>`;
      }, 2000);
    });
  });

  check?.addEventListener('change', () => {
    finishBtn.disabled = !check.checked;
    if (check.checked) {
      finishBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
      finishBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
  });

  backBtn?.addEventListener('click', () => {
    currentViewMode = 'standard';
    renderDynamicAuthStage(ctx);
  });

  finishBtn?.addEventListener('click', async () => {
    if (!check.checked) return;

    finishBtn.disabled = true;
    finishBtn.innerHTML = `<span>Encrypting workspace...</span>`;

    try {
      // Also store legacy SHA-256 hash for local backward compatibility
      const legacyHash = await hashPassword(tempCreatedPasscode);
      await storeHash(legacyHash);

      if (currentUser) {
        // Migrate/initialize cloud workspace
        await migrateLocalWorkspaceToCloud(currentUser, tempCreatedPasscode, tempGeneratedRecoveryCode);
      } else {
        // Initialize local-only envelope
        const { dek } = await createWorkspaceEnvelope(tempCreatedPasscode, tempGeneratedRecoveryCode);
        setActiveWorkspaceDEK(dek);
      }

      showToast('Workspace initialized and encrypted successfully.', 'success');

      // Clear volatile temps
      tempCreatedPasscode = null;
      tempGeneratedRecoveryCode = null;
      currentViewMode = 'standard';

      if (typeof pendingAuthSuccessCallback === 'function') {
        const cb = pendingAuthSuccessCallback;
        pendingAuthSuccessCallback = null;
        cb();
      } else {
        navigate('/tracker');
      }
    } catch (err) {
      console.error('Initialization error:', err);
      let userMsg = err.message || 'Unknown error';
      if (userMsg.includes('Missing or insufficient permissions') || userMsg.includes('permission-denied')) {
        userMsg = 'Firestore permission denied. Please publish firestore.rules in Firebase Console → Firestore Database → Rules.';
      }
      showToast('Failed to initialize workspace: ' + userMsg, 'error');
      const createAlert = document.getElementById('authCreateAlert');
      if (createAlert) {
        createAlert.textContent = userMsg;
        createAlert.classList.remove('hidden');
      }
      finishBtn.disabled = false;
      finishBtn.innerHTML = `<span>Initialize Workspace</span> <span>→</span>`;
    }
  });
}

/**
 * RECOVERY UNLOCK VIEW (Using Emergency Recovery Code)
 */
function renderRecoveryInputView(container, ctx) {
  const { cloudWorkspace, localEnvelope, currentUser } = ctx;
  const envelope = cloudWorkspace || localEnvelope;

  container.innerHTML = `
    <div class="space-y-4 animate-fade-in text-left">
      <div>
        <h2 class="sanchoy-auth-card-title">Emergency Workspace Recovery</h2>
        <p class="sanchoy-auth-card-sub">
          Enter your 20-character Recovery Code to restore access and configure a new Private Passcode.
        </p>
      </div>

      <div id="authRecoveryAlert" class="sanchoy-auth-alert hidden" role="alert"></div>

      <form id="authRecoveryForm" onsubmit="return false;" class="space-y-3.5">
        <div class="sanchoy-auth-field">
          <label class="sanchoy-auth-label" for="recoveryCodeInput">Recovery Code</label>
          <input
            id="recoveryCodeInput"
            type="text"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            class="sanchoy-auth-input font-mono uppercase tracking-widest text-center"
            required
            autofocus
          />
        </div>

        <div class="sanchoy-auth-field">
          <label class="sanchoy-auth-label" for="recoveryNewPasscodeInput">New Private Passcode</label>
          <input
            id="recoveryNewPasscodeInput"
            type="password"
            placeholder="At least 6 characters"
            class="sanchoy-auth-input"
            required
          />
        </div>

        <div class="pt-2 flex gap-3">
          <button id="cancelRecoveryBtn" type="button" class="sanchoy-btn sanchoy-btn-secondary flex-1 py-3 text-xs">
            Cancel
          </button>
          <button id="submitRecoveryBtn" type="submit" class="sanchoy-auth-submit flex-[2]">
            <span>Recover & Unlock</span>
            <span>→</span>
          </button>
        </div>
      </form>
    </div>
  `;

  const recInput = document.getElementById('recoveryCodeInput');
  const newPassInput = document.getElementById('recoveryNewPasscodeInput');
  const submitBtn = document.getElementById('submitRecoveryBtn');
  const cancelBtn = document.getElementById('cancelRecoveryBtn');
  const alertBox = document.getElementById('authRecoveryAlert');

  cancelBtn?.addEventListener('click', () => {
    currentViewMode = 'standard';
    renderDynamicAuthStage(ctx);
  });

  submitBtn?.addEventListener('click', async () => {
    const rawCode = recInput.value.trim();
    const newPass = newPassInput.value.trim();

    if (!rawCode || rawCode.length < 16) {
      if (alertBox) {
        alertBox.textContent = 'Please enter your complete 20-character recovery code.';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    if (!newPass || newPass.length < 6) {
      if (alertBox) {
        alertBox.textContent = 'New passcode must be at least 6 characters.';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Recovering workspace key...</span>`;

    try {
      if (!envelope) throw new Error('No workspace envelope found to recover.');

      // 1. Unwrap DEK using recovery code
      const dek = await unlockDEKWithRecoveryCode(envelope, rawCode);

      // 2. Generate new Recovery Code for immediate rotation
      const newRecoveryCode = generateRecoveryCode();

      // 3. Re-wrap DEK under new passcode
      const { wrapKeyWithPasscode } = await import('../security/key-derivation.js');
      const newPwWrapped = await wrapKeyWithPasscode(dek, newPass);

      // 4. Re-wrap DEK under new recovery code
      const { wrapKeyWithRecoveryCode } = await import('../security/recovery.js');
      const newRecWrapped = await wrapKeyWithRecoveryCode(dek, newRecoveryCode);

      const updatedEnvelope = {
        ...envelope,
        passcodeWrappedKey: newPwWrapped.wrappedKey,
        passcodeSalt: newPwWrapped.salt,
        passcodeWrapIv: newPwWrapped.iv,
        recoveryWrappedKey: newRecWrapped.wrappedKey,
        recoverySalt: newRecWrapped.salt,
        recoveryWrapIv: newRecWrapped.iv,
        updatedAt: new Date().toISOString()
      };

      await saveLocalEnvelope(updatedEnvelope);

      // Also update cloud if authenticated
      if (currentUser) {
        const { saveEncryptedWorkspace } = await import('../firebase/firestore.js');
        await saveEncryptedWorkspace(currentUser.uid, updatedEnvelope);
      }

      // Update legacy hash
      const legacyHash = await hashPassword(newPass);
      await storeHash(legacyHash);

      setActiveWorkspaceDEK(dek);

      // Present new recovery code to user
      tempGeneratedRecoveryCode = newRecoveryCode;
      currentViewMode = 'show_recovery_code';
      showToast('Workspace recovered successfully. Save your new Recovery Code.', 'success');
      renderDynamicAuthStage(ctx);
    } catch (err) {
      console.error('Recovery failed:', err);
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Recover & Unlock</span> <span>→</span>`;
      if (alertBox) {
        alertBox.textContent = 'Recovery failed: ' + (err.message || 'Invalid recovery code.');
        alertBox.classList.remove('hidden');
      }
    }
  });
}
