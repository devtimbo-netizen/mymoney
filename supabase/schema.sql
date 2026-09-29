-- Money tracker schema.
--
-- Run in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- If the editor rejects the whole script, run it in the four chunks marked
-- below. Every statement is idempotent, so chunks and full runs are equivalent.
--
-- This file is the concatenation of the statements that were applied to the live
-- project. Note there is no nested dollar-quoting: the editor's statement
-- splitter mis-splits a DO block that embeds a second $tag$ body, which is what
-- previously caused the script to abort partway and roll the rename back.

-- ===========================================================================
-- CHUNK 1: tables and columns
-- ===========================================================================

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Earlier versions of this app stored a spreadsheet of expenses. Rename rather
-- than drop, so any existing rows survive the change of model.
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'expenses'
  ) and not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'transactions'
  ) then
    alter table public.expenses rename to transactions;
  end if;
end $$;

-- The ledger. The balance is the signed sum of amount, where kind decides the
-- sign. amount itself is never negative.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'out',
  amount numeric(14, 2) not null default 0,
  category_id uuid references public.categories (id) on delete set null,
  note text not null default '',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Column defaults backfill any pre-existing row, so no UPDATE is needed. The
-- defaults are also why this never references the old spent_on column, which
-- is dropped further down and would otherwise break every later run.
alter table public.transactions add column if not exists kind text;
alter table public.transactions add column if not exists occurred_at timestamptz;
alter table public.transactions add column if not exists amount numeric(14, 2);

alter table public.transactions alter column kind set default 'out';
alter table public.transactions alter column kind set not null;
alter table public.transactions alter column amount set not null;
alter table public.transactions alter column occurred_at set default now();
alter table public.transactions alter column occurred_at set not null;

-- Constraints are added by name rather than inline in create table, because on
-- a renamed table that statement is a no-op and inline ones are never applied.
alter table public.transactions drop constraint if exists transactions_kind_known;
alter table public.transactions drop constraint if exists transactions_amount_nonneg;
alter table public.transactions add constraint transactions_kind_known
  check (kind in ('in', 'out'));
alter table public.transactions add constraint transactions_amount_nonneg
  check (amount >= 0);

-- Spreadsheet-only columns, meaningless in a ledger. Dropped only while the
-- table is empty, so this can never silently destroy a real ledger.
do $$
declare
  row_count bigint;
begin
  select count(*) into row_count from public.transactions;
  if row_count = 0 then
    alter table public.transactions
      drop column if exists label,
      drop column if exists spent_on,
      drop column if exists formula,
      drop column if exists sort_order;
  end if;
end $$;

create index if not exists transactions_user_time_idx
  on public.transactions (user_id, occurred_at desc);
create index if not exists categories_user_idx
  on public.categories (user_id);
drop index if exists public.expenses_user_sort_idx;

-- ===========================================================================
-- CHUNK 2: updated_at trigger
-- ===========================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists expenses_touch_updated_at on public.transactions;
drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- CHUNK 3: row level security
--
-- These policies are the real authorisation boundary: the app's key has no
-- BYPASSRLS, so nothing in the client can bypass them.
-- ===========================================================================

alter table public.categories enable row level security;
alter table public.transactions enable row level security;

-- Stamp user_id in the database instead of trusting the client to send it. A
-- missing user_id makes `auth.uid() = user_id` NULL, which fails the check and
-- surfaces as a confusing RLS error on insert.
alter table public.categories alter column user_id set default auth.uid();
alter table public.transactions alter column user_id set default auth.uid();

drop policy if exists "categories_select_own" on public.categories;
create policy "categories_select_own" on public.categories
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "categories_insert_own" on public.categories;
create policy "categories_insert_own" on public.categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "categories_update_own" on public.categories;
create policy "categories_update_own" on public.categories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_delete_own" on public.categories
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Policies keep their names across a table rename, so the old ones are still
-- attached and must be removed explicitly.
drop policy if exists "expenses_select_own" on public.transactions;
drop policy if exists "expenses_insert_own" on public.transactions;
drop policy if exists "expenses_update_own" on public.transactions;
drop policy if exists "expenses_delete_own" on public.transactions;
drop policy if exists "transactions_select_own" on public.transactions;
drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "transactions_update_own" on public.transactions;
drop policy if exists "transactions_delete_own" on public.transactions;

create policy "transactions_select_own" on public.transactions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "transactions_insert_own" on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "transactions_update_own" on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "transactions_delete_own" on public.transactions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ===========================================================================
-- CHUNK 4: preferences and signup defaults
-- ===========================================================================

-- Display currency only. Amounts are plain numbers, so switching currency
-- relabels the data and never converts it.
create table if not exists public.preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  currency text not null default 'SAR',
  created_at timestamptz not null default now(),
  constraint preferences_currency_known check (currency in (
    'SAR', 'USD', 'EUR', 'GBP', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD',
    'EGP', 'INR', 'PKR', 'JPY', 'CNY', 'CAD', 'AUD', 'TRY', 'ZAR'
  ))
);

alter table public.preferences enable row level security;

drop policy if exists "preferences_select_own" on public.preferences;
create policy "preferences_select_own" on public.preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "preferences_insert_own" on public.preferences;
create policy "preferences_insert_own" on public.preferences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "preferences_update_own" on public.preferences;
create policy "preferences_update_own" on public.preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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

  insert into public.preferences (user_id, currency)
  values (new.id, 'SAR');

  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill a preferences row for any account that predates this table.
insert into public.preferences (user_id, currency)
select id, 'SAR' from auth.users
on conflict (user_id) do nothing;

-- PostgREST caches the schema it exposes. After a rename it can keep serving
-- the old name briefly, showing "table not found in schema cache" even though
-- the migration worked. A no-op where nothing listens on the channel.
notify pgrst, 'reload schema';
