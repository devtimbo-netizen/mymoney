'use client'

import { useMemo } from 'react'
import { formatMoney, parseAmount, type CurrencyCode } from '@/lib/currency'
import { toLocalInput, type Account, type Category, type Kind, type Transaction } from '@/lib/ledger'

export type EntryDraft = {
  kind: Kind
  amount: string
  category_id: string
  account_id: string
  note: string
  occurred_at: string
}

export function draftFrom(t: Transaction | null, kind: Kind, fallbackAccount: string): EntryDraft {
  return {
    kind,
    amount: t ? String(t.amount) : '',
    category_id: t?.category_id ?? '',
    account_id: t?.account_id ?? fallbackAccount,
    note: t?.note ?? '',
    occurred_at: toLocalInput(t?.occurred_at ?? new Date().toISOString()),
  }
}

const FIELD =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-slate-500'

export default function EntryForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
  categories,
  accounts,
  currency,
  editing,
  saving,
  error,
  submitLabel,
}: {
  draft: EntryDraft
  onChange: (next: EntryDraft) => void
  onSubmit: () => void
  onCancel: () => void
  onDelete?: () => void
  categories: Category[]
  accounts: Account[]
  currency: CurrencyCode
  editing: boolean
  saving: boolean
  error: string | null
  submitLabel: string
}) {
  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) =>
    onChange({ ...draft, [key]: value })

  const parsed = parseAmount(draft.amount)
  const invalid = draft.amount.trim() !== '' && (parsed === null || parsed <= 0)

  // Live preview of the effect on the balance, so the direction is never a
  // guess: spending always shows a minus, adding money always a plus.
  const preview = useMemo(() => {
    if (parsed === null || parsed <= 0) return null
    const text = formatMoney(parsed, currency)
    return draft.kind === 'in' ? `+${text}` : `-${text}`
  }, [parsed, draft.kind, currency])

  return (
    <section className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <div className="flex gap-2" role="tablist">
        {(['in', 'out'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={draft.kind === k}
            onClick={() => set('kind', k)}
            className={`min-h-[44px] flex-1 rounded-lg px-3 py-2.5 text-sm font-medium ${
              draft.kind === k
                ? k === 'in'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-rose-600 text-white'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {k === 'in' ? 'Add money' : 'Spend'}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-sm text-slate-400">Amount</span>
        <input
          autoFocus
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => set('amount', e.target.value)}
          placeholder="0.00"
          aria-invalid={invalid}
          className={`mt-1 ${FIELD} ${invalid ? 'border-rose-600' : ''}`}
        />
        {invalid && <span className="mt-1 block text-xs text-rose-400">Enter an amount above zero.</span>}
      </label>

      {preview && (
        <p className="text-sm text-slate-400">
          Recorded as <span className="tabular-nums">{preview}</span>,{' '}
          {draft.kind === 'in' ? 'added to' : 'deducted from'} your balance.
        </p>
      )}

      <label className="block">
        <span className="text-sm text-slate-400">Date and time</span>
        <input
          type="datetime-local"
          value={draft.occurred_at}
          onChange={(e) => set('occurred_at', e.target.value)}
          className={`mt-1 ${FIELD}`}
        />
      </label>

      {draft.kind === 'out' && (
        <label className="block">
          <span className="text-sm text-slate-400">Category</span>
          <select
            value={draft.category_id}
            onChange={(e) => set('category_id', e.target.value)}
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
            value={draft.account_id}
            onChange={(e) => set('account_id', e.target.value)}
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

      <label className="block">
        <span className="text-sm text-slate-400">Note (optional)</span>
        <input
          value={draft.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder={draft.kind === 'in' ? 'Salary' : 'Groceries'}
          className={`mt-1 ${FIELD}`}
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || invalid}
          className="min-h-[44px] flex-1 rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg px-4 py-3 text-sm text-slate-400"
        >
          Cancel
        </button>
        {editing && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="min-h-[44px] w-full rounded-lg border border-rose-900 px-4 py-3 text-sm text-rose-400"
          >
            Delete entry
          </button>
        )}
      </div>
    </section>
  )
}
