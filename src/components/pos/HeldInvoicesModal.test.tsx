import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import HeldInvoicesModal from './HeldInvoicesModal'

const restore = vi.hoisted(() => vi.fn())
vi.mock('@/store/cartStore', () => ({ useCartStore: () => ({ items: [], restoreCart: restore }) }))
afterEach(() => { cleanup(); restore.mockClear() })

describe('held bill keyboard list', () => {
  it('recalls the selected local hold with arrows and Enter', async () => {
    const recall = vi.fn().mockResolvedValue({ success: true, data: { items: ['restored'] } })
    Object.defineProperty(window, 'api', { configurable: true, value: { holds: {
      list: vi.fn().mockResolvedValue({ success: true, data: ['a', 'b'].map(id => ({ id, customer_name: id, total_amount: 100, created_at: '2026-11-22T10:00:00Z' })) }), recall,
    } } })
    const close = vi.fn()
    render(<HeldInvoicesModal onClose={close} />)
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(3))
    const dialog = screen.getByRole('dialog')
    expect(screen.getByLabelText('Hold number')).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(recall).toHaveBeenCalledWith('b')
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ items: ['restored'], globalDiscount: 0, billType: 'RETAIL' }))
  })

  it('accepts a typed hold number and acknowledges delivery after restoring normalized cart data', async () => {
    const recall = vi.fn().mockResolvedValue({ success: true, data: { items: [], bill_type: 'CREDIT', global_discount: 5, recall_token: 'request-1' } })
    const acknowledgeRecall = vi.fn().mockResolvedValue({ success: true })
    Object.defineProperty(window, 'api', { configurable: true, value: { holds: {
      list: vi.fn().mockResolvedValue({ success: true, data: [] }), recall, acknowledgeRecall,
    } } })
    const close = vi.fn()
    render(<HeldInvoicesModal onClose={close} />)
    const input = screen.getByLabelText('Hold number')
    fireEvent.change(input, { target: { value: 'h-01' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(recall).toHaveBeenCalledWith('H-01')
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ billType: 'CREDIT', globalDiscount: 5 }))
    expect(acknowledgeRecall).toHaveBeenCalledWith('request-1')
    expect(restore.mock.invocationCallOrder[0]).toBeLessThan(acknowledgeRecall.mock.invocationCallOrder[0])
  })
})
