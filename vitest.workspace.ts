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
      // NOTE: previously also excluded 'src/**/*.test.ts' / 'electron/**/*.test.ts'
      // — those globs match `*.test.ts` as a suffix (glob `*` matches dots), so
      // they also matched this project's own `*.integration.test.ts` include
      // pattern and silently excluded every integration test that could ever
      // exist. The include list above is already narrow enough that a plain
      // `foo.test.ts` unit test can never match it, so those exclude entries
      // were redundant as well as self-defeating.
      exclude: ['e2e/**'],
      hookTimeout: 60_000,
      testTimeout: 60_000,
      pool: 'forks',
      // Each integration file defines its own Electron/electron-store mocks
      // and temp database. Run files sequentially (configured via --no-file-parallelism
      // in package.json test:integration, since fileParallelism is a runner-level option
      // not permitted in Vitest ProjectConfig), but in separate forked workers so
      // a hoisted Electron mock cannot leak into the next file.
      isolate: true,
      poolOptions: { forks: { singleFork: false, isolate: true } },
    },
  },
])
