// Sanchoy Conflict Resolution Presentation & Workflow Engine (Phase 6B)
// Responsibilities:
// - Read preserved multi-device conflict state from js/sync/conflict.js
// - Render Conflict List screen with human-friendly transaction info (zero raw IDs exposed)
// - Render Detailed Comparison Screen (Desktop 2-column, Mobile responsive stacked)
// - Highlight changed vs identical fields without relying on color alone
// - Support Keep Local, Keep Other Device, and Safe Merge (only if deterministic merge is safe)
// - Strictly prevent financial estimation / guessing / averaging
// - Apply resolution locally -> Trigger deterministic ledger recalculation -> Enqueue mutation -> Cloud sync
// - Handle failed cloud sync cleanly (preserves local resolution, informs user)
// - Handle locked session (masks financial info) and sign-out (closes UI)

import { getActiveConflicts, removeConflictItem } from '../sync/conflict.js';
import { getTxs, saveTxs, refreshAllViews } from '../transactions/transactions.js';
import { applyVaultConflictResolution } from '../vault/vault.js';
import { enqueueMutation, VAULT_MUTATION_TYPES } from '../sync/queue.js';
import { syncWorkspaceToCloud, getSyncStatus } from '../firebase/sync.js';
import { checkVaultSafeMerge, constructVaultSafeMerge } from '../sync/merge.js';
import { openModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { getIcon } from './icons.js';
import { escapeHtml, round } from '../utils/utils.js';
import { getSecurityState, SecurityState, getActiveWorkspaceDEK } from '../security/secure-session.js';
import { events } from '../core/events.js';

let isListeningToLock = false;

function ensureLockListener() {
  if (isListeningToLock) return;
  isListeningToLock = true;
  events.on('auth:lock', () => {
    // If a modal or conflict UI is showing financial data, close or mask it immediately
    closeModal();
  });
}

/**
 * Normalizes display attributes for transaction vs vault records
 */
export function getRecordDisplayProps(rec, isVault) {
  if (!rec) return null;
  if (isVault) {
    let walletFlow = 'Vault';
    if (rec.type === 'deposit') {
      walletFlow = `${rec.sourceWallet === 'cash' ? 'Cash' : 'Online'} → Vault`;
    } else if (rec.type === 'withdrawal') {
      walletFlow = `Vault → ${rec.destinationWallet === 'cash' ? 'Cash' : 'Online'}`;
    } else if (rec.type === 'spend') {
      walletFlow = 'Vault Spending';
    }
    const typeLabel = rec.type ? String(rec.type).toUpperCase() : 'RECORD';
    return {
      badge: `Vault ${typeLabel}`,
      amount: (rec.amount !== undefined && rec.amount !== null) ? `₹${round(rec.amount)}` : 'N/A',
      category: rec.category || 'Vault Savings',
      walletLabel: 'Flow',
      wallet: walletFlow,
      date: rec.date ? new Date(rec.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      desc: (rec.description || rec.notes || rec.desc || '').trim() || '(No note)'
    };
  }
  return {
    badge: rec.type === 'expense' ? 'Expense' : 'Income',
    amount: (rec.amount !== undefined && rec.amount !== null) ? `₹${round(rec.amount)}` : 'N/A',
    category: rec.category || 'Other',
    walletLabel: 'Wallet',
    wallet: rec.method || 'Online',
    date: rec.date ? new Date(rec.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
    desc: (rec.desc || '').trim() || '(No note)'
  };
}

/**
 * Checks whether the current session is safe to view financial conflict data
 */
function isSessionUnlocked() {
  const secState = getSecurityState();
  const dek = getActiveWorkspaceDEK();
  return secState === SecurityState.AUTHENTICATED_UNLOCKED && !!dek;
}

/**
 * Opens the main Conflict List modal/dialog from Sync Center
 */
export function openConflictListModal() {
  ensureLockListener();

  if (!isSessionUnlocked()) {
    openLockedNoticeModal();
    return;
  }

  const conflictRecords = getActiveConflicts();
  const record = conflictRecords && conflictRecords.length > 0 ? conflictRecords[0] : null;
  const conflicts = (record && record.conflicts) ? record.conflicts : [];

  if (conflicts.length === 0) {
    openNoConflictsModal();
    return;
  }

  const html = `
    <div class="space-y-4 text-left">
      <!-- Header -->
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            ${getIcon('scale', { size: 'w-4 h-4' })}
          </div>
          <div>
            <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">
              Conflicts Requiring Attention
            </h3>
            <p class="text-[11px] text-[var(--text-muted)]">
              ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} preserved safely across devices
            </p>
          </div>
        </div>
        <button id="closeConflictListBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close dialog">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Informational banner -->
      <div class="p-3 rounded-xl sanchoy-surface-inset text-xs text-[var(--text-secondary)] space-y-1">
        <p class="font-medium text-[var(--text-primary)]">
          Both versions of your financial records are safely preserved in storage.
        </p>
        <p class="text-[11px] text-[var(--text-muted)]">
          Select a conflict below to review differences and choose which version to keep.
        </p>
      </div>

      <!-- Conflicts List -->
      <div class="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1" role="list">
        ${conflicts.map((c, index) => {
          const isVault = c.entityType === 'vault' || String(c.type || '').startsWith('VAULT_');
          const tx = c.local || c.remote || {};
          const isExpense = String(tx.type || 'expense').toLowerCase() === 'expense';
          const isDeleteVsEdit = c.type === 'DELETION_EDIT_CONFLICT' || c.type === 'VAULT_DELETION_CONFLICT';
          const typeLabel = isDeleteVsEdit ? 'Delete vs Edit' : 'Edit vs Edit';
          const dateStr = tx.date ? new Date(tx.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date';
          const category = tx.category || (isVault ? 'Vault Savings' : 'Uncategorized');
          const desc = (tx.description || tx.desc || tx.notes || '').trim() || (isVault ? `Vault ${tx.type ? tx.type.toUpperCase() : 'Record'}` : (isExpense ? 'Expense' : 'Income'));
          const amount = (tx.amount !== undefined && tx.amount !== null) ? `₹${round(tx.amount)}` : 'Amount deleted';

          return `
            <div class="p-3.5 rounded-xl sanchoy-card border border-[var(--border-subtle)] hover:border-[var(--border)] transition-all flex flex-col sm:flex-row justify-between sm:items-center gap-3" role="listitem">
              <div class="space-y-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded sanchoy-surface-inset text-[var(--danger)] font-bold">
                    ${typeLabel}
                  </span>
                  ${isVault ? `
                    <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded sanchoy-surface-inset text-amber-500 font-bold">
                      Vault
                    </span>
                  ` : ''}
                  <span class="text-[10px] text-[var(--text-muted)] font-mono">${dateStr}</span>
                </div>
                <h4 class="font-bold text-xs text-[var(--text-primary)] truncate font-serif-editorial">
                  ${escapeHtml(desc)}
                </h4>
                <div class="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <span>${escapeHtml(category)}</span>
                  <span>·</span>
                  <span class="font-mono font-semibold text-[var(--text-primary)]">${amount}</span>
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <button data-resolve-id="${escapeHtml(c.entityId)}" class="sanchoy-btn sanchoy-btn-secondary text-xs py-1.5 px-3.5 font-bold cursor-pointer hover:border-[var(--accent)]" aria-label="Review conflict for ${escapeHtml(desc)}">
                  Review Difference
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="pt-2 flex justify-end border-t border-[var(--border-subtle)]">
        <button id="closeConflictListBottomBtn" class="sanchoy-btn sanchoy-btn-secondary text-xs py-2 px-4">
          Done
        </button>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#closeConflictListBtn')?.addEventListener('click', closeModal);
      modalEl.querySelector('#closeConflictListBottomBtn')?.addEventListener('click', closeModal);

      modalEl.querySelectorAll('button[data-resolve-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const entityId = btn.dataset.resolveId;
          openConflictDetailModal(entityId);
        });
      });
    }
  });
}

