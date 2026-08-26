import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

/**
 * The Supabase project lives on its own origin, so the extension needs an
 * explicit host permission for it. We derive that from VITE_SUPABASE_URL at
 * build time.
 *
 * If the variable is missing (fresh clone, no .env yet) we fall back to the
 * wildcard `https://*.supabase.co/*` so the extension still loads. For a Chrome
 * Web Store submission always build with a real .env present: reviewers ask why
 * a permission is needed, and "my project" is a much easier answer than
 * "every Supabase project on the internet".
 */
function supabaseHostPermission(supabaseUrl: string | undefined): string {
  if (!supabaseUrl) return 'https://*.supabase.co/*'
  try {
    return `${new URL(supabaseUrl).origin}/*`
  } catch {
    return 'https://*.supabase.co/*'
  }
}

export function createManifest(env: Record<string, string>) {
  return defineManifest({
    manifest_version: 3,
    name: 'vid2friend',
    // Chrome Web Store shows this under the name - keep it under 132 chars.
    description:
      'Send YouTube videos to friends. Their picks appear right at the top of your YouTube homepage instead of getting lost in chat.',
    version: pkg.version,

    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },

    action: {
      default_popup: 'src/popup/index.html',
      default_title: 'vid2friend',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },

    background: {
      service_worker: 'src/background/index.ts',
      type: 'module',
    },

    content_scripts: [
      {
        matches: ['https://www.youtube.com/*'],
        js: ['src/content/index.ts'],
        // document_idle keeps us out of YouTube's critical rendering path.
        run_at: 'document_idle',
      },
    ],

    /**
     * Deliberately minimal. Every extra permission slows down store review and
     * shows up as a scary warning on install.
     *   storage -> session + cached shelf data (chrome.storage.local)
     *   alarms  -> 5 minute polling fallback, because MV3 service workers die
     * We do NOT request `tabs` (messaging works without it) and never <all_urls>.
     */
    permissions: ['storage', 'alarms'],

    host_permissions: [
      'https://*.youtube.com/*',
      supabaseHostPermission(env.VITE_SUPABASE_URL),
    ],
  })
}
