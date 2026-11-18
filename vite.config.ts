import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { workerConfig } from './cloudflare.config.ts'

const webDir = path.dirname(fileURLToPath(import.meta.url))

function emitCloudflareBuildOutput(): Plugin {
  let currentMode: string | undefined
  return {
    name: 'emit-cloudflare-build-output',
    apply: 'build',
    configResolved(resolvedConfig) {
      currentMode = resolvedConfig.mode
    },
    closeBundle() {
      if (this.environment.name !== 'ssr') return
      const ssrDir = path.resolve(webDir, 'dist/server')
      const clientDir = path.resolve(webDir, 'dist/client')
      if (!fs.existsSync(ssrDir) || !fs.existsSync(clientDir)) return

      const outputRoot = path.resolve(webDir, '.cloudflare/output/v0')
      const defaultWorkerDir = path.join(outputRoot, 'workers/default')
      const bundleDir = path.join(defaultWorkerDir, 'bundle')
      const assetsDir = path.join(defaultWorkerDir, 'assets')

      fs.rmSync(path.resolve(webDir, '.cloudflare/output'), {
        recursive: true,
        force: true,
      })
      fs.mkdirSync(bundleDir, { recursive: true })
      fs.mkdirSync(assetsDir, { recursive: true })

      for (const entry of fs.readdirSync(ssrDir)) {
        if (entry === 'wrangler.json' || entry === '.dev.vars') continue
        fs.cpSync(path.join(ssrDir, entry), path.join(bundleDir, entry), {
          recursive: true,
        })
      }

      for (const entry of fs.readdirSync(clientDir)) {
        if (
          entry === 'wrangler.json' ||
          entry === '.dev.vars' ||
          entry === '.assetsignore'
        ) {
          continue
        }
        fs.cpSync(path.join(clientDir, entry), path.join(assetsDir, entry), {
          recursive: true,
        })
      }

      const { entrypoint: _entrypoint, ...workerOutput } = workerConfig
      const isPreview = process.env.CLOUDFLARE_PREVIEW_BUILD === 'true'
      const rootConfig = {
        buildContext: {
          isPreview,
          ...(currentMode && currentMode !== 'production'
            ? { mode: currentMode }
            : {}),
        },
      }
      const workerConfigJson = {
        ...workerOutput,
        manifest: {
          type: 'partial',
          mainModule: 'index.js',
          modules: {},
        },
      }

      fs.writeFileSync(
        path.join(outputRoot, 'config.json'),
        JSON.stringify(rootConfig, null, 2),
      )
      fs.writeFileSync(
        path.join(defaultWorkerDir, 'worker.config.json'),
        JSON.stringify(workerConfigJson, null, 2),
      )
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  optimizeDeps: {
    // Base UI is imported per component from lazily split routes. Listing
    // the subpaths up front stops Vite from re-optimizing mid-session, which
    // breaks the first visit to a route with a 504 "Outdated Optimize Dep".
    include: [
      '@base-ui/react/accordion',
      '@base-ui/react/alert-dialog',
      '@base-ui/react/avatar',
      '@base-ui/react/button',
      '@base-ui/react/checkbox',
      '@base-ui/react/collapsible',
      '@base-ui/react/context-menu',
      '@base-ui/react/dialog',
      '@base-ui/react/direction-provider',
      '@base-ui/react/drawer',
      '@base-ui/react/input',
      '@base-ui/react/menu',
      '@base-ui/react/menubar',
      '@base-ui/react/merge-props',
      '@base-ui/react/navigation-menu',
      '@base-ui/react/popover',
      '@base-ui/react/preview-card',
      '@base-ui/react/progress',
      '@base-ui/react/radio',
      '@base-ui/react/radio-group',
      '@base-ui/react/scroll-area',
      '@base-ui/react/select',
      '@base-ui/react/separator',
      '@base-ui/react/slider',
      '@base-ui/react/switch',
      '@base-ui/react/tabs',
      '@base-ui/react/toast',
      '@base-ui/react/toggle',
      '@base-ui/react/toggle-group',
      '@base-ui/react/tooltip',
      '@base-ui/react/use-render',
    ],
  },
  plugins: [
    devtools(),
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      // Account-specific bindings come from cloudflare.config.ts (.env.cloudflare),
      // so wrangler.jsonc stays a generic baseline.
      config: {
        name: workerConfig.name,
        d1_databases: [
          {
            binding: 'DB',
            database_name: workerConfig.env.DB.name,
            database_id: workerConfig.env.DB.id,
            migrations_dir: 'migrations',
          },
        ],
        r2_buckets: [
          { binding: 'AVATARS', bucket_name: workerConfig.env.AVATARS.name },
        ],
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
    emitCloudflareBuildOutput(),
  ],
})

export default config
