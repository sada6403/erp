import type { IpcMain, IpcMainInvokeEvent } from 'electron'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => any

/**
 * Wraps ipcMain.handle with a standard try/catch so every handler in
 * electron/ipc/*.ts returns { success: false, error } on an unexpected
 * throw instead of crashing the IPC round-trip. Handlers that already
 * return their own { success, error } shape on validation failures are
 * unaffected — this only catches what would otherwise be an unhandled
 * exception. Signature intentionally mirrors ipcMain.handle's own
 * (event, ...args: any[]) shape so any existing handler function can be
 * passed through unchanged.
 */
export function safeHandle(ipcMain: IpcMain, channel: string, fn: Handler) {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return await fn(event, ...args)
    } catch (err) {
      return { success: false, error: (err as Error)?.message ?? String(err) }
    }
  })
}
