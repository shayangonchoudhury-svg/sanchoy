/**
 * SANCHOY UNIFIED MONOCHROME SVG ICON SYSTEM
 * Quiet, precise, editorial & financial icons
 * All icons inherit currentColor with consistent 1.75-2px stroke
 */

const SVG_ICONS = {
  // Navigation & Primary
  home: `<path d="M3 10.5L12 3l9 7.5v9.75a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H4.5A1.5 1.5 0 0 1 3 20.25V10.5z"/>`,
  charts: `<path d="M3 20.25h18M4.5 16.5l5.25-5.25 4.5 4.5 6-7.5M15.75 8.25h4.5v4.5"/>`,
  vault: `<path d="M12 2.25l8.25 3.75v6c0 5.25-3.5 10.125-8.25 11.25-4.75-1.125-8.25-6-8.25-11.25v-6L12 2.25z"/><circle cx="12" cy="11.25" r="2.25"/><path d="M12 13.5v3"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  profile: `<circle cx="12" cy="7.5" r="4"/><path d="M4.5 20.25a7.5 7.5 0 0 1 15 0"/>`,

  // Wallets & Holdings
  walletOnline: `<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.75h18M7.5 15h3"/>`,
  walletCash: `<rect x="3" y="5.25" width="18" height="13.5" rx="2.25"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/>`,
  card: `<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.75h18M7.5 15h3"/>`,
  banknote: `<rect x="3" y="5.25" width="18" height="13.5" rx="2.25"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/>`,
  holdings: `<rect x="3" y="3.75" width="18" height="16.5" rx="2.5"/><circle cx="12" cy="12" r="3.25"/><path d="M12 9v1M12 14v1M15 12h-1M10 12H9M6 7.5h.01M18 7.5h.01M6 16.5h.01M18 16.5h.01"/>`,

  // Actions
  plus: `<path d="M12 4.5v15M4.5 12h15"/>`,
  minus: `<path d="M4.5 12h15"/>`,
  add: `<circle cx="12" cy="12" r="9"/><path d="M12 8.25v7.5M8.25 12h7.5"/>`,
  expense: `<path d="M5.25 5.25l13.5 13.5M18.75 9.75v9h-9"/>`,
  income: `<path d="M18.75 18.75L5.25 5.25M5.25 14.25v-9h9"/>`,
  withdraw: `<path d="M7.5 9.75L3.75 6l3.75-3.75M3.75 6H15a6 6 0 0 1 6 6v1.5M16.5 14.25L20.25 18l-3.75 3.75M20.25 18H9a6 6 0 0 1-6-6v-1.5"/>`,
  deposit: `<path d="M12 3.75v10.5M7.5 9.75L12 14.25l4.5-4.5M4.5 18.75h15"/>`,
  spend: `<path d="M20.25 12.75l-7.5 7.5a2.25 2.25 0 0 1-3.18 0l-5.82-5.82a2.25 2.25 0 0 1-.66-1.59V4.5h8.34c.6 0 1.17.24 1.59.66l7.07 7.07a2.25 2.25 0 0 1 0 3.18z"/><circle cx="7.5" cy="7.5" r="1.5"/>`,
  allowance: `<path d="M3.75 6.75h16.5v13.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V6.75zM3.75 10.5h16.5M7.5 3.75v3M16.5 3.75v3M8.25 15l2.25 2.25 5.25-5.25"/>`,
  startingBalance: `<path d="M4.5 7.5h15v12a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-12zM9 7.5V5.25a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V7.5M4.5 12h15"/>`,
  backup: `<path d="M3.75 15.75v3a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-3M12 3.75v11.25M7.5 10.5l4.5 4.5 4.5-4.5"/>`,
  restore: `<path d="M3.75 15.75v3a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-3M12 15V3.75M7.5 8.25L12 3.75l4.5 4.5"/>`,
  exportCsv: `<path d="M14.25 3.75H5.25a1.5 1.5 0 0 0-1.5 1.5v13.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5V9.75L14.25 3.75zM14.25 3.75v6h6M8.25 13.5h7.5M8.25 16.5h4.5"/>`,
  delete: `<path d="M4.5 7.5h15M9 7.5V4.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3M6 7.5l.75 12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5l.75-12M10 11.25v6M14 11.25v6"/>`,
  trash: `<path d="M4.5 7.5h15M9 7.5V4.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3M6 7.5l.75 12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5l.75-12M10 11.25v6M14 11.25v6"/>`,
  edit: `<path d="M16.5 3.75l3.75 3.75L7.5 20.25H3.75v-3.75L16.5 3.75z"/>`,
  copy: `<rect x="8.25" y="8.25" width="12" height="12" rx="2"/><path d="M4.5 15.75v-10.5a1.5 1.5 0 0 1 1.5-1.5h10.5"/>`,
  sync: `<path d="M21 12a9 9 0 0 1-15.36 6.36L3.75 16.5M3 12a9 9 0 0 1 15.36-6.36L20.25 7.5M3.75 12v4.5h4.5M20.25 12V7.5h-4.5"/>`,
  globe: `<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18"/>`,
  leaf: `<path d="M20.25 3.75s-7.5.75-12 5.25c-3.75 3.75-3.75 9.75-3.75 9.75s6 0 9.75-3.75c4.5-4.5 5.25-12 5.25-12zM8.25 15.75l7.5-7.5"/>`,
  lightbulb: `<path d="M12 3a6 6 0 0 0-6 6c0 2.25 1.5 4.5 2.25 6h7.5c.75-1.5 2.25-3.75 2.25-6a6 6 0 0 0-6-6zM9.75 18h4.5M10.5 21h3"/>`,
  sparkles: `<path d="M12 3v3m0 12v3m9-9h-3M6 12H3m14.364-5.364l-2.121 2.121M8.757 15.243l-2.121 2.121m0-11.314l2.121 2.121m6.486 6.486l2.121 2.121"/>`,

  // Security & Authentication
  lock: `<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.25"/><path d="M7.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75"/>`,
  unlock: `<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.25"/><path d="M7.5 10.5V6.75a4.5 4.5 0 0 1 8.85-1.15"/>`,
  key: `<path d="M14.25 9.75a4.5 4.5 0 1 0-6.19 6.19L3.75 20.25v2.25h2.25v-1.5h1.5v-1.5h1.5l2.06-2.06a4.5 4.5 0 0 0 3.19-7.69z"/><circle cx="15.75" cy="8.25" r="1.125"/>`,
  logout: `<path d="M15 3.75h4.5a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5H15M9.75 16.5l4.5-4.5-4.5-4.5M14.25 12H3.75"/>`,

  // Status & Utility
  eye: `<path d="M2.25 12c1.75-4.5 5.5-7.5 9.75-7.5s8 3 9.75 7.5c-1.75 4.5-5.5 7.5-9.75 7.5s-8-3-9.75-7.5z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff: `<path d="M2.25 2.25l19.5 19.5M10.3 10.3a3 3 0 0 0 4.24 4.24M7.5 7.8A10.8 10.8 0 0 0 2.25 12c1.75 4.5 5.5 7.5 9.75 7.5 2.1 0 4.05-.75 5.67-2.04M16.5 16.2A10.8 10.8 0 0 0 21.75 12c-1.75-4.5-5.5-7.5-9.75-7.5-1.14 0-2.25.21-3.27.6"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.25v2.25M12 19.5v2.25M4.22 4.22l1.59 1.59M18.19 18.19l1.59 1.59M2.25 12h2.25M19.5 12h2.25M4.22 19.78l1.59-1.59M18.19 5.81l1.59-1.59"/>`,
  moon: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  warning: `<path d="M12 3.75L2.25 20.25h19.5L12 3.75zM12 9v5.25M12 17.25h.01"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11.25v4.5M12 8.25h.01"/>`,
  check: `<path d="M4.5 12.75l5.25 5.25 9.75-10.5"/>`,
  close: `<path d="M6 6l12 12M6 18L18 6"/>`,
  calendar: `<rect x="3.75" y="5.25" width="16.5" height="15" rx="2.25"/><path d="M3.75 9.75h16.5M8.25 3v3M15.75 3v3"/>`,
  lightning: `<path d="M12.75 2.25L4.5 13.5h6.75l-1.5 8.25 9.75-12h-6.75l1.5-7.5z"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6.75"/><path d="M15.75 15.75L21 21"/>`,
  filter: `<path d="M3.75 5.25h16.5l-6.75 7.875v5.625l-3 1.5v-7.125L3.75 5.25z"/>`,
  note: `<path d="M19.5 5.25H4.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5V6.75a1.5 1.5 0 0 0-1.5-1.5zM7.5 9.75h9M7.5 14.25h6"/>`,
  scale: `<path d="M12 3v18M5 6.75h14M8.25 6.75L4.5 13.5a3.75 3.75 0 0 0 7.5 0L8.25 6.75zM15.75 6.75L12 13.5a3.75 3.75 0 0 0 7.5 0l-3.75-6.75z"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  chevronUp: `<path d="M18 15l-6-6-6 6"/>`,
  chevronRight: `<path d="M9 18l6-6-6-6"/>`,

  // Transaction Categories (Quiet, editorial, monochrome)
  food: `<path d="M5.25 3.75v5.25a2.25 2.25 0 0 0 2.25 2.25v9M9.75 3.75v5.25a2.25 2.25 0 0 1-2.25 2.25M7.5 3.75v4.5M16.5 3.75v16.5a2.25 2.25 0 0 1-2.25-2.25v-8.25a6 6 0 0 1 6-6h-3.75z"/>`,
  shopping: `<path d="M6 8.25h12l1.5 12H4.5L6 8.25zM9 8.25V6a3 3 0 0 1 6 0v2.25"/>`,
  transport: `<rect x="3.75" y="6" width="16.5" height="11.25" rx="3"/><circle cx="7.5" cy="17.25" r="1.5"/><circle cx="16.5" cy="17.25" r="1.5"/><path d="M3.75 11.25h16.5M6 6l1.5-2.25h9L18 6"/>`,
  entertainment: `<rect x="3.75" y="4.5" width="16.5" height="15" rx="2.25"/><path d="M9.75 9l5.25 3-5.25 3V9z"/>`,
  bills: `<path d="M5.25 3.75h13.5v16.5l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5V3.75zM8.25 8.25h7.5M8.25 12h7.5M8.25 15.75h4.5"/>`,
  health: `<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9"/>`,
  study: `<path d="M3.75 6.75A3 3 0 0 1 6.75 3.75H12v15H6.75a3 3 0 0 0-3 3V6.75zM20.25 6.75A3 3 0 0 0 17.25 3.75H12v15h5.25a3 3 0 0 1 3 3V6.75z"/>`,
  other: `<path d="M12 3.75L3.75 8.25v7.5L12 20.25l8.25-4.5v-7.5L12 3.75zM12 11.25L3.75 7M12 11.25l8.25-4.25M12 11.25v9"/>`,
  salary: `<rect x="3.75" y="6.75" width="16.5" height="13.5" rx="2.25"/><path d="M8.25 6.75V4.5a1.5 1.5 0 0 1 1.5-1.5h4.5a1.5 1.5 0 0 1 1.5 1.5v2.25M3.75 11.25h16.5M10.5 14.25h3"/>`,
  freelance: `<rect x="4.5" y="4.5" width="15" height="11.25" rx="2"/><path d="M2.25 18.75h19.5M9.75 8.25l-2.25 2.25 2.25 2.25M14.25 8.25l2.25 2.25-2.25 2.25"/>`,
  gift: `<rect x="4.5" y="9" width="15" height="11.25" rx="1.5"/><path d="M3 6.75h18v3H3zM12 6.75v13.5M12 6.75c-1.5 0-3-1.5-3-2.625 0-.75.6-1.125 1.5-1.125 1.5 0 2.25 2.25 2.25 3.75zM12 6.75c1.5 0 3-1.5 3-2.625 0-.75-.6-1.125-1.5-1.125-1.5 0-2.25 2.25-2.25 3.75z"/>`,
  refund: `<path d="M3 10.5h10.5a5.25 5.25 0 0 1 5.25 5.25v.75M3 10.5l4.5-4.5M3 10.5l4.5 4.5"/>`
};

