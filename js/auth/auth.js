// Master Password Authentication & Auto-Lock Security Engine
import { state, setSessionUnlocked, setVaultUnlocked, setVaultCryptoKey, setDecryptedVaultRecords, safeStorage } from '../core/state.js';
import { events } from '../core/events.js';
import { AppDB } from '../storage/database.js';
import { showToast } from '../ui/toast.js';
import { getIcon } from '../ui/icons.js';

export async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getStoredHash() {
  if (AppDB.db) {
    const hashRec = await AppDB.get('master_password_hash', 'master_hash');
    if (hashRec && hashRec.hash) return hashRec.hash;
  }
  return safeStorage.getItem('et_master_password_hash') || null;
}

export async function storeHash(hash) {
  safeStorage.setItem('et_master_password_hash', hash);
  if (AppDB.db) {
    await AppDB.put('master_password_hash', { id: 'master_hash', hash: hash });
    return true;
  }
  return false;
}

export async function verifyPassword(password) {
  const stored = await getStoredHash();
  if (!stored) return false;
  const inputHash = await hashPassword(password);
  return stored === inputHash;
}

export function lockSession() {
  setSessionUnlocked(false);
  setVaultUnlocked(false);
  setVaultCryptoKey(null);
  setDecryptedVaultRecords([]);
  events.emit('auth:lock');
}

export function unlockSession() {
  setSessionUnlocked(true);
  events.emit('auth:unlock');
}

// Inactivity and Sleep Jump Protection Engine
let lastActiveTime = Date.now();
let lastCheckTime = Date.now();
let activityThrottleTimeout = null;

function recordActivity() {
  lastActiveTime = Date.now();
}

function resetInactivityTimer() {
  if (!activityThrottleTimeout) {
    recordActivity();
    activityThrottleTimeout = setTimeout(() => {
      activityThrottleTimeout = null;
    }, 500);
  }
}

export function initInactivityEngine() {
  ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll', 'click'].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, { capture: true, passive: true });
  });

  setInterval(() => {
    const now = Date.now();
    const inactivityLimit = 5 * 60 * 1000; // 5 minutes
    const sleepJumpThreshold = 10 * 1000; // 10 seconds

    const timeSinceLastCheck = now - lastCheckTime;
    const timeSinceLastActive = now - lastActiveTime;

    if (timeSinceLastCheck > sleepJumpThreshold || timeSinceLastActive >= inactivityLimit) {
      if (state.sessionUnlocked || state.vaultUnlocked) {
        lockSession();
        console.log('[Security] Application automatically locked due to inactivity or system sleep.');
      }
    }

    lastCheckTime = now;
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.visibilityState === 'visible') {
      if (now - lastActiveTime >= 5 * 60 * 1000) {
        if (state.sessionUnlocked || state.vaultUnlocked) {
          lockSession();
        }
      }
    } else {
      recordActivity();
    }
  });

  window.addEventListener('blur', () => {
    lastCheckTime = Date.now();
  });

  window.addEventListener('pagehide', () => {
    lockSession();
  });

  window.addEventListener('beforeunload', () => {
    lockSession();
  });
}

