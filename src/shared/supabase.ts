/**
 * The Supabase client.
 *
 * Created in two places: the service worker and the popup. Both share the same
 * session through chrome.storage.local, and supabase-js coordinates token
 * refreshes between them with the Web Locks API, which exists in both contexts.
 *
 * The content script deliberately does NOT create a client. It talks to the
 * service worker over chrome.runtime messaging instead. Two reasons: it keeps
 * ~60 kB of client library out of every YouTube page load, and it means there
 * is exactly one thing refreshing the auth token no matter how many tabs are
 * open.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from './env'
import { AUTH_STORAGE_KEY, chromeStorageAdapter } from './storage'
import { log } from './log'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client

  if (!isConfigured) {
    throw new Error(
      'V2F_NOT_CONFIGURED: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. See README section 2.',
    )
  }

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: chromeStorageAdapter,
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // There is no OAuth redirect anywhere in this extension, and leaving this
      // on would make supabase-js poke at window.location in contexts that have
      // no window at all.
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
    global: {
      headers: { 'x-client-info': `vid2friend/${__APP_VERSION__}` },
    },
  })

  return client
}

/**
 * Makes sure we have a session, creating an anonymous one on first run.
 *
 * The user never sees this. It exists so that `auth.uid()` is a real value and
 * RLS has something to work with - without a JWT every policy would deny.
 */
export async function ensureSession(): Promise<string | null> {
  const supabase = getSupabase()

  const { data: existing } = await supabase.auth.getSession()
  if (existing.session) return existing.session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) {
    // The single most likely cause, and the one nobody finds on their own.
    log.error(
      'anonymous sign-in failed. Is "Allow anonymous sign-ins" enabled in the Supabase dashboard under Authentication > Sign In / Providers?',
      error,
    )
    throw error
  }

  log.info('created anonymous session')
  return data.session?.user.id ?? null
}
