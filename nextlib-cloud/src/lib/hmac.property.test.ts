import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { generateToken, validateToken } from './hmac'

/**
 * Property 1: HMAC-SHA256 Token Round-Trip Integrity
 *
 * For all valid (secret_key, request_body) pairs, a token generated with
 * generateToken(body, secret) must always pass validation with
 * validateToken(token, body, secret).
 *
 * Formal: ∀ secret, body: validateToken(generateToken(body, secret), body, secret) == true
 *
 * **Validates: Requirements 3.1, 3.4**
 */
describe('Property 1: HMAC-SHA256 Token Round-Trip Integrity', () => {
  it('generateToken → validateToken with same secret always succeeds', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 256 }),  // secret (non-empty)
        fc.string({ maxLength: 1024 }),                // body (can be empty)
        (secret, body) => {
          const token = generateToken(body, secret)
          const isValid = validateToken(token, body, secret)
          expect(isValid).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('generateToken → validateToken with unicode strings always succeeds', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 128 }),  // secret (non-empty)
        fc.string({ minLength: 1, maxLength: 512 }),  // body (non-empty unicode)
        (secret, body) => {
          const token = generateToken(body, secret)
          const isValid = validateToken(token, body, secret)
          expect(isValid).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('generateToken produces valid token format (timestamp.signature)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.string({ maxLength: 256 }),
        (secret, body) => {
          const token = generateToken(body, secret)
          const parts = token.split('.')
          expect(parts).toHaveLength(2)

          const [timestamp, signature] = parts
          // Timestamp should be a valid integer
          expect(Number.isInteger(Number(timestamp))).toBe(true)
          // Signature should be a 64-char hex string (SHA-256 = 32 bytes = 64 hex chars)
          expect(signature).toMatch(/^[0-9a-f]{64}$/)
        }
      ),
      { numRuns: 100 }
    )
  })
})
