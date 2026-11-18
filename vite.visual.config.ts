import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import path from 'node:path'
/** Separate local-only entrypoint. Never imported by TanStack routes or the Worker build. */
export default defineConfig({
  envDir: false,
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  plugins: [react(), tailwind()],
  build: {
    outDir: 'visual-dist',
    rollupOptions: { input: 'visual/index.html' },
  },
  server: { host: '127.0.0.1', port: 3200, strictPort: true },
})
