import path from 'node:path'
import { preview } from 'vite'
import react from '@vitejs/plugin-react'

const root = process.cwd()
const port = Number(process.env.DEV_PORT || 4173)

const server = await preview({
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
  preview: {
    port,
    strictPort: true,
  },
})

server.printUrls()
