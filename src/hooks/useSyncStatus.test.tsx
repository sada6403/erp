import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncStatus } from './useSyncStatus'

describe('useSyncStatus', () => {
  const status = vi.fn()
  const trigger = vi.fn()

  beforeEach(() => {
    status.mockReset()
    trigger.mockReset()
    status
      .mockResolvedValueOnce({
        success: true,
        data: { pending: 0, failed: 0, online: true, running: false },
      })
      .mockResolvedValue({
        success: true,
        data: { pending: 1, failed: 0, online: true, running: false },
      })
    trigger.mockResolvedValue({ success: true })
    window.api = { sync: { status, trigger } }
  })

  it('keeps refresh stable when a status response updates hook state', async () => {
    const { result } = renderHook(() => useSyncStatus())

    await waitFor(() => expect(status).toHaveBeenCalledTimes(1))
    const firstRefresh = result.current.refresh

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.status.pending).toBe(1)
    expect(result.current.refresh).toBe(firstRefresh)
    expect(status).toHaveBeenCalledTimes(2)
  })
})
