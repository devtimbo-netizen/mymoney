import type { CapacitorConfig } from '@capacitor/cli'

/**
 * This app is rendered on the server (Supabase auth, RLS, and the recurring-entry
 * catch-up all run there), so there is no static bundle to ship inside the APK.
 * Capacitor loads the deployed site in a WebView instead.
 *
 * CAPACITOR_SERVER_URL must point at the Next.js app, not at Supabase. The script
 * throws if it is missing, because a wrong URL here produces an app that opens
 * to a blank page or a JSON error with no obvious cause.
 *
 *   Deployed:  $env:CAPACITOR_SERVER_URL = "https://your-app.vercel.app"
 *   Emulator:  $env:CAPACITOR_SERVER_URL = "http://10.0.2.2:3000"   (dev server)
 *   Device:    $env:CAPACITOR_SERVER_URL = "http://192.168.x.x:3000" (same wifi)
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL

if (!serverUrl) {
  throw new Error(
    'CAPACITOR_SERVER_URL is not set. Point it at the running Next.js app, for example:\n' +
      '  $env:CAPACITOR_SERVER_URL = "http://10.0.2.2:3000"   # Android emulator -> dev server\n' +
      '  $env:CAPACITOR_SERVER_URL = "https://your-app.vercel.app"   # deployed\n' +
      'Then run: npx cap sync android',
  )
}

if (serverUrl.includes('supabase.co')) {
  throw new Error(
    `CAPACITOR_SERVER_URL points at Supabase (${serverUrl}), not at the web app. ` +
      'It must be the address the Next.js site is served from.',
  )
}

const config: CapacitorConfig = {
  appId: 'com.mymoney.tracker',
  appName: 'Cashio',
  webDir: 'public',
  server: {
    url: serverUrl,
    // Needed only for plain http during LAN testing. Turn off for production.
    cleartext: !serverUrl.startsWith('https://'),
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
