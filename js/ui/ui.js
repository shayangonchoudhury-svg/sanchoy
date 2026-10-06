// Navigation, Routing & Screen Transitions Controller
import { state } from '../core/state.js';
import { events } from '../core/events.js';

export const routes = {
  '/': 'page-landing',
  '/tracker': 'page-tracker',
  '/analytics': 'page-analytics',
  '/vault': 'page-vault',
  '/auth': 'page-auth',
  '/sync': 'page-sync'
};

let pageChangeCallback = null;

export function setPageChangeCallback(callback) {
  pageChangeCallback = callback;
}

export function showPage(id, push = true) {
  if (id === 'page-vault' && !state.vaultUnlocked) {
    id = 'page-tracker';
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('visible'));
  const targetPage = document.getElementById(id);
  if (targetPage) {
    targetPage.classList.add('visible');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (push) {
    try {
      const path = Object.keys(routes).find(k => routes[k] === id) || '/';
      history.pushState({ page: id }, '', path);
    } catch (e) {
      console.warn('History pushState is not supported or blocked by sandbox constraints:', e);
    }
  }

  events.emit('route:change', id);

  if (typeof pageChangeCallback === 'function') {
    pageChangeCallback(id);
  }
}

export function navigate(path, push = true) {
  showPage(routes[path] || routes['/'], push);
}

export function initRouter(onPageChange = null) {
  if (onPageChange) {
    setPageChangeCallback(onPageChange);
  }

  window.addEventListener('popstate', e => {
    if (e.state && e.state.page) {
      showPage(e.state.page, false);
    } else {
      navigate(location.pathname, false);
    }
  });

  const toTrackerBtn = document.getElementById('toTrackerBtn');
  if (toTrackerBtn) toTrackerBtn.addEventListener('click', () => {
    // Landing CTA routes to Screen 2 (Login / Sign Up)
    navigate('/auth');
  });

  const backToLanding = document.getElementById('backToLanding');
  if (backToLanding) backToLanding.addEventListener('click', () => navigate('/'));

  const backToTracker = document.getElementById('backToTracker');
  if (backToTracker) backToTracker.addEventListener('click', () => navigate('/tracker'));

  // Page container transition event listeners
  document.querySelectorAll('.page').forEach(p => {
    p.addEventListener('transitionend', () => {
      if (p.classList.contains('visible') && p.id === 'page-tracker') {
        events.emit('page:trackerVisible');
      }
    });
  });
}
