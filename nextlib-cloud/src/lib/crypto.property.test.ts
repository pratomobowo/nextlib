import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { encrypt, decrypt } from './crypto'

/**
 * Property 6: AES-256 Credential Encryption Round-Trip
 *
 * For all credential strings encrypted with AES-256-GCM, decrypting with
 * the same key must always produce the original plaintext.
 *
 * Formal: ∀ credential, key: decrypt(encrypt(credential, key), key) == credential
 *
 * **Validates: Requirements 5.3**
 */
describe('Property 6: AES-256 Credential Encryption Round-Trip', () => {
  // Generator for valid 64-char hex keys (256-bit)
  const hexCharArb = fc.constantFrom(
    ...'0123456789abcdef'.split('')
  )
  const hexKeyArb = fc
    .array(hexCharArb, { minLength: 64, maxLength: 64 })
    .map((chars) => chars.join(''))

  it('encrypt → decrypt == original for all credential strings', () => {
    fc.assert(
      fc.property(
        hexKeyArb,
        fc.string({ minLength: 0, maxLength: 1024 }),
        (key, credential) => {
          const ciphertext = encrypt(credential, key)
          const decrypted = decrypt(ciphertext, key)
          expect(decrypted).toBe(credential)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('encrypt → decrypt preserves URL-style credentials', () => {
    fc.assert(
      fc.property(
        hexKeyArb,
        fc.webUrl(),
        (key, url) => {
          const ciphertext = encrypt(url, key)
          const decrypted = decrypt(ciphertext, key)
          expect(decrypted).toBe(url)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('encrypt → decrypt preserves API key-style credentials', () => {
    // Generate strings resembling API keys (alphanumeric with dashes/underscores)
    const apiKeyArb = fc.stringMatching(/^[a-zA-Z0-9_-]{16,128}$/)

    fc.assert(
      fc.property(
        hexKeyArb,
        apiKeyArb,
        (key, apiKey) => {
          const ciphertext = encrypt(apiKey, key)
          const decrypted = decrypt(ciphertext, key)
          expect(decrypted).toBe(apiKey)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('encrypt → decrypt preserves unicode credential strings', () => {
    fc.assert(
      fc.property(
        hexKeyArb,
        fc.string({ minLength: 1, maxLength: 512 }),
        (key, credential) => {
          const ciphertext = encrypt(credential, key)
          const decrypted = decrypt(ciphertext, key)
          expect(decrypted).toBe(credential)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('decrypt with wrong key always throws', () => {
    fc.assert(
      fc.property(
        hexKeyArb,
        hexKeyArb,
        fc.string({ minLength: 1, maxLength: 512 }),
        (keyA, keyB, credential) => {
          // Only test when keys are different
          fc.pre(keyA !== keyB)

          const ciphertext = encrypt(credential, keyA)
          expect(() => decrypt(ciphertext, keyB)).toThrow()
        }
      ),
      { numRuns: 200 }
    )
  })
})
