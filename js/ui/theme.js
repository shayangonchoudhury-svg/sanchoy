// Sanchoy Unified Global Theme System
// Supports "Futuristic Financial OS" (Dark) & "Premium FinTech" (Light)
import { events } from '../core/events.js';
import { safeStorage } from '../core/state.js';
import { getIcon } from './icons.js';

const THEME_STORAGE_KEY = 'sanchoy_theme_mode_v1';

export function getPreferredTheme() {
  const saved = safeStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') {
    return saved;
  }
  // Default to dark ("Futuristic Financial OS") or user system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.setAttribute('data-theme', theme);
  
  // Update theme meta color for mobile browser bars
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', isDark ? '#0b0f0e' : '#f8f7f4');
  }

  // Update toggle button icons if present
  document.querySelectorAll('[data-theme-toggle-icon]').forEach(el => {
    el.innerHTML = isDark
      ? getIcon('sun', { size: 'w-4 h-4', className: 'text-[var(--text-secondary)]' })
      : getIcon('moon', { size: 'w-4 h-4', className: 'text-[var(--text-secondary)]' });
  });

  safeStorage.setItem(THEME_STORAGE_KEY, theme);
  events.emit('theme:change', theme);
}

export function toggleTheme() {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function initTheme() {
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  // Wire up any theme toggle buttons across the DOM
  document.querySelectorAll('[data-action="toggle-theme"]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleTheme();
    });
  });

  // Listen for OS scheme changes if user hasn't explicitly set a preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!safeStorage.getItem(THEME_STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}
