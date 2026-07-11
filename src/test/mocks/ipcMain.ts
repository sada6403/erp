// Fake IpcMain that records handlers and lets tests invoke them directly.
// Useful for invoking handler logic without spinning up Electron.

import { vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>

export function createMockIpcMain() {
  const handlers = new Map<string, Handler>()

  return {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: Handler) => {
      handlers.set(`on:${channel}`, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
    /** Invoke a previously-registered handler as if Electron had dispatched an IPC. */
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler registered for "${channel}"`)
      return Promise.resolve(handler({}, ...args)) as Promise<T>
    },
    get handlerCount() {
      return handlers.size
    },
    get channels() {
      return [...handlers.keys()]
    },
  }
}
