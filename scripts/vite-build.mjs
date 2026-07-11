import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const root = process.cwd()

await build({
  configFile: false,
  root,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['better-sqlite3', 'electron-store', 'bcryptjs', 'jsonwebtoken', 'nanoid'],
  },
})
