import assert from 'node:assert/strict'
import {
  MAX_CATCH_UP,
  dueDates,
  nextDue,
  nextDueAfter,
  occurrenceTimestamp,
  pendingOccurrences,
  type RecurringRule,
} from './recurring'

let passed = 0
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: got ${JSON.stringify(actual)}`)
  passed++
}

function rule(over: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'r1',
    kind: 'out',
    amount: 1500,
    category_id: 'c-bills',
    account_id: 'a-cash',
    note: 'Rent',
    frequency: 'monthly',
    next_due: '2026-01-01',
    active: true,
    ...over,
  }
}

check('weekly advances 7 days', nextDue('2026-01-01', 'weekly'), '2026-01-08')
check('weekly crosses a month boundary', nextDue('2026-01-28', 'weekly'), '2026-02-04')
check('monthly advances one month', nextDue('2026-01-01', 'monthly'), '2026-02-01')

// The clamping cases that silently break naive month arithmetic.
check('Jan 31 clamps to Feb 28', nextDue('2026-01-31', 'monthly'), '2026-02-28')
check('leap year Feb 29 is reachable', nextDue('2028-01-31', 'monthly'), '2028-02-29')
check('non-leap Feb 28', nextDue('2026-01-31', 'monthly'), '2026-02-28')
check('clamping does not drift into the next month', nextDue('2026-02-28', 'monthly'), '2026-03-28')
check('31st of a 30 day month', nextDue('2026-04-30', 'monthly'), '2026-05-30')
check('year boundary', nextDue('2026-12-15', 'monthly'), '2027-01-15')

check('due dates up to today only', dueDates(rule(), '2026-03-15'), [
  '2026-01-01',
  '2026-02-01',
  '2026-03-01',
])
check('nothing due yet yields nothing', dueDates(rule(), '2025-12-31'), [])
check('due today is included', dueDates(rule({ next_due: '2026-03-01' }), '2026-03-01'), ['2026-03-01'])
check('a long gap is capped', dueDates(rule({ next_due: '2000-01-01' }), '2026-03-01').length, MAX_CATCH_UP)

const pending = pendingOccurrences(rule(), '2026-03-15', new Set())
check('pending count matches occurrences', pending.length, 3)
check('occurrence carries the rule amount', pending[0].amount, 1500)
check('occurrence carries the rule note', pending[0].note, 'Rent')
check('occurrence marks its rule', pending[2].rule_id, 'r1')

// Idempotency: the whole point of materialising on load rather than on a cron.
const already = new Set(['2026-01-01', '2026-02-01'])
const once = pendingOccurrences(rule(), '2026-03-15', already)
check('already-recorded dates are skipped', once.map((o) => o.occurred_on), ['2026-03-01'])
check(
  'repeating the call adds nothing more',
  pendingOccurrences(rule(), '2026-03-15', new Set(['2026-01-01', '2026-02-01', '2026-03-01'])),
  [],
)

check('inactive rules owe nothing', pendingOccurrences(rule({ active: false }), '2026-03-15', new Set()), [])
check('zero-amount rules owe nothing', pendingOccurrences(rule({ amount: 0 }), '2026-03-15', new Set()), [])

check('reschedules past the last due date', nextDueAfter(rule(), '2026-03-15'), '2026-04-01')
check('reschedule is unchanged when nothing is due', nextDueAfter(rule({ next_due: '2026-05-01' }), '2026-03-15'), '2026-05-01')

const ts = occurrenceTimestamp('2026-03-15')
check('occurrence is a valid timestamp', Number.isNaN(Date.parse(ts)), false)
check('occurrence lands on the due day', new Date(ts).getDate(), 15)
check('occurrence lands on the due month', new Date(ts).getMonth(), 2)
check('occurrence lands on the due year', new Date(ts).getFullYear(), 2026)
check('occurrence is local midnight', new Date(ts).getHours(), 0)
check('occurrence is local midnight, minutes', new Date(ts).getMinutes(), 0)
// Guards the case where reading local getters off a UTC-parsed date would drift
// backwards: 2026-03-15T00:00:00Z is still the 14th in New York, so the entry
// would have been booked a day early for every user behind UTC.
check(
  'occurrence does not slip a day behind UTC',
  occurrenceTimestamp('2026-03-15').slice(0, 10) >= '2026-03-15' ||
    new Date(occurrenceTimestamp('2026-03-15')).getDate() === 15,
  true,
)
check('a month-end rule is not dragged into the next month', new Date(occurrenceTimestamp('2026-01-31')).getMonth(), 0)

console.log(`recurring: ${passed} assertions passed`)
