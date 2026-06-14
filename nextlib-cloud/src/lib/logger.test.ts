import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sanitizeForLog, logger } from './logger'

describe('sanitizeForLog', () => {
  describe('PII field masking', () => {
    it('masks name field to first 3 chars + "***"', () => {
      const result = sanitizeForLog({ name: 'John Doe' })
      expect(result).toEqual({ name: 'Joh***' })
    })

    it('masks email field', () => {
      const result = sanitizeForLog({ email: 'john@university.ac.id' })
      expect(result).toEqual({ email: 'joh***' })
    })

    it('masks phone field', () => {
      const result = sanitizeForLog({ phone: '08123456789' })
      expect(result).toEqual({ phone: '081***' })
    })

    it('masks member_id field', () => {
      const result = sanitizeForLog({ member_id: 'MBR-12345' })
      expect(result).toEqual({ member_id: 'MBR***' })
    })

    it('masks nim field', () => {
      const result = sanitizeForLog({ nim: '2021001234' })
      expect(result).toEqual({ nim: '202***' })
    })

    it('masks address field', () => {
      const result = sanitizeForLog({ address: 'Jl. Merdeka No. 10' })
      expect(result).toEqual({ address: 'Jl.***' })
    })

    it('masks member_name field', () => {
      const result = sanitizeForLog({ member_name: 'Jane Smith' })
      expect(result).toEqual({ member_name: 'Jan***' })
    })

    it('handles short PII values (less than 3 chars)', () => {
      const result = sanitizeForLog({ name: 'AB' })
      expect(result).toEqual({ name: 'AB***' })
    })

    it('handles empty string PII values', () => {
      const result = sanitizeForLog({ name: '' })
      expect(result).toEqual({ name: '***' })
    })

    it('redacts non-string PII values', () => {
      const result = sanitizeForLog({ member_id: 12345 })
      expect(result).toEqual({ member_id: '[REDACTED]' })
    })

    it('preserves null PII values', () => {
      const result = sanitizeForLog({ name: null })
      expect(result).toEqual({ name: null })
    })

    it('preserves undefined PII values', () => {
      const result = sanitizeForLog({ name: undefined })
      expect(result).toEqual({ name: undefined })
    })
  })

  describe('secret field masking', () => {
    it('masks api_secret to first 8 chars + "..."', () => {
      const result = sanitizeForLog({ api_secret: 'sk_live_1234567890abcdef' })
      expect(result).toEqual({ api_secret: 'sk_live_...' })
    })

    it('masks token to first 8 chars + "..."', () => {
      const result = sanitizeForLog({ token: '1718000000.abcdef1234567890' })
      expect(result).toEqual({ token: '17180000...' })
    })

    it('handles short secret values (less than 8 chars)', () => {
      const result = sanitizeForLog({ token: 'short' })
      expect(result).toEqual({ token: 'short...' })
    })

    it('redacts non-string secret values', () => {
      const result = sanitizeForLog({ api_secret: 99999 })
      expect(result).toEqual({ api_secret: '[REDACTED]' })
    })

    it('preserves null secret values', () => {
      const result = sanitizeForLog({ token: null })
      expect(result).toEqual({ token: null })
    })
  })

  describe('case insensitivity', () => {
    it('masks fields regardless of case', () => {
      const result = sanitizeForLog({ Email: 'test@uni.id', NAME: 'Alice' })
      expect(result).toEqual({ Email: 'tes***', NAME: 'Ali***' })
    })

    it('masks Token regardless of case', () => {
      const result = sanitizeForLog({ Token: 'abcdefghijk123' })
      expect(result).toEqual({ Token: 'abcdefgh...' })
    })
  })

  describe('recursive sanitization', () => {
    it('sanitizes nested objects', () => {
      const data = {
        tenant: 'campus-a',
        member: {
          name: 'John Doe',
          email: 'john@uni.id',
        },
      }
      const result = sanitizeForLog(data)
      expect(result).toEqual({
        tenant: 'campus-a',
        member: {
          name: 'Joh***',
          email: 'joh***',
        },
      })
    })

    it('sanitizes arrays of objects', () => {
      const data = {
        members: [
          { name: 'Alice', nim: '2021001' },
          { name: 'Bob', nim: '2021002' },
        ],
      }
      const result = sanitizeForLog(data)
      expect(result).toEqual({
        members: [
          { name: 'Ali***', nim: '202***' },
          { name: 'Bob***', nim: '202***' },
        ],
      })
    })

    it('sanitizes deeply nested structures', () => {
      const data = {
        response: {
          data: {
            user: {
              name: 'Deep User',
              phone: '08111222333',
            },
          },
        },
      }
      const result = sanitizeForLog(data)
      expect(result).toEqual({
        response: {
          data: {
            user: {
              name: 'Dee***',
              phone: '081***',
            },
          },
        },
      })
    })

    it('handles arrays at top level', () => {
      const data = [{ name: 'Alice' }, { name: 'Bob' }]
      const result = sanitizeForLog(data)
      expect(result).toEqual([{ name: 'Ali***' }, { name: 'Bob***' }])
    })
  })

  describe('non-sensitive fields pass through', () => {
    it('does not mask non-PII fields', () => {
      const data = {
        tenant_id: 'uuid-123',
        status: 'connected',
        visitor_count: 150,
        loan_count: 45,
      }
      const result = sanitizeForLog(data)
      expect(result).toEqual(data)
    })

    it('preserves mixed sensitive and non-sensitive fields', () => {
      const data = {
        tenant_id: 'uuid-123',
        name: 'Universitas ABC',
        email: 'admin@abc.ac.id',
        status: 'active',
      }
      const result = sanitizeForLog(data)
      expect(result).toEqual({
        tenant_id: 'uuid-123',
        name: 'Uni***',
        email: 'adm***',
        status: 'active',
      })
    })
  })

  describe('edge cases', () => {
    it('returns null for null input', () => {
      expect(sanitizeForLog(null)).toBeNull()
    })

    it('returns undefined for undefined input', () => {
      expect(sanitizeForLog(undefined)).toBeUndefined()
    })

    it('passes through string primitives', () => {
      expect(sanitizeForLog('hello')).toBe('hello')
    })

    it('passes through number primitives', () => {
      expect(sanitizeForLog(42)).toBe(42)
    })

    it('passes through boolean primitives', () => {
      expect(sanitizeForLog(true)).toBe(true)
    })

    it('handles empty object', () => {
      expect(sanitizeForLog({})).toEqual({})
    })

    it('handles empty array', () => {
      expect(sanitizeForLog([])).toEqual([])
    })
  })
})

