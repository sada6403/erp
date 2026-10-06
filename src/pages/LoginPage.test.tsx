import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage'

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ pinLogin: vi.fn(), user: null, init: vi.fn() }),
}))

vi.mock('@/hooks/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: { online: true, pending: 0 } }),
}))

vi.mock('@/lib/brandTheme', () => ({ applyBrandTheme: vi.fn() }))

describe('LoginPage company contact details', () => {
  let branding: Record<string, unknown>
  let settingsUpdated: (() => void) | undefined

  beforeEach(() => {
    localStorage.clear()
    branding = {
      company_name: 'Main Company',
      company_phone: '+94 11 234 5678',
      company_email: 'hello@example.com',
      company_address: '10 Main Street, Colombo',
    }
    settingsUpdated = undefined

    ;(window as unknown as { api: unknown }).api = {
      settings: {
        get: vi.fn(async () => ({ success: true, data: { ...branding } })),
        refreshBranding: vi.fn(async () => ({ success: true })),
      },
      license: { status: vi.fn(async () => ({ active: true })) },
      app: {
        getDeviceInfo: vi.fn(async () => ({ deviceId: 'test-device' })),
        getVersion: vi.fn(async () => '1.0.0'),
        getActivationInfo: vi.fn(async () => ({ workspace_id: 'test-workspace' })),
      },
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'settings:updated') settingsUpdated = callback
        return vi.fn()
      }),
    }
  })

  it('shows contact details in every login mode and refreshes contact-only changes', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('+94 11 234 5678')).toBeInTheDocument()
    expect(screen.getByText('hello@example.com')).toBeInTheDocument()
    expect(screen.getByText('10 Main Street, Colombo')).toBeInTheDocument()
    expect(screen.getByText('If you forgot your password, use Admin Login → Forgot Password or contact your administrator.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('+94 11 234 5678')).toBeInTheDocument()
    expect(screen.getByText('hello@example.com')).toBeInTheDocument()
    expect(screen.getByText('10 Main Street, Colombo')).toBeInTheDocument()
    expect(screen.getByText('If you forgot your password, use Admin Login → Forgot Password or contact your administrator.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Staff PIN/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Support Access' }))
    expect(screen.getByText('+94 11 234 5678')).toBeInTheDocument()
    expect(screen.getByText('hello@example.com')).toBeInTheDocument()
    expect(screen.getByText('10 Main Street, Colombo')).toBeInTheDocument()

    branding = {
      ...branding,
      company_phone: '+94 77 765 4321',
      company_email: 'support@example.com',
      company_address: '20 New Road, Kandy',
    }
    await act(async () => settingsUpdated?.())

    expect(await screen.findByText('+94 77 765 4321')).toBeInTheDocument()
    expect(screen.getByText('support@example.com')).toBeInTheDocument()
    expect(screen.getByText('20 New Road, Kandy')).toBeInTheDocument()
  })
})
