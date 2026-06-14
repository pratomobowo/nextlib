// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantRegistrationForm } from './tenant-registration-form'

describe('TenantRegistrationForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders form fields correctly', () => {
    render(<TenantRegistrationForm />)

    expect(screen.getByLabelText(/Nama Institusi/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Slug/)).toBeInTheDocument()
    expect(screen.getByLabelText(/URL SLiMS/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Daftarkan Tenant/ })).toBeInTheDocument()
  })

  it('shows validation errors on empty submission', async () => {
    const user = userEvent.setup()
    render(<TenantRegistrationForm />)

    await user.click(screen.getByRole('button', { name: /Daftarkan Tenant/ }))

    await waitFor(() => {
      expect(screen.getByText(/Nama institusi wajib diisi/)).toBeInTheDocument()
      expect(screen.getByText(/URL SLiMS wajib diisi/)).toBeInTheDocument()
    })
  })

  it('shows validation error for invalid URL', async () => {
    const user = userEvent.setup()
    render(<TenantRegistrationForm />)

    await user.type(screen.getByLabelText(/Nama Institusi/), 'Test University')
    await user.type(screen.getByLabelText(/URL SLiMS/), 'not-a-valid-url')
    await user.click(screen.getByRole('button', { name: /Daftarkan Tenant/ }))

    await waitFor(() => {
      expect(screen.getByText(/Harus berupa URL yang valid/)).toBeInTheDocument()
    })
  })

  it('shows slug preview from name input', async () => {
    const user = userEvent.setup()
    render(<TenantRegistrationForm />)

    await user.type(screen.getByLabelText(/Nama Institusi/), 'Universitas Teknologi Indonesia')

    await waitFor(() => {
      expect(screen.getByText('universitas-teknologi-indonesia')).toBeInTheDocument()
    })
  })

  it('submits form and displays token on success', async () => {
    const mockResponse = {
      id: '123',
      name: 'Test University',
      slug: 'test-university',
      status: 'pending',
      api_token: 'abc123secret',
      created_at: '2025-01-01T00:00:00Z',
    }

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    const user = userEvent.setup()
    render(<TenantRegistrationForm />)

    await user.type(screen.getByLabelText(/Nama Institusi/), 'Test University')
    await user.type(screen.getByLabelText(/URL SLiMS/), 'https://slims.test.ac.id')
    await user.click(screen.getByRole('button', { name: /Daftarkan Tenant/ }))

    await waitFor(() => {
      expect(screen.getByText('Tenant Berhasil Dibuat')).toBeInTheDocument()
      expect(screen.getByText('abc123secret')).toBeInTheDocument()
    })
  })

  it('displays server error on failed submission', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: true,
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: [{ path: 'slims_base_url', message: 'URL tidak valid' }],
        }),
    })

    const user = userEvent.setup()
    render(<TenantRegistrationForm />)

    await user.type(screen.getByLabelText(/Nama Institusi/), 'Test')
    await user.type(screen.getByLabelText(/URL SLiMS/), 'https://slims.test.ac.id')
    await user.click(screen.getByRole('button', { name: /Daftarkan Tenant/ }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('slims_base_url: URL tidak valid')
    })
  })

  it('shows slug validation error for invalid format', async () => {
    const user = userEvent.setup()
    render(<TenantRegistrationForm />)

    await user.type(screen.getByLabelText(/Nama Institusi/), 'Test')
    await user.type(screen.getByLabelText(/Slug/), 'INVALID SLUG!')
    await user.type(screen.getByLabelText(/URL SLiMS/), 'https://slims.test.ac.id')
    await user.click(screen.getByRole('button', { name: /Daftarkan Tenant/ }))

    await waitFor(() => {
      expect(screen.getByText(/Slug harus lowercase kebab-case/)).toBeInTheDocument()
    })
  })
})