// Modals Setup
export function openCreatePasswordModal() {
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div class="glass-modal p-6 rounded-3xl space-y-6">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
            ${getIcon('lock', { size: 'w-4 h-4' })}
          </div>
          <h3 class="text-base font-extrabold text-[var(--text-primary)] font-serif-editorial">Create Your Master Password</h3>
        </div>
        <button id="closeSecModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      
      <p class="text-xs text-[var(--text-muted)] leading-relaxed">
        Set up a secure offline Master Password to protect your balances, CSV exports, and security settings.
      </p>
      
      <div class="space-y-4">
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1.5">New Master Password</label>
          <div class="relative">
            <input id="secNewPassword" type="password" placeholder="At least 8 characters" class="neu-input w-full p-2.5 pr-10 text-xs font-bold text-[var(--text-primary)]" />
            <button id="toggleNewPass" class="absolute right-3 top-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none" aria-label="Toggle password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
          <div class="mt-2 space-y-1">
            <div class="flex justify-between items-center text-[10px] text-[var(--text-muted)]">
              <span>Password Strength:</span>
              <span id="strengthText" class="font-bold text-rose-500">Too Short</span>
            </div>
            <div class="grid grid-cols-4 gap-1 h-1.5 w-full bg-[var(--surface-inset)] rounded-full overflow-hidden">
              <div id="strengthBar1" class="h-full rounded-full bg-[var(--border)]"></div>
              <div id="strengthBar2" class="h-full rounded-full bg-[var(--border)]"></div>
              <div id="strengthBar3" class="h-full rounded-full bg-[var(--border)]"></div>
              <div id="strengthBar4" class="h-full rounded-full bg-[var(--border)]"></div>
            </div>
          </div>
        </div>
        
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1.5">Confirm Password</label>
          <div class="relative">
            <input id="secConfirmPassword" type="password" placeholder="Re-enter password" class="neu-input w-full p-2.5 pr-10 text-xs font-bold text-[var(--text-primary)]" />
            <button id="toggleConfPass" class="absolute right-3 top-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none" aria-label="Toggle confirm password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
          <p id="matchErrorText" class="text-[10px] font-bold text-rose-500 mt-1 hidden"></p>
        </div>
      </div>
      
      <div class="flex gap-3 pt-2">
        <button id="saveSecPassword" disabled class="flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all opacity-50 cursor-not-allowed">
          Set Master Password
        </button>
        <button id="cancelSecPassword" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all">
          Cancel
        </button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  modal.style.display = 'flex';

  const newPassInput = document.getElementById('secNewPassword');
  const confPassInput = document.getElementById('secConfirmPassword');
  const strengthText = document.getElementById('strengthText');
  const matchErrorText = document.getElementById('matchErrorText');
  const saveBtn = document.getElementById('saveSecPassword');

  document.getElementById('toggleNewPass').addEventListener('click', () => {
    newPassInput.type = newPassInput.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('toggleConfPass').addEventListener('click', () => {
    confPassInput.type = confPassInput.type === 'password' ? 'text' : 'password';
  });

  function updateValidation() {
    const val = newPassInput.value;
    const confVal = confPassInput.value;

    let score = 0;
    if (val.length >= 8) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const bars = [
      document.getElementById('strengthBar1'),
      document.getElementById('strengthBar2'),
      document.getElementById('strengthBar3'),
      document.getElementById('strengthBar4')
    ];
    bars.forEach(b => {
      if (b) b.className = 'h-full rounded-full bg-slate-300';
    });

    if (val.length === 0) {
      strengthText.textContent = 'Empty';
      strengthText.className = 'font-bold text-slate-400';
    } else if (val.length < 8) {
      strengthText.textContent = 'Too Short (Min 8)';
      strengthText.className = 'font-bold text-rose-500';
      if (bars[0]) bars[0].className = 'h-full rounded-full bg-rose-500';
    } else {
      if (score === 1) {
        strengthText.textContent = 'Weak';
        strengthText.className = 'font-bold text-rose-500';
        if (bars[0]) bars[0].className = 'h-full rounded-full bg-rose-500';
      } else if (score === 2) {
        strengthText.textContent = 'Fair';
        strengthText.className = 'font-bold text-amber-500';
        if (bars[0]) bars[0].className = 'h-full rounded-full bg-amber-500';
        if (bars[1]) bars[1].className = 'h-full rounded-full bg-amber-500';
      } else if (score === 3) {
        strengthText.textContent = 'Good';
        strengthText.className = 'font-bold text-indigo-500';
        if (bars[0]) bars[0].className = 'h-full rounded-full bg-indigo-500';
        if (bars[1]) bars[1].className = 'h-full rounded-full bg-indigo-500';
        if (bars[2]) bars[2].className = 'h-full rounded-full bg-indigo-500';
      } else {
        strengthText.textContent = 'Strong';
        strengthText.className = 'font-bold text-emerald-500';
        bars.forEach(b => {
          if (b) b.className = 'h-full rounded-full bg-emerald-500';
        });
      }
    }

    const matches = val === confVal && val.length > 0;
    if (confVal.length > 0) {
      if (val === confVal) {
        matchErrorText.textContent = 'Passwords match ✓';
        matchErrorText.className = 'text-[10px] font-bold text-emerald-500 mt-1 block';
      } else {
        matchErrorText.textContent = 'Passwords do not match';
        matchErrorText.className = 'text-[10px] font-bold text-rose-500 mt-1 block';
      }
    } else {
      matchErrorText.className = 'hidden';
    }

    const isValid = val.length >= 8 && matches;
    if (isValid) {
      saveBtn.disabled = false;
      saveBtn.className = 'flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer';
    } else {
      saveBtn.disabled = true;
      saveBtn.className = 'flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all opacity-50 cursor-not-allowed';
    }
  }

  newPassInput.addEventListener('input', updateValidation);
  confPassInput.addEventListener('input', updateValidation);

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  document.getElementById('closeSecModal').addEventListener('click', hide);
  document.getElementById('cancelSecPassword').addEventListener('click', hide);

  saveBtn.addEventListener('click', async () => {
    const password = newPassInput.value;
    const hash = await hashPassword(password);
    await storeHash(hash);
    unlockSession();
    hide();
  });
}

export function openUnlockModal(onSuccessCallback) {
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div id="unlockContainer" class="glass-modal p-6 rounded-3xl space-y-6 transition-all duration-300">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
            ${getIcon('key', { size: 'w-4 h-4' })}
          </div>
          <h3 class="text-base font-extrabold text-[var(--text-primary)] font-serif-editorial">Unlock Expense Tracker</h3>
        </div>
        <button id="closeSecModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      
      <p class="text-xs text-[var(--text-muted)] leading-relaxed">
        Please enter your offline Master Password to unlock financial databases and premium views.
      </p>
      
      <div class="space-y-4">
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1.5">Master Password</label>
          <div class="relative">
            <input id="secUnlockPassword" type="password" placeholder="••••••••" class="neu-input w-full p-2.5 pr-10 text-xs font-bold text-[var(--text-primary)]" />
            <button id="toggleUnlockPass" class="absolute right-3 top-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none" aria-label="Toggle password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
          <p id="unlockErrorText" class="text-[10px] font-bold text-rose-500 mt-1 hidden">Incorrect Password.</p>
        </div>
      </div>
      
      <div class="flex gap-3 pt-2">
        <button id="submitUnlock" class="flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer">
          Unlock
        </button>
        <button id="cancelUnlock" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all">
          Cancel
        </button>
      </div>

      <div class="text-center pt-2 border-t border-[var(--border-subtle)]">
        <button id="forgotPasswordBtn" class="text-[11px] text-[var(--accent)] hover:underline font-semibold bg-transparent border-0 cursor-pointer">
          Forgot Master Password?
        </button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  modal.style.display = 'flex';

  const unlockPassInput = document.getElementById('secUnlockPassword');
  const errorText = document.getElementById('unlockErrorText');
  const submitBtn = document.getElementById('submitUnlock');
  const container = document.getElementById('unlockContainer');

  unlockPassInput.focus();

  document.getElementById('toggleUnlockPass').addEventListener('click', () => {
    unlockPassInput.type = unlockPassInput.type === 'password' ? 'text' : 'password';
  });

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  document.getElementById('closeSecModal').addEventListener('click', hide);
  document.getElementById('cancelUnlock').addEventListener('click', hide);
  document.getElementById('forgotPasswordBtn').addEventListener('click', () => {
    triggerForgotPasswordFlow();
  });

  async function performUnlock() {
    const entered = unlockPassInput.value;
    const isValid = await verifyPassword(entered);

    if (isValid) {
      unlockSession();
      hide();
      if (typeof onSuccessCallback === 'function') {
        onSuccessCallback();
      }
    } else {
      container.classList.remove('animate-shake');
      void container.offsetWidth;
      container.classList.add('animate-shake');

      errorText.classList.remove('hidden');
      unlockPassInput.value = '';
      unlockPassInput.focus();
    }
  }

  submitBtn.addEventListener('click', performUnlock);
  unlockPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      performUnlock();
    }
  });
}

