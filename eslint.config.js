//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  { ignores:['**/dist/**','.cloudflare/**','.wrangler/**','visual-dist/**','test-results/**','playwright-report/**'] },
  ...tanstackConfig,
  { files:['**/*.ts','**/*.tsx'], languageOptions:{parserOptions:{project:'./tsconfig.eslint.json'}} },
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
]
