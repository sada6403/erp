// Global Vitest setup — runs before every unit test.
// - Extends `expect` with @testing-library/jest-dom matchers
// - Resets the window.api mock so each test starts clean
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

// Default window.api mock — tests can override per-method with createMockApi().
;(globalThis as unknown as { window: unknown }).window = globalThis.window ?? {}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
