import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import { createManifest } from './manifest.config.ts'
import pkg from './package.json' with { type: 'json' }

export default defineConfig(({ mode }) => {
  // Third arg '' = load ALL env vars, not just VITE_ prefixed ones, so the
  // manifest builder can read VITE_SUPABASE_URL before Vite's define step runs.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), crx({ manifest: createManifest(env) })],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      target: 'esnext',
      // Extension review is easier when the shipped code is readable-ish, and
      // sourcemaps never leave our machine (they are gitignored with dist/).
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          // Stable-ish names make it obvious in chrome://extensions what loaded.
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    server: {
      // CRXJS needs a fixed port for HMR into the extension context.
      port: 5173,
      strictPort: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
