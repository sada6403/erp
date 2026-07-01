export function applySystemTheme(settings: Record<string, unknown>) {
  const theme = String(settings.theme || localStorage.getItem('theme') || 'dark')
  const isDark = theme === 'dark'
  document.documentElement.classList.toggle('dark', isDark)
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
  window.dispatchEvent(new Event('themechange'))
}

export async function loadAndApplySystemTheme() {
  const res = await window.api.settings.get()
  if (res.success && res.data) {
    applySystemTheme(res.data as Record<string, unknown>)
  }
}
