import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NO_FILTERS,
  accountBalance,
  adjustmentFor,
  applyFilters,
  balance,
  balancesByAccount,
  buildTransfer,
  byNewest,
  formatStamp,
  fromLocalInput,
  isFilterActive,
  isLive,
  live,
  monthOf,
  monthsPresent,
  round2,
  sortNewest,
  spentByCategory,
  toLocalInput,
  totalIn,
  totalOut,
  withRunningBalance,
  type Category,
  type Transaction,
} from './ledger'

let passed = 0
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: got ${JSON.stringify(actual)}`)
  passed++
}

let seq = 0
function tx(
  kind: 'in' | 'out',
  amount: number,
  occurred_at = `2026-03-0${++seq}T10:00:00.000Z`,
  extra: Partial<Transaction> = {},
): Transaction {
  return {
    id: `t${seq}`,
    kind,
    amount,
    category_id: null,
    note: '',
    occurred_at,
    ...extra,
  }
}

// The exact example from the request: 800 in, 30 spent, 770 left.
const example = [tx('in', 800, '2026-03-01T09:00:00.000Z'), tx('out', 30, '2026-03-02T12:30:00.000Z')]
check('800 in then 30 out leaves 770', balance(example), 770)
check('total in', totalIn(example), 800)
check('total out', totalOut(example), 30)
check('empty ledger is zero, not NaN', balance([]), 0)

check('spending more than you have goes negative', balance([tx('out', 100)]), -100)
check('float drift is rounded off', balance([tx('in', 0.1), tx('out', 0.2)]), -0.1)
check('many small amounts stay exact', balance([tx('in', 10.1), tx('out', 0.1), tx('out', 0.05)]), 9.95)
check('round2 half-up on cents', round2(1.005), 1.01)
check('zero amounts are allowed in maths', balance([tx('in', 0), tx('out', 0)]), 0)

// Order: the ledger is a statement, so newest first regardless of input order.
const shuffled = [
  tx('out', 30, '2026-03-02T12:30:00.000Z'),
  tx('in', 800, '2026-03-01T09:00:00.000Z'),
]
check('sorts newest first', sortNewest(shuffled).map((t) => t.amount), [30, 800])
check('sorting does not mutate the input', shuffled[0].amount, 30)
check('newest comparator orders by clock time, not just date', byNewest(
  { ...tx('in', 1, '2026-03-02T08:00:00.000Z') },
  { ...tx('in', 1, '2026-03-02T18:00:00.000Z') },
), 1)

const rows = withRunningBalance(example)
check('list is newest first', rows[0].kind, 'out')
check('newest row shows balance after it', rows[0].running, 770)
check('oldest row ends at current balance', rows[1].running, 770)
check('running balance accounts for every row', balance(example), rows[0].running)

// Only spending is broken down by category; income is not a category.
const categories: Category[] = [
  { id: 'c-food', name: 'Food', color: '#ef4444' },
  { id: 'c-gas', name: 'Gas', color: '#f59e0b' },
]
const mixed: Transaction[] = [
  tx('in', 800, '2026-03-01T09:00:00.000Z'),
  tx('out', 30, '2026-03-02T12:00:00.000Z', { category_id: 'c-food' }),
  tx('out', 20, '2026-03-02T13:00:00.000Z', { category_id: 'c-food' }),
  tx('out', 15, '2026-03-02T14:00:00.000Z', { category_id: 'c-gas' }),
  tx('out', 5, '2026-03-02T15:00:00.000Z'),
]
check('spending totals by category, highest first', spentByCategory(mixed, categories).map((r) => [r.category.name, r.total]), [
  ['Food', 50],
  ['Gas', 15],
])
check('uncategorised spending is excluded from the breakdown', spentByCategory(mixed, categories).length, 2)
check('balance ignores category entirely', balance(mixed), 730)

// Timestamps keep local wall-clock time when edited, so an entry made at 14:05
// is not silently stored as a different hour depending on where you are.
check('local input round trips', toLocalInput(fromLocalInput('2026-03-12T14:05')), '2026-03-12T14:05')
check('bad local input falls back to now', Number.isNaN(Date.parse(fromLocalInput('nonsense'))), false)
check('invalid stamp renders as a dash', formatStamp('not-a-date', 'en-US'), '—')
check('stamp includes the clock time', /\d{1,2}:\d{2}/.test(formatStamp('2026-03-12T14:05:00.000Z', 'en-US')), true)

// Filters
const f0 = tx('in', 800, '2026-03-01T09:00:00.000Z', { account_id: 'a-cash' })
const f1 = tx('out', 30, '2026-03-12T10:00:00.000Z', { category_id: 'c-food', account_id: 'a-cash' })
const f2 = tx('out', 20, '2026-02-02T11:00:00.000Z', { category_id: 'c-gas', account_id: 'a-card' })
const f3 = tx('out', 15, '2026-03-12T12:00:00.000Z', { category_id: 'c-food', account_id: 'a-card' })
const pool = [f0, f1, f2, f3]

check('no filters keeps everything', applyFilters(pool, NO_FILTERS).length, 4)
check('filters are inactive by default', isFilterActive(NO_FILTERS), false)
check('any filter counts as active', isFilterActive({ ...NO_FILTERS, month: '2026-03' }), true)
check('filter by direction', applyFilters(pool, { ...NO_FILTERS, kind: 'out' }).length, 3)
check('filter by direction in', applyFilters(pool, { ...NO_FILTERS, kind: 'in' }).map((t) => t.amount), [800])
check('filter by month', applyFilters(pool, { ...NO_FILTERS, month: '2026-03' }).length, 3)
check('filter by category', applyFilters(pool, { ...NO_FILTERS, category_id: 'c-food' }).length, 2)
check('filter by account', applyFilters(pool, { ...NO_FILTERS, account_id: 'a-card' }).length, 2)
check(
  'filters combine',
  applyFilters(pool, { ...NO_FILTERS, kind: 'out', month: '2026-03', account_id: 'a-card' })
    .map((t) => t.amount),
  [15],
)
check('filters that match nothing return empty', applyFilters(pool, { ...NO_FILTERS, month: '1999-01' }), [])
check('months present, newest first', monthsPresent(pool), ['2026-03', '2026-02'])
check('monthOf slices the year and month', monthOf('2026-03-12T10:00:00.000Z'), '2026-03')

// Reconciling with a real bank balance: one honest adjustment row, not a fake
// income or withdrawal invented to make the numbers appear to work.
check('lowering the balance books an outgoing adjustment', adjustmentFor(1000, 940), { kind: 'out', amount: 60 })
check('raising the balance books an incoming adjustment', adjustmentFor(940, 1000), { kind: 'in', amount: 60 })
check('a matching balance needs no entry at all', adjustmentFor(1000, 1000), null)
check('an adjustment from zero works', adjustmentFor(0, 250), { kind: 'in', amount: 250 })
check('an adjustment down past zero stays positive', adjustmentFor(100, 0)?.amount, 100)
check('adjustments are never negative', (adjustmentFor(100, 40)?.amount ?? 0) > 0, true)
check('float drift does not create a phantom 0.00 row', adjustmentFor(0.1 + 0.2, 0.3), null)
check('an adjustment to a negative balance is outgoing', adjustmentFor(0, -50), { kind: 'out', amount: 50 })
check('the adjustment makes the total match the target', balance([...pool, { ...tx('in', 1), kind: 'out', amount: 60 }]), 675)

// Per-account balances must still add up to the overall balance.
const perAccount = balancesByAccount(pool)
check('cash balance', perAccount.get('a-cash'), 770)
check('card balance', perAccount.get('a-card'), -35)
check(
  'account balances sum to the overall balance',
  [...perAccount.values()].reduce((a, b) => a + b, 0),
  balance(pool),
)
check('entries with no account are grouped separately', balancesByAccount([tx('in', 5)]).get(''), 5)
check('account with no entries is simply absent from the map', perAccount.has('a-savings'), false)
check('accountBalance reads one account', accountBalance(pool, 'a-card'), -35)
check('accountBalance of an untouched account is zero', accountBalance(pool, 'a-savings'), 0)

// A transfer is a matched pair, so the two accounts each move by the amount and
// the total does not move at all. This is the property that would break silently
// if transfers were ever stored any other way.
const before = balance(pool)
const { halves, transferId } = buildTransfer({
  fromAccountId: 'a-cash',
  toAccountId: 'a-savings',
  amount: 300,
  fromName: 'Cash',
  toName: 'Savings',
  transferId: 'tr-1',
})
check('transfer produces exactly two halves', halves.length, 2)
check('money leaves the source', halves[0].kind, 'out')
check('money arrives in the target', halves[1].kind, 'in')
check('both halves carry the same amount', halves[0].amount === halves[1].amount, true)
check('both halves share one transfer id', halves[0].transfer_id === halves[1].transfer_id, true)
check('transfer id is the requested one', transferId, 'tr-1')
check('halves point at opposite accounts', [halves[0].account_id, halves[1].account_id], [
  'a-cash',
  'a-savings',
])
check('transfer rows carry no category', halves[0].category_id, null)
const afterTransfer = [...pool, ...(halves as unknown as Transaction[])]
check('a transfer leaves the total untouched', balance(afterTransfer), before)
check('per-account balances still sum to the total', [...balancesByAccount(afterTransfer).values()].reduce((a, b) => a + b, 0), balance(afterTransfer))
check('source account lost the amount', accountBalance(afterTransfer, 'a-cash'), 470)
check('target account gained the amount', accountBalance(afterTransfer, 'a-savings'), 300)
check('a generated transfer id is not empty', buildTransfer({
  fromAccountId: 'x', toAccountId: 'y', amount: 1, fromName: 'X', toName: 'Y',
}).transferId.length > 0, true)

// Archiving keeps the record but removes the rows from every total, which is how
// deleting an account stops its old entries from still inflating the balance.
const archivedPool = [tx('in', 500, '2026-04-01T10:00:00.000Z', { account_id: 'a-doomed', archived: true }), tx('in', 10)]
check('archived rows are recognised', isLive(archivedPool[0]), false)
check('live rows are recognised', isLive(archivedPool[1]), true)
check('live() drops archived rows', live(archivedPool).length, 1)
check('archived rows do not count towards the total', balance(archivedPool), 10)
check('archived rows do not count towards in', totalIn(archivedPool), 10)
check('archived rows do not count towards out', totalOut(archivedPool), 0)
check('archived rows do not count per account', balancesByAccount(archivedPool).has('a-doomed'), false)
check('archived rows do not count in the category breakdown', spentByCategory(archivedPool, categories).length, 0)
check(
  'an archived row does not break the running balance',
  withRunningBalance(archivedPool).map((r) => r.running),
  [10, 10],
)
check('the balance of the remaining accounts is unchanged by archiving', accountBalance([...pool, ...archivedPool], 'a-cash'), 770)
check('and so is the total, apart from the two archivedPool rows themselves', balance([...pool, ...archivedPool]), balance(pool) + 10)

// The app talks to the `transactions`, `accounts` and `recurring_rules` tables.
// These guard the mistakes that broke it before: inserting without user_id, and
// querying a table a migration has retired.
const source = readFileSync(
  join(process.cwd(), 'src', 'app', 'sheet', 'BalanceTracker.tsx'),
  'utf8',
)
for (const table of ['transactions', 'accounts', 'recurring_rules']) {
  const re = new RegExp(
    String.raw`\.from\('` + table + String.raw`'\)\s*\.insert\(\{[\s\S]{0,200}?user_id`,
  )
  check(`${table} insert sends user_id`, re.test(source), true)
}
check('reads from transactions', /\.from\('transactions'\)/.test(source), true)
check('never references the retired expenses table', /'expenses'/.test(source), false)
check(
  'edits update scoped by id',
  /\.update\(payload\)\.eq\('id', editingId\)/.test(source),
  true,
)
check('never writes a negative amount', /amount:\s*-/.test(source), false)
check('no client-generated row ids', /id:\s*crypto\.randomUUID\(\)/.test(source), false)

console.log(`ledger: ${passed} assertions passed`)
