import Link from 'next/link'
import { isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupNotice } from '@/components/SetupNotice'
import SignupForm from './signup-form'

export default function SignupPage() {
  if (!isSupabaseConfigured) return <SetupNotice />

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-100">
          Create your account
        </h1>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          <SignupForm />
        </div>
        <p className="mt-4 text-center text-sm text-slate-400">
          Already registered?{' '}
          <Link href="/login" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
