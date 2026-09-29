# My Money

A personal balance tracker. You type in what you have, then record what you spend or add. The
running balance updates itself. No bank connection — you enter every number yourself.

Built with Next.js (App Router), TypeScript, Tailwind CSS and Supabase, wrapped for Android with
Capacitor.

## What it does

- **Balance** — one running total at the top. Add money, spend money, watch it change.
- **Two clear actions** — *Add money* and *Spend*, each opening a short form. You never type a
  minus sign, so you cannot record spending as income by accident.
- **Categories** — spend is tagged Food, Gas, Clothes, Transport, Bills, Health, Fun or Other.
- **Edit or delete anything** — tap any entry to change its amount, category, account, note or
  time, or remove it. The balance and the running totals recalculate immediately.
- **Multiple accounts** — Cash, card and savings each keep their own balance. The headline figure
  is the sum of all of them, so nothing is hidden behind a toggle. Create as many as you like,
  rename them, and each one shows the date it was opened.
- **Deleting an account** — you choose what happens to the money. Move it to another account, or
  delete without moving. The entries themselves are always kept in your history.
- **Recurring entries** — set rent or salary once, and it is booked automatically each time you
  open the app, including every occurrence you missed while you were away.
- **Filters** — narrow the history by direction, month, category or account. The running balance
  on each row always refers to your real, complete balance, not to the filtered subset.
- **Exact timestamps** — every entry records the date *and* time, so you can read back to any
  point, not just the day.
- **Currency** — amounts display in the currency saved on your account, default SAR. Switching
  currency re-labels the figures; it never converts them, so no exchange rate is ever applied
  silently behind your back.
- **Per-user accounts** — email/password auth, and every row is scoped to its owner by database
  row-level security.
- **Sign out** — a real server-action sign-out that clears the session cookies.

## Owner tools

A pen in the top-left corner opens extra controls, shown only to `devtimbo@gmail.com`. It can edit,
hide, restore or delete any entry, and — the useful one — **correct the balance**.

Typing in what your bank actually says adds a single entry labelled *Balance adjustment* for the
difference. The alternative, entering a fake matching "income" or "withdrawal" so the numbers
appear to add up, would leave a false story in your history that is painful to unpick later. One
honestly-labelled adjustment is fewer rows and more truthful, and it can be deleted in a tap once
the real transaction turns up. It previews the exact entry before saving, and does nothing at all
if the balance already matches, so a stray `0.00` row can never appear.

*Hide* keeps an entry but stops it counting and removes it from the history; *Delete* removes it
permanently. Both are listed in the owner panel, and hidden entries can be restored.

This gate is a convenience, not a security boundary, and does not need to be one: every action
writes to the caller's own rows, and row-level security already prevents any user from reading or
writing anyone else's data. "Admin" only means "extra buttons in my own UI".

## How the balance works

Every row is either money **in** or money **out**. The balance is the signed sum of all of them:

```
balance = sum(amount where kind = 'in') - sum(amount where kind = 'out')
```

So +800 then −30 leaves 770. The balance is never stored; it is always derived, which means it
cannot drift out of sync with the entries.

Amounts are stored as **positive numbers**, and the direction lives in a separate `kind` column.
This is deliberate: a single signed `amount` column makes it far too easy to end up with a
negative amount that quietly increases the balance. The database rejects negative amounts, and
the app rejects anything that is not greater than zero before it is sent.

Per-account balances use the same rule, and they always add up to the overall balance — there is a
test that asserts exactly that.

## Getting started

```bash
npm install
cp .env.example .env.local   # add your Supabase URL and publishable key
npm run dev
```

### Database setup

Run these in the Supabase dashboard under **SQL Editor → New query**, in order. They are written
as three separate chunks because long scripts fail intermittently in the SQL editor; each chunk is
independently re-runnable.

1. `supabase/schema.sql` — the core `categories`, `transactions` and `preferences` tables, RLS
   policies, and the signup trigger.
2. `supabase/accounts-and-recurring.sql` — chunk 5 (accounts), chunk 6 (recurring rules), chunk 7
   (default account for new signups), chunk 8 (transfers and archiving).

Running a chunk twice is harmless: everything is written as `if not exists` or
`on conflict do nothing`, and existing entries are carried across rather than recreated.

## How recurring entries work

There is no background worker or cron job. Instead, each rule simply stores the next date it is
due (`next_due`). When the app loads, every rule that is due on or before today is expanded into
real transactions, and the rule moves forward.

This is made safe by a database constraint rather than by careful coding:

```sql
create unique index transactions_recurring_once
  on transactions (recurring_rule_id, occurred_on)
  where recurring_rule_id is not null;
```

That index means a given occurrence can exist **only once**, so opening the app ten times in a day
books a month of rent once, not ten times. It also means two devices opening the app at the same
moment cannot create a duplicate, which client-side checks alone would not prevent.

Entries are created as ordinary rows, so they appear in the history, take part in filters, can be
edited, and count towards the balance exactly like anything you typed yourself.

## How currency works

Amounts are stored in Postgres as plain numbers. Nothing about the currency is baked into the
data — `preferences.currency` only records which symbol to display. The selector was removed at
the owner's request, so the preference is read but never written, and the default SAR applies
unless the stored value says otherwise.

Note that this is **not** conversion. If your balance is 770 SAR, it shows 770 whatever symbol is
set; the number never moves. No exchange rate is ever applied silently behind your back. To
convert deliberately, record it as its own entry.

