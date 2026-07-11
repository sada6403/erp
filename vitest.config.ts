import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Root config — only sets up path aliases. Per-project config lives in
// vitest.workspace.ts (the file Vitest 2.x requires for multi-project).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron': path.resolve(__dirname, './electron'),
    },
  },
})
