// In-memory replacement for `electron-store`. Use via:
//   vi.mock('electron-store', () => ({ default: FakeStore }))
// The class is hoisted before the SUT import, which is required because many
// handler modules instantiate `new Store()` at module scope.

export class FakeStore {
  data = new Map<string, unknown>()

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value)
  }

  delete(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  // electron-store uses path/config — provide stubs to satisfy call sites
  path = '/tmp/fake-store'
  store = this.data
}
