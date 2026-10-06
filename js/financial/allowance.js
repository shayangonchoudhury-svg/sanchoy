// Sanchoy Monthly Allowance & Automatic Daily Allocation Engine
import { WALLET_TYPES } from './wallets.js';
import { LS, safeStorage } from '../core/state.js';
import { events } from '../core/events.js';

/**
 * Retrieves the persisted virtual allowance configuration.
 * @returns {object|null}
 */
export function getAllowanceConfig() {
  try {
    const raw = safeStorage.getItem(LS.allowanceConfig);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * Persists updated virtual allowance configuration.
 * @param {object} config
 */
export function saveAllowanceConfig(config) {
  try {
    safeStorage.setItem(LS.allowanceConfig, JSON.stringify(config));
  } catch (e) {}
  events.emit('allowance:change', config);
}

/**
 * Retrieves initial virtual wallet starting balances.
 * @returns {{ online: number, cash: number }}
 */
export function getStartingBalances() {
  try {
    const raw = safeStorage.getItem(LS.startingBalances);
    if (!raw) {
      // Check legacy balances
      const legacyRaw = safeStorage.getItem(LS.balances);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        return {
          online: Number(parsed?.online) || 0,
          cash: Number(parsed?.cash) || 0
        };
      }
      return { online: 0, cash: 0 };
    }
    const parsed = JSON.parse(raw);
    return {
      online: Number(parsed?.online) || 0,
      cash: Number(parsed?.cash) || 0
    };
  } catch (e) {
    return { online: 0, cash: 0 };
  }
}

/**
 * Saves initial virtual wallet starting balances.
 * @param {{ online: number, cash: number }} balances
 */
export function saveStartingBalances(balances) {
  const clean = {
    online: Number(balances?.online) || 0,
    cash: Number(balances?.cash) || 0
  };
  try {
    safeStorage.setItem(LS.startingBalances, JSON.stringify(clean));
  } catch (e) {}
  events.emit('startingBalances:change', clean);
}

/**
 * Returns number of calendar days in a given month.
 * @param {number} year - Full year (e.g. 2026)
 * @param {number} month - 1-based month (1 = Jan, 12 = Dec)
 * @returns {number} 28, 29, 30, or 31
 */
export function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Computes exact daily virtual allocation rate for a given month.
 * Formula: daily allocation = monthly allowance / number of calendar days in applicable month.
 * Precision is kept unrounded.
 * @param {number} monthlyAllowance
 * @param {number} year
 * @param {number} month (1-based)
 * @returns {number}
 */
export function getDailyAllocation(monthlyAllowance, year, month) {
  const allowance = Number(monthlyAllowance) || 0;
  if (allowance <= 0) return 0;
  const days = getDaysInMonth(year, month);
  return allowance / days;
}

/**
 * Creates or versions an allowance configuration record.
 * @param {object} params
 * @returns {object}
 */
export function createAllowanceConfig({
  id = null,
  monthlyOnlineAllowance = 0,
  monthlyCashAllowance = 0,
  effectiveDate = null,
  version = 1
} = {}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  return {
    id: id || `allowance_v${version}_${Date.now()}`,
    version: Number(version) || 1,
    monthlyOnlineAllowance: Math.max(0, Number(monthlyOnlineAllowance) || 0),
    monthlyCashAllowance: Math.max(0, Number(monthlyCashAllowance) || 0),
    totalMonthlyAllowance: Math.max(0, Number(monthlyOnlineAllowance) || 0) + Math.max(0, Number(monthlyCashAllowance) || 0),
    effectiveDate: effectiveDate || todayStr,
    createdAt: new Date().toISOString()
  };
}

/**
 * Formats a Date object as local YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
export function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Generates an array of daily ISO date strings (YYYY-MM-DD) inclusive from start to end.
 * @param {string} startDateStr - "YYYY-MM-DD"
 * @param {string} endDateStr - "YYYY-MM-DD"
 * @returns {string[]}
 */
export function generateDateSequence(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return [];
  if (startDateStr > endDateStr) return [];

  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);

  const cur = new Date(sy, sm - 1, sd, 12, 0, 0); // Noon to prevent DST boundary drift
  const end = new Date(ey, em - 1, ed, 12, 0, 0);

  const dates = [];
  while (cur <= end) {
    dates.push(toLocalDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/**
 * Generates deterministic, idempotent daily virtual allocation events for a given allowance configuration.
 * Rules:
 * - Only generates allocations on or after config.effectiveDate (no retroactive allocations).
 * - Generates allocations up through targetDateStr (defaults to today).
 * - Respects month boundaries with each month's actual calendar day count.
 * - Idempotency key: `alloc_${date}_${wallet}`.
 *
 * @param {object} config - AllowanceConfig
 * @param {string} targetDateStr - "YYYY-MM-DD"
 * @returns {Array<object>} Array of deterministic ledger events
 */
export function generateDailyAllocationEvents(config, targetDateStr = null) {
  if (!config) return [];

  const effectiveDate = config.effectiveDate;
  const targetDate = targetDateStr || toLocalDateString(new Date());

  if (effectiveDate > targetDate) {
    return [];
  }

  const days = generateDateSequence(effectiveDate, targetDate);
  const events = [];

  days.forEach(dateStr => {
    const [y, m] = dateStr.split('-').map(Number);

    if (config.monthlyOnlineAllowance > 0) {
      const dailyOnline = getDailyAllocation(config.monthlyOnlineAllowance, y, m);
      events.push({
        id: `alloc_${dateStr}_${WALLET_TYPES.ONLINE}`,
        type: 'ALLOCATION',
        wallet: WALLET_TYPES.ONLINE,
        amount: dailyOnline,
        date: dateStr,
        source: 'allowance_engine',
        referenceId: config.id,
        metadata: {
          year: y,
          month: m,
          monthlyAllowance: config.monthlyOnlineAllowance,
          daysInMonth: getDaysInMonth(y, m)
        }
      });
    }

    if (config.monthlyCashAllowance > 0) {
      const dailyCash = getDailyAllocation(config.monthlyCashAllowance, y, m);
      events.push({
        id: `alloc_${dateStr}_${WALLET_TYPES.CASH}`,
        type: 'ALLOCATION',
        wallet: WALLET_TYPES.CASH,
        amount: dailyCash,
        date: dateStr,
        source: 'allowance_engine',
        referenceId: config.id,
        metadata: {
          year: y,
          month: m,
          monthlyAllowance: config.monthlyCashAllowance,
          daysInMonth: getDaysInMonth(y, m)
        }
      });
    }
  });

  return events;
}
