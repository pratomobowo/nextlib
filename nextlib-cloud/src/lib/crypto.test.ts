import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './crypto'
import { randomBytes } from 'crypto'

describe('AES-256-GCM Crypto Utility', () => {
  // Valid 32-byte key (64 hex chars)
  const validKey = 'a'.repeat(64)

  describe('encrypt', () => {
    it('returns a base64-encoded string', () => {
      const result = encrypt('hello world', validKey)
      // Should be valid base64
      expect(() => Buffer.from(result, 'base64')).not.toThrow()
      // base64 should decode to at least IV (12) + authTag (16) + some ciphertext
      const decoded = Buffer.from(result, 'base64')
      expect(decoded.length).toBeGreaterThan(28)
    })

    it('produces different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'same input'
      const result1 = encrypt(plaintext, validKey)
      const result2 = encrypt(plaintext, validKey)
      expect(result1).not.toBe(result2)
    })

    it('throws for invalid key length (too short)', () => {
      expect(() => encrypt('test', 'abcd')).toThrow(
        'Encryption key must be exactly 32 bytes'
      )
    })

    it('throws for invalid key length (too long)', () => {
      expect(() => encrypt('test', 'a'.repeat(128))).toThrow(
        'Encryption key must be exactly 32 bytes'
      )
    })

    it('handles empty plaintext', () => {
      const result = encrypt('', validKey)
      expect(result).toBeTruthy()
      expect(decrypt(result, validKey)).toBe('')
    })

    it('handles unicode plaintext', () => {
      const unicode = '🎉 Halo Perpustakaan Universitas! 日本語テスト'
      const encrypted = encrypt(unicode, validKey)
      expect(decrypt(encrypted, validKey)).toBe(unicode)
    })
  })

  describe('decrypt', () => {
    it('decrypts what encrypt produced', () => {
      const plaintext = 'secret data for tenant'
      const encrypted = encrypt(plaintext, validKey)
      const decrypted = decrypt(encrypted, validKey)
      expect(decrypted).toBe(plaintext)
    })

    it('throws for invalid key length', () => {
      const encrypted = encrypt('test', validKey)
      expect(() => decrypt(encrypted, 'short')).toThrow(
        'Encryption key must be exactly 32 bytes'
      )
    })

    it('throws for ciphertext that is too short', () => {
      const tooShort = Buffer.alloc(10).toString('base64')
      expect(() => decrypt(tooShort, validKey)).toThrow('Invalid ciphertext: too short')
    })

    it('throws for tampered ciphertext (auth tag verification fails)', () => {
      const encrypted = encrypt('original', validKey)
      const packed = Buffer.from(encrypted, 'base64')
      // Tamper with the ciphertext bytes
      packed[packed.length - 1] ^= 0xff
      const tampered = packed.toString('base64')
      expect(() => decrypt(tampered, validKey)).toThrow()
    })

    it('throws when decrypted with wrong key', () => {
      const encrypted = encrypt('secret', validKey)
      const wrongKey = 'b'.repeat(64)
      expect(() => decrypt(encrypted, wrongKey)).toThrow()
    })
  })

  describe('round-trip', () => {
    it('handles long plaintext', () => {
      const long = 'x'.repeat(10000)
      const encrypted = encrypt(long, validKey)
      expect(decrypt(encrypted, validKey)).toBe(long)
    })

    it('handles URL as plaintext', () => {
      const url = 'https://perpus.universitasabc.ac.id/slims9/index.php'
      const encrypted = encrypt(url, validKey)
      expect(decrypt(encrypted, validKey)).toBe(url)
    })

    it('works with a randomly generated key', () => {
      const randomKey = randomBytes(32).toString('hex')
      const plaintext = 'test with random key'
      const encrypted = encrypt(plaintext, randomKey)
      expect(decrypt(encrypted, randomKey)).toBe(plaintext)
    })
  })
})