/**
 * Opens detailed side-by-side or stacked comparison for a single conflict
 */
export function openConflictDetailModal(entityId) {
  ensureLockListener();

  if (!isSessionUnlocked()) {
    openLockedNoticeModal();
    return;
  }

  const conflictRecords = getActiveConflicts();
  const record = conflictRecords && conflictRecords.length > 0 ? conflictRecords[0] : null;
  const conflict = (record && record.conflicts) ? record.conflicts.find(c => c.entityId === entityId) : null;

  if (!conflict) {
    showToast('Conflict not found or already resolved', 'info');
    openConflictListModal();
    return;
  }

  const isVault = conflict.entityType === 'vault' || String(conflict.type || '').startsWith('VAULT_');
  const isDeleteVsEdit = conflict.type === 'DELETION_EDIT_CONFLICT' || conflict.type === 'VAULT_DELETION_CONFLICT';
  const localTx = conflict.local;
  const remoteTx = conflict.remote;

  // Evaluate field differences
  const fieldDiffs = isVault
    ? evaluateVaultDifferences(localTx, remoteTx, isDeleteVsEdit)
    : evaluateTransactionDifferences(localTx, remoteTx, isDeleteVsEdit);

  // Check if safe merge is possible (Deterministic only: both non-null, amounts identical, types identical, wallets identical, dates identical)
  const isSafeMergeable = isVault
    ? checkVaultSafeMerge(localTx, remoteTx)
    : checkSafeMergeability(localTx, remoteTx, isDeleteVsEdit);
  const safeMergedTx = isSafeMergeable
    ? (isVault ? constructVaultSafeMerge(localTx, remoteTx) : constructSafeMerge(localTx, remoteTx))
    : null;

  const localProps = getRecordDisplayProps(localTx, isVault);
  const remoteProps = getRecordDisplayProps(remoteTx, isVault);
  const mergedProps = getRecordDisplayProps(safeMergedTx, isVault);

  const html = `
    <div class="space-y-5 text-left max-h-[80vh] overflow-y-auto pr-1">
      <!-- Title Bar -->
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <button id="conflictDetailBackBtn" class="sanchoy-btn-icon text-xs mr-1" title="Back to list" aria-label="Back to conflict list">
            ←
          </button>
          <div>
            <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">
              Resolve Conflict
            </h3>
            <p class="text-[11px] text-[var(--text-muted)]">
              ${isDeleteVsEdit ? 'Delete vs Edit Collision' : `${fieldDiffs.differCount} field${fieldDiffs.differCount === 1 ? '' : 's'} differ across devices`}
            </p>
          </div>
        </div>
        <button id="closeConflictDetailBtn" class="sanchoy-btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close dialog">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Informational Callout -->
      <div class="p-3 rounded-xl sanchoy-surface-inset text-xs text-[var(--text-secondary)] space-y-1">
        <p class="font-medium text-[var(--text-primary)]">
          ${isDeleteVsEdit 
            ? `This ${isVault ? 'Vault record' : 'transaction'} was deleted on one device and modified on another.` 
            : `This ${isVault ? 'Vault record' : 'transaction'} was modified with differing details on two devices.`}
        </p>
        <p class="text-[11px] text-[var(--text-muted)]">
          Choose which version to preserve. The financial ledger will recalculate deterministically upon resolution.
        </p>
      </div>

      <!-- ============================================== -->
      <!-- DESKTOP 2-COLUMN VIEW (hidden on small screen)  -->
      <!-- ============================================== -->
      <div class="hidden sm:grid grid-cols-2 gap-4">
        <!-- Local Panel -->
        <div class="sanchoy-card p-4 space-y-3 border border-[var(--border)] flex flex-col justify-between">
          <div class="space-y-3">
            <div class="flex justify-between items-center pb-2 border-b border-[var(--border-subtle)]">
              <span class="text-[10px] font-mono uppercase font-bold text-[var(--accent)] tracking-wider">This Device (Local)</span>
              ${localProps ? `<span class="text-[10px] font-mono text-[var(--text-muted)]">${escapeHtml(localProps.badge)}</span>` : '<span class="text-[10px] font-mono text-[var(--danger)]">Deleted</span>'}
            </div>

            ${localProps ? `
              <div class="space-y-2 text-xs">
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Amount</span>
                  <span class="font-bold font-mono text-base text-[var(--text-primary)]">${localProps.amount}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Category</span>
                  <span class="font-medium text-[var(--text-primary)]">${escapeHtml(localProps.category)}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">${escapeHtml(localProps.walletLabel)}</span>
                  <span class="font-medium text-[var(--text-primary)]">${escapeHtml(localProps.wallet)}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Date</span>
                  <span class="font-medium text-[var(--text-primary)] font-mono">${localProps.date}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Description / Note</span>
                  <span class="text-[var(--text-secondary)] italic">${escapeHtml(localProps.desc)}</span>
                </div>
              </div>
            ` : `
              <div class="py-10 text-center text-xs text-[var(--danger)] font-mono flex items-center justify-center gap-1.5">
                ${getIcon('trash', { size: 'w-4 h-4', className: 'text-[var(--danger)]' })}
                <span>${isVault ? 'Vault record' : 'Transaction'} deleted locally</span>
              </div>
            `}
          </div>

          <div class="pt-3 border-t border-[var(--border-subtle)]">
            <button id="chooseLocalBtn" class="sanchoy-btn sanchoy-btn-primary w-full text-xs py-2 font-bold cursor-pointer" aria-label="Keep this version">
              ${localTx ? 'Keep This Version' : 'Keep Deleted'}
            </button>
          </div>
        </div>

        <!-- Remote Panel -->
        <div class="sanchoy-card p-4 space-y-3 border border-[var(--border)] flex flex-col justify-between">
          <div class="space-y-3">
            <div class="flex justify-between items-center pb-2 border-b border-[var(--border-subtle)]">
              <span class="text-[10px] font-mono uppercase font-bold text-[var(--accent)] tracking-wider">Other Device (Cloud)</span>
              ${remoteProps ? `<span class="text-[10px] font-mono text-[var(--text-muted)]">${escapeHtml(remoteProps.badge)}</span>` : '<span class="text-[10px] font-mono text-[var(--danger)]">Deleted</span>'}
            </div>

            ${remoteProps ? `
              <div class="space-y-2 text-xs">
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Amount</span>
                  <span class="font-bold font-mono text-base text-[var(--text-primary)]">${remoteProps.amount}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Category</span>
                  <span class="font-medium text-[var(--text-primary)]">${escapeHtml(remoteProps.category)}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">${escapeHtml(remoteProps.walletLabel)}</span>
                  <span class="font-medium text-[var(--text-primary)]">${escapeHtml(remoteProps.wallet)}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Date</span>
                  <span class="font-medium text-[var(--text-primary)] font-mono">${remoteProps.date}</span>
                </div>
                <div>
                  <span class="text-[10px] text-[var(--text-muted)] uppercase block">Description / Note</span>
                  <span class="text-[var(--text-secondary)] italic">${escapeHtml(remoteProps.desc)}</span>
                </div>
              </div>
            ` : `
              <div class="py-10 text-center text-xs text-[var(--danger)] font-mono flex items-center justify-center gap-1.5">
                ${getIcon('trash', { size: 'w-4 h-4', className: 'text-[var(--danger)]' })}
                <span>${isVault ? 'Vault record' : 'Transaction'} deleted on other device</span>
              </div>
            `}
          </div>

          <div class="pt-3 border-t border-[var(--border-subtle)]">
            <button id="chooseRemoteBtn" class="sanchoy-btn sanchoy-btn-secondary w-full text-xs py-2 font-bold cursor-pointer" aria-label="Keep other version">
              ${remoteTx ? 'Keep Other Version' : 'Keep Deleted'}
            </button>
          </div>
        </div>
      </div>

      <!-- ============================================== -->
      <!-- MOBILE STACKED FIELD COMPARISON                -->
      <!-- ============================================== -->
      <div class="block sm:hidden space-y-3">
        ${fieldDiffs.fields.map(f => `
          <div class="p-3 rounded-xl sanchoy-surface-inset text-xs space-y-1.5 ${f.isDifferent ? 'border border-[var(--warning)]' : ''}">
            <div class="flex justify-between items-center">
              <span class="text-[10px] uppercase font-bold text-[var(--text-muted)]">${f.name}</span>
              <span class="text-[9px] font-mono px-1.5 py-0.2 rounded ${f.isDifferent ? 'bg-[var(--warning-bg)] text-[var(--warning)] font-bold' : 'text-[var(--text-muted)]'}">
                ${f.isDifferent ? 'Changed' : 'Same'}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--border-subtle)] text-[11px]">
              <div>
                <span class="text-[9px] text-[var(--text-muted)] block font-mono">This Device</span>
                <span class="font-medium text-[var(--text-primary)]">${escapeHtml(f.localVal)}</span>
              </div>
              <div>
                <span class="text-[9px] text-[var(--text-muted)] block font-mono">Other Device</span>
                <span class="font-medium text-[var(--text-primary)]">${escapeHtml(f.remoteVal)}</span>
              </div>
            </div>
          </div>
        `).join('')}

        <div class="grid grid-cols-2 gap-2 pt-2">
          <button id="chooseLocalMobileBtn" class="sanchoy-btn sanchoy-btn-primary text-xs py-2 font-bold cursor-pointer" aria-label="Keep this device version">
            ${localTx ? 'Keep Local' : 'Keep Deleted'}
          </button>
          <button id="chooseRemoteMobileBtn" class="sanchoy-btn sanchoy-btn-secondary text-xs py-2 font-bold cursor-pointer" aria-label="Keep other device version">
            ${remoteTx ? 'Keep Cloud' : 'Keep Deleted'}
          </button>
        </div>
      </div>

      <!-- ============================================== -->
      <!-- SAFE MERGE SECTION (CONDITIONAL)               -->
      <!-- ============================================== -->
      ${isSafeMergeable && safeMergedTx && mergedProps ? `
        <div class="p-4 rounded-2xl sanchoy-surface-raised border border-[var(--accent)] space-y-3 text-xs">
          <div class="flex justify-between items-center">
            <span class="font-bold text-[var(--accent)] flex items-center gap-1.5">
              ${getIcon('sparkles', { size: 'w-3.5 h-3.5', className: 'text-[var(--accent)]' })}
              <span>Safe Merge Available</span>
            </span>
            <span class="text-[10px] font-mono text-[var(--income)] font-bold">Deterministic</span>
          </div>
          <p class="text-[11px] text-[var(--text-secondary)]">
            Amounts and core financial fields match. Merging will preserve non-conflicting details without altering your wallet accounting.
          </p>
          <div class="p-2.5 rounded-xl sanchoy-surface-inset text-[11px] font-mono space-y-0.5">
            <div><span class="text-[var(--text-muted)]">Amount:</span> ${mergedProps.amount} (${mergedProps.wallet})</div>
            <div><span class="text-[var(--text-muted)]">Category:</span> ${escapeHtml(mergedProps.category)}</div>
            <div><span class="text-[var(--text-muted)]">Merged Note:</span> ${escapeHtml(mergedProps.desc)}</div>
          </div>
          <button id="chooseMergeBtn" class="sanchoy-btn sanchoy-btn-primary w-full text-xs py-2 font-bold cursor-pointer" aria-label="Apply safe merged version">
            Apply Merged Version
          </button>
        </div>
      ` : ''}

      <!-- Bottom Cancel -->
      <div class="pt-2 flex justify-between items-center border-t border-[var(--border-subtle)] text-xs">
        <span class="text-[10px] text-[var(--text-muted)]">No changes are made until confirmed.</span>
        <button id="cancelConflictDetailBtn" class="sanchoy-btn sanchoy-btn-ghost text-xs py-1.5 px-3">
          Cancel
        </button>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-2xl',
    onOpen: (modalEl) => {
      // Navigation
      modalEl.querySelector('#conflictDetailBackBtn')?.addEventListener('click', openConflictListModal);
      modalEl.querySelector('#closeConflictDetailBtn')?.addEventListener('click', closeModal);
      modalEl.querySelector('#cancelConflictDetailBtn')?.addEventListener('click', openConflictListModal);

      // Keep Local
      const handleKeepLocal = () => {
        confirmAndApplyResolution({
          entityId,
          type: 'KEEP_LOCAL',
          chosenTx: localTx,
          conflict,
          message: localTx 
            ? `The ${isVault ? 'Vault record' : 'transaction'} stored on this device will become the authoritative version.` 
            : `This ${isVault ? 'Vault record' : 'transaction'} will remain deleted from your ledger.`
        });
      };
      modalEl.querySelector('#chooseLocalBtn')?.addEventListener('click', handleKeepLocal);
      modalEl.querySelector('#chooseLocalMobileBtn')?.addEventListener('click', handleKeepLocal);

      // Keep Remote
      const handleKeepRemote = () => {
        confirmAndApplyResolution({
          entityId,
          type: 'KEEP_REMOTE',
          chosenTx: remoteTx,
          conflict,
          message: remoteTx 
            ? `The ${isVault ? 'Vault record' : 'transaction'} synchronized from your other device will become the authoritative version.` 
            : `This ${isVault ? 'Vault record' : 'transaction'} will be removed from your ledger.`
        });
      };
      modalEl.querySelector('#chooseRemoteBtn')?.addEventListener('click', handleKeepRemote);
      modalEl.querySelector('#chooseRemoteMobileBtn')?.addEventListener('click', handleKeepRemote);

      // Safe Merge
      modalEl.querySelector('#chooseMergeBtn')?.addEventListener('click', () => {
        confirmAndApplyResolution({
          entityId,
          type: 'SAFE_MERGE',
          chosenTx: safeMergedTx,
          conflict,
          message: `The merged ${isVault ? 'Vault record' : 'transaction'} will be applied to your ledger.`
        });
      });
    }
  });
}

/**
 * Confirmation step prior to applying resolution to ledger
 */
function confirmAndApplyResolution({ entityId, type, chosenTx, message, conflict = null }) {
  const confirmHtml = `
    <div class="space-y-4 text-left">
      <div class="flex items-center gap-2.5 pb-2 border-b border-[var(--border-subtle)]">
        <div class="p-1 rounded-lg bg-[var(--warning)]/15 text-[var(--warning)] shrink-0">
          ${getIcon('warning', { size: 'w-5 h-5' })}
        </div>
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">
          Confirm Resolution
        </h3>
      </div>

      <div class="p-3.5 rounded-xl sanchoy-surface-inset text-xs space-y-2">
        <p class="text-[var(--text-primary)] font-medium">${message}</p>
        <p class="text-[11px] text-[var(--text-muted)]">
          The financial engine will recalculate all affected wallet balances and recovery periods deterministically.
        </p>
      </div>

      <div class="pt-2 flex gap-2 justify-end">
        <button id="cancelConfirmBtn" class="sanchoy-btn sanchoy-btn-secondary text-xs py-2 px-3.5">
          Cancel
        </button>
        <button id="executeConfirmBtn" class="sanchoy-btn sanchoy-btn-primary text-xs py-2 px-4 font-bold">
          Confirm & Apply
        </button>
      </div>
    </div>
  `;

  openModal(confirmHtml, {
    maxWidth: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#cancelConfirmBtn')?.addEventListener('click', () => {
        openConflictDetailModal(entityId);
      });

      modalEl.querySelector('#executeConfirmBtn')?.addEventListener('click', async () => {
        const btn = modalEl.querySelector('#executeConfirmBtn');
        if (btn) btn.disabled = true;
        await executeResolution(entityId, chosenTx, conflict);
      });
    }
  });
}

/**
 * Executes the resolution:
 * 1. Modifies local transactions array via saveTxs or Vault records via applyVaultConflictResolution
 * 2. Enqueues the appropriate mutation in the offline queue (vault:update/vault:delete or RESOLVE_CONFLICT)
 * 3. Removes the resolved conflict item from active conflicts
 * 4. Triggers cloud synchronization
 * 5. Handles sync success vs offline/failure gracefully
 */
export async function executeResolution(entityId, resolvedTx, conflict = null) {
  try {
    const conflictRecords = getActiveConflicts();
    const record = conflictRecords && conflictRecords.length > 0 ? conflictRecords[0] : null;
    const activeConflict = (record && record.conflicts) ? record.conflicts.find(c => c.entityId === entityId) : null;
    const targetConflict = conflict || activeConflict;
    const isVault = targetConflict?.entityType === 'vault' || 
                    String(targetConflict?.type || '').startsWith('VAULT_');

    if (isVault) {
      // 1. Apply to Vault using applyVaultConflictResolution
      await applyVaultConflictResolution(entityId, resolvedTx);

      // 2. Enqueue mutation
      const mutType = resolvedTx ? VAULT_MUTATION_TYPES.UPDATE : VAULT_MUTATION_TYPES.DELETE;
      enqueueMutation(mutType, resolvedTx || { id: entityId }, entityId);

      // 3. Remove this conflict item from active storage
      removeConflictItem(entityId);

      // 4. Attempt cloud sync
      showToast('Applying resolution and synchronizing with encrypted cloud…', 'info');
      let syncSuccess = false;
      try {
        await syncWorkspaceToCloud('vault_conflict_resolved');
        syncSuccess = true;
      } catch (syncErr) {
        console.warn('[Conflict Resolution] Cloud sync deferred or offline:', syncErr);
      }

      // 5. Open Success / Status Modal (if in browser DOM)
      if (typeof document !== 'undefined' && document.body) {
        openResolutionResultModal({
          success: syncSuccess,
          resolvedTx,
          remainingCount: getActiveConflicts().reduce((acc, r) => acc + (r.conflicts ? r.conflicts.length : 0), 0)
        });
      }
      return { success: true, isVault: true, syncSuccess };
    }

    const txs = getTxs();
    const existingIndex = txs.findIndex(t => t.id === entityId);

    if (resolvedTx) {
      if (existingIndex >= 0) {
        txs[existingIndex] = resolvedTx;
      } else {
        txs.push(resolvedTx);
      }
    } else {
      // Deletion resolved: remove from array
      if (existingIndex >= 0) {
        txs.splice(existingIndex, 1);
      }
    }

    // 1. Update local storage & trigger full deterministic financial engine recalculation
    saveTxs(txs);
    refreshAllViews();

    // 2. Enqueue mutation
    enqueueMutation('RESOLVE_CONFLICT', {
      entityId,
      resolvedTx: resolvedTx || null
    });

    // 3. Remove this conflict item from active storage
    removeConflictItem(entityId);

    // 4. Attempt cloud sync
    showToast('Applying resolution and synchronizing with encrypted cloud…', 'info');
    let syncSuccess = false;
    try {
      await syncWorkspaceToCloud('conflict_resolved');
      syncSuccess = true;
    } catch (syncErr) {
      console.warn('[Conflict Resolution] Cloud sync deferred or offline:', syncErr);
    }

    // 5. Open Success / Status Modal (if in browser DOM)
    if (typeof document !== 'undefined' && document.body) {
      openResolutionResultModal({
        success: syncSuccess,
        resolvedTx,
        remainingCount: getActiveConflicts().reduce((acc, r) => acc + (r.conflicts ? r.conflicts.length : 0), 0)
      });
    }
    return { success: true, isVault: false, syncSuccess };
  } catch (err) {
    console.error('[Conflict Resolution] Local resolution failed:', err);
    showToast(`Error applying resolution: ${err.message}`, 'danger');
    if (typeof document !== 'undefined' && document.body) {
      openConflictListModal();
    }
    throw err;
  }
}

/**
 * Result modal informing user of local durability and sync state
 */
function openResolutionResultModal({ success, resolvedTx, remainingCount }) {
  const resultHtml = `
    <div class="space-y-4 text-left">
      <div class="flex items-center gap-2.5 pb-2 border-b border-[var(--border-subtle)]">
        <span class="text-xl">${success ? '✓' : '○'}</span>
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">
          ${success ? 'Conflict Resolved' : 'Resolution Saved Locally'}
        </h3>
      </div>

      <div class="p-3.5 rounded-xl sanchoy-surface-inset text-xs space-y-2">
        <p class="text-[var(--text-primary)] font-medium">
          ${success 
            ? 'The chosen version has been synchronized with your encrypted cloud workspace.' 
            : 'Your resolution is safely stored on this device. Cloud synchronization will complete automatically when connection is available.'}
        </p>
        <p class="text-[11px] text-[var(--text-muted)]">
          All wallet balances, allowance carry-forwards, and charts have been deterministically updated.
        </p>
      </div>

      <div class="pt-2 flex justify-between items-center text-xs">
        <span class="text-[10px] text-[var(--text-muted)]">
          ${remainingCount > 0 ? `${remainingCount} conflict${remainingCount === 1 ? '' : 's'} remaining` : 'Zero conflicts remaining'}
        </span>
        <button id="finishResolutionBtn" class="sanchoy-btn sanchoy-btn-primary text-xs py-2 px-4 font-bold">
          ${remainingCount > 0 ? 'Review Remaining' : 'Done'}
        </button>
      </div>
    </div>
  `;

  openModal(resultHtml, {
    maxWidth: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#finishResolutionBtn')?.addEventListener('click', () => {
        closeModal();
        if (remainingCount > 0) {
          openConflictListModal();
        } else {
          // Re-render Sync Center if on sync page
          const syncPage = document.getElementById('page-sync');
          if (syncPage && syncPage.classList.contains('visible')) {
            import('./sync-center.js').then(m => m.renderSyncCenter()).catch(() => {});
          }
        }
      });
    }
  });
}

function openNoConflictsModal() {
  const html = `
    <div class="space-y-4 text-left">
      <div class="flex items-center gap-2 pb-2 border-b border-[var(--border-subtle)]">
        <span class="text-xl">✓</span>
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">
          All Synchronized
        </h3>
      </div>
      <p class="text-xs text-[var(--text-secondary)]">
        No conflicts require your attention. All financial records across your devices are unified.
      </p>
      <div class="pt-2 flex justify-end">
        <button id="closeNoConflictsBtn" class="sanchoy-btn sanchoy-btn-primary text-xs py-2 px-4">
          Close
        </button>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-sm',
    onOpen: (modalEl) => {
      modalEl.querySelector('#closeNoConflictsBtn')?.addEventListener('click', closeModal);
    }
  });
}

