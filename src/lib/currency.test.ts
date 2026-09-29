import assert from 'node:assert/strict'
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  DISPLAY_LOCALE,
  currencyName,
  formatMoney,
  formatNumber,
  isCurrencyCode,
  parseAmount,
} from './currency'

let passed = 0
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: got ${JSON.stringify(actual)}`)
  passed++
}

check('default is SAR', DEFAULT_CURRENCY, 'SAR')
check('SAR is listed', isCurrencyCode('SAR'), true)
check('unknown code rejected', isCurrencyCode('XYZ'), false)
check('lowercase rejected', isCurrencyCode('sar'), false)
check('SAR name', currencyName('SAR'), 'Saudi Riyal')
check('no duplicate codes', new Set(CURRENCIES.map((c) => c.code)).size, CURRENCIES.length)

// Output must not depend on the host locale, or the Node server and the browser
// emit different markup and React hydration fails. These exact strings are the
// regression guard for that bug.
const nbsp = (s: string) => s.replace(/\u00a0/g, ' ')

check('locale is pinned', DISPLAY_LOCALE, 'en-US')
check('SAR renders ASCII in any host locale', nbsp(formatMoney(1234.5, 'SAR')), 'SAR 1,234.50')
check('USD renders ASCII in any host locale', formatMoney(1234.5, 'USD'), '$1,234.50')
check('EUR renders ASCII in any host locale', formatMoney(1234.5, 'EUR'), '€1,234.50')
check('grid numbers always use comma grouping', formatNumber(1234567.5), '1,234,567.50')
check(
  'SAR code is separated by a non-breaking space',
  /SAR\u00a0/.test(formatMoney(1234.5, 'SAR')),
  true,
)
check(
  'no arabic-Indic digits leak into output',
  /[٠-٩]/.test(formatMoney(1234.5, 'SAR') + formatNumber(1234.5)),
  false,
)

check('parses plain number', parseAmount('100'), 100)
check('parses decimal', parseAmount('12.34'), 12.34)
check('parses negative', parseAmount('-45.99'), -45.99)
check('parses leading plus', parseAmount('+7'), 7)
check('parses spaces', parseAmount('  42  '), 42)
check('blank is null', parseAmount(''), null)
check('whitespace only is null', parseAmount('   '), null)
check('junk is null', parseAmount('abc'), null)
check('symbol stripped', parseAmount('$1,200.50'), 1200.5)
check('sar symbol stripped', parseAmount('ر.س 1,200.50'), 1200.5)
check('space grouping stripped', parseAmount('ر.س 1 200.50'), 1200.5)
check('us grouping', parseAmount('1,234.56'), 1234.56)
check('eu decimal comma', parseAmount('1.234,56'), 1234.56)
check('eu thousands only', parseAmount('1,234'), 1234)
check('single comma decimal', parseAmount('12,34'), 12.34)
check('chained dot grouping', parseAmount('1.234.567'), 1234567)
check('rounds to cents', parseAmount('10.005'), 10.01)
check('bare minus is null', parseAmount('-'), null)
check('double minus normalises', parseAmount('--5'), -5)
check('no thousands collapse', parseAmount('1,500'), 1500)

check('formatMoney includes digits', /\d/.test(formatMoney(1234.5, 'SAR')), true)
check('formatMoney renders 2dp', /1,234\.50|1234\.50/.test(formatMoney(1234.5, 'SAR')), true)
check('formatMoney zero', /\d/.test(formatMoney(0, 'SAR')), true)
check('formatMoney handles NaN', formatMoney(Number.NaN, 'SAR'), '—')
check('formatMoney handles Infinity', formatMoney(Number.POSITIVE_INFINITY, 'SAR'), '—')
check('formatMoney negative', formatMoney(-50, 'USD').includes('50'), true)
check('formatNumber has no symbol', /[^\d.,\-]/.test(formatNumber(1234.5)), false)
check('formatNumber 2dp', /1,234\.50|1234\.50/.test(formatNumber(1234.5)), true)

for (const c of CURRENCIES) {
  const out = formatMoney(1234.5, c.code)
  check(`${c.code} formats`, /\d/.test(out) && out !== '—', true)
}

console.log(`currency: ${passed} assertions passed`)
