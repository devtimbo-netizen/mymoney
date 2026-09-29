import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SetupNotice } from '@/components/SetupNotice'
import BalanceTracker from './BalanceTracker'
import { DEFAULT_CURRENCY, isCurrencyCode } from '@/lib/currency'
import type { Account, Category, Transaction } from '@/lib/ledger'
import {
  occurrenceTimestamp,
  pendingOccurrences,
  nextDueAfter,
  type RecurringRule,
} from '@/lib/recurring'

export default async function SheetPage() {
  if (!isSupabaseConfigured) return <SetupNotice />

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)

  // Recurring rules are turned into real entries here, on load, rather than by a
  // background job. The unique index on (recurring_rule_id, occurred_on) makes
  // this safe to run on every request: an occurrence can only be created once.
  const { data: rulesData } = await supabase
    .from('recurring_rules')
    .select('id, kind, amount, category_id, account_id, note, frequency, next_due, active')
    .eq('active', true)

  const rules = (rulesData ?? []) as RecurringRule[]

  if (rules.length > 0) {
    const { data: existing } = await supabase
      .from('transactions')
      .select('recurring_rule_id, occurred_on')
      .not('recurring_rule_id', 'is', null)

    const already = new Set(
      (existing ?? []).map((t) => `${t.recurring_rule_id}:${(t.occurred_on ?? '').slice(0, 10)}`),
    )

    const toInsert: Record<string, unknown>[] = []
    const reschedules: { id: string; next_due: string }[] = []

    for (const rule of rules) {
      const pending = pendingOccurrences(
        rule,
        today,
        new Set(
          [...already]
            .filter((k) => k.startsWith(`${rule.id}:`))
            .map((k) => k.slice(rule.id.length + 1)),
        ),
      )
      for (const o of pending) {
        toInsert.push({
          user_id: user.id,
          kind: o.kind,
          amount: o.amount,
          category_id: o.category_id,
          account_id: o.account_id,
          note: o.note,
          occurred_at: occurrenceTimestamp(o.occurred_on),
          occurred_on: o.occurred_on,
          recurring_rule_id: o.rule_id,
        })
      }
      if (pending.length > 0) {
        reschedules.push({ id: rule.id, next_due: nextDueAfter(rule, today) })
      }
    }

    if (toInsert.length > 0) {
      await supabase.from('transactions').insert(toInsert)
    }
    for (const r of reschedules) {
      await supabase.from('recurring_rules').update({ next_due: r.next_due }).eq('id', r.id)
    }
  }

  const [{ data: transactions, error: txError }, { data: categories }, { data: accounts }, { data: prefs }] =
    await Promise.all([
      supabase
        .from('transactions')
        .select(
          'id, kind, amount, category_id, account_id, note, occurred_at, occurred_on, recurring_rule_id, transfer_id, archived',
        )
        .order('occurred_at', { ascending: false }),
      supabase.from('categories').select('id, name, color').order('name'),
      supabase.from('accounts').select('id, name, kind, created_at').order('created_at'),
      supabase.from('preferences').select('currency').maybeSingle(),
    ])

  if (txError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]">
        <div className="max-w-md rounded-2xl border border-red-900 bg-red-950/40 p-6 text-sm text-red-300">
          <h1 className="mb-2 text-base font-semibold">Could not load your account</h1>
          <p>{txError.message}</p>
          <p className="mt-3 text-xs text-slate-400">
            If a feature is new, run <code>supabase/accounts-and-recurring.sql</code> in the Supabase
            SQL editor.
          </p>
        </div>
      </main>
    )
  }

  const storedCurrency = prefs?.currency
  const initialCurrency =
    typeof storedCurrency === 'string' && isCurrencyCode(storedCurrency)
      ? storedCurrency
      : DEFAULT_CURRENCY

  return (
    <BalanceTracker
      initialTransactions={(transactions ?? []) as Transaction[]}
      initialCategories={(categories ?? []) as Category[]}
      initialAccounts={(accounts ?? []) as Account[]}
      initialRules={rules}
      initialCurrency={initialCurrency}
      userId={user.id}
      email={user.email ?? 'signed in'}
    />
  )
}
