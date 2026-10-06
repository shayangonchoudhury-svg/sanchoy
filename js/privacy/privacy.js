// Privacy Masking & Visual Shield Engine
import { state } from '../core/state.js';
import { lockSession, getStoredHash, openCreatePasswordModal, openUnlockModal } from '../auth/auth.js';
import { lockWorkspaceMemory } from '../security/secure-session.js';
import { showToast } from '../ui/toast.js';

export function renderPrivacyToggle() {
  const iconContainer = document.getElementById('privacyIcon');
  if (!iconContainer) return;

  if (state.sessionUnlocked) {
    iconContainer.innerHTML = `
      <svg class="w-5 h-5 text-indigo-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    `;
    iconContainer.parentElement.title = "Lock balances (Enable Privacy)";
  } else {
    iconContainer.innerHTML = `
      <svg class="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
      </svg>
    `;
    iconContainer.parentElement.title = "Unlock balances (Disable Privacy)";
  }
}

export function initPrivacyControls() {
  const toggleBtn = document.getElementById('togglePrivacyBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      if (state.sessionUnlocked) {
        lockSession();
      } else {
        const stored = await getStoredHash();
        if (!stored) {
          openCreatePasswordModal();
        } else {
          openUnlockModal();
        }
      }
    });
  }

  const hideEverythingBtn = document.getElementById('hideEverythingBtn');
  if (hideEverythingBtn) {
    hideEverythingBtn.addEventListener('click', () => {
      lockWorkspaceMemory();
      lockSession();
      showToast('Application securely locked and privacy shield activated!', 'info');
    });
  }
}
