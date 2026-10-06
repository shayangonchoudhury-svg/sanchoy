// Sanchoy Master Application Bootstrap & Lifecycle Controller
import { ensureDataLoaded } from './storage/database.js';
import { initInactivityEngine } from './auth/auth.js';
import { renderPrivacyToggle, initPrivacyControls } from './privacy/privacy.js';
import {
  renderBalances,
  renderRecent,
  renderOverview,
  refreshAllViews,
  initTransactionControls,
  getTxs
} from './transactions/transactions.js';
import { renderCharts, updateChartsPrivacyMask } from './charts/charts.js';
import {
  renderVault,
  updateVaultStyles,
  initVaultControls,
  seedSampleVaultData,
  editVaultRecord,
  deleteVaultRecord
} from './vault/vault.js';
import { initSettingsControls } from './settings/settings.js';
import { initRouter, navigate, routes } from './ui/ui.js';
import { initTheme } from './ui/theme.js';
import { initModalListeners } from './ui/modal.js';
import { initNavigation } from './ui/navigation.js';
import { renderAuthPage } from './ui/auth-page.js';
import { initFirebaseAuthListener } from './firebase/auth.js';
import { testFirestoreConnection } from './firebase/firestore.js';
import { events } from './core/events.js';
import { state } from './core/state.js';

async function bootstrap() {
  try {
    // 0. Initialize theme before anything renders
    initTheme();

    // 0b. Initialize Firebase Auth State Listener & test connection if configured
    try {
      await initFirebaseAuthListener((user) => {
        if (document.getElementById('page-auth')?.classList.contains('visible')) {
          renderAuthPage();
        }
      });
      testFirestoreConnection();
    } catch (fbErr) {
      console.warn('[Sanchoy] Firebase optional listener notice:', fbErr);
    }

    // 1. Load data from persistent IndexedDB into memory
    await ensureDataLoaded();

    // 2. Initialize router and page lifecycle
    initRouter((pageId) => {
      if (pageId === 'page-analytics') {
        setTimeout(() => renderCharts(getTxs()), 150);
      }
      if (pageId === 'page-vault') {
        setTimeout(renderVault, 150);
      }
      if (pageId === 'page-tracker') {
        setTimeout(refreshAllViews, 100);
      }
      if (pageId === 'page-auth') {
        renderAuthPage();
      }
      if (pageId === 'page-sync') {
        import('./ui/sync-center.js').then(m => {
          m.renderSyncCenter();
          m.initSyncCenter();
        }).catch(err => console.error('Failed to load Sync Center:', err));
      }
    });

    // 3. Initialize feature controllers & listeners
    initInactivityEngine();
    initPrivacyControls();
    initTransactionControls();
    initVaultControls((path) => navigate(path));
    initSettingsControls();
    initModalListeners();
    initNavigation();

    // 4. Setup event-driven UI updates
    events.on('auth:lock', () => {
      renderPrivacyToggle();
      refreshAllViews();
      updateChartsPrivacyMask();
      const currentPath = Object.keys(routes).find(k => routes[k] === 'page-vault');
      if (location.pathname === currentPath || document.getElementById('page-vault')?.classList.contains('visible')) {
        navigate('/tracker');
      }
    });

    events.on('auth:unlock', () => {
      renderPrivacyToggle();
      refreshAllViews();
      updateChartsPrivacyMask();
    });

    events.on('page:trackerVisible', () => {
      refreshAllViews();
    });

    // 5. Initial component styles & view renders
    updateVaultStyles();
    renderPrivacyToggle();
    refreshAllViews();
    try {
      const { updateSyncStatus } = await import('./firebase/sync.js');
      updateSyncStatus();
    } catch (e) {}

    // 6. Navigate to initial route
    navigate(location.pathname, false);

    console.log('[Sanchoy] Application successfully initialized.');
  } catch (err) {
    console.error('[Sanchoy] Initialization error:', err);
  }
}

// Expose handlers required by inline HTML event attributes
window.seedSampleVaultData = seedSampleVaultData;
window.editVaultRecord = editVaultRecord;
window.deleteVaultRecord = deleteVaultRecord;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
