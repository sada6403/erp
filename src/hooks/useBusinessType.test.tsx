import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBusinessType } from './useBusinessType'
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }))

afterEach(cleanup)
describe('company module visibility', () => {
  it('updates existing screens when company settings refresh, and cleans up subscriptions', async () => {
    let type = 'retail'
    let listener: (() => void) | undefined
    const off = vi.fn()
    window.api = { settings: { get: vi.fn(async () => ({ success: true, data: { business_type: type } })) }, on: vi.fn((_channel, callback) => { listener=callback; return off }) }
    const { result, unmount } = renderHook(useBusinessType)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isSupermarket).toBe(false)
    type = ' Supermarket '
    await act(async () => { listener?.() })
    await waitFor(() => expect(result.current.isSupermarket).toBe(true))
    type = 'furniture'
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(result.current.isSupermarket).toBe(false))
    unmount()
    expect(off).toHaveBeenCalledOnce()
  })
  it('shows settings errors and recovers after retry', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ success: true, data: { business_type: 'supermarket' } })
    window.api = { settings: { get } }
    const { result } = renderHook(useBusinessType)
    await waitFor(() => expect(result.current.error).toBe('Offline'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.error).toBe('')
    expect(result.current.isSupermarket).toBe(true)
  })
  it('enables stock and profit for the current retail company without changing its industry', async () => {
    let enabled = true
    window.api = { settings: { get: vi.fn(async () => ({ success: true, data: { business_type: 'retail', supermarket_stock_enabled: enabled } })) } }
    const { result } = renderHook(useBusinessType)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.businessType).toBe('retail')
    expect(result.current.isSupermarket).toBe(true)
    enabled = false
    await act(async () => { await result.current.refresh() })
    expect(result.current.isSupermarket).toBe(false)
  })

})
