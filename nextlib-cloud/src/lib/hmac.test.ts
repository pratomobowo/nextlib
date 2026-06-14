import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateToken, validateToken, isTokenExpired } from './hmac'
import { createHmac } from 'crypto'

describe('HMAC-SHA256 Token Utility', () => {
  const secretKey = 'test-secret-key-123'
  const requestBody = '{"query":"javascript","limit":10}'

  describe('generateToken', () => {
    it('generates token in {timestamp}.{signature} format', () => {
      const token = generateToken(requestBody, secretKey)
      const parts = token.split('.')
      expect(parts).toHaveLength(2)
      expect(/^\d+$/.test(parts[0])).toBe(true)
      expect(/^[a-f0-9]{64}$/.test(parts[1])).toBe(true)
    })

    it('uses current unix timestamp', () => {
      const before = Math.floor(Date.now() / 1000)
      const token = generateToken(requestBody, secretKey)
      const after = Math.floor(Date.now() / 1000)
      const timestamp = parseInt(token.split('.')[0], 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('produces correct HMAC-SHA256 hex signature', () => {
      const token = generateToken(requestBody, secretKey)
      const [timestamp, signature] = token.split('.')
      const expected = createHmac('sha256', secretKey)
        .update(timestamp + requestBody)
        .digest('hex')
      expect(signature).toBe(expected)
    })
  })

  describe('validateToken', () => {
    it('validates a freshly generated token', () => {
      const token = generateToken(requestBody, secretKey)
      expect(validateToken(token, requestBody, secretKey)).toBe(true)
    })

    it('rejects token with wrong secret key', () => {
      const token = generateToken(requestBody, secretKey)
      expect(validateToken(token, requestBody, 'wrong-key')).toBe(false)
    })

    it('rejects token with tampered body', () => {
      const token = generateToken(requestBody, secretKey)
      expect(validateToken(token, '{"tampered":true}', secretKey)).toBe(false)
    })

    it('rejects malformed token without dot separator', () => {
      expect(validateToken('nodot', requestBody, secretKey)).toBe(false)
    })

    it('rejects token with non-numeric timestamp', () => {
      expect(validateToken('abc.def', requestBody, secretKey)).toBe(false)
    })

    it('rejects token with tampered signature', () => {
      const token = generateToken(requestBody, secretKey)
      const [timestamp] = token.split('.')
      const tamperedToken = `${timestamp}.${'a'.repeat(64)}`
      expect(validateToken(tamperedToken, requestBody, secretKey)).toBe(false)
    })

    it('rejects token with wrong length signature', () => {
      const token = generateToken(requestBody, secretKey)
      const [timestamp] = token.split('.')
      const shortToken = `${timestamp}.abc123`
      expect(validateToken(shortToken, requestBody, secretKey)).toBe(false)
    })
  })

  describe('isTokenExpired', () => {
    it('returns false for freshly generated token', () => {
      const token = generateToken(requestBody, secretKey)
      expect(isTokenExpired(token)).toBe(false)
    })

    it('returns true for token older than maxAgeSeconds', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400
      const signature = createHmac('sha256', secretKey)
        .update(oldTimestamp.toString() + requestBody)
        .digest('hex')
      const oldToken = `${oldTimestamp}.${signature}`
      expect(isTokenExpired(oldToken)).toBe(true)
    })

    it('returns false for token within maxAgeSeconds', () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 100
      const signature = createHmac('sha256', secretKey)
        .update(recentTimestamp.toString() + requestBody)
        .digest('hex')
      const recentToken = `${recentTimestamp}.${signature}`
      expect(isTokenExpired(recentToken)).toBe(false)
    })

    it('supports custom maxAgeSeconds', () => {
      const timestamp = Math.floor(Date.now() / 1000) - 10
      const signature = createHmac('sha256', secretKey)
        .update(timestamp.toString() + requestBody)
        .digest('hex')
      const token = `${timestamp}.${signature}`
      expect(isTokenExpired(token, 5)).toBe(true)
      expect(isTokenExpired(token, 60)).toBe(false)
    })

    it('returns true for malformed token without dot', () => {
      expect(isTokenExpired('malformed')).toBe(true)
    })

    it('returns true for token with non-numeric timestamp', () => {
      expect(isTokenExpired('abc.signature')).toBe(true)
    })
  })

  describe('interoperability with PHP HmacSigner', () => {
    it('validates a token generated with known timestamp and body', () => {
      // Simulate what PHP HmacSigner would generate:
      // timestamp = "1700000000", body = "hello", secret = "mysecret"
      // signature = hash_hmac('sha256', '1700000000hello', 'mysecret')
      const phpSecret = 'mysecret'
      const phpBody = 'hello'
      const phpTimestamp = '1700000000'
      const expectedSig = createHmac('sha256', phpSecret)
        .update(phpTimestamp + phpBody)
        .digest('hex')
      const phpToken = `${phpTimestamp}.${expectedSig}`

      // Our validateToken should accept this
      expect(validateToken(phpToken, phpBody, phpSecret)).toBe(true)
    })
  })
})
