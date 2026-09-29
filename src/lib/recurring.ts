/**
 * Recurring entries.
 *
 * Rules are not applied with a background job. When the app loads, any rule
 * whose next_due date has passed is turned into real transactions, up to today.
 * A unique index on (recurring_rule_id, occurred_on) makes this idempotent, so
 * opening the app ten times still produces exactly one entry per occurrence.
 *
 * Keeping this pure and separate from the database means the awkward parts -
 * month-end dates, leap years, catching up several periods at once - are
 * testable without a live database.
 */

export type RecurringRule = {
  id: string
  kind: 'in' | 'out'
  amount: number
  category_id: string | null
  account_id: string | null
  note: string
  frequency: 'weekly' | 'monthly'
  next_due: string // 'YYYY-MM-DD'
  active: boolean
}

export type Occurrence = {
  rule_id: string
  kind: 'in' | 'out'
  amount: number
  category_id: string | null
  account_id: string | null
  note: string
  occurred_on: string // 'YYYY-MM-DD'
}

/** Guards against a rule with a wildly wrong date producing thousands of rows. */
export const MAX_CATCH_UP = 24

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Advances a due date by one period.
 *
 * Months are clamped rather than overflowing: the 31st of January plus a month
 * is the 28th of February, not the 3rd of March. Without this, a rule set up on
 * the 29th or 30th would silently drift into the following month.
 */
export function nextDue(current: string, frequency: 'weekly' | 'monthly'): string {
  const d = parseDate(current)
  if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7)
    return formatDate(d)
  }
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return formatDate(d)
}

/** Every due date from `next_due` up to and including `until`, newest last. */
export function dueDates(rule: RecurringRule, until: string): string[] {
  const dates: string[] = []
  let cursor = rule.next_due
  while (cursor <= until) {
    dates.push(cursor)
    const advanced = nextDue(cursor, rule.frequency)
    if (advanced <= cursor) break // never loop forever on a malformed date
    cursor = advanced
    if (dates.length >= MAX_CATCH_UP) break
  }
  return dates
}

/**
 * The occurrences a rule still owes, minus any already recorded. Excluding the
 * existing ones is what makes repeated loads safe even if the unique index were
 * ever removed.
 */
export function pendingOccurrences(
  rule: RecurringRule,
  until: string,
  alreadyRecorded: Set<string>,
): Occurrence[] {
  if (!rule.active || rule.amount <= 0) return []
  return dueDates(rule, until)
    .filter((d) => !alreadyRecorded.has(d))
    .map((occurred_on) => ({
      rule_id: rule.id,
      kind: rule.kind,
      amount: rule.amount,
      category_id: rule.category_id,
      account_id: rule.account_id,
      note: rule.note,
      occurred_on,
    }))
}

/** The date a rule should be rescheduled to once everything due is recorded. */
export function nextDueAfter(rule: RecurringRule, until: string): string {
  const dates = dueDates(rule, until)
  if (dates.length === 0) return rule.next_due
  return nextDue(dates[dates.length - 1], rule.frequency)
}

/**
 * Local midnight on the due date, so a recurring entry is predictable and shows
 * up on the day the user actually chose.
 *
 * The components are read from the string and used to build a local date, rather
 * than reading local getters off a UTC-parsed Date. That second approach is
 * wrong anywhere behind UTC: 2026-09-27T00:00:00Z is 20:00 on the 26th in
 * New York, so getDate() returns 26 and the entry silently lands a day early.
 */
export function occurrenceTimestamp(occurred_on: string): string {
  const [y, m, d] = occurred_on.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}
