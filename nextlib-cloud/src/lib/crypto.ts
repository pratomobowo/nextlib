import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPrivateKey,
  createPublicKey,
} from 'crypto'

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

/** An Ed25519 keypair: 32-byte public key + 32-byte raw seed, both base64-encoded. */
export interface Ed25519Keypair {
  /** 32 bytes, base64. Safe to ship in .env. */
  publicKey: string
  /** 32 bytes, base64 (RFC 8032 seed — the 32-byte private key, not the 64-byte expanded secret). Treat as secret; encrypt at rest. */
  privateKey: string
}

// Ed25519 PKCS#8 v1 DER prefix wrapping a 32-byte raw seed.
// PrivateKeyInfo ::= SEQUENCE {
//   version INTEGER 0,
//   privateKeyAlgorithm AlgorithmIdentifier { id-Ed25519 (1.3.101.112) },
//   privateKey OCTET STRING { OCTET STRING <32-byte seed> }
// }
// Fixed-length, so we can prepend this prefix to any 32-byte seed.
const ED25519_PKCS8_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

// Ed25519 SPKI DER prefix wrapping a 32-byte raw public key.
// SubjectPublicKeyInfo ::= SEQUENCE {
//   algorithm AlgorithmIdentifier { id-Ed25519 },
//   subjectPublicKey BIT STRING { 0x00 unused-bits + <32-byte key> }
// }
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
])

const ED25519_KEY_LENGTH = 32

export function generateEd25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  // JWK export gives us the raw 32-byte values as base64url — convert to standard base64.
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { d: string }
  return {
    publicKey: Buffer.from(pubJwk.x, 'base64url').toString('base64'),
    privateKey: Buffer.from(privJwk.d, 'base64url').toString('base64'),
  }
}

/**
 * Sign an outbound request. Returns 64-byte detached signature as base64.
 * The message signed is: `${timestamp}.${method}.${path}.${body}`
 * (timestamp in seconds since epoch, as string; method uppercased).
 *
 * The private key is the 32-byte raw Ed25519 seed (RFC 8032), not a DER blob.
 */
export function signRequest(
  privateKeyBase64: string,
  timestamp: string,
  method: string,
  path: string,
  body: string
): string {
  const seed = Buffer.from(privateKeyBase64, 'base64')
  if (seed.length !== ED25519_KEY_LENGTH) {
    throw new Error(`Ed25519 private key must be ${ED25519_KEY_LENGTH} bytes, got ${seed.length}`)
  }
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  })
  const message = Buffer.from(`${timestamp}.${method.toUpperCase()}.${path}.${body}`, 'utf8')
  return cryptoSign(null, message, key).toString('base64')
}

/**
 * Verify a request signature. Returns false on any error (bad sig, wrong key,
 * expired timestamp, malformed input). maxAgeSec is the tolerance window.
 *
 * The public key is the raw 32-byte Ed25519 public key, not a DER blob.
 */
export function verifyRequestSignature(
  publicKeyBase64: string,
  signatureBase64: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
  maxAgeSec: number
): boolean {
  try {
    const ts = parseInt(timestamp, 10)
    if (!Number.isFinite(ts)) return false
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - ts) > maxAgeSec) return false

    const rawPub = Buffer.from(publicKeyBase64, 'base64')
    if (rawPub.length !== ED25519_KEY_LENGTH) return false
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPub]),
      format: 'der',
      type: 'spki',
    })
    const message = Buffer.from(`${timestamp}.${method.toUpperCase()}.${path}.${body}`, 'utf8')
    const sig = Buffer.from(signatureBase64, 'base64')
    return cryptoVerify(null, message, key, sig)
  } catch {
    return false
  }
}
