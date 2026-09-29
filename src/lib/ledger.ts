export type Kind = 'in' | 'out'

export type Transaction = {
  id: string
  kind: Kind
  amount: number
  category_id: string | null
  note: string
  occurred_at: string
  account_id?: string | null
  /** Set only for entries produced by a recurring rule. */
  recurring_rule_id?: string | null
  occurred_on?: string | null
  /**
   * Set on both halves of a transfer, so the two rows can be recognised and
   * removed together. Undefined/absent on ordinary entries.
   */
  transfer_id?: string | null
  /**
   * Archived entries stay in the database for the record but stop counting
   * towards any balance. Used when an account is deleted: its rows keep their
   * history, but must not keep inflating the total after the account is gone.
   */
  archived?: boolean
}

export type Category = {
  id: string
  name: string
  color: string
}

export type Account = {
  id: string
  name: string
  kind: 'cash' | 'card' | 'savings'
  created_at?: string
}

export type Filters = {
  kind: 'all' | Kind
  month: string // 'YYYY-MM', or '' for every month
  category_id: string // '' for every category
  account_id: string // '' for every account
}

export const NO_FILTERS: Filters = {
  kind: 'all',
  month: '',
  category_id: '',
  account_id: '',
}

export function isFilterActive(f: Filters): boolean {
  return f.kind !== 'all' || f.month !== '' || f.category_id !== '' || f.account_id !== ''
}

export function matchesFilters(t: Transaction, f: Filters): boolean {
  if (f.kind !== 'all' && t.kind !== f.kind) return false
  if (f.month && monthOf(t.occurred_at) !== f.month) return false
  if (f.category_id && t.category_id !== f.category_id) return false
  if (f.account_id && t.account_id !== f.account_id) return false
  return true
}

