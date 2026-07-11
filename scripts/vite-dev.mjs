import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = process.cwd()
const port = Number(process.env.DEV_PORT || 5173)

const server = await createServer({
  configFile: false,
  root,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
  server: {
    port,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['better-sqlite3', 'electron-store', 'bcryptjs', 'jsonwebtoken', 'nanoid'],
  },
})

await server.listen()
server.printUrls()
