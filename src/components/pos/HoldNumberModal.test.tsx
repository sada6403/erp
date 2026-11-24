import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import HoldNumberModal from './HoldNumberModal'

afterEach(cleanup)
describe('cashier chooses the hold number', () => {
  it('focuses the field and submits exactly the number typed using Enter', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    render(<HoldNumberModal onSubmit={submit} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Enter hold number')).toHaveFocus()
    await userEvent.setup().type(screen.getByLabelText('Enter hold number'), '007{Enter}')
    await waitFor(() => expect(submit).toHaveBeenCalledWith('007'))
    expect(submit).toHaveBeenCalledTimes(1)
  })
  it('keeps the dialog and entered number when a duplicate is rejected', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('Hold number is already in use'))
    render(<HoldNumberModal onSubmit={submit} onClose={vi.fn()} />)
    await userEvent.setup().type(screen.getByLabelText('Enter hold number'), '25{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('already in use')
    expect(screen.getByLabelText('Enter hold number')).toHaveValue('25')
  })
  it('rejects blank input and lets Escape cancel without saving', async () => {
    const submit = vi.fn(), close = vi.fn()
    render(<HoldNumberModal onSubmit={submit} onClose={close} />)
    fireEvent.click(screen.getByText('Hold (Enter)'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('Enter hold number'), { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })
})
