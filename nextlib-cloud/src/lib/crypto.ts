import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16 // 128-bit auth tag

/**
 * Encrypt plaintext using AES-256-GCM.
 * Output format: base64(iv + authTag + ciphertext)
 *
 * @param plaintext - The string to encrypt
 * @param keyHex - The 256-bit key as a 64-character hex string
 * @returns Base64-encoded string containing IV + auth tag + ciphertext
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (64 hex characters)')
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  const authTag = cipher.getAuthTag()

  // Pack: iv (12) + authTag (16) + ciphertext (variable)
  const packed = Buffer.concat([iv, authTag, encrypted])
  return packed.toString('base64')
}

/**
 * Decrypt a base64-encoded ciphertext produced by encrypt().
 *
 * @param ciphertext - Base64-encoded string containing IV + auth tag + ciphertext
 * @param keyHex - The 256-bit key as a 64-character hex string
 * @returns The original plaintext string
 */
export function decrypt(ciphertext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (64 hex characters)')
  }

  const packed = Buffer.from(ciphertext, 'base64')

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short')
  }

  const iv = packed.subarray(0, IV_LENGTH)
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}
