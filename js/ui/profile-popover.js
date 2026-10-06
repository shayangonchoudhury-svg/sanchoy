// Sanchoy Profile Popover & Quick Menu Controller
// Elegant popover presenting Profile info, Dual-Layer Security status, Google Account, and Lock/Sign-Out actions
import { state } from '../core/state.js';
import { getStoredHash, lockSession, openCreatePasswordModal, openUnlockModal, openChangePasswordModal } from '../auth/auth.js';
import { openSettingsModal } from './settings-modal.js';
import { showToast } from './toast.js';
import { navigate } from './ui.js';
import { getCurrentFirebaseUser, signOutUser } from '../firebase/auth.js';
import { getSecurityState, lockWorkspaceMemory, getActiveWorkspaceDEK } from '../security/secure-session.js';
import { getSyncStatus, syncWorkspaceToCloud } from '../firebase/sync.js';
import { getIcon } from './icons.js';

let popoverEl = null;

export function initProfileMenu() {
  const profileBtn = document.getElementById('profileBtn');
  if (!profileBtn) return;

  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProfilePopover(profileBtn);
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (popoverEl && !popoverEl.contains(e.target) && e.target !== profileBtn && !profileBtn.contains(e.target)) {
      closeProfilePopover();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popoverEl) {
      closeProfilePopover();
    }
  });
}

