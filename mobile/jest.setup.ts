// Global Jest setup: in-memory stand-ins for native modules.
jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  const make = () => ({
    getString: (k: string) => store.get(k),
    set: (k: string, v: string) => void store.set(k, v),
    remove: (k: string) => store.delete(k),
    delete: (k: string) => store.delete(k),
    contains: (k: string) => store.has(k),
    getAllKeys: () => Array.from(store.keys()),
    clearAll: () => store.clear(),
  });
  return { createMMKV: make, MMKV: make };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
  addEventListener: jest.fn(() => jest.fn()),
}));

jest.mock('expo-secure-store', () => {
  const mem = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void mem.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void mem.delete(k)),
  };
});

// expo-router pulls ESM-only navigation packages; unit tests only need a few hooks.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
  Redirect: () => null,
}));
