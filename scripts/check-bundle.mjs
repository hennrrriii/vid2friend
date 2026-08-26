/**
 * Verifies that the built extension is wired to the right code.
 *
 * This exists because of a bug that cost real debugging time and produced no
 * error anywhere: both entry points were called `index.ts`, CRXJS maps entries
 * to emitted bundles by file name, and so `service-worker-loader.js` ended up
 * importing the *content script's* chunk. The service worker therefore
 * registered no message listener, and every call from a YouTube tab failed with
 * "vid2friend is not responding". The build was green, the manifest looked
 * correct, and nothing in dist/ looked out of place.
 *
 * The checks below are deliberately about identity, not size: does the file the
 * service worker loads actually contain the service worker, and does the
 * content script's bundle stay free of the Supabase client.
 *
 * Runs as part of `npm run build`.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))

/** String literals that survive minification, one per entry point. */
const SERVICE_WORKER_MARKER = 'v2f-poll' // the chrome.alarms name
const CONTENT_MARKER = '__v2fContentLoaded' // the content script's boot flag

const failures = []

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    failures.push(`${label}${detail ? `\n        ${detail}` : ''}`)
    console.log(`  FAIL  ${label}`)
  }
}

const manifest = JSON.parse(await readFile(`${dist}manifest.json`, 'utf8'))

/** Follows a loader file to the chunk it imports and returns that chunk's code. */
async function loadedCode(loaderPath) {
  const loader = await readFile(`${dist}${loaderPath}`, 'utf8')
  const match = loader.match(/["'](?:\.\/)?(assets\/[^"']+\.js)["']/)
  if (!match) return { file: null, code: loader }
  return { file: match[1], code: await readFile(`${dist}${match[1]}`, 'utf8') }
}

console.log('checking the built extension...')

// --- service worker --------------------------------------------------------
const swEntry = manifest.background?.service_worker
check('manifest declares a service worker', Boolean(swEntry))

if (swEntry) {
  const sw = await loadedCode(swEntry)
  check(
    'the service worker bundle is the background code',
    sw.code.includes(SERVICE_WORKER_MARKER),
    `${swEntry} loads ${sw.file}, which does not contain ${SERVICE_WORKER_MARKER}`,
  )
  check(
    'the service worker bundle is not the content script',
    !sw.code.includes(CONTENT_MARKER),
    `${sw.file} contains the content script's boot flag`,
  )
}

// --- content scripts -------------------------------------------------------
const contentScripts = manifest.content_scripts ?? []
const entries = contentScripts.flatMap((entry) => entry.js ?? [])
check('manifest declares content scripts', entries.length > 0)

const bundles = []
for (const entry of entries) {
  bundles.push({ entry, ...(await loadedCode(entry)) })
}

check(
  'one content script bundle is the main content code',
  bundles.some((bundle) => bundle.code.includes(CONTENT_MARKER)),
  `checked ${bundles.map((b) => b.file ?? b.entry).join(', ')}`,
)

check(
  'no content script bundles the Supabase client',
  bundles.every((bundle) => !bundle.code.includes('supabase')),
  'content scripts must go through the service worker, see src/shared/supabase.ts',
)

// The invite capture script only earns its place by running early. If that
// ever regresses to document_idle it is dead weight, and invite links break in
// a way nothing else notices.
const capture = contentScripts.find((entry) =>
  (entry.js ?? []).some((file) => file.includes('invite-capture')),
)
check('the invite capture script is registered', Boolean(capture))
check(
  'the invite capture script runs at document_start',
  capture?.run_at === 'document_start',
  `run_at is ${capture?.run_at ?? 'unset'}`,
)

// --- permissions -----------------------------------------------------------
const permissions = manifest.permissions ?? []
check(
  'no permissions beyond storage and alarms',
  permissions.every((p) => p === 'storage' || p === 'alarms'),
  `found: ${permissions.join(', ')}`,
)
check(
  'host permissions are limited to YouTube and Supabase',
  (manifest.host_permissions ?? []).every(
    (h) => h.includes('youtube.com') || h.includes('supabase'),
  ),
  `found: ${(manifest.host_permissions ?? []).join(', ')}`,
)

// A build without .env still works, it just asks for every Supabase project.
// Worth a warning rather than a failure, because CI has no .env by design.
if ((manifest.host_permissions ?? []).includes('https://*.supabase.co/*')) {
  console.log(
    '\n  note  built without .env, so the manifest asks for every Supabase host.\n' +
      '        Fine locally. Fill in .env before building for the Chrome Web Store.',
  )
}

if (failures.length > 0) {
  console.error(`\nbundle check failed:\n\n  - ${failures.join('\n  - ')}\n`)
  process.exit(1)
}

console.log('\nbundle check passed.')
