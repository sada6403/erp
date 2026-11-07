import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import en from './en.json';
import ta from './ta.json';
import si from './si.json';
import { useThemeStore } from '@/store/themeStore';
import type { Lang } from '@/theme/fonts';

export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'si', label: 'සිංහල' },
];

function deviceLang(): Lang {
  const code = Localization.getLocales?.()[0]?.languageCode;
  return code === 'ta' || code === 'si' ? code : 'en';
}

/** Initial language: the saved choice, else the phone's language if we support it. */
function initialLang(): Lang {
  const saved = useThemeStore.getState().language;
  return saved ?? deviceLang();
}

export function initI18n() {
  if (i18n.isInitialized) return i18n;
  i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ta: { translation: ta }, si: { translation: si } },
    lng: initialLang(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
    compatibilityJSON: 'v4',
  });
  // Keep i18next in sync with the persisted Settings choice.
  useThemeStore.subscribe((s, prev) => {
    if (s.language !== prev.language) i18n.changeLanguage(s.language);
  });
  return i18n;
}

export default i18n;
