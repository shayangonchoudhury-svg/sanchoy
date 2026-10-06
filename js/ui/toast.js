// Sanchoy Unified Toast Notification Engine
// Subtle, restrained, accessible notifications for transactions and settings

import { getIcon } from './icons.js';

let container = null;

function ensureContainer() {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }
  if (!container || !document.body.contains(container)) {
    container = document.getElementById('sanchoyToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sanchoyToastContainer';
      container.className = 'sanchoy-toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(container);
    }
  }
  return container;
}

/**
 * Displays a non-intrusive toast notification.
 * @param {string} message - Message text to display
 * @param {'success'|'error'|'info'|'warning'} type - Semantic notification level
 * @param {number} duration - Milliseconds before auto-dismiss (default: 3200ms)
 */
export function showToast(message, type = 'info', duration = 3200) {
  if (typeof document === 'undefined') return;
  const c = ensureContainer();
  if (!c) return;
  const toast = document.createElement('div');
  toast.className = `sanchoy-toast sanchoy-toast-${type}`;

  const iconMap = {
    success: getIcon('check', { size: 'w-4 h-4', className: 'text-[var(--income)]' }),
    error: getIcon('close', { size: 'w-4 h-4', className: 'text-[var(--danger)]' }),
    warning: getIcon('warning', { size: 'w-4 h-4', className: 'text-[var(--warning)]' }),
    info: getIcon('info', { size: 'w-4 h-4', className: 'text-[var(--accent)]' })
  };

  const icon = iconMap[type] || getIcon('info', { size: 'w-4 h-4' });

  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0;">
      <span style="display: inline-flex; align-items: center; justify-content: center; shrink-0;">${icon}</span>
      <span style="line-height: 1.35; overflow: hidden; text-overflow: ellipsis;">${escapeText(message)}</span>
    </div>
    <button type="button" aria-label="Dismiss notification" style="background: none; border: none; padding: 0.2rem; cursor: pointer; color: inherit; opacity: 0.6; display: inline-flex; align-items: center; justify-content: center;">
      ${getIcon('close', { size: 'w-3.5 h-3.5' })}
    </button>
  `;

  const closeBtn = toast.querySelector('button');
  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode === c) {
        c.removeChild(toast);
      }
    }, 250);
  };

  closeBtn.addEventListener('click', dismiss);
  c.appendChild(toast);

  // Trigger smooth enter animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
}

function escapeText(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
