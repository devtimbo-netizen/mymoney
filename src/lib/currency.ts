export type CurrencyCode = (typeof CURRENCIES)[number]['code']

export const CURRENCIES = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'ج.م' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
] as const

export const DEFAULT_CURRENCY: CurrencyCode = 'SAR'

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCIES.some((c) => c.code === value)
}

export function currencyName(code: CurrencyCode): string {
  return CURRENCIES.find((c) => c.code === code)?.name ?? code
}

/**
 * Formatting locale is pinned rather than left to the runtime default.
 *
 * `Intl` resolves `undefined` to the host locale, which differs between the
 * Node server (en-US) and the user's browser (possibly ar-SA). That produces
 * different markup for the same value and breaks React hydration, so the
 * locale is fixed here. Input parsing stays lenient instead, since a pasted
 * bank statement can use either separator convention.
 */
export const DISPLAY_LOCALE = 'en-US'

const formatterCache = new Map<string, Intl.NumberFormat>()

function getFormatter(code: CurrencyCode): Intl.NumberFormat {
  const cached = formatterCache.get(code)
  if (cached) return cached
  const formatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  formatterCache.set(code, formatter)
  return formatter
}

/** Format an amount in the given currency, e.g. "ر.س 1,234.50". */
export function formatMoney(value: number, code: CurrencyCode): string {
  if (!Number.isFinite(value)) return '—'
  try {
    return getFormatter(code).format(value)
  } catch {
    return `${code} ${value.toFixed(2)}`
  }
}

/** Plain grouped number with no symbol, for grid cells. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  return value.toLocaleString(DISPLAY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const SYMBOL_CHARS = /[^\d.,\-]/g

// Multi-character symbols first: several of them contain a period or comma
// ("ر.س", "د.إ"), which would otherwise be misread as decimal separators.
const SYMBOLS = [
  'ر.س',
  'ر.ق',
  'ر.ع',
  'د.إ',
  'د.ك',
  'د.ا',
  'ج.م',
  'د.ب',
  'SR',
  'SAR',
  'AED',
  'USD',
  'EUR',
  'GBP',
]

/**
 * Parse user-typed amounts tolerantly: strips currency symbols, thousands
 * separators and spaces, then accepts either decimal convention.
 *
 *   "1,234.50"  -> 1234.5   (en-US grouping)
 *   "1.234,50"  -> 1234.5   (de-DE grouping)
 *   "ر.س 1 234" -> 1234
 */
export function parseAmount(input: string): number | null {
  let s = input.trim()
  if (s === '') return null

  const upper = s.toUpperCase()
  for (const sym of SYMBOLS) {
    if (upper.includes(sym.toUpperCase())) {
      s = s.replace(new RegExp(sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
      break
    }
  }

  s = s.replace(SYMBOL_CHARS, '')
  if (s === '' || s === '-') return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // Whichever separator comes last is the decimal point.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    // A single comma with 1-2 trailing digits is a decimal comma.
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (hasDot) {
    // Multiple dots mean thousands grouping, e.g. "1.234.567".
    if ((s.match(/\./g) ?? []).length > 1 && !/\.\d{1,2}$/.test(s)) {
      s = s.replace(/\./g, '')
    }
  }

  if (s.startsWith('-')) s = `-${s.slice(1).replace(/^-+/, '')}`
  if (s.startsWith('+')) s = s.slice(1)

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}
