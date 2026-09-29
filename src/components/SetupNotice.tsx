export function SetupNotice({ title = 'Connect Supabase to continue' }: { title?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-amber-800/60 bg-amber-950/20 p-6">
        <h1 className="text-lg font-semibold text-amber-200">{title}</h1>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-amber-100/90">
          <li>
            Create a project at{' '}
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              supabase.com/dashboard
            </a>
          </li>
          <li>
            Copy <code>supabase/schema.sql</code> into the SQL editor and run it.
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code> and fill in the project URL
            and anon key.
          </li>
          <li>Restart the dev server.</li>
        </ol>
      </div>
    </main>
  )
}
