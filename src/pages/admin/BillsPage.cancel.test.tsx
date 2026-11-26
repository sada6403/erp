import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BillsPage from './BillsPage'
const auth = vi.hoisted(() => ({ user: null as unknown }))
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ user: auth.user }) }))

const bills = [
  { id: 'b1', invoice_number: 'MAIN-001-INV-2026-0047', created_at: '2026-11-26T05:45:24Z', total_amount: 450, status: 'completed', branch_name: 'Main Branch' },
  { id: 'b2', invoice_number: 'MAIN-001-INV-2026-0035', created_at: '2026-11-25T16:43:16Z', total_amount: 5840, status: 'completed', branch_name: 'Main Branch' },
  { id: 'b3', invoice_number: 'MAIN-001-INV-2026-0025', created_at: '2026-11-25T04:08:53Z', total_amount: 925, status: 'completed', branch_name: 'Main Branch' },
]
let remaining = [...bills]
const cancel = vi.fn(async (id: string) => { remaining = remaining.filter(b => b.id !== id); return { success: true } })

function setRole(permissions: Record<string, boolean>) {
  auth.user = { id: 'u1', name: 'Admin', role: { permissions } }
}

beforeEach(() => {
  remaining = [...bills]; cancel.mockClear()
  ;(window as any).api = {
    admin: { branches: { list: async () => ({ success: true, data: [] }) } },
    reports: { transactions: async () => ({ success: true, data: remaining, total: remaining.length }) },
    invoices: { cancel },
  }
})
afterEach(cleanup)

describe('Bills page: cancel dummy sales', () => {
  it('cancels all selected bills with a reason and reloads the list', async () => {
    setRole({ all: true })
    render(<BillsPage />)
    await screen.findByText('MAIN-001-INV-2026-0047')
    fireEvent.click(screen.getByLabelText('Select all bills on this page'))
    fireEvent.click(screen.getByText('Cancel selected bills'))
    const confirm = screen.getByRole('button', { name: 'Cancel bills' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Cancel reason'), { target: { value: 'Dummy test sales' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(3))
    expect(cancel).toHaveBeenCalledWith('b1', 'Dummy test sales')
    await waitFor(() => expect(screen.queryByText('MAIN-001-INV-2026-0047')).not.toBeInTheDocument())
  })

  it('cancels a single bill from its row', async () => {
    setRole({ all: true })
    render(<BillsPage />)
    await screen.findByText('MAIN-001-INV-2026-0035')
    fireEvent.click(screen.getAllByTitle('Cancel this bill and restore its stock')[1])
    fireEvent.change(screen.getByLabelText('Cancel reason'), { target: { value: 'test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel bills' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('b2', 'test'))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('hides cancel controls from a cashier', async () => {
    setRole({ pos: true })
    render(<BillsPage />)
    await screen.findByText('MAIN-001-INV-2026-0047')
    expect(screen.queryByTitle('Cancel this bill and restore its stock')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Select all bills on this page')).not.toBeInTheDocument()
  })
})