describe('logger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logger.info sanitizes PII and logs with [INFO] prefix', () => {
    logger.info('User action', { name: 'John', email: 'john@uni.id' })
    expect(infoSpy).toHaveBeenCalledWith(
      '[INFO] User action',
      { name: 'Joh***', email: 'joh***' }
    )
  })

  it('logger.warn sanitizes PII and logs with [WARN] prefix', () => {
    logger.warn('Suspicious activity', { member_id: 'MBR-999' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[WARN] Suspicious activity',
      { member_id: 'MBR***' }
    )
  })

  it('logger.error sanitizes PII and logs with [ERROR] prefix', () => {
    logger.error('Failed auth', { token: 'abc123456789xyz' })
    expect(errorSpy).toHaveBeenCalledWith(
      '[ERROR] Failed auth',
      { token: 'abc12345...' }
    )
  })

  it('logger handles multiple arguments', () => {
    logger.info('Event', { name: 'Alice' }, { phone: '08123' })
    expect(infoSpy).toHaveBeenCalledWith(
      '[INFO] Event',
      { name: 'Ali***' },
      { phone: '081***' }
    )
  })

  it('logger handles primitive arguments without modification', () => {
    logger.info('Count', 42, 'items')
    expect(infoSpy).toHaveBeenCalledWith('[INFO] Count', 42, 'items')
  })
})
