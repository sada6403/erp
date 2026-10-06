import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Modal from './Modal'

afterEach(cleanup)

describe('Modal', () => {
  it('does not close from backdrop clicks or drag releases outside the dialog', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="Edit item" onClose={onClose}>
        <p>Select this text</p>
      </Modal>,
    )
    const backdrop = container.firstElementChild as HTMLElement

    fireEvent.click(backdrop)
    fireEvent.mouseDown(screen.getByText('Select this text'))
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes from Escape and the explicit close button', () => {
    const onClose = vi.fn()
    render(
      <Modal title="Edit item" onClose={onClose}>
        <p>Content</p>
      </Modal>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
