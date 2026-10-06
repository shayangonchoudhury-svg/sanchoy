// Sanchoy Virtual Wallets Model
// Represents the two primary liquid virtual wallets: Online Wallet and Cash Wallet.

export const WALLET_TYPES = {
  ONLINE: 'online',
  CASH: 'cash'
};

export const WALLET_LABELS = {
  [WALLET_TYPES.ONLINE]: 'Online Wallet',
  [WALLET_TYPES.CASH]: 'Cash Wallet'
};

/**
 * Normalizes user-facing or legacy payment method string to standard wallet type.
 * @param {string} input 'Online', 'Cash', 'online', 'cash'
 * @returns {'online' | 'cash'}
 */
export function normalizeWalletType(input) {
  if (!input) return WALLET_TYPES.CASH;
  const str = String(input).trim().toLowerCase();
  if (str === 'online' || str === 'online wallet' || str === 'bank' || str === 'card') {
    return WALLET_TYPES.ONLINE;
  }
  return WALLET_TYPES.CASH;
}

/**
 * Creates an immutable snapshot of virtual wallet states.
 * @param {number} onlineBalance
 * @param {number} cashBalance
 * @returns {{ online: number, cash: number, total: number }}
 */
export function createWalletState(onlineBalance = 0, cashBalance = 0) {
  const online = Number(onlineBalance) || 0;
  const cash = Number(cashBalance) || 0;
  const total = online + cash;

  return {
    online,
    cash,
    total,
    isOnlineNegative: online < 0,
    isCashNegative: cash < 0,
    isTotalNegative: total < 0
  };
}
