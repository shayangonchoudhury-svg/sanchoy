// Sanchoy Sync Center Controller (Phase 6A)
// Dedicated view providing transparent, read-only visualization of:
// - Synchronization Status (SYNCED, SYNCING, OFFLINE, CONFLICT, ERROR)
// - Pending offline mutations count
// - Conflict warnings (read-only; resolution is reserved for future phases)
// - Safe session activity history
// - Anonymous Device Information (truncated device ID, client platform)
// - Safe Manual Sync action

import { getSyncStatus, syncWorkspaceToCloud, getSyncActivityLog, SyncStatus } from '../firebase/sync.js';
import { getActiveUser, getActiveWorkspaceDEK, getSecurityState, SecurityState } from '../security/secure-session.js';
import { events } from '../core/events.js';
import { navigate } from './ui.js';
import { openModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { getIcon } from './icons.js';

let isInitialized = false;

/**
 * Renders the entire Sync Center view inside #page-sync container
 */
export function renderSyncCenter() {
  const container = document.getElementById('page-sync');
  if (!container) return;

  const syncInfo = getSyncStatus();
  const user = getActiveUser();
  const dek = getActiveWorkspaceDEK();
  const secState = getSecurityState();
  const isLocked = secState === SecurityState.AUTHENTICATED_LOCKED || !dek;
  const isSignedOut = secState === SecurityState.SIGNED_OUT || !user;

  // Determine browser & OS platform safely without intrusive fingerprinting
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browserName = 'Browser';
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browserName = 'Chrome';
  else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browserName = 'Safari';
  else if (userAgent.includes('Firefox')) browserName = 'Firefox';
  else if (userAgent.includes('Edg')) browserName = 'Edge';

  let osName = 'Desktop / Mobile';
  if (userAgent.includes('Win')) osName = 'Windows';
  else if (userAgent.includes('Mac')) osName = 'macOS';
  else if (userAgent.includes('Linux')) osName = 'Linux';
  else if (userAgent.includes('Android')) osName = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) osName = 'iOS';

  const truncatedDevId = syncInfo.deviceId ? `${syncInfo.deviceId.slice(0, 12)}…` : 'dev_unknown';

  // Format last synced timestamp
  let lastSyncFormatted = 'Not yet synchronized';
  if (syncInfo.lastSyncedAt) {
    try {
      const d = new Date(syncInfo.lastSyncedAt);
      lastSyncFormatted = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (e) {}
  }

  // Activity list
  const activityList = getSyncActivityLog();

  container.innerHTML = `
    <div class="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-12 space-y-6">
      
      <!-- Top Navigation & Title Bar -->
      <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-bold tracking-widest uppercase text-[var(--accent)] font-mono">Cloud Synchronization</span>
            <span class="text-[10px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded sanchoy-surface-inset text-[var(--accent)] font-mono">Encrypted Layer</span>
          </div>
          <h1 class="text-2xl sm:text-3xl font-extrabold font-serif-editorial tracking-tight text-[var(--text-primary)] mt-0.5">Sync Center</h1>
          <p class="text-xs text-[var(--text-muted)] mt-0.5">Multi-device state, offline queues, and encrypted replication</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="syncCenterBackBtn" class="sanchoy-btn sanchoy-btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5" aria-label="Back to Command Center">
            <span>←</span> <span>Command Center</span>
          </button>
        </div>
      </div>

      <!-- Security / State Notice if Locked or Signed Out -->
      ${isSignedOut ? `
        <div class="p-4 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-start gap-3.5 text-xs text-[var(--text-secondary)]">
          <div class="p-2 rounded-xl bg-[var(--surface-inset)] text-[var(--text-muted)] shrink-0">
            ${getIcon('logout', { size: 'w-5 h-5' })}
          </div>
          <div>
            <h4 class="font-bold text-[var(--text-primary)]">Signed Out of Google Identity</h4>
            <p class="mt-0.5">Sanchoy is operating in local-only mode. Sign in to your Google Account and enter your Private Passcode to synchronize across devices.</p>
            <button id="syncCenterSignInBtn" class="sanchoy-btn sanchoy-btn-primary text-xs mt-3 py-1.5 px-3">Sign In with Google</button>
          </div>
        </div>
      ` : isLocked ? `
        <div class="p-4 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-start gap-3.5 text-xs text-[var(--text-secondary)]">
          <div class="p-2 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] shrink-0">
            ${getIcon('lock', { size: 'w-5 h-5' })}
          </div>
          <div>
            <h4 class="font-bold text-[var(--text-primary)]">Workspace Locked</h4>
            <p class="mt-0.5">Financial encryption keys are cleared from active application context. Cloud synchronization will continue automatically once you unlock your workspace with your Private Passcode.</p>
            <button id="syncCenterUnlockBtn" class="sanchoy-btn sanchoy-btn-primary text-xs mt-3 py-1.5 px-3">Unlock Workspace</button>
          </div>
        </div>
      ` : ''}

      <!-- Main Overview Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        <!-- Card 1: Current Status -->
        <div class="sanchoy-card p-5 space-y-3 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="sanchoy-section-tag">Status</span>
              <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded sanchoy-surface-inset text-[var(--text-muted)]">Live</span>
            </div>
            <div class="mt-2 flex items-center gap-2">
              ${renderStatusPill(syncInfo.status)}
            </div>
            <p class="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
              ${getStatusDescription(syncInfo.status, syncInfo.pendingMutationCount)}
            </p>
          </div>
          <div class="pt-3 border-t border-[var(--border-subtle)] text-[11px] space-y-1">
            <div class="flex justify-between text-[var(--text-muted)]">
              <span>Last Synchronized</span>
              <span class="font-mono text-[var(--text-primary)] font-medium">${lastSyncFormatted}</span>
            </div>
          </div>
        </div>

        <!-- Card 2: Pending Changes -->
        <div class="sanchoy-card p-5 space-y-3 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="sanchoy-section-tag">Local Queue</span>
              <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded sanchoy-surface-inset text-[var(--text-muted)]">IndexedDB</span>
            </div>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="text-3xl font-extrabold font-mono text-[var(--text-primary)]">${syncInfo.pendingMutationCount}</span>
              <span class="text-xs text-[var(--text-muted)]">mutations waiting</span>
            </div>
            <p class="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
              ${syncInfo.pendingMutationCount === 0 
                ? 'All local changes have been synchronized with the encrypted cloud.' 
                : 'Safely preserved on this device. Replaying to cloud automatically.'}
            </p>
          </div>
          <div class="pt-3 border-t border-[var(--border-subtle)] text-[11px]">
            <div class="flex justify-between text-[var(--text-muted)]">
              <span>Queue Durability</span>
              <span class="font-mono text-[var(--income)] font-semibold">Persistent ✓</span>
            </div>
          </div>
        </div>

        <!-- Card 3: Conflicts -->
        <div class="sanchoy-card p-5 space-y-3 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="sanchoy-section-tag">Integrity</span>
              <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded sanchoy-surface-inset ${syncInfo.hasConflict ? 'text-[var(--danger)]' : 'text-[var(--income)]'}">
                ${syncInfo.hasConflict ? 'Alert' : 'Nominal'}
              </span>
            </div>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="text-3xl font-extrabold font-mono ${syncInfo.hasConflict ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'}">
                ${syncInfo.conflicts.length}
              </span>
              <span class="text-xs text-[var(--text-muted)]">conflicts detected</span>
            </div>
            <p class="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
              ${syncInfo.hasConflict 
                ? 'Changes from another device need your attention. Both versions are safely preserved.' 
                : 'No conflicts require your attention. Workspace ledger is unified.'}
            </p>
          </div>
          <div class="pt-3 border-t border-[var(--border-subtle)]">
            ${syncInfo.hasConflict ? `
              <button id="syncCenterReviewConflictsBtn" class="sanchoy-btn sanchoy-btn-secondary text-[11px] py-1.5 w-full text-[var(--danger)] font-bold">
                Review Conflicts
              </button>
            ` : `
              <span class="text-[11px] text-[var(--text-muted)]">Zero data loss detected</span>
            `}
          </div>
        </div>

      </div>

      <!-- Sync Actions Toolbar -->
      <div class="sanchoy-card p-4 sm:p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div class="space-y-0.5">
          <h3 class="font-bold text-xs text-[var(--text-primary)] font-serif-editorial">Manual Synchronization</h3>
          <p class="text-[11px] text-[var(--text-muted)]">Flush pending local mutations to the encrypted cloud workspace on demand.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="syncCenterSyncNowBtn" class="sanchoy-btn sanchoy-btn-primary text-xs py-2 px-4 flex items-center gap-2" ${syncInfo.status === SyncStatus.SYNCING || isLocked || isSignedOut ? 'disabled' : ''}>
            <span id="syncCenterBtnIcon" class="flex items-center justify-center ${syncInfo.status === SyncStatus.SYNCING ? 'animate-spin' : ''}">
              ${getIcon('sync', { size: 'w-4 h-4' })}
            </span>
            <span>${syncInfo.status === SyncStatus.SYNCING ? 'Syncing Workspace…' : 'Sync Now'}</span>
          </button>
        </div>
      </div>

      <!-- Device Information Section -->
      <div class="sanchoy-card p-5 sm:p-6 space-y-4">
        <div class="pb-3 border-b border-[var(--border-subtle)]">
          <span class="sanchoy-section-tag">Origin</span>
          <h2 class="sanchoy-section-title text-base">Current Device Identity</h2>
          <p class="text-xs text-[var(--text-muted)] mt-0.5">Anonymous cryptographic identifier used to distinguish sync sources without personal fingerprinting.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-1">
            <span class="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider block">Browser</span>
            <span class="text-xs font-mono font-bold text-[var(--text-primary)]">${browserName}</span>
          </div>
          <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-1">
            <span class="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider block">Operating System</span>
            <span class="text-xs font-mono font-bold text-[var(--text-primary)]">${osName}</span>
          </div>
          <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-1">
            <span class="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider block">Anonymous Device ID</span>
            <span class="text-xs font-mono font-bold text-[var(--accent)]" title="Cryptographic device ID">${truncatedDevId}</span>
          </div>
        </div>
      </div>

      <!-- Recent Synchronization Activity Log -->
      <div class="sanchoy-card p-5 sm:p-6 space-y-4">
        <div class="flex justify-between items-center pb-3 border-b border-[var(--border-subtle)]">
          <div>
            <span class="sanchoy-section-tag">Audit</span>
            <h2 class="sanchoy-section-title text-base">Recent Synchronization Activity</h2>
          </div>
          <span class="text-[10px] font-mono text-[var(--text-muted)]">Session Log</span>
        </div>

        <div class="space-y-2">
          ${activityList.length === 0 ? `
            <div class="text-xs text-[var(--text-muted)] py-6 text-center font-mono sanchoy-surface-inset rounded-xl">
              No synchronization activity recorded yet during this session.
            </div>
          ` : `
            <div class="divide-y divide-[var(--border-subtle)] sanchoy-surface-inset rounded-xl overflow-hidden">
              ${activityList.map(act => {
                const timeStr = new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const icon = getActivityIcon(act.type);
                return `
                  <div class="p-3 flex items-center justify-between gap-3 text-xs">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <span class="text-sm shrink-0" aria-hidden="true">${icon}</span>
                      <span class="font-medium text-[var(--text-primary)] truncate">${act.message}</span>
                    </div>
                    <span class="font-mono text-[10px] text-[var(--text-muted)] shrink-0">${timeStr}</span>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>

    </div>
  `;

  attachSyncCenterListeners(container);
}

function attachSyncCenterListeners(container) {
  // Back to Command Center
  container.querySelector('#syncCenterBackBtn')?.addEventListener('click', () => {
    navigate('/tracker');
  });

  // Manual Sync Now button
  container.querySelector('#syncCenterSyncNowBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#syncCenterSyncNowBtn');
    const icon = container.querySelector('#syncCenterBtnIcon');
    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('animate-spin');

    showToast('Synchronizing workspace with encrypted cloud…', 'info');
    try {
      await syncWorkspaceToCloud('sync_center_click');
      showToast('Synchronization complete', 'success');
    } catch (err) {
      showToast('Synchronization deferred: offline or network issue', 'warning');
    } finally {
      renderSyncCenter();
    }
  });

  // Review Conflicts button (Wired to interactive Conflict Resolution in Phase 6B)
  container.querySelector('#syncCenterReviewConflictsBtn')?.addEventListener('click', async () => {
    try {
      const { openConflictListModal } = await import('./conflict-resolution.js');
      openConflictListModal();
    } catch (e) {
      console.error('Failed to open conflict resolution:', e);
    }
  });

  // Locked notice unlock button
  container.querySelector('#syncCenterUnlockBtn')?.addEventListener('click', () => {
    navigate('/auth');
  });

  // Signed out notice sign-in button
  container.querySelector('#syncCenterSignInBtn')?.addEventListener('click', () => {
    navigate('/auth');
  });
}

function renderStatusPill(status) {
  if (status === SyncStatus.SYNCING) {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sanchoy-surface-inset text-xs font-bold font-mono text-[var(--accent)]"><span class="w-2 h-2 rounded-full bg-[var(--accent)] animate-ping"></span>↻ Syncing…</span>`;
  }
  if (status === SyncStatus.OFFLINE) {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sanchoy-surface-inset text-xs font-bold font-mono text-[var(--warning)]"><span class="w-2 h-2 rounded-full bg-[var(--warning)]"></span>○ Offline</span>`;
  }
  if (status === SyncStatus.CONFLICT) {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sanchoy-surface-inset text-xs font-bold font-mono text-[var(--danger)]"><span class="w-2 h-2 rounded-full bg-[var(--danger)]"></span>! Conflict</span>`;
  }
  if (status === SyncStatus.ERROR) {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sanchoy-surface-inset text-xs font-bold font-mono text-[var(--danger)]"><span class="w-2 h-2 rounded-full bg-[var(--danger)]"></span>× Sync Error</span>`;
  }
  if (status === SyncStatus.PENDING) {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sanchoy-surface-inset text-xs font-bold font-mono text-[var(--warning)]"><span class="w-2 h-2 rounded-full bg-[var(--warning)]"></span>○ Pending</span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full sanchoy-surface-inset text-xs font-bold font-mono text-[var(--income)]"><span class="w-2 h-2 rounded-full bg-[var(--income)]"></span>✓ Synced</span>`;
}

function getStatusDescription(status, pendingCount) {
  if (status === SyncStatus.SYNCING) {
    return 'Uploading encrypted mutations and verifying cloud workspace revision.';
  }
  if (status === SyncStatus.OFFLINE) {
    return pendingCount > 0 
      ? `Your changes are safely stored on this device and will synchronize when you're back online.`
      : `You are currently offline. Local bookkeeping remains fully functional.`;
  }
  if (status === SyncStatus.CONFLICT) {
    return 'Changes from another device need your attention. Both versions are safely preserved.';
  }
  if (status === SyncStatus.ERROR) {
    return 'Synchronization could not be completed. The engine will retry automatically.';
  }
  if (status === SyncStatus.PENDING) {
    return `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to upload to the encrypted cloud.`;
  }
  return 'All financial changes are synchronized with your encrypted cloud storage.';
}

function getActivityIcon(type) {
  switch (type) {
    case 'SYNCED': return getIcon('check', { size: 'w-3 h-3', className: 'text-[var(--income)]' });
    case 'SYNCING': return getIcon('sync', { size: 'w-3 h-3', className: 'text-[var(--accent)] animate-spin' });
    case 'OFFLINE': return getIcon('eyeOff', { size: 'w-3 h-3', className: 'text-[var(--warning)]' });
    case 'ONLINE': return getIcon('globe', { size: 'w-3 h-3', className: 'text-[var(--accent)]' });
    case 'CONFLICT': return getIcon('warning', { size: 'w-3 h-3', className: 'text-[var(--warning)]' });
    case 'ERROR': return getIcon('close', { size: 'w-3 h-3', className: 'text-[var(--danger)]' });
    default: return getIcon('note', { size: 'w-3 h-3', className: 'text-[var(--text-muted)]' });
  }
}

/**
 * Informational Modal for Conflict Review in Phase 6A
 * (As specified in Phase 6A requirements: does NOT implement resolution yet)
 */
function openConflictReviewModal() {
  const syncInfo = getSyncStatus();

  const modalHtml = `
    <div class="space-y-4 text-left">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <div class="p-1.5 rounded-lg bg-[var(--warning)]/15 text-[var(--warning)] shrink-0">
            ${getIcon('warning', { size: 'w-5 h-5' })}
          </div>
          <div>
            <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">Sync Conflict Notice</h3>
            <p class="text-[11px] text-[var(--text-muted)]">Preserved multi-device divergence</p>
          </div>
        </div>
        <button id="closeConflictModalBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close dialog">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="p-3.5 rounded-xl sanchoy-surface-inset space-y-2 text-xs">
        <p class="text-[var(--text-primary)] font-medium">
          A financial change was made on another device while this device was offline or editing simultaneously.
        </p>
        <p class="text-[var(--text-secondary)]">
          <strong>Zero Data Loss Guarantee:</strong> Both your local version and the remote cloud version are safely preserved in storage. No data has been erased or silently overwritten.
        </p>
      </div>

      ${syncInfo.conflicts && syncInfo.conflicts.length > 0 ? `
        <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
          <span class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Active Conflict Items</span>
          ${syncInfo.conflicts.map((c, i) => `
            <div class="p-2.5 rounded-xl sanchoy-surface-raised border border-[var(--border)] text-xs space-y-1">
              <div class="flex justify-between items-center">
                <span class="font-bold text-[var(--danger)]">Conflict #${i + 1}: ${c.type || 'Transaction Divergence'}</span>
                <span class="font-mono text-[10px] text-[var(--text-muted)]">${c.entityId ? c.entityId.slice(0, 10) : ''}</span>
              </div>
              <p class="text-[11px] text-[var(--text-secondary)]">${c.message || 'Concurrent edit detected'}</p>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="p-3 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
        Interactive conflict review and side-by-side reconciliation will be provided in the upcoming Conflict Resolution interface. Your local bookkeeping remains fully active.
      </div>

      <div class="pt-2 flex justify-end">
        <button id="dismissConflictModalBtn" class="sanchoy-btn sanchoy-btn-primary text-xs py-2 px-4">
          Understood
        </button>
      </div>
    </div>
  `;

  openModal(modalHtml, {
    maxWidth: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#closeConflictModalBtn')?.addEventListener('click', closeModal);
      modalEl.querySelector('#dismissConflictModalBtn')?.addEventListener('click', closeModal);
    }
  });
}

/**
 * Initializes listeners for Sync Center live updates
 */
export function initSyncCenter() {
  if (isInitialized) return;
  isInitialized = true;

  // Listen for sync status changes and re-render if Sync Center is currently visible
  events.on('sync:statusChange', () => {
    const page = document.getElementById('page-sync');
    if (page && page.classList.contains('visible')) {
      renderSyncCenter();
    }
  });
}
