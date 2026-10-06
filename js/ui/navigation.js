// Sanchoy Unified Navigation Controller
// Coordinates desktop header & mobile bottom bar across Home, Charts, +, Vault, Settings
import { navigate, showPage } from './ui.js';
import { events } from '../core/events.js';
import { state } from '../core/state.js';
import { openNewTransactionModal } from '../transactions/transactions.js';
import { openSettingsModal } from './settings-modal.js';
import { getStoredHash, openCreatePasswordModal, openUnlockModal } from '../auth/auth.js';
import { openVaultUnlockModal } from '../vault/vault.js';
import { initProfileMenu } from './profile-popover.js';

export function initNavigation() {
  // 0. Profile quick menu popover
  initProfileMenu();

  // 1. Navigation items click handlers
  document.querySelectorAll('[data-nav-target]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const target = el.dataset.navTarget;
      handleNavigation(target);
    });
  });

  // 2. Central '+' Action button click handlers (desktop & mobile)
  document.querySelectorAll('[data-action="new-transaction"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openNewTransactionModal();
    });
  });

  // 3. Settings action button click handlers
  document.querySelectorAll('[data-action="open-settings"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openSettingsModal();
    });
  });

  // 4. Sync active navigation on route changes
  events.on('route:change', (pageId) => {
    syncActiveNavigation(pageId);
  });

  // Initial sync
  syncActiveNavigation(document.querySelector('.page.visible')?.id || 'page-tracker');
}

export async function handleNavigation(target) {
  if (target === 'home') {
    navigate('/tracker');
  } else if (target === 'landing') {
    navigate('/');
  } else if (target === 'charts' || target === 'analytics') {
    navigate('/analytics');
  } else if (target === 'new') {
    openNewTransactionModal();
  } else if (target === 'vault') {
    const stored = await getStoredHash();
    if (!stored) {
      openCreatePasswordModal();
    } else if (!state.vaultUnlocked) {
      openVaultUnlockModal((dest) => {
        navigate(dest || '/vault');
      });
    } else {
      navigate('/vault');
    }
  } else if (target === 'settings') {
    openSettingsModal();
  }
}

export function syncActiveNavigation(pageId) {
  let activeTarget = 'home';
  if (pageId === 'page-analytics') activeTarget = 'charts';
  if (pageId === 'page-vault') activeTarget = 'vault';
  if (pageId === 'page-landing') activeTarget = 'landing';
  if (pageId === 'page-auth') activeTarget = 'auth';

  // Screen 2 Auth & Landing page chrome visibility:
  // Hide authenticated header nav items and mobile bottom bar on dedicated Screen 2 /auth
  const isAuthPage = pageId === 'page-auth';
  const desktopHeader = document.querySelector('.sanchoy-header');
  const mobileBar = document.querySelector('.sanchoy-mobile-bar');
  const desktopNav = document.getElementById('desktopNavContainer');
  
  if (desktopHeader) {
    desktopHeader.style.display = isAuthPage ? 'none' : '';
  }
  if (mobileBar) {
    mobileBar.style.display = isAuthPage ? 'none' : '';
  }

  // Part 1 requirement: On the authenticated HOME (tracker) page only,
  // remove the top navigation items (Home, Charts, Vault, Settings).
  // The Home page should feel like the primary command center rather than a landing page with duplicated product navigation.
  // On other authenticated pages (Charts, Vault, Sync, etc.), navigation remains visible.
  if (desktopNav) {
    const isHomePage = pageId === 'page-tracker' || pageId === 'page-landing' || !pageId;
    desktopNav.style.display = isHomePage ? 'none' : '';
  }

  // Desktop nav items
  document.querySelectorAll('[data-nav-target]').forEach(link => {
    const isCurrent = link.dataset.navTarget === activeTarget;
    link.classList.toggle('active', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  // Mobile bottom bar items
  document.querySelectorAll('.sanchoy-mobile-nav-item[data-nav-target]').forEach(item => {
    const isCurrent = item.dataset.navTarget === activeTarget;
    item.classList.toggle('active', isCurrent);
  });
}
