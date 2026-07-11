const { defineConfig } = require('vite')
const path = require('path')

module.exports = defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: { port: 5173 },
  optimizeDeps: {
    exclude: ['better-sqlite3', 'electron-store', 'bcryptjs', 'jsonwebtoken', 'nanoid'],
  },
})
