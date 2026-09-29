-- ===========================================================================
-- CHUNK 5: multiple accounts
--
-- Each account holds its own balance; the headline figure is the sum of them.
-- Transactions keep existing on account delete (account_id becomes null) so
-- history is never silently destroyed.
-- ===========================================================================

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'cash',
  created_at timestamptz not null default now(),
  unique (user_id, name),
  constraint accounts_kind_known check (kind in ('cash', 'card', 'savings'))
);

alter table public.accounts enable row level security;
alter table public.accounts alter column user_id set default auth.uid();

drop policy if exists "accounts_select_own" on public.accounts;
create policy "accounts_select_own" on public.accounts
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own" on public.accounts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own" on public.accounts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_delete_own" on public.accounts
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Added with the foreign key inline. Splitting this into a plain `add column`
-- followed by a second `add column if not exists` would silently never add the
-- reference, because the column would already exist.
alter table public.transactions add column if not exists account_id uuid
  references public.accounts (id) on delete set null;

create index if not exists transactions_account_idx
  on public.transactions (account_id);

-- Give every existing user a Cash account, and move any pre-account entries
-- onto it so old history is not orphaned and left out of per-account totals.
insert into public.accounts (user_id, name, kind)
select id, 'Cash', 'cash' from auth.users
on conflict (user_id, name) do nothing;

update public.transactions t
set account_id = a.id
from public.accounts a
where t.user_id = a.user_id
  and t.account_id is null
  and a.kind = 'cash';

-- ===========================================================================
-- CHUNK 6: recurring entries
--
-- Rules are materialised into real transactions when the app loads, rather than
-- by a background job. The unique index below makes that idempotent, so an
-- entry can never be created twice however often the app is opened.
-- ===========================================================================

create table if not exists public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'out',
  amount numeric(14, 2) not null,
  category_id uuid references public.categories (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  note text not null default '',
  frequency text not null default 'monthly',
  next_due date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint recurring_rules_kind_known check (kind in ('in', 'out')),
  constraint recurring_rules_amount_nonneg check (amount >= 0),
  constraint recurring_rules_frequency_known check (frequency in ('weekly', 'monthly'))
);

alter table public.recurring_rules enable row level security;
alter table public.recurring_rules alter column user_id set default auth.uid();

drop policy if exists "recurring_select_own" on public.recurring_rules;
create policy "recurring_select_own" on public.recurring_rules
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "recurring_insert_own" on public.recurring_rules;
create policy "recurring_insert_own" on public.recurring_rules
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "recurring_update_own" on public.recurring_rules;
create policy "recurring_update_own" on public.recurring_rules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "recurring_delete_own" on public.recurring_rules;
create policy "recurring_delete_own" on public.recurring_rules
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Marks which rule an entry came from, and the day it covers. The pair is
-- unique so materialising the same occurrence twice is impossible.
alter table public.transactions add column if not exists recurring_rule_id uuid
  references public.recurring_rules (id) on delete set null;
alter table public.transactions add column if not exists occurred_on date;

create unique index if not exists transactions_recurring_once
  on public.transactions (recurring_rule_id, occurred_on)
  where recurring_rule_id is not null;

-- Keep occurred_on in step with occurred_at for manual entries.
update public.transactions
set occurred_on = occurred_at::date
where occurred_on is null and occurred_at is not null;

create index if not exists recurring_rules_due_idx
  on public.recurring_rules (user_id, next_due);

-- ===========================================================================
-- CHUNK 7: default account for future signups
--
-- Chunk 5 only gave accounts to users who already existed. Without this, anyone
-- who signs up afterwards lands on a tracker with no accounts at all, so the
-- account picker and the per-account balances have nothing to work with.
-- `on conflict` keeps this safe if this function is ever re-run.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.categories (user_id, name, color)
  values
    (new.id, 'Food', '#ef4444'),
    (new.id, 'Gas', '#f59e0b'),
    (new.id, 'Clothes', '#8b5cf6'),
    (new.id, 'Transport', '#0ea5e9'),
    (new.id, 'Bills', '#6366f1'),
    (new.id, 'Health', '#ec4899'),
    (new.id, 'Fun', '#a855f7'),
    (new.id, 'Other', '#64748b');

  insert into public.accounts (user_id, name, kind)
  values (new.id, 'Cash', 'cash')
  on conflict (user_id, name) do nothing;

  insert into public.preferences (user_id, currency)
  values (new.id, 'SAR');

  return new;
end;
$fn$;

-- ===========================================================================
-- CHUNK 8: transfers and archiving
--
-- A transfer between two accounts is stored as a matched pair of ordinary
-- entries (one out, one in) that share a transfer_id. Storing it as a pair of
-- real entries is what keeps the total equal to the plain signed sum of the
-- rows, with no special case in the balance maths.
--
-- `archived` is what makes deleting an account safe. Without it, removing an
-- account would leave its entries behind with a null account_id, and they would
-- go on counting towards the total. Archiving keeps the history and drops the
-- rows out of every balance.
-- ===========================================================================

alter table public.transactions
  add column if not exists archived boolean not null default false;
alter table public.transactions
  add column if not exists transfer_id uuid;

create index if not exists transactions_archived_idx
  on public.transactions (archived);

-- Safety net: if the two halves of a transfer were ever written separately, this
-- catches it rather than letting a one-sided transfer quietly halve a balance.
create index if not exists transactions_transfer_idx
  on public.transactions (transfer_id)
  where transfer_id is not null;
