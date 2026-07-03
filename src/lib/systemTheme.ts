type ThemeMode = 'dark' | 'light'

function normalizeTheme(value: unknown): ThemeMode | null {
  return value === 'dark' || value === 'light' ? value : null
}

export function setSystemTheme(theme: ThemeMode) {
  const isDark = theme === 'dark'
  document.documentElement.classList.toggle('dark', isDark)
  localStorage.setItem('theme', theme)
  window.dispatchEvent(new Event('themechange'))
}

export function applySystemTheme(
  settings: Record<string, unknown>,
  options: { preferStored?: boolean } = {},
) {
  const storedTheme = normalizeTheme(localStorage.getItem('theme'))
  const settingsTheme = normalizeTheme(settings.theme)
  const theme = (options.preferStored ? storedTheme : settingsTheme) ?? settingsTheme ?? storedTheme ?? 'dark'
  setSystemTheme(theme)
}

export async function loadAndApplySystemTheme() {
  const res = await window.api.settings.get()
  if (res.success && res.data) {
    applySystemTheme(res.data as Record<string, unknown>, { preferStored: true })
  }
}
