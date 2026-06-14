import { createHmac } from 'crypto'

/**
 * Generate an HMAC-SHA256 token for secure communication.
 * Token format: {timestamp}.{signature}
 * where signature = HMAC-SHA256(timestamp + requestBody, secret)
 */
export function generateToken(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', secret)
    .update(timestamp + body)
    .digest('hex')
  return `${timestamp}.${signature}`
}

/**
 * Validate an HMAC-SHA256 token against a given body and secret.
 * Returns true if the token signature matches the expected HMAC.
 */
export function validateToken(token: string, body: string, secret: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return false
  }

  const [timestamp, signature] = parts
  if (!timestamp || !signature) {
    return false
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(timestamp + body)
    .digest('hex')

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }

  return mismatch === 0
}

/**
 * Check if a token has expired based on its embedded timestamp.
 * @param token - The token string in format {timestamp}.{signature}
 * @param maxAge - Maximum age in seconds (default: 300 = 5 minutes)
 * @returns true if the token is expired
 */
export function isTokenExpired(token: string, maxAge: number = 300): boolean {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return true
  }

  const [timestampStr] = parts
  const timestamp = parseInt(timestampStr, 10)

  if (isNaN(timestamp)) {
    return true
  }

  const now = Math.floor(Date.now() / 1000)
  return (now - timestamp) > maxAge
}
