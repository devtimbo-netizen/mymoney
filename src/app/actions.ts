'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Signs the user out.
 *
 * This has to be a server action rather than a client-side call: the session
 * lives in cookies that the browser cannot clear on its own, so `router.push('/')`
 * alone does nothing except bounce straight back to /sheet. It also redirects
 * with a cache-busting query string, because Next.js would otherwise serve the
 * cached authenticated page.
 */
export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login?signedOut=1')
}