export function openChangePasswordModal() {
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div class="glass-modal p-6 rounded-3xl space-y-6">
      <div class="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
            ${getIcon('key', { size: 'w-4 h-4' })}
          </div>
          <h3 class="text-base font-extrabold text-[var(--text-primary)] font-serif-editorial">Change Master Password</h3>
        </div>
        <button id="closeSecModal" class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg neu-btn transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      
      <p class="text-xs text-[var(--text-muted)] leading-relaxed">
        Update your offline Master Password securely. This password remains entirely private inside your browser sandbox.
      </p>
      
      <div class="space-y-4">
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1.5">Current Master Password</label>
          <input id="secCurrentPassword" type="password" placeholder="••••••••" class="neu-input w-full p-2.5 text-xs font-bold text-[var(--text-primary)]" />
          <p id="currentErrorText" class="text-[10px] font-bold text-rose-500 mt-1 hidden">Incorrect current password.</p>
        </div>
        
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1.5">New Master Password</label>
          <div class="relative">
            <input id="secNewPassword" type="password" placeholder="At least 8 characters" class="neu-input w-full p-2.5 pr-10 text-xs font-bold text-[var(--text-primary)]" />
            <button id="toggleNewPass" class="absolute right-3 top-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none" aria-label="Toggle password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
          <div class="mt-2 space-y-1">
            <div class="flex justify-between items-center text-[10px] text-[var(--text-muted)]">
              <span>Password Strength:</span>
              <span id="strengthText" class="font-bold text-[var(--text-muted)]">Too Short</span>
            </div>
            <div class="grid grid-cols-4 gap-1 h-1.5 w-full bg-[var(--surface-inset)] rounded-full overflow-hidden">
              <div id="strengthBar1" class="h-full rounded-full bg-[var(--border)]"></div>
              <div id="strengthBar2" class="h-full rounded-full bg-[var(--border)]"></div>
              <div id="strengthBar3" class="h-full rounded-full bg-[var(--border)]"></div>
              <div id="strengthBar4" class="h-full rounded-full bg-[var(--border)]"></div>
            </div>
          </div>
        </div>
        
        <div>
          <label class="block text-[10px] font-bold text-[var(--text-secondary)] uppercase mb-1.5">Confirm New Password</label>
          <div class="relative">
            <input id="secConfirmPassword" type="password" placeholder="Re-enter password" class="neu-input w-full p-2.5 pr-10 text-xs font-bold text-[var(--text-primary)]" />
            <button id="toggleConfPass" class="absolute right-3 top-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none" aria-label="Toggle confirm password visibility">
              ${getIcon('eye', { size: 'w-4 h-4' })}
            </button>
          </div>
          <p id="matchErrorText" class="text-[10px] font-bold text-rose-500 mt-1 hidden"></p>
        </div>
      </div>
      
      <div class="flex gap-3 pt-2">
        <button id="saveNewPassword" disabled class="flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all opacity-50 cursor-not-allowed">
          Change Password
        </button>
        <button id="cancelChangePassword" class="py-2.5 px-4 neu-btn text-[var(--text-secondary)] font-bold text-xs rounded-xl transition-all">
          Cancel
        </button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  modal.style.display = 'flex';

  const currentPassInput = document.getElementById('secCurrentPassword');
  const newPassInput = document.getElementById('secNewPassword');
  const confPassInput = document.getElementById('secConfirmPassword');
  const currentErrorText = document.getElementById('currentErrorText');
  const strengthText = document.getElementById('strengthText');
  const matchErrorText = document.getElementById('matchErrorText');
  const saveBtn = document.getElementById('saveNewPassword');

  document.getElementById('toggleNewPass').addEventListener('click', () => {
    newPassInput.type = newPassInput.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('toggleConfPass').addEventListener('click', () => {
    confPassInput.type = confPassInput.type === 'password' ? 'text' : 'password';
  });

  function updateValidation() {
    const val = newPassInput.value;
    const confVal = confPassInput.value;

    let score = 0;
    if (val.length >= 8) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const bars = [
      document.getElementById('strengthBar1'),
      document.getElementById('strengthBar2'),
      document.getElementById('strengthBar3'),
      document.getElementById('strengthBar4')
    ];
    bars.forEach(b => {
      if (b) b.className = 'h-full rounded-full bg-slate-300';
    });

    if (val.length === 0) {
      strengthText.textContent = 'Empty';
      strengthText.className = 'font-bold text-slate-400';
    } else if (val.length < 8) {
      strengthText.textContent = 'Too Short (Min 8)';
      strengthText.className = 'font-bold text-rose-500';
      if (bars[0]) bars[0].className = 'h-full rounded-full bg-rose-500';
    } else {
      if (score === 1) {
        strengthText.textContent = 'Weak';
        strengthText.className = 'font-bold text-rose-500';
        if (bars[0]) bars[0].className = 'h-full rounded-full bg-rose-500';
      } else if (score === 2) {
        strengthText.textContent = 'Fair';
        strengthText.className = 'font-bold text-amber-500';
        if (bars[0]) bars[0].className = 'h-full rounded-full bg-amber-500';
        if (bars[1]) bars[1].className = 'h-full rounded-full bg-amber-500';
      } else if (score === 3) {
        strengthText.textContent = 'Good';
        strengthText.className = 'font-bold text-indigo-500';
        if (bars[0]) bars[0].className = 'h-full rounded-full bg-indigo-500';
        if (bars[1]) bars[1].className = 'h-full rounded-full bg-indigo-500';
        if (bars[2]) bars[2].className = 'h-full rounded-full bg-indigo-500';
      } else {
        strengthText.textContent = 'Strong';
        strengthText.className = 'font-bold text-emerald-500';
        bars.forEach(b => {
          if (b) b.className = 'h-full rounded-full bg-emerald-500';
        });
      }
    }

    const matches = val === confVal && val.length > 0;
    if (confVal.length > 0) {
      if (val === confVal) {
        matchErrorText.textContent = 'Passwords match ✓';
        matchErrorText.className = 'text-[10px] font-bold text-emerald-500 mt-1 block';
      } else {
        matchErrorText.textContent = 'Passwords do not match';
        matchErrorText.className = 'text-[10px] font-bold text-rose-500 mt-1 block';
      }
    } else {
      matchErrorText.className = 'hidden';
    }

    const isValid = val.length >= 8 && matches;
    if (isValid) {
      saveBtn.disabled = false;
      saveBtn.className = 'flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer';
    } else {
      saveBtn.disabled = true;
      saveBtn.className = 'flex-1 py-2.5 px-4 neu-btn-primary text-white font-extrabold text-xs rounded-xl shadow-md transition-all opacity-50 cursor-not-allowed';
    }
  }

  newPassInput.addEventListener('input', updateValidation);
  confPassInput.addEventListener('input', updateValidation);

  const hide = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  document.getElementById('closeSecModal').addEventListener('click', hide);
  document.getElementById('cancelChangePassword').addEventListener('click', hide);

  saveBtn.addEventListener('click', async () => {
    const enteredCurrent = currentPassInput.value;
    const isCurrentValid = await verifyPassword(enteredCurrent);

    if (!isCurrentValid) {
      currentErrorText.classList.remove('hidden');
      currentPassInput.focus();
      return;
    }

    currentErrorText.classList.add('hidden');
    const newPassword = newPassInput.value;
    const newHash = await hashPassword(newPassword);
    await storeHash(newHash);

    // Re-wrap workspace envelope DEK with new passcode if envelope exists
    try {
      const { loadLocalEnvelope, changePasscodeInEnvelope } = await import('../security/workspace-keys.js');
      const env = await loadLocalEnvelope();
      if (env) {
        await changePasscodeInEnvelope(env, enteredCurrent, newPassword);
      }
    } catch (envErr) {
      console.warn('[Sanchoy Security] Envelope re-wrap notice:', envErr);
    }

    unlockSession();
    hide();
    const { showToast } = await import('../ui/toast.js');
    showToast('Private Passcode successfully updated and workspace secured', 'success');
  });
}

export function triggerForgotPasswordFlow() {
  const modal = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div id="recoveryWarningContainer" class="glass-modal p-6 rounded-3xl space-y-6 transition-all duration-300 max-w-md mx-auto text-left">
      <div class="flex items-center gap-3 border-b border-slate-200/50 pb-3">
        <div class="p-2 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 shrink-0">
          ${getIcon('warning', { size: 'w-6 h-6' })}
        </div>
        <h3 class="text-base font-extrabold text-rose-600 dark:text-rose-400 font-display">Master Password Recovery</h3>
      </div>
      
      <div class="space-y-4">
        <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Because this application runs <strong>entirely offline inside your browser sandbox</strong>, your Master Password is cryptographically hashed and kept strictly private. There is no central server, and we can never retrieve your forgotten password.
        </p>
        
        <div class="bg-rose-500/10 border border-rose-500/20 p-3 rounded-2xl space-y-2">
          <p class="text-xs font-bold text-rose-600 dark:text-rose-400">
            To proceed, you must permanently delete:
          </p>
          <ul class="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5">
            <li class="flex items-center gap-2">${getIcon('vault', { size: 'w-3.5 h-3.5', className: 'text-rose-500 shrink-0' })} <span><strong>Hidden Savings Vault</strong> (All encrypted records will be deleted)</span></li>
            <li class="flex items-center gap-2">${getIcon('settings', { size: 'w-3.5 h-3.5', className: 'text-rose-500 shrink-0' })} <span><strong>Privacy Settings & Toggle Preferences</strong></span></li>
            <li class="flex items-center gap-2">${getIcon('key', { size: 'w-3.5 h-3.5', className: 'text-rose-500 shrink-0' })} <span><strong>Stored Password Cryptographic Hash</strong></span></li>
          </ul>
        </div>
        
        <p class="text-[11px] text-slate-500 leading-relaxed">
          Your primary offline transactions, category budgets, and analytics data will be kept intact. After deletion, you will immediately set up a brand-new Master Password to secure the application.
        </p>
      </div>

      <div class="flex gap-3 pt-2">
        <button id="confirmRecoveryDelete" class="flex-1 py-2.5 px-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5 cursor-pointer">
          Erase & Set New Password
        </button>
        <button id="cancelRecovery" class="py-2.5 px-4 neu-btn text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl transition-all">
          Cancel
        </button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  modal.style.display = 'flex';

  const cancelBtn = document.getElementById('cancelRecovery');
  const confirmBtn = document.getElementById('confirmRecoveryDelete');

  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  });

  confirmBtn.addEventListener('click', async () => {
    try {
      if (AppDB.db) {
        await AppDB.clearStore('savings_vault');
        await AppDB.clearStore('privacy_settings');
        await AppDB.clearStore('master_password_hash');
      }
      safeStorage.removeItem('et_vault_savings_v1');
      safeStorage.removeItem('et_master_password_hash');

      lockSession();
      showToast('Secured data successfully erased. You will now be prompted to set up a brand-new Master Password.', 'info', 5000);
      openCreatePasswordModal();
    } catch (e) {
      console.error('Error during password reset/recovery erase:', e);
      showToast('An error occurred during secure deletion: ' + e.message, 'error');
    }
  });
}
