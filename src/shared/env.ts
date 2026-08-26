/**
 * Build-time configuration, injected by Vite from `.env`.
 *
 * The anon key is public by design - it identifies the project, it does not
 * grant access. Row Level Security decides what a given JWT may read or write.
 * See README section 6.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const SUPABASE_URL = url ?? ''
export const SUPABASE_ANON_KEY = anonKey ?? ''

/** True when .env was filled in. The UI shows a setup hint when this is false. */
export const isConfigured =
  SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('your-project-ref') &&
  SUPABASE_ANON_KEY.length > 20 &&
  SUPABASE_ANON_KEY !== 'your-anon-key'
