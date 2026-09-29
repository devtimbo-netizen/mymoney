'use client'

import { useCallback, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { signOut } from '@/app/actions'
import EntryForm, { draftFrom, type EntryDraft } from '@/components/EntryForm'
import RecurringPanel from '@/components/RecurringPanel'
import { AccountManager } from '@/components/AccountManager'
import { AdminPanel, isAdmin } from '@/components/AdminPanel'
import { DISPLAY_LOCALE, formatMoney, parseAmount, type CurrencyCode } from '@/lib/currency'
import {
  NO_FILTERS,
  accountBalance,
  adjustmentFor,
  applyFilters,
  balance,
  balancesByAccount,
  buildTransfer,
  currentBalanceFor,
  formatStamp,
  fromLocalInput,
  isFilterActive,
  live,
  monthOf,
  monthsPresent,
  spentByCategory,
  toLocalInput,
  totalIn,
  totalOut,
  withRunningBalance,
  type Account,
  type AdjustScope,
  type Category,
  type Filters,
  type Kind,
  type Transaction,
} from '@/lib/ledger'
import type { RecurringRule } from '@/lib/recurring'

type Tab = 'list' | 'recurring' | 'accounts' | 'admin'

export default function BalanceTracker({
  initialTransactions,
  initialCategories,
  initialAccounts,
  initialRules,
  initialCurrency,
  userId,
  email,
}: {
  initialTransactions: Transaction[]
  initialCategories: Category[]
  initialAccounts: Account[]
  initialRules: RecurringRule[]
  initialCurrency: CurrencyCode
  userId: string
  email: string
}) {
  const supabase = useMemo(() => createClient(), [])

  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions)
  const [categories] = useState<Category[]>(initialCategories)
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts)
  const [rules, setRules] = useState<RecurringRule[]>(initialRules)
  // The currency selector was removed at the owner's request, so the stored
  // preference is only ever read, never written. It still decides the symbol.
  const [currency] = useState<CurrencyCode>(initialCurrency)

  const [tab, setTab] = useState<Tab>('list')
  const [draft, setDraft] = useState<EntryDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  const money = useCallback((n: number) => formatMoney(n, currency), [currency])

  /**
   * Hidden entries are loaded so the owner can restore them, but they are kept
   * out of the history, the filters and every total. The balance helpers ignore
   * them themselves, so there is no way for one to leak into a figure.
   */
  const active = useMemo(() => live(transactions), [transactions])

  // The headline is always everything. Filters narrow the list, never the
  // balance, so a filtered view can never be mistaken for your real position.
  const overall = useMemo(() => balance(transactions), [transactions])
  const perAccount = useMemo(() => balancesByAccount(transactions), [transactions])
  const visible = useMemo(() => applyFilters(active, filters), [active, filters])
  const rows = useMemo(() => withRunningBalance(visible), [visible])
  const breakdown = useMemo(() => spentByCategory(visible, categories), [visible, categories])
  const months = useMemo(() => monthsPresent(active), [active])
  const spent = useMemo(() => totalOut(visible), [visible])
  const earned = useMemo(() => totalIn(visible), [visible])

  const focusedBalance = filters.account_id ? (perAccount.get(filters.account_id) ?? 0) : overall
  const isFiltered = isFilterActive(filters)
  const showAdmin = isAdmin(email)

  async function applyAdjustment(
    targetBalance: number,
    accountId: string,
    scope: AdjustScope,
  ) {
    // Measure against the scope the user picked, never always the grand total.
    // Measuring a single-account correction against the total books a huge
    // phantom entry that drags every other account with it.
    const adj = adjustmentFor(currentBalanceFor(transactions, scope, accountId || null), targetBalance)
    if (!adj) return
    setSaving(true)
    setError(null)
    const { data, error: e } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        kind: adj.kind,
        amount: adj.amount,
        category_id: null,
        account_id: accountId || null,
        note: 'Balance adjustment',
        occurred_at: fromLocalInput(toLocalInput(new Date().toISOString())),
        occurred_on: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single()
    setSaving(false)
    if (e) {
      setError(e.message)
      return
    }
    setTransactions((prev) => [data as Transaction, ...prev])
  }

  async function hideEntry(t: Transaction) {
    setSaving(true)
    const { error: e } = await supabase
      .from('transactions')
      .update({ archived: true })
      .eq('id', t.id)
    setSaving(false)
    if (e) {
      setError(e.message)
      return
    }
    setTransactions((prev) => prev.map((x) => (x.id === t.id ? { ...x, archived: true } : x)))
  }

  async function restoreEntry(id: string) {
    setSaving(true)
    const { error: e } = await supabase
      .from('transactions')
      .update({ archived: false })
      .eq('id', id)
    setSaving(false)
    if (e) {
      setError(e.message)
      return
    }
    setTransactions((prev) => prev.map((x) => (x.id === id ? { ...x, archived: false } : x)))
  }

  async function deleteEntry(t: Transaction) {
    setSaving(true)
    const { error: e } = await supabase.from('transactions').delete().eq('id', t.id)
    setSaving(false)
    if (e) {
      setError(e.message)
      return
    }
    setTransactions((prev) => prev.filter((x) => x.id !== t.id))
  }

  function startAdd(kind: Kind) {
    setError(null)
    setEditingId(null)
    setDraft(draftFrom(null, kind, accounts[0]?.id ?? ''))
  }

  function startEdit(t: Transaction) {
    setError(null)
    setEditingId(t.id)
    setDraft(draftFrom(t, t.kind, accounts[0]?.id ?? ''))
  }

  async function save() {
    if (!draft) return
    const amount = parseAmount(draft.amount)
    if (amount === null || amount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      kind: draft.kind,
      amount,
      category_id: draft.kind === 'out' ? draft.category_id || null : null,
      account_id: draft.account_id || null,
      note: draft.note.trim(),
      occurred_at: fromLocalInput(draft.occurred_at),
    }

    if (editingId) {
      const { error: e } = await supabase.from('transactions').update(payload).eq('id', editingId)
      setSaving(false)
      if (e) {
        setError(e.message)
        return
      }
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === editingId
            ? { ...t, ...payload, occurred_on: monthOf(payload.occurred_at) }
            : t,
        ),
      )
    } else {
      const { data, error: e } = await supabase
        .from('transactions')
        .insert({ user_id: userId, ...payload })
        .select()
        .single()
      setSaving(false)
      if (e) {
        setError(e.message)
        return
      }
      setTransactions((prev) => [...prev, data as Transaction])
    }
    setDraft(null)
    setEditingId(null)
  }

  async function remove() {
    if (!editingId) return
    const previous = transactions
    setTransactions((prev) => prev.filter((t) => t.id !== editingId))
    setDraft(null)
    setEditingId(null)
    const { error: e } = await supabase.from('transactions').delete().eq('id', editingId)
    if (e) setTransactions(previous)
    setError(e?.message ?? null)
  }

  async function addAccount() {
    const name = window.prompt('Account name')
    if (!name?.trim()) return
    const { data, error: e } = await supabase
      .from('accounts')
      .insert({ user_id: userId, name: name.trim(), kind: 'cash' })
      .select()
      .single()
    if (e) {
      setError(e.message)
      return
    }
    setAccounts((prev) => [...prev, data as Account])
  }

  async function renameAccount(id: string, name: string) {
    const { error: e } = await supabase.from('accounts').update({ name }).eq('id', id)
    if (e) {
      setError(e.message)
      return
    }
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)))
    // Entries reference the account by id, so a rename cannot disturb the
    // history or any balance. Nothing else needs updating.
  }

  /**
   * Deleting an account is the one action that can quietly lose money, so it is
   * done in three explicit steps:
   *
   *  1. optionally record a transfer, which adds one row out and one row in, so
   *     the money reappears on the chosen account and the total is unchanged;
   *  2. archive the account's existing entries, so they keep their history but
   *     stop counting towards the balance;
   *  3. delete the account itself.
   *
   * Step 2 is what stops the total from jumping: the foreign key would otherwise
   * null out account_id and leave those rows still counted.
   */
  async function deleteAccount(id: string, moveToAccountId: string | null) {
    const from = accounts.find((a) => a.id === id)
    if (!from) return
    setSaving(true)
    setError(null)

    const amount = accountBalance(transactions, id)

    if (moveToAccountId && amount > 0) {
      const to = accounts.find((a) => a.id === moveToAccountId)
      if (to) {
        const { halves, transferId } = buildTransfer({
          fromAccountId: id,
          toAccountId: to.id,
          amount: Math.abs(amount),
          fromName: from.name,
          toName: to.name,
        })
        // A negative source balance means the account owes money. Flipping both
        // halves keeps the direction honest instead of inventing income.
        const signed = amount > 0 ? halves : [halves[1], halves[0]]
        const { error: te } = await supabase
          .from('transactions')
          .insert(signed.map((h) => ({ user_id: userId, ...h, transfer_id: transferId })))
        if (te) {
          setSaving(false)
          setError(te.message)
          return
        }
      }
    }

    const { error: ae } = await supabase
      .from('transactions')
      .update({ archived: true })
      .eq('account_id', id)
      .eq('archived', false)
    if (ae) {
      setSaving(false)
      setError(ae.message)
      return
    }

    const { error: de } = await supabase.from('accounts').delete().eq('id', id)
    setSaving(false)
    if (de) {
      setError(de.message)
      return
    }

    setTransactions((prev) => prev.filter((t) => t.account_id !== id))
    setAccounts((prev) => prev.filter((a) => a.id !== id))
    setDraft((d) => (d && d.account_id === id ? { ...d, account_id: '' } : d))
    setFilters((f) => (f.account_id === id ? { ...f, account_id: '' } : f))
  }

  async function createRule(rule: Omit<RecurringRule, 'id'>) {
    setSaving(true)
    const { data, error: e } = await supabase
      .from('recurring_rules')
      .insert({ user_id: userId, ...rule })
      .select()
      .single()
    setSaving(false)
    if (e) {
      setError(e.message)
      return
    }
    setRules((prev) => [...prev, data as RecurringRule])
  }

  async function toggleRule(id: string, active: boolean) {
    const { error: e } = await supabase.from('recurring_rules').update({ active }).eq('id', id)
    if (e) {
      setError(e.message)
      return
    }
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)))
  }

  async function deleteRule(id: string) {
    const { error: e } = await supabase.from('recurring_rules').delete().eq('id', id)
    if (e) {
      setError(e.message)
      return
    }
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  const chip =
    'min-h-[40px] shrink-0 rounded-full border px-4 py-2 text-sm transition-colors'

  return (
    <div className="min-h-dvh bg-slate-950/55 text-slate-100 backdrop-blur-[2px]">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/75 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          {showAdmin && (
            <button
              type="button"
              onClick={() => setTab(tab === 'admin' ? 'list' : 'admin')}
              aria-label="Owner tools"
              aria-pressed={tab === 'admin'}
              title="Owner tools"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-lg leading-none ${
                tab === 'admin'
                  ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                  : 'border-slate-800 text-slate-500'
              }`}
            >
              ✎
            </button>
          )}
          <h1 className="text-base font-semibold">My Money</h1>
          <div className="ml-auto flex items-center gap-2">
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-[44px] px-2 text-sm text-slate-400"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pb-28 pt-4">
        {accounts.length === 0 && (
          <section className="rounded-2xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm">
            <h2 className="font-semibold text-amber-200">No accounts yet</h2>
            <p className="mt-1 text-amber-200/80">
              Entries need an account before they can be recorded. Creating one now.
            </p>
            <button
              type="button"
              onClick={addAccount}
              className="mt-3 min-h-[44px] rounded-lg bg-amber-500 px-4 font-medium text-slate-950"
            >
              Add an account
            </button>
          </section>
        )}

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-400">
                {filters.account_id
                  ? accounts.find((a) => a.id === filters.account_id)?.name ?? 'Account'
                  : 'Total balance'}
              </p>
              <p
                className={`mt-1 text-4xl font-semibold tabular-nums ${
                  focusedBalance < 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {money(focusedBalance)}
              </p>
            </div>
            {accounts.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    account_id: f.account_id ? '' : (accounts[0]?.id ?? ''),
                  }))
                }
                className="min-h-[44px] shrink-0 rounded-lg border border-slate-700 px-3 text-sm text-slate-300"
              >
                {filters.account_id ? 'All accounts' : 'By account'}
              </button>
            )}
          </div>

          <div className="mt-4 flex gap-5 text-sm">
            <div>
              <span className="text-slate-400">In </span>
              <span className="ml-1 font-medium tabular-nums text-emerald-400">{money(earned)}</span>
            </div>
            <div>
              <span className="text-slate-400">Out </span>
              <span className="ml-1 font-medium tabular-nums text-rose-400">{money(spent)}</span>
            </div>
          </div>

          {accounts.length > 1 && !filters.account_id && (
            <ul className="mt-4 space-y-1 border-t border-slate-800 pt-3">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{a.name}</span>
                  <span
                    className={`tabular-nums ${
                      (perAccount.get(a.id) ?? 0) < 0 ? 'text-rose-400' : 'text-slate-300'
                    }`}
                  >
                    {money(perAccount.get(a.id) ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => startAdd('in')}
            className="min-h-[52px] flex-1 rounded-xl border border-emerald-600 bg-emerald-600/10 text-base font-medium text-emerald-400 active:bg-emerald-600/20"
          >
            Add money
          </button>
          <button
            type="button"
            onClick={() => startAdd('out')}
            className="min-h-[52px] flex-1 rounded-xl border border-rose-600 bg-rose-600/10 text-base font-medium text-rose-400 active:bg-rose-600/20"
          >
            Spend
          </button>
        </div>

        {draft && (
          <EntryForm
            draft={draft}
            onChange={setDraft}
            onSubmit={save}
            onCancel={() => {
              setDraft(null)
              setEditingId(null)
            }}
            onDelete={editingId ? remove : undefined}
            categories={categories}
            accounts={accounts}
            currency={currency}
            editing={Boolean(editingId)}
            saving={saving}
            error={error}
            submitLabel={editingId ? 'Save changes' : 'Add entry'}
          />
        )}

        {tab === 'list' ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowFilters((s) => !s)}
                className={`${chip} ${
                  isFiltered
                    ? 'border-slate-400 bg-slate-800 text-slate-100'
                    : 'border-slate-700 text-slate-400'
                }`}
              >
                Filters{isFiltered ? ' on' : ''}
              </button>
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => setFilters(NO_FILTERS)}
                  className={`${chip} border-slate-700 text-slate-400`}
                >
                  Clear
                </button>
              )}
            </div>

            {showFilters && (
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex flex-wrap gap-2">
                  {(['all', 'out', 'in'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFilters((f) => ({ ...f, kind: k }))}
                      className={`${chip} ${
                        filters.kind === k
                          ? 'border-slate-400 bg-slate-800 text-slate-100'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {k === 'all' ? 'All' : k === 'out' ? 'Spending' : 'Money in'}
                    </button>
                  ))}
                </div>
                <select
                  value={filters.month}
                  onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
                  className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base"
                >
                  <option value="">All months</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.category_id}
                  onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}
                  className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base"
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {accounts.length > 1 && (
                  <select
                    value={filters.account_id}
                    onChange={(e) => setFilters((f) => ({ ...f, account_id: e.target.value }))}
                    className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base"
                  >
                    <option value="">All accounts</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {breakdown.length > 0 && (
              <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <h2 className="text-sm font-semibold text-slate-300">Spent by category</h2>
                <ul className="mt-3 space-y-2">
                  {breakdown.map(({ category, total }) => (
                    <li key={category.id} className="flex items-center gap-3 text-sm">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      <span className="flex-1 text-slate-300">{category.name}</span>
                      <span className="tabular-nums text-slate-400">{money(total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              <h2 className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-300">
                History{isFiltered ? ` (${rows.length})` : ''}
              </h2>
              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  Nothing here yet. Use &ldquo;Add money&rdquo; to record what you have.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {rows.map((row) => {
                    const category = categories.find((c) => c.id === row.category_id)
                    const account = accounts.find((a) => a.id === row.account_id)
                    const isIn = row.kind === 'in'
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {category && (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: category.color }}
                                />
                              )}
                              <span className="truncate text-sm text-slate-200">
                                {row.note || (isIn ? 'Money in' : category?.name || 'Spending')}
                              </span>
                              {row.recurring_rule_id && (
                                <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                                  auto
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500">
                              {formatStamp(row.occurred_at, DISPLAY_LOCALE)}
                              {account && accounts.length > 1 && ` · ${account.name}`}
                            </span>
                          </div>
                          <div className="text-right">
                            <div
                              className={`text-sm font-medium tabular-nums ${
                                isIn ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isIn ? '+' : '-'}
                              {formatMoney(row.amount, currency)}
                            </div>
                            <div className="text-xs tabular-nums text-slate-500">
                              {money(row.running)}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </>
        ) : (
          <>
            <RecurringPanel
              rules={rules}
              categories={categories}
              accounts={accounts}
              currency={currency}
              onCreate={createRule}
              onToggle={toggleRule}
              onDelete={deleteRule}
              busy={saving}
              error={error}
            />
            <button
              type="button"
              onClick={addAccount}
              className="min-h-[44px] w-full rounded-lg border border-slate-800 text-sm text-slate-400"
            >
              New account
            </button>
          </>
        )}

        {tab === 'admin' && showAdmin && (
          <AdminPanel
            email={email}
            transactions={transactions}
            accounts={accounts}
            overallBalance={overall}
            accountBalances={perAccount}
            currency={currency}
            format={money}
            onAdjust={applyAdjustment}
            onRestore={restoreEntry}
            onDelete={deleteEntry}
            onEdit={(t) => {
              setEditingId(t.id)
              setDraft(draftFrom(t, t.kind, t.account_id ?? ''))
              setTab('list')
            }}
            onHide={hideEntry}
            busy={saving}
            error={error}
          />
        )}

        {tab === 'accounts' && (
          <>
            <AccountManager
              accounts={accounts}
              transactions={transactions}
              currency={currency}
              format={money}
              onRename={renameAccount}
              onDelete={deleteAccount}
              busy={saving}
              error={error}
            />
            <button
              type="button"
              onClick={addAccount}
              className="min-h-[44px] w-full rounded-lg border border-slate-800 text-sm text-slate-400"
            >
              New account
            </button>
          </>
        )}

        <p className="pt-2 text-center text-xs text-slate-600">Signed in as {email}</p>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl">
          {(
            [
              ['list', 'History'],
              ['recurring', 'Recurring'],
              ['accounts', 'Accounts'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`min-h-[56px] flex-1 text-sm font-medium ${
                tab === key ? 'text-slate-100' : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
