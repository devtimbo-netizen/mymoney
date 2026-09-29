'use client'

import { useState } from 'react'
import type { Account, Transaction } from '@/lib/ledger'
import { accountBalance, formatStamp } from '@/lib/ledger'

/**
 * Managing accounts: see each one's balance and creation date, rename it, or
 * delete it. Deleting is the only destructive action in the app, so it asks what
 * should happen to the money first, and never silently discards a balance.
 */
export function AccountManager({
  accounts,
  transactions,
  currency,
  format,
  onRename,
  onDelete,
  busy,
  error,
}: {
  accounts: Account[]
  transactions: Transaction[]
  currency: string
  format: (n: number) => string
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string, moveToAccountId: string | null) => Promise<void>
  busy: boolean
  error: string | null
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [destination, setDestination] = useState('')

  if (accounts.length === 0) return null

  const startRename = (a: Account) => {
    setRenaming(a.id)
    setRenameValue(a.name)
    setConfirming(null)
  }

  const submitRename = async (id: string) => {
    const name = renameValue.trim()
    setRenaming(null)
    if (!name) return
    await onRename(id, name)
  }

  const target = accounts.find((a) => a.id === confirming)
  const amount = target ? accountBalance(transactions, target.id) : 0
  const others = accounts.filter((a) => a.id !== confirming)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">Your accounts</h2>
        <span className="text-xs text-slate-500">
          {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
        </span>
      </div>

      <ul className="space-y-2">
        {accounts.map((a) => {
          const value = accountBalance(transactions, a.id)
          return (
            <li key={a.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              {renaming === a.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    submitRename(a.id)
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    maxLength={40}
                    aria-label="Account name"
                    className="min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-base"
                  />
                  <button
                    type="submit"
                    disabled={busy || !renameValue.trim()}
                    className="min-h-[44px] rounded-lg bg-emerald-500 px-4 text-sm font-medium text-slate-950 disabled:opacity-50"
                  >
                    Save
                  </button>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {a.kind} · created {a.created_at ? formatStamp(a.created_at, currency) : 'recently'}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 font-semibold tabular-nums ${
                      value < 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {format(value)}
                  </p>
                </div>
              )}

              {renaming !== a.id && (
                <div className="mt-3 flex gap-4 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={() => startRename(a)}
                    className="min-h-[40px] text-sm text-slate-400"
                  >
                    Rename
                  </button>
                  {accounts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(confirming === a.id ? null : a.id)
                        setDestination('')
                        setRenaming(null)
                      }}
                      className="min-h-[40px] text-sm text-rose-400"
                    >
                      {confirming === a.id ? 'Cancel' : 'Delete'}
                    </button>
                  )}
                </div>
              )}

              {confirming === a.id && others.length > 0 && (
                <div className="mt-3 space-y-3 rounded-xl border border-rose-900/70 bg-rose-950/20 p-3">
                  <p className="text-sm text-slate-300">
                    <strong className="text-rose-300">{a.name}</strong> holds{' '}
                    <span className="tabular-nums">{format(amount)}</span>.
                  </p>
                  <p className="text-xs text-slate-400">
                    Its entries stay in your history either way, but they stop counting towards
                    your balance once the account is gone. What should happen to the{' '}
                    {amount === 0 ? 'nothing in it' : 'money in it'}?
                  </p>

                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-400">Move it to</span>
                    <select
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base"
                    >
                      <option value="">Delete without moving (balance leaves)</option>
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          Transfer to {o.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null)
                      onDelete(a.id, destination || null)
                    }}
                    className="min-h-[44px] w-full rounded-lg bg-rose-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {destination
                      ? `Move ${format(amount)} and delete ${a.name}`
                      : `Delete ${a.name}`}
                  </button>
                </div>
              )}

              {confirming === a.id && others.length === 0 && (
                <p className="mt-3 rounded-xl border border-slate-800 p-3 text-xs text-slate-400">
                  This is your only account. Create another one first if you want to move money
                  between them.
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {error && <p className="text-sm text-rose-400">{error}</p>}
    </section>
  )
}
