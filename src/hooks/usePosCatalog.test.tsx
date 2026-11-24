import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePosCatalog } from './usePosCatalog'

afterEach(cleanup)

describe('local catalog lifecycle', () => {
  it('loads local products offline, refreshes on sync and retains a usable snapshot on refresh failure', async () => {
    let changed = () => {}
    const list = vi.fn().mockResolvedValue({ success: true, data: [{ id: 'p', name: 'Milk', sku: 'M', is_active: true, selling_price: 100 }] })
    const unsubscribe = vi.fn()
    Object.defineProperty(window, 'api', { configurable: true, value: {
      products: { list }, on: (_event: string, cb: () => void) => { changed = cb; return unsubscribe },
    } })
    const { result, unmount } = renderHook(() => usePosCatalog('B1'))
    await waitFor(() => expect(result.current.catalog?.lookup('M')?.selling_price).toBe(100))
    expect(list).toHaveBeenCalledWith({ is_active: true, branch_id: 'B1' })
    list.mockResolvedValueOnce({ success: false, error: 'Local refresh failed' })
    act(() => changed())
    await waitFor(() => expect(result.current.error).toBe('Local refresh failed'))
    expect(result.current.catalog?.lookup('M')?.selling_price).toBe(100)
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('never exposes the previous branch catalog while the next branch is loading', async () => {
    const list = vi.fn().mockResolvedValueOnce({ success: true, data: [{ id: 'p', name: 'Milk', sku: 'M', is_active: true }] })
      .mockImplementationOnce(() => new Promise(() => {}))
    Object.defineProperty(window, 'api', { configurable: true, value: { products: { list }, on: () => () => {} } })
    const { result, rerender } = renderHook(({ branch }) => usePosCatalog(branch), { initialProps: { branch: 'B1' } })
    await waitFor(() => expect(result.current.catalog).toBeDefined())
    rerender({ branch: 'B2' })
    expect(result.current.catalog).toBeUndefined()
  })
})
