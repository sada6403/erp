import { createMMKV } from 'react-native-mmkv';

/** Minimal string storage used by Zustand persist and the TanStack Query persister. */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createStorage(): StringStorage {
  try {
    const mmkv = createMMKV({ id: 'natural-plantation' });
    return {
      getItem: (k) => mmkv.getString(k) ?? null,
      setItem: (k, v) => mmkv.set(k, v),
      removeItem: (k) => void mmkv.remove(k),
    };
  } catch {
    // MMKV unavailable (unit tests, web): fall back to memory so the app still renders.
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

export const storage: StringStorage = createStorage();

/** Adapter for zustand `createJSONStorage`. */
export const zustandStorage = {
  getItem: (name: string) => storage.getItem(name),
  setItem: (name: string, value: string) => storage.setItem(name, value),
  removeItem: (name: string) => storage.removeItem(name),
};

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: caches are best effort */
  }
}
