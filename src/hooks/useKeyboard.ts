import { useEffect, useCallback } from 'react'

type KeyHandler = (e: KeyboardEvent) => void

interface KeyBinding {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  handler: KeyHandler
  description?: string
}

export function useKeyboard(bindings: KeyBinding[], enabled = true) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!enabled) return

    for (const binding of bindings) {
      const keyMatch  = e.key === binding.key
      const ctrlMatch = !!binding.ctrl === (e.ctrlKey || e.metaKey)
      const shiftMatch = !!binding.shift === e.shiftKey
      const altMatch  = !!binding.alt === e.altKey

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        const target = e.target as HTMLElement
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        const isFKey  = e.key.startsWith('F') && e.key.length <= 3
        // Allow: F-keys always, Ctrl combos always, everything else only when not in input
        if (isInput && !isFKey && !e.ctrlKey && !e.altKey) continue

        e.preventDefault()
        binding.handler(e)
        return
      }
    }
  }, [bindings, enabled])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])
}

export const POS_SHORTCUTS = [
  { key: 'F1',        label: 'New Invoice' },
  { key: 'F2',        label: 'Customer' },
  { key: 'F3',        label: 'Hold' },
  { key: 'F4/F12',   label: 'Payment' },
  { key: 'F6',        label: 'Search' },
  { key: 'F7',        label: 'Products' },
  { key: 'F8',        label: 'Category' },
  { key: 'F9',        label: 'Discount' },
  { key: 'Enter',     label: 'Add / Confirm' },
  { key: '↑↓',       label: 'Navigate list' },
  { key: 'Ctrl+↑↓',  label: 'Cart item' },
  { key: '+/-',       label: 'Qty' },
  { key: 'Del',       label: 'Remove' },
  { key: 'Ctrl+1-3',  label: 'Bill type' },
  { key: 'Alt+T',     label: 'Theme' },
]