function openLockedNoticeModal() {
  const html = `
    <div class="space-y-4 text-left">
      <div class="flex items-center gap-2 pb-2 border-b border-[var(--border-subtle)]">
        <div class="p-1 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent)] shrink-0">
          ${getIcon('lock', { size: 'w-5 h-5' })}
        </div>
        <h3 class="text-sm font-extrabold text-[var(--text-primary)] font-display uppercase tracking-wider">
          Workspace Locked
        </h3>
      </div>
      <p class="text-xs text-[var(--text-secondary)]">
        Financial transaction details are encrypted. Please unlock your workspace with your Private Passcode to review conflict differences.
      </p>
      <div class="pt-2 flex justify-end">
        <button id="closeLockedNoticeBtn" class="sanchoy-btn sanchoy-btn-primary text-xs py-2 px-4">
          Understood
        </button>
      </div>
    </div>
  `;

  openModal(html, {
    maxWidth: 'max-w-sm',
    onOpen: (modalEl) => {
      modalEl.querySelector('#closeLockedNoticeBtn')?.addEventListener('click', closeModal);
    }
  });
}

/**
 * Evaluates individual transaction fields for difference visualization
 */
function evaluateTransactionDifferences(localTx, remoteTx, isDeleteVsEdit) {
  if (isDeleteVsEdit) {
    return {
      differCount: 1,
      fields: [
        {
          name: 'Record State',
          localVal: localTx ? 'Active Transaction' : 'Deleted from device',
          remoteVal: remoteTx ? 'Active Transaction' : 'Deleted from device',
          isDifferent: true
        }
      ]
    };
  }

  const fields = [
    {
      name: 'Amount',
      localVal: localTx ? `₹${round(localTx.amount)}` : 'N/A',
      remoteVal: remoteTx ? `₹${round(remoteTx.amount)}` : 'N/A',
      isDifferent: Number(localTx?.amount) !== Number(remoteTx?.amount)
    },
    {
      name: 'Category',
      localVal: localTx?.category || 'None',
      remoteVal: remoteTx?.category || 'None',
      isDifferent: String(localTx?.category || '') !== String(remoteTx?.category || '')
    },
    {
      name: 'Wallet',
      localVal: localTx?.method || 'Online',
      remoteVal: remoteTx?.method || 'Online',
      isDifferent: String(localTx?.method || '').toLowerCase() !== String(remoteTx?.method || '').toLowerCase()
    },
    {
      name: 'Date',
      localVal: localTx?.date ? new Date(localTx.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      remoteVal: remoteTx?.date ? new Date(remoteTx.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      isDifferent: String(localTx?.date || '').slice(0, 10) !== String(remoteTx?.date || '').slice(0, 10)
    },
    {
      name: 'Description / Note',
      localVal: localTx?.desc || '(none)',
      remoteVal: remoteTx?.desc || '(none)',
      isDifferent: String(localTx?.desc || '').trim() !== String(remoteTx?.desc || '').trim()
    }
  ];

  const differCount = fields.filter(f => f.isDifferent).length;
  return { differCount, fields };
}

/**
 * Evaluates whether two colliding transactions can be safely and deterministically merged:
 * - Both must exist (not delete vs edit)
 * - Amount, Type, Method (Wallet), and Date must match exactly
 * - ONLY note / description diverges
 */
export function checkSafeMergeability(localTx, remoteTx, isDeleteVsEdit) {
  if (isDeleteVsEdit || !localTx || !remoteTx) return false;

  const amountsMatch = Number(localTx.amount) === Number(remoteTx.amount);
  const typesMatch = String(localTx.type || '').toLowerCase() === String(remoteTx.type || '').toLowerCase();
  const methodsMatch = String(localTx.method || '').toLowerCase() === String(remoteTx.method || '').toLowerCase();
  const datesMatch = String(localTx.date || '').slice(0, 10) === String(remoteTx.date || '').slice(0, 10);
  const categoriesMatch = String(localTx.category || '') === String(remoteTx.category || '');

  // Safe merge ONLY if all core financial attributes match and only description differs
  return amountsMatch && typesMatch && methodsMatch && datesMatch && categoriesMatch;
}

/**
 * Deterministically constructs a merged transaction
 */
export function constructSafeMerge(localTx, remoteTx) {
  const localDesc = (localTx.desc || '').trim();
  const remoteDesc = (remoteTx.desc || '').trim();

  let mergedDesc = localDesc;
  if (!localDesc && remoteDesc) {
    mergedDesc = remoteDesc;
  } else if (localDesc && remoteDesc && localDesc !== remoteDesc) {
    mergedDesc = `${localDesc} (${remoteDesc})`;
  }

  return {
    ...localTx,
    desc: mergedDesc
  };
}

/**
 * Evaluates individual vault record fields for difference visualization
 */
export function evaluateVaultDifferences(localRec, remoteRec, isDeleteVsEdit) {
  if (isDeleteVsEdit) {
    return {
      differCount: 1,
      fields: [
        {
          name: 'Record State',
          localVal: localRec ? 'Active Vault Record' : 'Deleted from device',
          remoteVal: remoteRec ? 'Active Vault Record' : 'Deleted from device',
          isDifferent: true
        }
      ]
    };
  }

  const fields = [
    {
      name: 'Type',
      localVal: localRec?.type ? String(localRec.type).toUpperCase() : 'N/A',
      remoteVal: remoteRec?.type ? String(remoteRec.type).toUpperCase() : 'N/A',
      isDifferent: String(localRec?.type || '').toLowerCase() !== String(remoteRec?.type || '').toLowerCase()
    },
    {
      name: 'Amount',
      localVal: (localRec?.amount !== undefined && localRec?.amount !== null) ? `₹${round(localRec.amount)}` : 'N/A',
      remoteVal: (remoteRec?.amount !== undefined && remoteRec?.amount !== null) ? `₹${round(remoteRec.amount)}` : 'N/A',
      isDifferent: Number(localRec?.amount) !== Number(remoteRec?.amount)
    },
    {
      name: 'Category',
      localVal: localRec?.category || 'General Savings',
      remoteVal: remoteRec?.category || 'General Savings',
      isDifferent: String(localRec?.category || '') !== String(remoteRec?.category || '')
    },
    {
      name: 'Source Wallet',
      localVal: localRec?.sourceWallet || 'N/A',
      remoteVal: remoteRec?.sourceWallet || 'N/A',
      isDifferent: String(localRec?.sourceWallet || '').toLowerCase() !== String(remoteRec?.sourceWallet || '').toLowerCase()
    },
    {
      name: 'Destination Wallet',
      localVal: localRec?.destinationWallet || 'N/A',
      remoteVal: remoteRec?.destinationWallet || 'N/A',
      isDifferent: String(localRec?.destinationWallet || '').toLowerCase() !== String(remoteRec?.destinationWallet || '').toLowerCase()
    },
    {
      name: 'Date',
      localVal: localRec?.date ? new Date(localRec.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      remoteVal: remoteRec?.date ? new Date(remoteRec.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      isDifferent: String(localRec?.date || '').slice(0, 10) !== String(remoteRec?.date || '').slice(0, 10)
    },
    {
      name: 'Description / Note',
      localVal: (localRec?.description || localRec?.notes || '').trim() || '(none)',
      remoteVal: (remoteRec?.description || remoteRec?.notes || '').trim() || '(none)',
      isDifferent: String(localRec?.description || localRec?.notes || '').trim() !== String(remoteRec?.description || remoteRec?.notes || '').trim()
    }
  ];

  const differCount = fields.filter(f => f.isDifferent).length;
  return { differCount, fields };
}