export async function toggleProfilePopover(anchorEl) {
  if (popoverEl) {
    closeProfilePopover();
    return;
  }

  const storedHash = await getStoredHash();
  const isPasscodeSet = !!storedHash;
  const isUnlocked = state.sessionUnlocked;
  const currentUser = getCurrentFirebaseUser();
  const syncInfo = getSyncStatus();

  popoverEl = document.createElement('div');
  popoverEl.id = 'sanchoyProfilePopover';
  popoverEl.className = 'absolute right-4 top-16 z-50 w-80 sanchoy-card p-4 shadow-modal border border-[var(--border)] rounded-2xl animate-fade-in text-left space-y-3';

  popoverEl.innerHTML = `
    <!-- User / Workspace Info -->
    <div class="flex items-center gap-3 pb-3 border-b border-[var(--border-subtle)]">
      <div class="w-10 h-10 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--accent)] flex items-center justify-center font-serif text-lg font-bold shrink-0">
        ${currentUser && currentUser.photoURL ? `<img src="${currentUser.photoURL}" class="w-full h-full rounded-xl object-cover" alt="User Avatar"/>` : 'S'}
      </div>
      <div class="min-w-0 flex-1">
        <h4 class="font-bold text-xs text-[var(--text-primary)] font-serif-editorial truncate">
          ${currentUser ? (currentUser.displayName || currentUser.email) : 'Local Workspace'}
        </h4>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="w-1.5 h-1.5 rounded-full ${isUnlocked ? 'bg-[var(--income)]' : 'bg-[var(--warning)]'}"></span>
          <span class="text-[10px] text-[var(--text-muted)] font-mono">${isUnlocked ? 'DEK Decrypted (Active)' : 'Masked / Encrypted'}</span>
        </div>
      </div>
    </div>

    <!-- Dual-Layer Security & Sync Status -->
    <div class="space-y-1.5">
      <div class="p-2 rounded-xl sanchoy-surface-inset flex items-center justify-between text-[11px]">
        <span class="text-[var(--text-secondary)] font-medium">Google Identity</span>
        <span class="font-bold font-mono ${currentUser ? 'text-[var(--income)]' : 'text-[var(--text-muted)]'}">
          ${currentUser ? 'Authenticated ✓' : 'Local Only'}
        </span>
      </div>

      <div class="p-2 rounded-xl sanchoy-surface-inset flex items-center justify-between text-[11px]">
        <span class="text-[var(--text-secondary)] font-medium">Cloud Sync</span>
        <span class="font-bold font-mono text-[var(--accent)] flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full ${syncInfo.status === 'SYNCING' ? 'bg-[var(--accent)] animate-ping' : syncInfo.status === 'CONFLICT' ? 'bg-[var(--danger)]' : syncInfo.status === 'OFFLINE' ? 'bg-[var(--warning)]' : 'bg-[var(--income)]'}"></span>
          <span>${syncInfo.status}</span>
          ${syncInfo.pendingMutationCount > 0 ? `<span class="text-[9px] px-1 rounded bg-[var(--surface-raised)]">(${syncInfo.pendingMutationCount})</span>` : ''}
        </span>
      </div>

      ${syncInfo.lastSyncedAt ? `
        <div class="p-1.5 px-2 rounded-xl sanchoy-surface-inset flex items-center justify-between text-[9px] font-mono text-[var(--text-muted)]">
          <span>Last Synced</span>
          <span>${new Date(syncInfo.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ` : ''}

      ${syncInfo.deviceId ? `
        <div class="p-1.5 px-2 rounded-xl sanchoy-surface-inset flex items-center justify-between text-[9px] font-mono text-[var(--text-muted)]">
          <span>Device ID</span>
          <span class="truncate max-w-[120px]">${syncInfo.deviceId.slice(0, 12)}…</span>
        </div>
      ` : ''}
    </div>

    <!-- Quick Actions Menu -->
    <div class="space-y-1 pt-1 text-xs">
      <button id="profileMenuSyncCenterBtn" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[var(--accent)] hover:bg-[var(--surface-raised)] transition-all font-semibold cursor-pointer">
        ${getIcon('sync', { size: 'w-4 h-4', className: 'text-[var(--accent)] shrink-0' })}
        <span>Open Sync Center</span>
      </button>

      <button id="profileMenuSettingsBtn" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] transition-all cursor-pointer">
        ${getIcon('settings', { size: 'w-4 h-4', className: 'text-[var(--text-secondary)] shrink-0' })}
        <span class="font-semibold">System Settings</span>
      </button>

      <button id="profileMenuSecurityBtn" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] transition-all cursor-pointer">
        ${getIcon('key', { size: 'w-4 h-4', className: 'text-[var(--text-secondary)] shrink-0' })}
        <span class="font-semibold">Change Private Passcode</span>
      </button>

      <button id="profileMenuSyncNowBtn" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] transition-all cursor-pointer">
        ${getIcon('sync', { size: 'w-4 h-4', className: 'text-[var(--text-secondary)] shrink-0' })}
        <span class="font-semibold">Sync Workspace to Cloud</span>
      </button>

      <div class="pt-1.5 border-t border-[var(--border-subtle)] space-y-1">
        ${isUnlocked ? `
          <button id="profileMenuLockBtn" class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[var(--danger)] hover:bg-[var(--expense-bg)] transition-all font-bold cursor-pointer">
            <span class="flex items-center gap-2">
              ${getIcon('lock', { size: 'w-4 h-4' })}
              <span>Lock Workspace</span>
            </span>
            <span class="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded sanchoy-surface-inset">Clear Keys</span>
          </button>
        ` : `
          <button id="profileMenuUnlockBtn" class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all font-bold cursor-pointer">
            <span class="flex items-center gap-2">
              ${getIcon('unlock', { size: 'w-4 h-4' })}
              <span>Unlock Workspace</span>
            </span>
            <span class="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded sanchoy-surface-inset">Enter Passcode</span>
          </button>
        `}

        ${currentUser ? `
          <button id="profileMenuSignOutBtn" class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--expense-bg)] transition-all text-[11px] font-semibold cursor-pointer">
            <span class="flex items-center gap-2">
              ${getIcon('logout', { size: 'w-4 h-4' })}
              <span>Sign Out of Google</span>
            </span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(popoverEl);

  // Position popover relative to anchor
  const rect = anchorEl.getBoundingClientRect();
  popoverEl.style.position = 'fixed';
  popoverEl.style.top = `${rect.bottom + 8}px`;
  popoverEl.style.right = `${window.innerWidth - rect.right}px`;

  // Bind Actions
  document.getElementById('profileMenuSyncCenterBtn')?.addEventListener('click', () => {
    closeProfilePopover();
    navigate('/sync');
  });

  document.getElementById('profileMenuSettingsBtn').addEventListener('click', () => {
    closeProfilePopover();
    openSettingsModal();
  });

  document.getElementById('profileMenuSecurityBtn').addEventListener('click', async () => {
    closeProfilePopover();
    openChangePasswordModal();
  });

  document.getElementById('profileMenuSyncNowBtn')?.addEventListener('click', async () => {
    closeProfilePopover();
    showToast('Initiating cloud sync...', 'info');
    await syncWorkspaceToCloud('manual');
    showToast('Cloud sync completed', 'success');
  });

  document.getElementById('profileMenuLockBtn')?.addEventListener('click', () => {
    closeProfilePopover();
    lockWorkspaceMemory();
    lockSession();
    showToast('Workspace locked. Encryption key cleared from memory.', 'info');
    navigate('/auth');
  });

  document.getElementById('profileMenuUnlockBtn')?.addEventListener('click', () => {
    closeProfilePopover();
    navigate('/auth');
  });

  document.getElementById('profileMenuSignOutBtn')?.addEventListener('click', async () => {
    closeProfilePopover();
    await signOutUser();
    showToast('Signed out of Google account', 'info');
    navigate('/auth');
  });
}

export function closeProfilePopover() {
  if (popoverEl && popoverEl.parentNode) {
    popoverEl.parentNode.removeChild(popoverEl);
  }
  popoverEl = null;
}
