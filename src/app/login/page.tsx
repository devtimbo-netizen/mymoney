import Link from 'next/link'
import { isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupNotice } from '@/components/SetupNotice'
import LoginForm from './login-form'

export default function LoginPage() {
  if (!isSupabaseConfigured) return <SetupNotice />

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-100">My Money</h1>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-sm text-slate-400">
          No account?{' '}
          <Link href="/signup" className="text-emerald-400 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  )
}
