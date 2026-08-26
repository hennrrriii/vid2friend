/**
 * Concatenates supabase/migrations/*.sql into a single supabase/schema.sql.
 *
 * Why this exists: the README offers two ways to set up the database. The
 * Supabase CLI path uses the migrations directly. The dashboard path is
 * "open the SQL editor, paste one file, press Run" - and pasting five files in
 * the right order is exactly the kind of step people get wrong. The bundle is
 * committed so nobody has to run this script to follow the README.
 *
 * Run with: npm run sql:bundle
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const dir = here('../supabase/migrations')

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

const parts = [
  '-- ===========================================================================',
  '-- vid2friend :: complete schema',
  '-- ---------------------------------------------------------------------------',
  '-- GENERATED FILE - do not edit. Source of truth: supabase/migrations/*.sql',
  '-- Regenerate with: npm run sql:bundle',
  '--',
  '-- Paste this whole file into the Supabase SQL editor and press Run. It is',
  '-- safe to run on a fresh project; running it twice will fail on the CREATE',
  '-- TYPE statements, which is intentional (it means the schema is already in).',
  '-- ===========================================================================',
  '',
]

for (const file of files) {
  parts.push(`-- >>> ${file}`, '')
  parts.push((await readFile(`${dir}/${file}`, 'utf8')).trimEnd(), '')
}

await writeFile(here('../supabase/schema.sql'), parts.join('\n') + '\n', 'utf8')
console.log(`sql: bundled ${files.length} migrations into supabase/schema.sql`)
