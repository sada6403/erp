import { renderHook, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { useKeyboard } from './useKeyboard'

afterEach(cleanup)
describe('cashier keyboard isolation', () => {
  it('allows Escape in an input without interpreting ordinary typing as a shortcut', () => {
    const escape = vi.fn(), letter = vi.fn()
    renderHook(() => useKeyboard([{ key: 'Escape', handler: escape }, { key: 'p', handler: letter }]))
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.keyDown(input, { key: 'p' })
    expect(escape).toHaveBeenCalledOnce()
    expect(letter).not.toHaveBeenCalled()
    input.remove()
  })
  it('ignores events already handled by a child', () => {
    const handler = vi.fn()
    renderHook(() => useKeyboard([{ key: 'F4', handler }]))
    const event = new KeyboardEvent('keydown', { key: 'F4', cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(handler).not.toHaveBeenCalled()
  })
})
