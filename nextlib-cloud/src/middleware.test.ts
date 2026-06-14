import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// We need to test the middleware under different NODE_ENV values.
// The middleware reads process.env.NODE_ENV at runtime, so we stub it per test.

describe('HTTPS enforcement middleware', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    vi.resetModules()
    process.env.NODE_ENV = originalEnv
  })

  async function loadMiddleware() {
    // Dynamic import to pick up fresh env per test
    const mod = await import('./middleware')
    return mod.middleware
  }

  function makeRequest(url: string, headers?: Record<string, string>): NextRequest {
    const req = new NextRequest(new URL(url), {
      headers: headers ? new Headers(headers) : undefined,
    })
    return req
  }

  describe('in production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('redirects HTTP to HTTPS when x-forwarded-proto is http', async () => {
      const middleware = await loadMiddleware()
      const request = makeRequest('https://example.com/dashboard', {
        'x-forwarded-proto': 'http',
      })

      const response = middleware(request)

      expect(response.status).toBe(301)
      const location = response.headers.get('location')
      expect(location).toContain('https://')
    })

    it('allows request when x-forwarded-proto is https', async () => {
      const middleware = await loadMiddleware()
      const request = makeRequest('https://example.com/api/v1/tenants', {
        'x-forwarded-proto': 'https',
      })

      const response = middleware(request)

      // NextResponse.next() returns a 200
      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    })

    it('allows request when URL scheme is https and no x-forwarded-proto header', async () => {
      const middleware = await loadMiddleware()
      const request = makeRequest('https://example.com/api/v1/tenants')

      const response = middleware(request)

      expect(response.status).toBe(200)
    })

    it('redirects when URL scheme is http and no x-forwarded-proto header', async () => {
      const middleware = await loadMiddleware()
      const request = makeRequest('http://example.com/api/v1/tenants')

      const response = middleware(request)

      expect(response.status).toBe(301)
      const location = response.headers.get('location')
      expect(location).toMatch(/^https:/)
    })
  })

  describe('in development', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development'
    })

    it('does not redirect HTTP in development', async () => {
      const middleware = await loadMiddleware()
      const request = makeRequest('http://localhost:3000/api/v1/tenants', {
        'x-forwarded-proto': 'http',
      })

      const response = middleware(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    })

    it('passes through HTTPS requests in development', async () => {
      const middleware = await loadMiddleware()
      const request = makeRequest('https://localhost:3000/api/v1/tenants', {
        'x-forwarded-proto': 'https',
      })

      const response = middleware(request)

      expect(response.status).toBe(200)
    })
  })

  describe('in test environment', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test'
    })

    it('does not enforce HTTPS in test environment', async () => {
      const middleware = await loadMiddleware()
      const request = makeRequest('http://localhost:3000/api/test', {
        'x-forwarded-proto': 'http',
      })

      const response = middleware(request)

      expect(response.status).toBe(200)
    })
  })
})
