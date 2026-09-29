import { redirect } from 'next/navigation'
import { isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupNotice } from '@/components/SetupNotice'
import { createClient } from '@/lib/supabase/server'

export default async function RootPage() {
  if (!isSupabaseConfigured) return <SetupNotice />

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  redirect('/sheet')
}
