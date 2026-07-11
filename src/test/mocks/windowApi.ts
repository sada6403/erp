// Factory for a typed mock of the preload-exposed `window.api` bridge.
// By default every method returns `{ success: true, data: null }`.
// Tests pass per-method overrides: createMockApi({ 'products:list': vi.fn().mockResolvedValue(...) })

import { vi, type Mock, expect } from 'vitest'

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

const DEFAULT_RESPONSE: ApiResponse<null> = { success: true, data: null }

/** Recursively build a mock object shaped like a category of api methods. */
function buildMock(overrides: Record<string, unknown> | undefined): unknown {
  const obj: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (typeof value === 'function') {
      obj[key] = value
    } else if (value && typeof value === 'object') {
      obj[key] = buildMock(value as Record<string, unknown>)
    } else {
      // Stand-in for an api group (e.g. `auth: { login: ... }`) that the test
      // didn't override — return a function that yields the default success.
      obj[key] = vi.fn(async () => DEFAULT_RESPONSE)
    }
  }
  return obj
}

export function createMockApi(overrides?: Record<string, unknown>) {
  const api = buildMock(overrides)
  // Catch-all proxy so `window.api.anything.you.want()` returns success without
  // requiring an explicit override.
  return new Proxy(api as object, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      if (prop === 'on') return vi.fn(() => vi.fn())
      return vi.fn(async () => DEFAULT_RESPONSE)
    },
  })
}

/** Install a fresh mock api onto the current window (call in beforeEach). */
export function installMockApi(overrides?: Record<string, unknown>) {
  ;(window as unknown as { api: unknown }).api = createMockApi(overrides)
}

/** Helper: assert a mock was called with specific IPC channel + args. */
export function expectIpc(mock: Mock, channel: string, ...args: unknown[]) {
  expect(mock).toHaveBeenCalledWith(channel, ...args)
}
