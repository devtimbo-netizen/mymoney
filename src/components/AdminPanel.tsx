'use client'

import { useState } from 'react'
import {
  adjustmentFor,
  formatStamp,
  isLive,
  type Transaction,
} from '@/lib/ledger'
import { parseAmount } from '@/lib/currency'

/**
 * Owner tools.
 *
 * This is a convenience gate, not a security boundary: anyone could bypass a
 * client-side check. It does not need to be one, though. Every action here
 * writes to the caller's own rows, and row-level security already prevents any
 * user from reading or writing anyone else's data. So "admin" only means "extra
 * buttons in my own UI" and cannot widen access to anything.
 */
const ADMIN_EMAILS = new Set(['devtimbo@gmail.com'])

export function isAdmin(email: string): boolean {
  return ADMIN_EMAILS.has(email.trim().toLowerCase())
}

export function AdminPanel({
  email,
  transactions,
  accounts,
  currentBalance,
  currency,
  format,
  onAdjust,
  onRestore,
  onDelete,
  onEdit,
  onHide,
  busy,
  error,
}: {
  email: string
  transactions: Transaction[]
  accounts: { id: string; name: string }[]
  currentBalance: number
  currency: string
  format: (n: number) => string
  onAdjust: (target: number, accountId: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
  onDelete: (t: Transaction) => Promise<void>
  onEdit: (t: Transaction) => void
  onHide: (t: Transaction) => Promise<void>
  busy: boolean
  error: string | null
}) {
  const [target, setTarget] = useState('')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')

  if (!isAdmin(email)) return null

  const hidden = transactions.filter((t) => !isLive(t))
  const live = transactions.filter(isLive)
  const parsed = parseAmount(target)
  const preview = parsed === null ? null : adjustmentFor(currentBalance, parsed)

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-amber-800/60 bg-amber-950/25 p-4">
        <h2 className="text-sm font-semibold text-amber-200">Correct the balance</h2>
        <p className="mt-1 text-xs text-amber-200/70">
          Your records say <span className="tabular-nums">{format(currentBalance)}</span>. Type what
          your bank actually says, and one clearly-labelled adjustment entry will be added to make
          them agree. No fake income or withdrawal, and you can delete the adjustment later.
        </p>

        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Real balance</span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              placeholder={String(currentBalance)}
              className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base"
            />
          </label>

          {accounts.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Which account is off?</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {preview && (
            <p className="rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
              This will add one {preview.kind === 'in' ? 'money in' : 'money out'} entry of{' '}
              <span className="tabular-nums">{format(preview.amount)}</span>, bringing the balance to{' '}
              <span className="tabular-nums">{format(parsed as number)}</span>.
            </p>
          )}
          {parsed !== null && !preview && (
            <p className="rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
              That already matches the current balance, so nothing will be added.
            </p>
          )}

          <button
            type="button"
            disabled={busy || !preview}
            onClick={() => {
              if (!preview || parsed === null) return
              setTarget('')
              void onAdjust(parsed, accountId)
            }}
            className="min-h-[44px] w-full rounded-lg bg-amber-500 px-4 font-medium text-slate-950 disabled:opacity-40"
          >
            {preview ? `Add adjustment and set balance to ${format(parsed as number)}` : 'Nothing to adjust'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">
          Every entry
          <span className="ml-2 text-xs font-normal text-slate-500">
            edit, hide or remove
          </span>
        </h2>
        <ul className="space-y-2">
          {live.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className={t.kind === 'in' ? 'text-emerald-400' : 'text-rose-400'}>
                    {t.kind === 'in' ? '+' : '−'}
                    {format(t.amount)}
                  </span>
                  {t.note ? <span className="ml-2 text-slate-400">{t.note}</span> : null}
                </p>
                <p className="text-xs text-slate-500">{formatStamp(t.occurred_at, currency)}</p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(t)}
                className="min-h-[40px] px-2 text-xs text-slate-400"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onHide(t)}
                className="min-h-[40px] px-2 text-xs text-amber-400"
              >
                Hide
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDelete(t)}
                className="min-h-[40px] px-2 text-xs text-rose-400"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>

      {hidden.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            Hidden
            <span className="ml-2 text-xs font-normal text-slate-500">
              kept, but not counted
            </span>
          </h2>
          <ul className="space-y-2">
            {hidden.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-xl border border-slate-800/60 bg-slate-900/40 px-3 py-2 opacity-70"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-400">
                    {t.kind === 'in' ? '+' : '−'}
                    {format(t.amount)}
                    {t.note ? <span className="ml-2">{t.note}</span> : null}
                  </p>
                  <p className="text-xs text-slate-600">{formatStamp(t.occurred_at, currency)}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRestore(t.id)}
                  className="min-h-[40px] px-2 text-xs text-emerald-400"
                >
                  Restore
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDelete(t)}
                  className="min-h-[40px] px-2 text-xs text-rose-400"
                >
                Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}
    </section>
  )
}
