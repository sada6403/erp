import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import Modal from './Modal'
import { setSystemTheme } from '@/lib/systemTheme'

/**
 * The single sanctioned way to change the app theme.
 * - Clicking the button (or firing the `request-theme-toggle` window event, e.g.
 *   from the POS Alt+T shortcut) opens a confirmation dialog.
 * - The theme only changes after the user confirms, and the choice is persisted
 *   to app_settings so it never silently reverts on navigation / re-init.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains('dark'))
    const openConfirm = () => setConfirming(true)
    window.addEventListener('themechange', sync)
    window.addEventListener('request-theme-toggle', openConfirm)
    return () => {
      window.removeEventListener('themechange', sync)
      window.removeEventListener('request-theme-toggle', openConfirm)
    }
  }, [])

  const nextIsDark = !dark
  const nextLabel = nextIsDark ? 'Dark' : 'Light'

  async function confirmChange() {
    setSaving(true)
    const theme = nextIsDark ? 'dark' : 'light'
    setSystemTheme(theme)
    try {
      await window.api?.settings?.update?.({ theme })
    } catch {
      // Offline / no API — localStorage still holds the choice for this session.
    }
    setSaving(false)
    setConfirming(false)
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="p-2 rounded-lg hover:bg-[var(--bg-soft)] transition-colors"
        style={{ color: 'var(--text-3)' }}
        title="Change theme"
      >
        {dark ? <Sun size={16} className="text-yellow-500" /> : <Moon size={16} />}
      </button>

      {confirming && (
        <Modal
          title="Change Theme"
          size="sm"
          onClose={() => !saving && setConfirming(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" disabled={saving} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={saving} onClick={confirmChange}>
                {saving ? 'Switching…' : `Switch to ${nextLabel}`}
              </button>
            </div>
          }
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--bg-soft)' }}
            >
              {nextIsDark ? <Moon size={20} className="text-indigo-400" /> : <Sun size={20} className="text-yellow-500" />}
            </div>
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              Switch the app to <strong style={{ color: 'var(--text-1)' }}>{nextLabel} theme</strong>?
              This changes the appearance across all pages and will be remembered.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
