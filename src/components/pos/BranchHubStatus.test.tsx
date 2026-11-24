import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import BranchHubStatus from './BranchHubStatus'

afterEach(cleanup)
describe('cashier Hub status', () => {
  it('shows authenticated Hub state and pending holds without guessing cloud connectivity', async () => {
    const unsubscribe = vi.fn()
    Object.defineProperty(window, 'api', { configurable: true, value: {
      holds: { hubStatus: vi.fn().mockResolvedValue({ success: true, data: { configured: true, hub_online: false, cloud: 'not_configured', pending: 2, recoverable: 1, last_hold_number: 'H-T01-0001' } }) },
      on: () => unsubscribe,
    } })
    const { unmount } = render(<BranchHubStatus />)
    await waitFor(() => expect(screen.getByText('Pending holds: 2')).toBeInTheDocument())
    expect(screen.getByText('Hub: Offline')).toBeInTheDocument()
    expect(screen.getByText('Hub cloud: Not configured')).toBeInTheDocument()
    expect(screen.getByText('Last hold: H-T01-0001')).toBeInTheDocument()
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
