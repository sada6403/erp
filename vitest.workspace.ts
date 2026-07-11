import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    // Pure functions + React component tests (happy-dom env)
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      environment: 'happy-dom',
      include: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'electron/**/*.test.ts',
      ],
      exclude: ['**/*.integration.test.ts', 'e2e/**'],
      setupFiles: ['./src/test/setup.ts'],
    },
  },
  {
    // Integration tests: real better-sqlite3 against an in-memory DB
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      environment: 'node',
      include: [
        'src/**/*.integration.test.ts',
        'electron/**/*.integration.test.ts',
      ],
      exclude: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'e2e/**'],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
])
