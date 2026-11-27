import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BillRecallPanel from './BillRecallPanel'
afterEach(cleanup)
it('finds a bill by number and reprints the saved bill without creating a sale', async () => {
  const bill = { id: 'b', invoice_number: 'INV-1', status: 'completed', bill_type: 'RETAIL', paid_amount: 100, total_amount: 100, items: [{ id: 'i', product_name: 'Tea', quantity: 1, total: 100 }], payments: [] }
  const print = vi.fn().mockResolvedValue({ success: true })
  Object.defineProperty(window, 'api', { configurable: true, value: {
    invoices: { list: vi.fn().mockResolvedValue({ success: true, data: [bill] }) },
    reports: { transactionDetail: vi.fn().mockResolvedValue({ success: true, data: { ...bill, items: [{ ...bill.items[0], total: undefined, line_total: 100, discount_amount: 5, tax_amount: 2 }] } }) }, printer: { printInvoice: print },
  } })
  const append = vi.fn()
  render(<BillRecallPanel onAppend={append} disabled={false} />)
  fireEvent.change(screen.getByLabelText(/Find bill/), { target: { value: 'INV-1' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Open' }).closest('form')!)
  await screen.findByRole('button', { name: /Reprint/ })
  fireEvent.click(screen.getByRole('button', { name: /Reprint/ }))
  await waitFor(() => expect(print).toHaveBeenCalledOnce())
  expect(print.mock.calls[0][0]).toMatchObject({ invoice_number: 'INV-1', total_amount: 100 })
  expect(print.mock.calls[0][0].items[0]).toMatchObject({ line_total: 100, discount_amount: 5 })
  fireEvent.click(screen.getByRole('button', { name: 'Add items' }))
  expect(append).toHaveBeenCalledWith(expect.objectContaining({ id: bill.id, items: [expect.objectContaining({ total: 100, discount: 5, tax: 2 })] }))
})