Supported: SAR, USD, EUR, GBP, AED, KWD, QAR, BHD, OMR, JOD, EGP, INR, PKR, JPY, CNY, CAD, AUD,
TRY, ZAR. A database constraint rejects anything outside that list.

Amounts are formatted with a **pinned** `en-US` locale rather than the browser's default. This
is required for correctness, not preference: `Intl` resolves an undefined locale differently in
Node and in the browser, so the server and client would render `SAR 1,234.50` and
`ر.س 1,234.50` for the same value and break hydration. Input parsing stays lenient instead, so a
pasted bank statement works either way: `1,234.56`, `1.234,56`, `ر.س 1,200` and `1 200.50` all
parse correctly.

## Security

Authenticated requests use the publishable key, which has no `BYPASSRLS`, so the row-level
security policies are the real authorisation boundary — not a client-side check. Each user can
read and write only their own rows.

`user_id` is also stamped by the database (`default auth.uid()`) rather than trusted from the
client, so a client cannot write a row against another account even if it tried.

## How transfers and account deletion work

Moving money between accounts is written as **two ordinary entries that share a
`transfer_id`**: one out of the source account, one into the target, same amount, same instant.

This is deliberate. If transfers were a special case in the balance calculation, the promise that
the total is just the signed sum of the rows would stop being true, and every total would need a
second code path. As a matched pair, a transfer cannot change the total (one −X, one +X), needs no
special handling in the maths, and both halves appear in the history and filters like any other
entry. There is a test asserting exactly that.

Deleting an account is the one action that could quietly lose money, so it is done in three steps:

1. optionally write the transfer, so the money reappears on the account you chose;
2. **archive** the account's existing entries — they keep their history but stop counting;
3. delete the account.

Step 2 is the important one. The foreign key would otherwise set `account_id` to null on those
rows and they would go on counting towards the total, leaving your balance quietly inflated. There
is a test that archiving leaves every other account's balance untouched.

## Android

The Android app is a Capacitor WebView pointing at your running web app. There is no static
bundle inside the APK, because the app is rendered on the server — that is where auth, RLS and
the recurring catch-up all run.

`capacitor.config.ts` therefore requires `CAPACITOR_SERVER_URL` to be set, and refuses to start
if it is missing or if it points at Supabase rather than at the web app. A wrong URL here
produces an app that opens to a blank page with no obvious cause, so it fails loudly instead.

```bash
# pick whichever applies, then sync and open Android Studio
$env:CAPACITOR_SERVER_URL = "https://your-app.vercel.app"   # deployed
$env:CAPACITOR_SERVER_URL = "http://10.0.2.2:3000"          # emulator, dev server
$env:CAPACITOR_SERVER_URL = "http://192.168.0.102:3000"     # phone on the same wifi

npm run cap:sync
npm run cap:open
```

**Building needs JDK 17 or 21.** This is the single most common failure here, and it is
confusing because two JDKs on a typical machine both fail: the `java` on `PATH` may be Java 8
(far too old), and Android Studio's bundled runtime may be Java 25, which is too *new* for
Gradle 8.14 and fails with `Unsupported class file major version 69`. Point Gradle at a JDK 21:

```powershell
$env:JAVA_HOME = "C:\Users\tim\.jdks\jbr-21.0.11"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

In Android Studio the same setting is **Settings → Build, Execution, Deployment → Build Tools →
Gradle → Gradle JDK**.

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. To run it on a real phone,
enable Developer options → USB debugging on the phone, plug it in, accept the debugging prompt,
then either press Run in Android Studio or `adb install -r <path-to-apk>`.

Both the phone and the computer must be on the same wifi, and `npm run dev` must be running with
the server reachable from the network. `http://` addresses are enabled automatically only while
the URL is not `https://`, which is what you want for LAN testing. Once you point it at a real
deployment, `cleartext` switches itself off.

## Scripts

```bash
npm run dev        # start the dev server on http://localhost:3000
npm test           # run the test suite (133 assertions)
npm run typecheck  # TypeScript, no emit
npm run lint       # ESLint
npm run build      # production build
npm run cap:sync   # copy config into the Android project
npm run cap:open   # open the Android project in Android Studio
```

## Project layout

```
src/
  app/
    page.tsx                  landing page
    login/  signup/           auth screens
    auth/callback/            OAuth / session exchange
    sheet/
      page.tsx                server component: materialises recurring rules, loads the ledger
      BalanceTracker.tsx      balance card, filters, history, mobile layout
  components/
    EntryForm.tsx             shared add/edit form
    RecurringPanel.tsx        recurring rule management
    CurrencySelect.tsx        (removed - the selector was taken out)
    SetupNotice.tsx           unconfigured-environment checklist
  lib/
    currency.ts               supported currencies, formatting, amount parsing
    currency.test.ts          60 assertions
    ledger.ts                 balance maths, filters, per-account totals, timestamps
    ledger.test.ts            48 assertions
    recurring.ts              due-date arithmetic and materialisation
    recurring.test.ts         25 assertions
    supabase/                 browser and server clients
supabase/
  schema.sql                  core tables, RLS policies, signup trigger
  accounts-and-recurring.sql  accounts, recurring rules, default account
capacitor.config.ts           Android WebView configuration
```

## Notes

- Deleting an account keeps its transactions — they are simply no longer attributed to an
  account, so history is never silently destroyed.
- Monthly catch-up is capped at 24 occurrences per rule per visit. If a rule has been dormant for
  years, the remainder is booked over the following visits rather than dumping a huge batch into
  your balance at once.
- If you signed up before the accounts migration, your existing account may still show the old
  default categories (Housing, Groceries, and so on). New signups get the current list.