export function applyFilters(transactions: Transaction[], f: Filters): Transaction[] {
  return transactions.filter((t) => matchesFilters(t, f))
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** Newest distinct months present in the data, for the month picker. */
export function monthsPresent(transactions: Transaction[]): string[] {
  const seen = new Set<string>()
  for (const t of transactions) {
    if (t.occurred_at) seen.add(monthOf(t.occurred_at))
  }
  return [...seen].sort().reverse()
}

/** Drops archived entries, which are kept for the record but never counted. */
export function isLive(t: Transaction): boolean {
  return t.archived !== true
}

export function live(transactions: Transaction[]): Transaction[] {
  return transactions.filter(isLive)
}

/** Balance per account id. Entries with no account are grouped under ''. */
export function balancesByAccount(transactions: Transaction[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const t of transactions) {
    if (!isLive(t)) continue
    const key = t.account_id ?? ''
    totals.set(key, round2((totals.get(key) ?? 0) + (t.kind === 'in' ? t.amount : -t.amount)))
  }
  return totals
}

/** Balance of one account, or 0 when it has no entries at all. */
export function accountBalance(transactions: Transaction[], accountId: string): number {
  return balancesByAccount(transactions).get(accountId) ?? 0
}

/** Which balance a correction is measured against. */
export type AdjustScope = 'account' | 'total'

/**
 * The number a correction should be compared to.
 *
 * This has to be explicit, because measuring every correction against the
 * grand total silently rewrites the other accounts. Correcting one account to
 * 120 while the total is 300 used to book a 180 withdrawal into that account,
 * dragging the others along. When the scope is 'account', only that account
 * moves; the others keep their own figures.
 */
export function currentBalanceFor(
  transactions: Transaction[],
  scope: AdjustScope,
  accountId: string | null,
): number {
  if (scope === 'total') return balance(transactions)
  return accountBalance(transactions, accountId ?? '')
}


/** Rounds to whole cents, avoiding float drift like 770.0000000001. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * The balance is the signed sum of every entry. Money in adds, money out
 * subtracts, so 800 in then 30 out leaves 770.
 */
export function balance(transactions: Transaction[]): number {
  return round2(
    live(transactions).reduce((sum, t) => sum + (t.kind === 'in' ? t.amount : -t.amount), 0),
  )
}

export function totalIn(transactions: Transaction[]): number {
  return round2(
    live(transactions).filter((t) => t.kind === 'in').reduce((sum, t) => sum + t.amount, 0),
  )
}

export function totalOut(transactions: Transaction[]): number {
  return round2(
    live(transactions).filter((t) => t.kind === 'out').reduce((sum, t) => sum + t.amount, 0),
  )
}

/** Newest first, with a stable tiebreak so equal timestamps keep input order. */
export function byNewest(a: Transaction, b: Transaction): number {
  if (a.occurred_at === b.occurred_at) return a.id < b.id ? 1 : -1
  return a.occurred_at < b.occurred_at ? 1 : -1
}

export function sortNewest(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(byNewest)
}

export type LedgerEntry = Transaction & { running: number }

/**
 * Newest-first rows plus the balance after each one, so the list reads like a
 * statement. The oldest row ends at the current balance.
 */
export function withRunningBalance(
  transactions: Transaction[],
  order: Transaction[] = sortNewest(transactions),
): LedgerEntry[] {
  const chronological = [...order].reverse()
  const running = new Map<string, number>()
  let sum = 0
  for (const t of chronological) {
    if (isLive(t)) sum = round2(sum + (t.kind === 'in' ? t.amount : -t.amount))
    running.set(t.id, sum)
  }
  return order.map((t) => ({ ...t, running: running.get(t.id) ?? 0 }))
}

export function spentByCategory(
  transactions: Transaction[],
  categories: Category[],
): { category: Category; total: number }[] {
  const totals = new Map<string, number>()
  for (const t of transactions) {
    if (!isLive(t) || t.kind !== 'out' || !t.category_id) continue
    totals.set(t.category_id, round2((totals.get(t.category_id) ?? 0) + t.amount))
  }
  return categories
    .map((category) => ({ category, total: totals.get(category.id) ?? 0 }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
}

/** A transfer row, before the database assigns an id. */
export type TransferHalf = {
  kind: Kind
  amount: number
  category_id: null
  note: string
  occurred_at: string
  account_id: string
  transfer_id: string
}

/**
 * A transfer between two accounts is written as a matched pair of ordinary
 * entries: money out of one, money into the other, same amount, same instant,
 * sharing a transfer_id.
 *
 * Doing it this way rather than with a separate transfers table is what keeps
 * the central promise of this app intact: the total is always just the signed
 * sum of the rows. A transfer therefore cannot change the total (one -X, one
 * +X), it needs no special case in the balance maths, and each half shows up
 * in the history and filters like any other entry.
 */
export function buildTransfer(opts: {
  fromAccountId: string
  toAccountId: string
  amount: number
  at?: string
  fromName: string
  toName: string
  transferId?: string
}): { halves: [TransferHalf, TransferHalf]; transferId: string } {
  const transferId = opts.transferId ?? newTransferId()
  const occurred_at = opts.at ?? new Date().toISOString()
  return {
    transferId,
    halves: [
      {
        kind: 'out',
        amount: opts.amount,
        category_id: null,
        note: `To ${opts.toName}`,
        occurred_at,
        account_id: opts.fromAccountId,
        transfer_id: transferId,
      },
      {
        kind: 'in',
        amount: opts.amount,
        category_id: null,
        note: `From ${opts.fromName}`,
        occurred_at,
        account_id: opts.toAccountId,
        transfer_id: transferId,
      },
    ],
  }
}

function newTransferId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Works out the single entry needed to move the balance from where it is to
 * where the user says it really is.
 *
 * This is how the app reconciles with a real bank balance. The alternative -
 * inventing a matching "income" or "withdrawal" so the numbers appear to add up
 * - would leave a false story in the history that is painful to unpick later.
 * One honestly-labelled adjustment is both fewer rows and more truthful, and it
 * can be deleted in a tap once the real transaction shows up.
 *
 * Returns null when there is nothing to do, so a no-op cannot create a 0.00 row
 * (the database would accept one, and it would clutter the history forever).
 */
export function adjustmentFor(
  currentBalance: number,
  targetBalance: number,
): { kind: Kind; amount: number } | null {
  const delta = round2(targetBalance - currentBalance)
  if (delta === 0) return null
  return delta > 0 ? { kind: 'in', amount: delta } : { kind: 'out', amount: round2(-delta) }
}

/** Value for a datetime-local input, which wants `YYYY-MM-DDTHH:mm` in local time. */
export function toLocalInput(iso: string): string {  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Converts local wall-clock input back to a real UTC instant. */
export function fromLocalInput(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/** e.g. "12 Mar 2026, 14:05" in the viewer's own timezone. */
export function formatStamp(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}