/**
 * Returns an accessible, consistent monochrome SVG string
 * @param {string} name - The icon key
 * @param {object} [options]
 * @param {string} [options.size='w-4 h-4'] - Tailwind size class (e.g. 'w-4 h-4', 'w-5 h-5')
 * @param {string} [options.className=''] - Additional Tailwind classes
 * @param {number} [options.strokeWidth=1.75] - Stroke weight
 * @param {string} [options.ariaLabel=''] - Optional accessibility label
 * @returns {string} SVG HTML string
 */
export function getIcon(name, options = {}) {
  const innerPath = SVG_ICONS[name] || SVG_ICONS.other;
  const size = options.size || 'w-4 h-4';
  const className = options.className || '';
  const strokeWidth = options.strokeWidth || 1.75;
  const ariaAttr = options.ariaLabel
    ? `role="img" aria-label="${options.ariaLabel}"`
    : `aria-hidden="true"`;

  return `<svg class="${size} ${className} inline-block shrink-0 align-middle" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ${ariaAttr}>${innerPath}</svg>`;
}

/**
 * Maps financial transaction categories to quiet monochrome SVG icons
 * @param {string} category - Category name
 * @param {boolean} [isExpense=true] - Whether transaction is an expense
 * @param {object} [options={}] - Custom icon options
 * @returns {string} SVG HTML string
 */
export function getCategoryIcon(category, isExpense = true, options = {}) {
  const norm = String(category || '').trim();
  const catMap = {
    'Food & Dining': 'food',
    'Shopping': 'shopping',
    'Transport': 'transport',
    'Entertainment': 'entertainment',
    'Bills': 'bills',
    'Health': 'health',
    'Study Material': 'study',
    'Other': 'other',
    'Allowance / Pocket Money': 'walletCash',
    'Salary / Internship': 'salary',
    'Freelance': 'freelance',
    'Gift': 'gift',
    'Refund': 'refund',
    'Other Income': 'holdings'
  };

  const iconName = catMap[norm] || (isExpense ? 'card' : 'banknote');
  const size = options.size || 'w-4 h-4';
  return getIcon(iconName, { size, ...options });
}

export default { getIcon, getCategoryIcon };
