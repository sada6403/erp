// Bridges renderer to Electron preload (window.api)

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { api: any }
}

export const api = window.api
