// Minimal `electron` module mock for tests that import app/ipcMain/etc.
// vi.mock('electron', () => electronMock)

import { vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMockIpcMain } from './ipcMain.js'

const ipc = createMockIpcMain()

export const electronMock = {
  app: {
    getPath: vi.fn((name: string) =>
      name === 'userData' ? join(tmpdir(), 'pos-erp-test') : tmpdir()
    ),
    getName: vi.fn(() => 'pos-erp'),
    getVersion: vi.fn(() => '0.0.0-test'),
    isPackaged: false,
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
    quit: vi.fn(),
    setAppUserModelId: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  ipcMain: ipc,
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
  net: { fetch: vi.fn() },
  Menu: {},
  session: { defaultSession: { clearCache: vi.fn() } },
}

export const ipcMock = ipc
