import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';
import type { ThemeKey } from '@/theme/themes';
import type { Lang } from '@/theme/fonts';

interface ThemeState {
  theme: ThemeKey;
  language: Lang;
  setTheme: (t: ThemeKey) => void;
  setLanguage: (l: Lang) => void;
}

/** Theme + language choice, persisted to MMKV and applied instantly. */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'olive',
      language: 'en',
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'np-theme', storage: createJSONStorage(() => zustandStorage) },
  ),
);
