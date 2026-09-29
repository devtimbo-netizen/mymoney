'use client'

import { useState } from 'react'
import { formatMoney, parseAmount, type CurrencyCode } from '@/lib/currency'
import { toLocalInput, type Account, type Category, type Kind } from '@/lib/ledger'
import type { RecurringRule } from '@/lib/recurring'

const FIELD =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-slate-500'

export default function RecurringPanel({
  rules,
  categories,
  accounts,
  currency,
  onCreate,
  onToggle,
  onDelete,
  busy,
  error,
}: {
  rules: RecurringRule[]
  categories: Category[]
  accounts: Account[]
  currency: CurrencyCode
  onCreate: (rule: Omit<RecurringRule, 'id'>) => Promise<void>
  onToggle: (id: string, active: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
  busy: boolean
  error: string | null
}) {
  const [kind, setKind] = useState<Kind>('out')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly')
  const [firstDue, setFirstDue] = useState(() => toLocalInput(new Date().toISOString()).slice(0, 10))

  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed > 0 && firstDue !== ''

  async function submit() {
    if (!valid) return
    await onCreate({
      kind,
      amount: parsed,
      category_id: kind === 'out' ? categoryId || null : null,
      account_id: accountId || null,
      note: note.trim(),
      frequency,
      next_due: firstDue,
      active: true,
    })
    setAmount('')
    setNote('')
    setCategoryId('')
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Recurring entries</h2>
        <p className="mt-1 text-xs text-slate-500">
          Rent, salary, subscriptions. Entries are created automatically each time you open the app.
        </p>
      </div>

      {rules.length > 0 && (
        <ul className="divide-y divide-slate-800">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-200">
                  {r.note || (r.kind === 'in' ? 'Money in' : 'Spending')}
                </p>
                <p className="text-xs text-slate-500">
                  {r.frequency === 'weekly' ? 'Every week' : 'Every month'} · next {r.next_due}
                </p>
              </div>
              <span
                className={`text-sm font-medium tabular-nums ${
                  r.kind === 'in' ? 'text-emerald-400' : 'text-rose-400'
                } ${r.active ? '' : 'opacity-40 line-through'}`}
              >
                {r.kind === 'in' ? '+' : '-'}
                {formatMoney(r.amount, currency)}
              </span>
              <button
                type="button"
                onClick={() => onToggle(r.id, !r.active)}
                className="min-h-[44px] min-w-[44px] text-xs text-slate-400"
              >
                {r.active ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                onClick={() => onDelete(r.id)}
                aria-label={`Delete recurring ${r.note || r.id}`}
                className="min-h-[44px] min-w-[44px] text-slate-600 hover:text-rose-400"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-xl border border-slate-800 bg-slate-950">
        <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-sm text-slate-300">
          Add a recurring entry
        </summary>
        <div className="space-y-3 border-t border-slate-800 p-4">
          <div className="flex gap-2">
            {(['in', 'out'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`min-h-[44px] flex-1 rounded-lg text-sm font-medium ${
                  kind === k
                    ? k === 'in'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {k === 'in' ? 'Money in' : 'Spending'}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-sm text-slate-400">Amount</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`mt-1 ${FIELD}`}
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-400">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Rent"
              className={`mt-1 ${FIELD}`}
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-400">Repeats</span>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as 'weekly' | 'monthly')}
              className={`mt-1 ${FIELD}`}
            >
              <option value="monthly">Every month</option>
              <option value="weekly">Every week</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-slate-400">First date</span>
            <input
              type="date"
              value={firstDue}
              onChange={(e) => setFirstDue(e.target.value)}
              className={`mt-1 ${FIELD}`}
            />
          </label>

          {kind === 'out' && (
            <label className="block">
              <span className="text-sm text-slate-400">Category</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={`mt-1 ${FIELD}`}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {accounts.length > 1 && (
            <label className="block">
              <span className="text-sm text-slate-400">Account</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={`mt-1 ${FIELD}`}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={!valid || busy}
            className="min-h-[44px] w-full rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Add recurring entry'}
          </button>
        </div>
      </details>
    </section>
  )
}
