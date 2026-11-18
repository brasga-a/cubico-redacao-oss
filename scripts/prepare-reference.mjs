import { execFileSync } from 'node:child_process'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const source = path.resolve('../web_reference'),
  destination = '/tmp/cubico-figma-reference'
const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
if (sha !== '5afd302b8346da860bebc0835ce87722b37dcffb')
  throw new Error(
    `Reference changed: ${sha}; review and update the manifest before comparing.`,
  )
const files = execFileSync('git', ['-C', source, 'ls-files', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
for (const file of files) {
  const target = path.join(destination, file)
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(path.join(source, file), target)
}
// Only the disposable copy's host configuration changes; reference sources remain identical.
await writeFile(
  path.join(destination, 'vite.config.ts'),
  `import{defineConfig}from'vite';import react from'@vitejs/plugin-react';import tailwind from'@tailwindcss/vite';import path from'node:path';export default defineConfig({envDir:false,resolve:{alias:{'@':path.resolve(import.meta.dirname,'src')}},plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:3300,strictPort:true}})`,
)
console.log(
  `Read-only reference copied at ${sha}. Run: cd ${destination} && bun install && bun run dev`,
)
